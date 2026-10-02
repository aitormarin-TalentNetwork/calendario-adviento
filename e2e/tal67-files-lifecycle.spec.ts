import { exec as execCb, execSync } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-67 — ciclo de vida de los ficheros (docs/dias.md § "Ficheros de TAL-67"):
 * fallos inyectados en cada frontera, borrado concurrente del día/calendario,
 * controles frente a `_storage` ajeno, registro duradero y su cierre (que
 * nunca borra), drenaje medido, lease, watchdog y concurrencia contando
 * ficheros en `_storage`.
 *
 * Solo con `TAL67_LIFECYCLE=1`: cambia variables de entorno del deployment de
 * Convex de `.env.local` (`ALLOW_TEST_HELPERS`, TTL corto, ganchos de fallo)
 * y se NIEGA si no es un deployment de dev. Las restaura al terminar.
 */
test.skip(process.env.TAL67_LIFECYCLE !== "1", "Solo con TAL67_LIFECYCLE=1 (cambia variables del Convex de dev)");
test.describe.configure({ mode: "serial" });
test.setTimeout(300_000);

const exec = promisify(execCb);
const ROOT = path.resolve(__dirname, "..");
const TTL_MS = 6_000;
const PAUSE_MS = 3_000;

function assertDev(): void {
  if (!(process.env.CONVEX_DEPLOYMENT ?? "").startsWith("dev:")) {
    throw new Error(`Solo contra un deployment de dev (CONVEX_DEPLOYMENT=${process.env.CONVEX_DEPLOYMENT}).`);
  }
}
function envSet(name: string, value: string): void {
  assertDev();
  execSync(`npx convex env set ${name} ${value}`, { cwd: ROOT, stdio: "pipe" });
}
function envRemove(name: string): void {
  assertDev();
  try {
    execSync(`npx convex env remove ${name}`, { cwd: ROOT, stdio: "pipe" });
  } catch {
    // ya no existía
  }
}
/** `npx convex run` de una función interna; devuelve el JSON del resultado. */
async function run<T = unknown>(fn: string, args: object = {}): Promise<T> {
  assertDev();
  const { stdout } = await exec(`npx convex run ${fn} '${JSON.stringify(args)}'`, { cwd: ROOT, maxBuffer: 50 * 1024 * 1024 });
  const text = stdout.trim();
  return (text === "" ? null : JSON.parse(text)) as T;
}

type Audit = {
  liveIntents: number;
  expiredRegistered: number;
  expiredUnregistered: number;
  registeredPending: number;
  oldestPendingAgeMs: number | null;
  oldestUnresolvedWindowAgeMs: number | null;
  danglingDayReferences: number;
  unresolvedWindows: {
    _id: string;
    status: string;
    kind: string;
    dayId: string;
    dayGone: boolean;
    windowStart: number;
    windowEnd: number;
    filesInWindowForReview: { storageId: string }[];
  }[];
};
type Page<T> = T & { isDone: boolean; continueCursor: string };

/** Recorre TODAS las páginas de una consulta paginada de auditoría (con tamaño de página pequeño a propósito). */
async function allPages<T>(fn: string, extra: object, numItems: number): Promise<Page<T>[]> {
  const pages: Page<T>[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 1000; i++) {
    const page: Page<T> = await run<Page<T>>(fn, { ...extra, cursor, numItems });
    pages.push(page);
    if (page.isDone) return pages;
    cursor = page.continueCursor;
  }
  throw new Error(`demasiadas páginas en ${fn}`);
}

type IntentsPage = { now: number; live: number; expiredRegistered: number; expiredUnregistered: number; registered: number; oldestRegisteredCreation: number | null };

/** Resumen de intenciones sumando páginas (de 7 en 7). */
async function intentsSummary() {
  const pages = await allPages<IntentsPage>("dayFiles:auditIntentsPage", {}, 7);
  const sum = (k: keyof IntentsPage) => pages.reduce((n, p) => n + (p[k] as number), 0);
  const oldest = pages.map((p) => p.oldestRegisteredCreation).filter((x): x is number => x !== null);
  const now = pages[pages.length - 1].now;
  return {
    liveIntents: sum("live"),
    expiredRegistered: sum("expiredRegistered"),
    expiredUnregistered: sum("expiredUnregistered"),
    registeredPending: sum("registered"),
    oldestPendingAgeMs: oldest.length ? now - Math.min(...oldest) : null,
    now,
  };
}

/** Auditoría completa recorriendo todas las páginas (ventanas de 3 en 3, candidatos de 4 en 4). */
async function audit(): Promise<Audit> {
  const intents = await intentsSummary();
  const windowPages = await allPages<{ windows: Audit["unresolvedWindows"] }>("dayFiles:listUnresolvedWindowsPage", {}, 3);
  const windows = windowPages.flatMap((p) => p.windows);
  const unresolvedWindows = [] as Audit["unresolvedWindows"];
  for (const w of windows) {
    const cand = await allPages<{ candidates: { storageId: string }[] }>("dayFiles:windowCandidatesPage", { windowId: w._id }, 4);
    unresolvedWindows.push({ ...w, filesInWindowForReview: cand.flatMap((c) => c.candidates) });
  }
  const refs = await allPages<{ dangling: number }>("dayFiles:auditDayReferencesPage", {}, 7);
  const created = windows.map((w) => (w as unknown as { _creationTime: number })._creationTime);
  return {
    ...intents,
    unresolvedWindows,
    oldestUnresolvedWindowAgeMs: created.length ? intents.now - Math.min(...created) : null,
    danglingDayReferences: refs.reduce((n, r) => n + r.dangling, 0),
  };
}
const storage = (ids: string[] = []) => run<{ total: number; exists: Record<string, boolean> }>("dayFiles:storageInfoForTests", { storageIds: ids });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Arranca un drenaje y espera a que termine (lease liberado y nada expirado registrado). */
async function drainNow(): Promise<number> {
  const started = Date.now();
  await run("dayFiles:startReconcile");
  await expect
    .poll(async () => {
      const [a, lease] = await Promise.all([intentsSummary(), run("dayFiles:leaseForTests")]);
      return a.expiredRegistered === 0 && a.expiredUnregistered === 0 && lease === null;
    }, { timeout: 240_000, intervals: [500, 1000, 2000] })
    .toBe(true);
  return Date.now() - started;
}

const runId = uniqueRunId();
const YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const YOUTUBE_2 = "https://www.youtube.com/watch?v=9bZkp7q19f0";
const SITE_URL = process.env.NEXT_PUBLIC_CONVEX_SITE_URL!;
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

let sId: Id<"users">;
let cal: Id<"calendars">;
let dateCounter = 0;
const createdCalendars = new Set<Id<"calendars">>();

async function newCalendar(tag: string): Promise<Id<"calendars">> {
  const id = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: sId,
    name: `TAL-67 ciclo ${tag} ${runId}`,
    coverTitle: "ciclo",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    creationKey: `e2e-tal67-ciclo-${tag}-${runId}`,
  });
  createdCalendars.add(id);
  return id;
}

function nextDate(): string {
  dateCounter += 1;
  const d = new Date(Date.UTC(2026, 0, 1 + dateCounter));
  return d.toISOString().slice(0, 10);
}

const saveDay = (calendarId: Id<"calendars">, date: string, videoUrl: string) =>
  convex.action(api.days.saveDayPublic, { serverSecret: serverSecret(), actorUserId: sId, calendarId, date, videoUrl });

async function dayIdOf(calendarId: Id<"calendars">, date: string): Promise<Id<"days">> {
  const view = await convex.query(api.guestCalendar.resolveCalendarDaysForGuestPublic, {
    serverSecret: serverSecret(),
    calendarId,
    userId: sId,
  });
  return view!.days.find((d) => d.date === date)!.dayId;
}

const upload = (calendarId: Id<"calendars">, date: string) =>
  fetch(`${SITE_URL}/tal67/day-image`, {
    method: "POST",
    headers: { "x-server-secret": serverSecret(), "x-actor-user-id": sId, "x-calendar-id": calendarId, "x-day-date": date },
    body: PNG_1PX,
  });

async function youtubeThumbnailBase64(): Promise<string> {
  const res = await fetch("https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}

test.beforeAll(async () => {
  assertDev();
  envSet("ALLOW_TEST_HELPERS", "1");
  envSet("DAY_FILE_INTENT_TTL_MS", String(TTL_MS));
  envRemove("DAY_FILES_FAULT");
  envRemove("DAY_FILES_PAUSE_AT");
  sId = await seedUser({ email: `e2e-tal67ciclo-super-${runId}@example.com`, superAdmin: true });
  cal = await newCalendar("principal");
  // Punto de partida limpio: nada pendiente de ejecuciones anteriores.
  await sleep(TTL_MS);
  await drainNow();
});

test.afterAll(async () => {
  for (const name of ["DAY_FILES_FAULT", "DAY_FILES_PAUSE_AT", "DAY_FILE_RECONCILE_BATCH", "DAY_FILE_RECONCILE_LEASE_MS", "DAY_FILE_INTENT_TTL_MS", "ALLOW_TEST_HELPERS"]) {
    envRemove(name);
  }
  for (const id of createdCalendars) {
    await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId: id, userId: sId }).catch(() => {});
  }
});

test("7 · concurrencia N=10 contando ficheros en _storage (misma URL, URLs distintas, guardado || migración)", async () => {
  const N = 10;
  const sameUrlDeltas: number[] = [];
  for (let i = 0; i < N; i++) {
    const date = nextDate();
    const before = (await storage()).total;
    const results = await Promise.all(Array.from({ length: 5 }, () => saveDay(cal, date, YOUTUBE)));
    const after = (await storage()).total;
    sameUrlDeltas.push(after - before);
    expect(results.filter((r) => r.ok && r.thumbnail === "stored").length).toBeGreaterThanOrEqual(1);
  }
  console.log("TAL-67 misma URL (5 guardados simultáneos x10), ficheros nuevos por iteración:", JSON.stringify(sameUrlDeltas));
  expect(sameUrlDeltas).toEqual(Array(N).fill(1));

  const diffUrlDeltas: number[] = [];
  for (let i = 0; i < N; i++) {
    const date = nextDate();
    const before = (await storage()).total;
    await Promise.all([saveDay(cal, date, YOUTUBE), saveDay(cal, date, YOUTUBE_2)]);
    const day = (await convex.query(api.days.getCalendarDaysPublic, { serverSecret: serverSecret(), calendarId: cal })).days.find((d) => d.date === date)!;
    diffUrlDeltas.push((await storage()).total - before);
    // La copia que queda es de la URL final del día: se comprueba re-guardando la URL final → "unchanged".
    expect(await saveDay(cal, date, day.videoUrl)).toMatchObject({ thumbnail: "unchanged" });
  }
  console.log("TAL-67 URLs distintas (2 simultáneos x10), ficheros nuevos por iteración:", JSON.stringify(diffUrlDeltas));
  expect(diffUrlDeltas).toEqual(Array(N).fill(1));

  // Guardado del Admin || migración sobre el mismo día. Primero una pasada
  // completa de migración para que el resto de días ya tenga su estado.
  await run("dayThumbnails:runThumbnailBackfill", { migrationId: `tal67-ciclo-base-${runId}`, batchSize: 25 });
  const migDeltas: number[] = [];
  for (let i = 0; i < 3; i++) {
    const date = nextDate();
    await convex.mutation(api.days.upsertDayPublic, { serverSecret: serverSecret(), calendarId: cal, date, videoUrl: YOUTUBE });
    const before = (await storage()).total;
    await Promise.all([
      saveDay(cal, date, YOUTUBE),
      run("dayThumbnails:runThumbnailBackfill", { migrationId: `tal67-ciclo-race-${runId}-${i}`, batchSize: 25 }),
    ]);
    migDeltas.push((await storage()).total - before);
  }
  console.log("TAL-67 guardado || migración, ficheros nuevos por iteración:", JSON.stringify(migDeltas));
  expect(migDeltas).toEqual([1, 1, 1]);
  const a = await audit();
  expect(a.liveIntents + a.registeredPending).toBe(0);
  expect(a.danglingDayReferences).toBe(0);
});

test("11+12 · fallo tras registrar (copia y subida) → el limpiador lo borra; los ficheros ajenos sobreviven (contraejemplo incluido)", async () => {
  const base = (await storage()).total;

  // Fichero de TAL-67 registrado y no enlazado (la action muere tras registrar).
  envSet("DAY_FILES_FAULT", "after-register");
  const d1 = nextDate();
  await expect(saveDay(cal, d1, YOUTUBE)).rejects.toThrow(/Fallo inyectado/);
  const d2 = nextDate();
  await saveDay(cal, d2, "https://example.com/v.mp4").catch(() => {}); // crea el día sin copia
  envSet("DAY_FILES_FAULT", "after-register");
  const up = await upload(cal, d2);
  expect(up.status).toBe(500);
  envRemove("DAY_FILES_FAULT");
  expect((await storage()).total).toBe(base + 2);
  const pending = await audit();
  expect(pending.registeredPending).toBeGreaterThanOrEqual(2);

  // Controles: ficheros que NO son de TAL-67 (o que sí lo son pero están enlazados).
  const ytBase64 = await youtubeThumbnailBase64();
  const sameContentAfter = await run<string>("dayFiles:storeUntrackedFileForTests", { base64: ytBase64, contentType: "image/jpeg" });
  const referencedElsewhere = await run<string>("dayFiles:storeUntrackedFileForTests", { base64: ytBase64, contentType: "image/jpeg" });
  await run("dayFiles:referenceFromOtherTableForTests", { storageId: referencedElsewhere, dayId: await dayIdOf(cal, d2) });
  const randomForeign = await run<string>("dayFiles:storeUntrackedFileForTests", { base64: PNG_1PX.toString("base64"), contentType: "image/png" });
  const linkedDay = nextDate();
  await saveDay(cal, linkedDay, YOUTUBE_2);
  const linkedUrl = (await convex.query(api.days.getCalendarDaysPublic, { serverSecret: serverSecret(), calendarId: cal })).days.find((d) => d.date === linkedDay)!.imageUrl!;

  await sleep(TTL_MS + 500);
  await drainNow();
  await drainNow();
  const after = await storage([sameContentAfter, referencedElsewhere, randomForeign]);
  console.log("TAL-67 controles tras 2 drenajes:", JSON.stringify(after.exists));
  expect(after.exists).toEqual({ [sameContentAfter]: true, [referencedElsewhere]: true, [randomForeign]: true });
  expect((await fetch(linkedUrl)).status).toBe(200);
  // Los 2 registrados se borraron; quedan los 3 controles + la copia enlazada.
  expect(after.total).toBe(base + 3 + 1);
  const a = await audit();
  expect(a.registeredPending).toBe(0);
});

test("11 · fallo antes de store y entre store y registro → registro duradero; el cierre NUNCA borra (2 contraejemplos)", async () => {
  const base = (await storage()).total;

  envSet("DAY_FILES_FAULT", "before-store");
  const d1 = nextDate();
  await expect(saveDay(cal, d1, YOUTUBE)).rejects.toThrow(/Fallo inyectado/);
  envSet("DAY_FILES_FAULT", "after-store");
  const d2 = nextDate();
  await expect(saveDay(cal, d2, YOUTUBE_2)).rejects.toThrow(/Fallo inyectado/);
  envRemove("DAY_FILES_FAULT");
  expect((await storage()).total).toBe(base + 1); // solo el de after-store

  // Dentro de la ventana de esas intenciones: un ajeno sin referencias y otro referenciado desde otra tabla.
  const foreignUnreferenced = await run<string>("dayFiles:storeUntrackedFileForTests", { base64: PNG_1PX.toString("base64"), contentType: "image/png" });
  const foreignReferenced = await run<string>("dayFiles:storeUntrackedFileForTests", { base64: PNG_1PX.toString("base64"), contentType: "image/png" });
  await run("dayFiles:referenceFromOtherTableForTests", { storageId: foreignReferenced, dayId: await dayIdOf(cal, d2) });

  await sleep(TTL_MS + 500);
  await drainNow();
  await drainNow();
  const a = await audit();
  expect(a.unresolvedWindows.length).toBeGreaterThanOrEqual(2);
  for (const w of a.unresolvedWindows) expect(w.status).toBe("unresolved-window");
  const afterStoreWindow = a.unresolvedWindows.find((w) => w.filesInWindowForReview.length > 0)!;
  console.log(
    "TAL-67 ventana sin resolver (after-store), ficheros para revisar:",
    afterStoreWindow.filesInWindowForReview.length,
    "oldestUnresolvedWindowAgeMs:",
    a.oldestUnresolvedWindowAgeMs
  );
  expect(afterStoreWindow.filesInWindowForReview.map((f) => f.storageId)).toContain(foreignUnreferenced);
  expect((await storage()).total).toBe(base + 3); // nada borrado por el limpiador

  // Cierre manual de TODAS las ventanas sin resolver: no borra nada.
  const totalBefore = (await storage()).total;
  for (const w of a.unresolvedWindows) {
    expect(await run("dayFiles:closeUnresolvedWindow", { id: w._id, resolvedBy: "e2e TAL-67", resolution: "test: el cierre no borra" })).toEqual({ ok: true });
  }
  const afterClose = await storage([foreignUnreferenced, foreignReferenced]);
  expect(afterClose.total).toBe(totalBefore);
  expect(afterClose.exists).toEqual({ [foreignUnreferenced]: true, [foreignReferenced]: true });
  const closed = await audit();
  expect(closed.unresolvedWindows).toEqual([]);
});

test("16 · borrado concurrente del día o del calendario en cada frontera (operación pausada)", async () => {
  const outcomes: Record<string, number> = {};
  for (const point of ["before-store", "after-store", "after-register"] as const) {
    for (const target of ["day", "calendar"] as const) {
      for (const flow of ["thumbnail", "upload"] as const) {
        const calendarId = await newCalendar(`frontera-${point}-${target}-${flow}`);
        const date = nextDate();
        if (flow === "upload") await saveDay(calendarId, date, "https://example.com/v.mp4");
        const before = (await storage()).total;
        envSet("DAY_FILES_PAUSE_AT", `${point}:${PAUSE_MS}`);
        const op = flow === "thumbnail" ? saveDay(calendarId, date, YOUTUBE).catch((e) => e) : upload(calendarId, date);
        await sleep(1_200);
        if (target === "day") {
          await convex.mutation(api.days.deleteDayPublic, { serverSecret: serverSecret(), calendarId, date });
        } else {
          await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId, userId: sId });
          createdCalendars.delete(calendarId);
        }
        await op;
        envRemove("DAY_FILES_PAUSE_AT");
        outcomes[`${flow}/${point}/${target}`] = (await storage()).total - before;
      }
    }
  }
  console.log("TAL-67 frontera (ficheros que quedan):", JSON.stringify(outcomes));
  for (const value of Object.values(outcomes)) expect(value).toBe(0);
  const a = await audit();
  expect(a.liveIntents).toBe(0);

  // Borrado y enlace a la vez, sin pausa, en los dos órdenes posibles (OCC).
  for (let i = 0; i < 5; i++) {
    const calendarId = await newCalendar(`attach-${i}`);
    const date = nextDate();
    const before = (await storage()).total;
    await Promise.all([
      saveDay(calendarId, date, YOUTUBE).catch(() => {}),
      sleep(250).then(() => convex.mutation(api.days.deleteDayPublic, { serverSecret: serverSecret(), calendarId, date })),
    ]);
    await sleep(300);
    expect((await storage()).total - before).toBe(0);
  }
});

test("16b · borrado del día con la operación MUERTA en cada frontera: la evidencia nunca desaparece", async () => {
  const base = (await storage()).total;
  const cases = [] as { point: string; date: string }[];
  for (const point of ["before-store", "after-store", "after-register"] as const) {
    const date = nextDate();
    envSet("DAY_FILES_FAULT", point);
    await expect(saveDay(cal, date, YOUTUBE)).rejects.toThrow(/Fallo inyectado/);
    envRemove("DAY_FILES_FAULT");
    await convex.mutation(api.days.deleteDayPublic, { serverSecret: serverSecret(), calendarId: cal, date });
    cases.push({ point, date });
  }
  // after-register: el borrado del día se llevó fichero + intención registrada. after-store: el fichero sigue (sin registrar).
  expect((await storage()).total).toBe(base + 1);
  const live = await audit();
  // Tombstones de before-store y after-store (vivas o ya expiradas: los cambios de entorno tardan).
  expect(live.liveIntents + live.expiredUnregistered).toBe(2);
  await sleep(TTL_MS + 500);
  await drainNow();
  const a = await audit();
  const tombstones = a.unresolvedWindows.filter((w) => w.dayGone);
  console.log("TAL-67 tombstones trasladadas al registro duradero:", tombstones.length);
  expect(tombstones.length).toBe(2);
  for (const w of a.unresolvedWindows) await run("dayFiles:closeUnresolvedWindow", { id: w._id, resolvedBy: "e2e TAL-67", resolution: "test 16b" });
});

test("13 · drenaje medido, no solape, continuación obsoleta, watchdog sin cron, frontera de expiración y edades", async () => {
  test.setTimeout(600_000);
  const dayId = await dayIdOf(cal, (await (async () => {
    const date = nextDate();
    await saveDay(cal, date, "https://example.com/v.mp4");
    return date;
  })()));
  const base = (await storage()).total;

  // Los pendientes de las medidas se siembran con caducidad FUTURA (+45 s) y se
  // espera a que expiren: así ningún drenaje (el cron real de 15 min está
  // desplegado) puede llevárselos mientras se siembran y la cuenta es exacta.
  const seedFuture = async (count: number) => {
    await run("dayFiles:seedExpiredIntentsForTests", { calendarId: cal, dayId, count, registered: true, ageMs: -45_000 });
    expect((await storage()).total).toBe(base + count);
    await sleep(46_000);
  };

  // Drenaje: 300 pendientes con lotes de 25 → un solo disparo.
  envSet("DAY_FILE_RECONCILE_BATCH", "25");
  await seedFuture(300);
  const ms25 = await drainNow();
  expect((await storage()).total).toBe(base);
  console.log(`TAL-67 drenaje: 300 pendientes, lotes de 25 (12 lotes) en ${ms25} ms → ${(ms25 / 12).toFixed(0)} ms/lote`);

  // Medida con el lote por defecto (100) para estimar 10.000.
  envRemove("DAY_FILE_RECONCILE_BATCH");
  await seedFuture(300);
  const ms100 = await drainNow();
  const perBatch100 = ms100 / 3;
  console.log(
    `TAL-67 drenaje: 300 pendientes, lotes de 100 (3 lotes) en ${ms100} ms → ${perBatch100.toFixed(0)} ms/lote → estimación 10.000 (100 lotes): ${((perBatch100 * 100) / 1000).toFixed(1)} s`
  );

  // No solape: un drenaje largo (300 pendientes en lotes de 5 → 60 lotes) sigue vivo cuando llega el segundo disparo.
  envSet("DAY_FILE_RECONCILE_BATCH", "5");
  await run("dayFiles:seedExpiredIntentsForTests", { calendarId: cal, dayId, count: 300, registered: true });
  const first = await run<{ started: boolean }>("dayFiles:startReconcile");
  const second = await run<{ started: boolean }>("dayFiles:startReconcile");
  expect(first.started).toBe(true);
  expect(second).toEqual({ started: false });
  await drainNow();
  envRemove("DAY_FILE_RECONCILE_BATCH");

  // Continuación obsoleta: relevo forzado y un lote con el token antiguo.
  await run("dayFiles:seedExpiredIntentsForTests", { calendarId: cal, dayId, count: 50, registered: true });
  envSet("DAY_FILES_FAULT", "drain-after-first-batch");
  envSet("DAY_FILE_RECONCILE_BATCH", "10");
  const t1 = await run<{ token: string }>("dayFiles:startReconcile");
  await sleep(2_000);
  expect(await run("dayFiles:expireLeaseForTests")).toBe(t1.token);
  envRemove("DAY_FILES_FAULT");
  const t2 = await run<{ started: boolean; token: string }>("dayFiles:startReconcile");
  expect(t2.started).toBe(true);
  expect(await run("dayFiles:reconcileBatch", { token: t1.token, cutoff: Date.now(), first: false })).toEqual({ stopped: "stale-token" });
  await drainNow();
  envRemove("DAY_FILE_RECONCILE_BATCH");

  // Watchdog sin cron: la cadena muere tras el primer lote y el watchdog toma el relevo solo.
  envSet("DAY_FILE_RECONCILE_LEASE_MS", "3000");
  envSet("DAY_FILE_RECONCILE_BATCH", "10");
  envSet("DAY_FILES_FAULT", "drain-after-first-batch");
  await run("dayFiles:seedExpiredIntentsForTests", { calendarId: cal, dayId, count: 40, registered: true });
  const wdStart = Date.now();
  await run("dayFiles:startReconcile");
  await sleep(1_500);
  expect((await audit()).expiredRegistered).toBe(30); // solo un lote de 10 procesado: la cadena "murió"
  await expect
    .poll(async () => {
      const [a, lease] = await Promise.all([audit(), run("dayFiles:leaseForTests")]);
      return a.expiredRegistered === 0 && lease === null;
    }, { timeout: 90_000, intervals: [2000] })
    .toBe(true);
  console.log(`TAL-67 watchdog: relevo y drenaje completo sin cron en ${Date.now() - wdStart} ms`);
  envRemove("DAY_FILES_FAULT");
  envRemove("DAY_FILE_RECONCILE_BATCH");
  envRemove("DAY_FILE_RECONCILE_LEASE_MS");

  // Frontera de expiración: una intención que expira justo después de un disparo se recoge en el siguiente.
  envSet("DAY_FILE_INTENT_TTL_MS", "10000");
  const date = nextDate();
  envSet("DAY_FILES_FAULT", "after-register");
  await expect(saveDay(cal, date, YOUTUBE)).rejects.toThrow(/Fallo inyectado/);
  envRemove("DAY_FILES_FAULT");
  await drainNow(); // aún no ha expirado: sigue pendiente
  expect((await audit()).registeredPending).toBe(1);
  await sleep(10_500);
  await drainNow();
  expect((await audit()).registeredPending).toBe(0);
  envSet("DAY_FILE_INTENT_TTL_MS", String(TTL_MS));

  // Edades: el pendiente más viejo.
  await run("dayFiles:seedExpiredIntentsForTests", { calendarId: cal, dayId, count: 1, registered: true });
  await sleep(3_000);
  const aged = await audit();
  console.log("TAL-67 oldestPendingAgeMs:", aged.oldestPendingAgeMs);
  expect(aged.oldestPendingAgeMs).toBeGreaterThanOrEqual(3_000);
  await drainNow();
  expect((await audit()).oldestPendingAgeMs).toBeNull();
});

test("M1 · rollback de la migración: si el Admin enlaza otra copia entre el enlace y el log, el log guarda la de la migración y revertir NO borra la del Admin", async () => {
  const calendarId = await newCalendar("m1");
  const date = nextDate();
  // Día SIN copia (como los de producción), para que la migración lo procese.
  await convex.mutation(api.days.upsertDayPublic, { serverSecret: serverSecret(), calendarId, date, videoUrl: YOUTUBE });
  // Base: cualquier otro día ya migrado, para que esta migración solo toque el nuevo.
  await run("dayThumbnails:runThumbnailBackfill", { migrationId: `tal67-m1-base-${runId}`, batchSize: 25 });
  await convex.mutation(api.days.upsertDayPublic, { serverSecret: serverSecret(), calendarId, date: nextDate(), videoUrl: "https://example.com/v.mp4" });
  const dayId = await dayIdOf(calendarId, date);
  // El día del test vuelve a no tener copia: se le cambia la URL y vuelve (sin Next nuevo).
  await convex.mutation(api.days.upsertDayPublic, { serverSecret: serverSecret(), calendarId, date, videoUrl: YOUTUBE_2 });
  await convex.mutation(api.days.upsertDayPublic, { serverSecret: serverSecret(), calendarId, date, videoUrl: YOUTUBE });

  const migrationId = `tal67-m1-${runId}`;
  envSet("DAY_FILES_PAUSE_AT", "migration-before-log:8000");
  const migration = run<{ stored: number }>("dayThumbnails:runThumbnailBackfill", { migrationId, batchSize: 25 });
  // Mientras la migración está parada entre el enlace (copia A) y el log: el Admin guarda otra URL → copia B.
  let copyA: string | null = null;
  await expect
    .poll(async () => {
      copyA = (await convex.query(api.days.getCalendarDaysPublic, { serverSecret: serverSecret(), calendarId })).days.find((d) => d.date === date)!.imageUrl;
      return copyA !== null;
    }, { timeout: 180_000, intervals: [1000] })
    .toBe(true);
  expect(await saveDay(calendarId, date, YOUTUBE_2)).toMatchObject({ thumbnail: "stored" });
  const copyB = (await convex.query(api.days.getCalendarDaysPublic, { serverSecret: serverSecret(), calendarId })).days.find((d) => d.date === date)!.imageUrl!;
  expect(copyB).not.toBe(copyA);
  await migration;
  envRemove("DAY_FILES_PAUSE_AT");

  const log = await run<{ page: { dayId: string; result: string; storageId?: string }[] }>("dayThumbnails:listMigrationLogPage", { migrationId, numItems: 100 });
  const entry = log.page.find((e) => e.dayId === dayId)!;
  console.log("TAL-67 M1 log de la migración para el día:", JSON.stringify(entry));
  expect(entry.result).toBe("stored");
  // El id del log es el de A (la copia que enlazó la migración), no el de B (releído del día).
  const info = await storage([entry.storageId!]);
  expect(info.exists[entry.storageId!]).toBe(false); // A ya se borró al cambiar la URL el Admin
  expect((await fetch(copyB)).status).toBe(200);

  const revert = await run<{ reverted: number }>("dayThumbnails:revertThumbnailBackfill", { migrationId });
  console.log("TAL-67 M1 revert:", JSON.stringify(revert));
  expect(revert.reverted).toBe(0);
  expect((await fetch(copyB)).status).toBe(200); // la copia del Admin sigue
});

test("M2 · auditoría paginada: más ventanas y más candidatos que el tamaño de página → se listan todos", async () => {
  const calendarId = await newCalendar("m2");
  const date = nextDate();
  await saveDay(calendarId, date, "https://example.com/v.mp4");
  const dayId = await dayIdOf(calendarId, date);
  const before = (await allPages<{ windows: unknown[] }>("dayFiles:listUnresolvedWindowsPage", {}, 3)).flatMap((p) => p.windows).length;

  // 11 intenciones sin registrar ya expiradas → 11 ventanas (más que 3 por página).
  await run("dayFiles:seedExpiredIntentsForTests", { calendarId, dayId, count: 11, registered: false });
  // Una intención sin registrar que caduca en 20 s, y 9 ficheros ajenos creados dentro de su ventana (más que 4 por página).
  await run("dayFiles:insertIntentForTests", { calendarId, dayId, expiresAt: Date.now() + 20_000 });
  const foreign: string[] = [];
  for (let i = 0; i < 9; i++) {
    foreign.push(await run<string>("dayFiles:storeUntrackedFileForTests", { base64: PNG_1PX.toString("base64"), contentType: "image/png" }));
  }
  await sleep(21_000);
  await drainNow();

  const pages = await allPages<{ windows: { _id: string; windowStart: number; windowEnd: number }[] }>("dayFiles:listUnresolvedWindowsPage", {}, 3);
  const windows = pages.flatMap((p) => p.windows);
  console.log(`TAL-67 M2: ${windows.length - before} ventanas nuevas en ${pages.length} páginas de 3`);
  expect(windows.length - before).toBe(12);
  expect(new Set(windows.map((w) => w._id)).size).toBe(windows.length);

  const wide = windows.reduce((a, b) => (b.windowEnd - b.windowStart > a.windowEnd - a.windowStart ? b : a));
  const candPages = await allPages<{ candidates: { storageId: string }[] }>("dayFiles:windowCandidatesPage", { windowId: wide._id }, 4);
  const cands = candPages.flatMap((p) => p.candidates.map((c) => c.storageId));
  console.log(`TAL-67 M2: ${cands.length} candidatos en ${candPages.length} páginas de 4`);
  for (const id of foreign) expect(cands).toContain(id);

  for (const w of windows) await run("dayFiles:closeUnresolvedWindow", { id: w._id, resolvedBy: "e2e TAL-67", resolution: "test M2" });
  expect((await allPages<{ windows: unknown[] }>("dayFiles:listUnresolvedWindowsPage", {}, 3)).flatMap((p) => p.windows)).toEqual([]);
  const after = await storage(foreign);
  expect(Object.values(after.exists).every(Boolean)).toBe(true); // el cierre no borra nada
});
