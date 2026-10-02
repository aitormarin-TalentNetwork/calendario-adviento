import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { NON_EMBEDDABLE_VIDEO_WARNING } from "../src/lib/video-embed";
import { loginAs, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-66 — vídeos que no se incrustaban. En Chromium real:
 * - cada formato de YouTube representativo carga su embed DENTRO del
 *   diálogo del invitado (iframe con el `src` esperado, incluido
 *   `?start=`, y el frame cargado en youtube.com/embed/<id>);
 * - la miniatura de YouTube aparece (casilla "vista" del invitado y casilla
 *   del editor) y la imagen carga de verdad;
 * - un vídeo NO incrustable (Vimeo oculto `/ID/HASH`) cae a "Ver vídeo ↗";
 * - el editor avisa al guardar una URL no incrustable (texto literal del
 *   PM), guarda igual, no cierra solo; tras corregir la URL, sí cierra.
 *
 * Vídeos públicos reales de YouTube que permiten incrustarse:
 * `dQw4w9WgXcQ` y `jNQXAC9IVRw` ("Me at the zoo"). Si el entorno no tiene
 * salida a youtube.com, los casos de carga real se saltan con el motivo
 * (y se documenta un smoke manual con captura en el export).
 */
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const ACTOR_EMAIL = `e2e-tal66-actor-${runId}@example.com`;
const ADMIN_EMAIL = `e2e-tal66-admin-${runId}@example.com`;
const GUEST_EMAIL = `e2e-tal66-guest-${runId}@example.com`;
const EVIDENCE_DIR = path.resolve(__dirname, "..", "docs", "evidence", "tal66");

const ID_A = "dQw4w9WgXcQ";
const ID_B = "jNQXAC9IVRw";
const HIDDEN_VIMEO = "https://vimeo.com/76979871/abc123def4";
// URL REAL del calendario afectado en producción (criterio b de TAL-66): una
// página de resultados de búsqueda de YouTube, no un vídeo.
const REAL_PROD_URL = "https://www.youtube.com/results?search_query=cute+kitten+purring";

// Fechas pasadas (desbloqueadas) dentro del rango del calendario.
const DAYS = [
  { date: "2026-09-20", url: `https://www.youtube.com/watch?v=${ID_A}`, embed: `https://www.youtube.com/embed/${ID_A}`, id: ID_A },
  { date: "2026-09-21", url: `https://www.youtube.com/live/${ID_B}?si=AbCdEf123`, embed: `https://www.youtube.com/embed/${ID_B}`, id: ID_B },
  { date: "2026-09-22", url: `https://music.youtube.com/watch?v=${ID_A}`, embed: `https://www.youtube.com/embed/${ID_A}`, id: ID_A },
  { date: "2026-09-23", url: `https://www.youtube-nocookie.com/embed/${ID_B}`, embed: `https://www.youtube.com/embed/${ID_B}`, id: ID_B },
  { date: "2026-09-24", url: `https://youtu.be/${ID_A}?t=1m30s`, embed: `https://www.youtube.com/embed/${ID_A}?start=90`, id: ID_A },
] as const;
const NON_EMBEDDABLE_DATE = "2026-09-25";
const EDITOR_WARNING_DATE = "2026-09-26";
const EDITOR_DIRECT_DATE = "2026-09-27";
const REAL_GUEST_DATE = "2026-09-28";
const REAL_EDITOR_DATE = "2026-09-29";

let actorId: Id<"users">;
let calendarId: Id<"calendars">;
let youtubeReachable = false;

const label = (dateStr: string) => new Date(`${dateStr}T00:00:00Z`).toLocaleDateString("es-ES", { timeZone: "UTC" });

async function newPage(browser: Browser, viewport?: { width: number; height: number }): Promise<Page> {
  return await (await browser.newContext(viewport ? { viewport } : {})).newPage();
}

async function imageLoads(page: Page, src: string): Promise<boolean> {
  return await page.evaluate(
    (url) =>
      new Promise<boolean>((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth > 0);
        img.onerror = () => resolve(false);
        img.src = url;
      }),
    src
  );
}

test.beforeAll(async ({ request }) => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  actorId = await seedUser({ email: ACTOR_EMAIL, superAdmin: true });
  calendarId = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: actorId,
    name: `TAL-66 vídeos ${runId}`,
    coverTitle: `TAL-66 vídeos ${runId}`,
    startDate: "2026-09-20",
    endDate: "2026-10-10",
    creationKey: `tal66-${runId}`,
  });
  for (const day of DAYS) {
    await convex.mutation(api.days.upsertDayPublic, { serverSecret: serverSecret(), calendarId, date: day.date, videoUrl: day.url });
  }
  await convex.mutation(api.days.upsertDayPublic, { serverSecret: serverSecret(), calendarId, date: NON_EMBEDDABLE_DATE, videoUrl: HIDDEN_VIMEO });
  await convex.mutation(api.days.upsertDayPublic, { serverSecret: serverSecret(), calendarId, date: REAL_GUEST_DATE, videoUrl: REAL_PROD_URL });
  expect(await convex.mutation(api.superadmin.addAdminPublic, { serverSecret: serverSecret(), actorUserId: actorId, calendarId, email: ADMIN_EMAIL })).toMatchObject({ ok: true });
  await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId, email: GUEST_EMAIL });

  try {
    const res = await request.get(`https://www.youtube.com/embed/${ID_A}`, { timeout: 15_000 });
    youtubeReachable = res.ok();
  } catch {
    youtubeReachable = false;
  }
  console.log(`youtube.com alcanzable desde el entorno de test: ${youtubeReachable}`);
});

test.afterAll(async () => {
  await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId, userId: actorId });
});

test("1 · invitado: cada formato de YouTube se reproduce DENTRO del diálogo (iframe cargado)", async ({ browser }) => {
  test.skip(!youtubeReachable, "Sin salida a youtube.com desde el entorno: se documenta smoke manual con captura.");
  const page = await newPage(browser);
  await loginAs(page, GUEST_EMAIL);
  await page.goto(`/c/${calendarId}`);
  for (const day of DAYS) {
    await page.getByRole("button", { name: new RegExp(`^${label(day.date)}`) }).click();
    const dialog = page.getByRole("dialog", { name: label(day.date) });
    await expect(dialog).toBeVisible();
    const iframe = dialog.locator("iframe");
    await expect(iframe).toHaveAttribute("src", day.embed);
    await expect(dialog.getByText("Ver vídeo ↗")).toHaveCount(0);

    // Carga real del reproductor: el frame del iframe navega a
    // youtube.com/embed/<id> y termina de cargar (no basta con el `src`).
    const frame = await (await iframe.elementHandle())!.contentFrame();
    expect(frame, `frame de ${day.embed}`).toBeTruthy();
    await expect.poll(() => frame!.url(), { timeout: 30_000 }).toContain(`/embed/${day.id}`);
    await frame!.waitForLoadState("load");
    await expect(frame!.locator("body")).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `1-dialogo-${day.date}.png`) });

    await dialog.getByRole("button", { name: "Cerrar" }).click();
    await expect(dialog).toBeHidden();
  }
  await page.context().close();
});

test("2 · invitado: tras verlos, las casillas «vistas» llevan la miniatura de YouTube y la imagen carga", async ({ browser }) => {
  test.skip(!youtubeReachable, "Sin salida a youtube.com desde el entorno: se documenta smoke manual con captura.");
  const page = await newPage(browser);
  await loginAs(page, GUEST_EMAIL);
  await page.goto(`/c/${calendarId}`);
  for (const day of DAYS) {
    const door = page.getByRole("button", { name: new RegExp(`^${label(day.date)} — ya visto`) });
    await expect(door).toBeVisible();
    const bg = await door.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg).toContain(`img.youtube.com/vi/${day.id}/hqdefault.jpg`);
  }
  expect(await imageLoads(page, `https://img.youtube.com/vi/${ID_A}/hqdefault.jpg`)).toBe(true);
  expect(await imageLoads(page, `https://img.youtube.com/vi/${ID_B}/hqdefault.jpg`)).toBe(true);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "2-miniaturas-invitado.png"), fullPage: true });
  await page.context().close();
});

test("3 · invitado: un vídeo NO incrustable (Vimeo oculto /ID/HASH) cae a «Ver vídeo ↗»", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAs(page, GUEST_EMAIL);
  await page.goto(`/c/${calendarId}`);
  await page.getByRole("button", { name: new RegExp(`^${label(NON_EMBEDDABLE_DATE)}`) }).click();
  const dialog = page.getByRole("dialog", { name: label(NON_EMBEDDABLE_DATE) });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("iframe")).toHaveCount(0);
  const link = dialog.getByRole("link", { name: "Ver vídeo ↗" });
  await expect(link).toHaveAttribute("href", HIDDEN_VIMEO);
  await page.context().close();
});

test("4 · editor: las casillas de los días de YouTube muestran su miniatura", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAs(page, ADMIN_EMAIL);
  await page.goto(`/admin/${calendarId}`);
  for (const day of DAYS) {
    const cell = page.getByRole("button", { name: `${label(day.date)} — vídeo asignado` });
    const bg = await cell.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(bg).toContain(`img.youtube.com/vi/${day.id}/hqdefault.jpg`);
  }
  const vimeoCell = page.getByRole("button", { name: `${label(NON_EMBEDDABLE_DATE)} — vídeo asignado` });
  expect(await vimeoCell.evaluate((el) => getComputedStyle(el).backgroundImage)).not.toContain("img.youtube.com");
  await page.context().close();
});

async function storedVideoUrl(date: string): Promise<string | undefined> {
  const result = await convex.query(api.days.getCalendarDaysPublic, { serverSecret: serverSecret(), calendarId });
  return result?.days.find((d) => d.date === date)?.videoUrl;
}

test("5 · editor: URL no incrustable → aviso literal, se guarda, no se cierra; después URL buena → se cierra sola", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAs(page, ADMIN_EMAIL);
  await page.goto(`/admin/${calendarId}`);
  const cell = page.getByRole("button", { name: `${label(EDITOR_WARNING_DATE)} — sin vídeo` });
  await cell.click();
  const dialog = page.getByRole("dialog", { name: `Editar día — ${label(EDITOR_WARNING_DATE)}` });
  await expect(dialog).toBeVisible();

  await dialog.locator('input[name="videoUrl"]').fill(HIDDEN_VIMEO);
  await dialog.getByRole("button", { name: "Guardar día" }).click();
  const warning = dialog.getByRole("status").filter({ hasText: NON_EMBEDDABLE_VIDEO_WARNING });
  await expect(warning).toHaveText(NON_EMBEDDABLE_VIDEO_WARNING);
  await expect.poll(() => storedVideoUrl(EDITOR_WARNING_DATE)).toBe(HIDDEN_VIMEO);
  // No se cierra solo: se espera un poco más que los dos frames del cierre automático.
  await page.waitForTimeout(800);
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "5-aviso-editor.png") });

  // Guardado sucesivo en el MISMO diálogo con una URL incrustable.
  await dialog.locator('input[name="videoUrl"]').fill(`https://youtu.be/${ID_B}`);
  await dialog.getByRole("button", { name: "Guardar día" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => storedVideoUrl(EDITOR_WARNING_DATE)).toBe(`https://youtu.be/${ID_B}`);
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", `${label(EDITOR_WARNING_DATE)} — vídeo asignado`);
  await page.context().close();
});

test("6 · editor: aviso cerrado por el Admin devuelve el foco; guardar una URL buena directamente se cierra solo (TAL-45)", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAs(page, ADMIN_EMAIL);
  await page.goto(`/admin/${calendarId}`);

  await page.getByRole("button", { name: `${label(EDITOR_DIRECT_DATE)} — sin vídeo` }).click();
  const dialog = page.getByRole("dialog", { name: `Editar día — ${label(EDITOR_DIRECT_DATE)}` });
  await dialog.locator('input[name="videoUrl"]').fill("https://example.com/mi-video.mp4");
  await dialog.getByRole("button", { name: "Guardar día" }).click();
  await expect(dialog.getByRole("status")).toHaveText(NON_EMBEDDABLE_VIDEO_WARNING);
  await dialog.getByRole("button", { name: "Cerrar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", `${label(EDITOR_DIRECT_DATE)} — vídeo asignado`);

  await page.getByRole("button", { name: `${label(EDITOR_DIRECT_DATE)} — vídeo asignado` }).click();
  const again = page.getByRole("dialog", { name: `Editar día — ${label(EDITOR_DIRECT_DATE)}` });
  await again.locator('input[name="videoUrl"]').fill(`https://www.youtube.com/watch?v=${ID_A}`);
  await again.getByRole("button", { name: "Guardar día" }).click();
  await expect(again).toBeHidden();
  await expect(again.getByRole("status")).toHaveCount(0);
  await page.context().close();
});

test("8 · caso real (criterio b): la URL de búsqueda reproduce el síntoma del invitado y el editor avisa al guardarla", async ({ browser }) => {
  // Síntoma reportado por Aitor: sin vídeo dentro del diálogo, enlace fuera.
  const guest = await newPage(browser);
  await loginAs(guest, GUEST_EMAIL);
  await guest.goto(`/c/${calendarId}`);
  await guest.getByRole("button", { name: new RegExp(`^${label(REAL_GUEST_DATE)}`) }).click();
  const guestDialog = guest.getByRole("dialog", { name: label(REAL_GUEST_DATE) });
  await expect(guestDialog.locator("iframe")).toHaveCount(0);
  await expect(guestDialog.getByRole("link", { name: "Ver vídeo ↗" })).toHaveAttribute("href", REAL_PROD_URL);
  await guest.context().close();

  // Arreglo: el Admin recibe el aviso al guardarla (y se guarda igual).
  const page = await newPage(browser);
  await loginAs(page, ADMIN_EMAIL);
  await page.goto(`/admin/${calendarId}`);
  await page.getByRole("button", { name: `${label(REAL_EDITOR_DATE)} — sin vídeo` }).click();
  const dialog = page.getByRole("dialog", { name: `Editar día — ${label(REAL_EDITOR_DATE)}` });
  await dialog.locator('input[name="videoUrl"]').fill(REAL_PROD_URL);
  await dialog.getByRole("button", { name: "Guardar día" }).click();
  await expect(dialog.getByRole("status")).toHaveText(NON_EMBEDDABLE_VIDEO_WARNING);
  await expect.poll(() => storedVideoUrl(REAL_EDITOR_DATE)).toBe(REAL_PROD_URL);
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "8-caso-real-aviso.png") });
  await page.context().close();
});

test("7 · 375px: el aviso cabe sin scroll horizontal", async ({ browser }) => {
  const page = await newPage(browser, { width: 375, height: 812 });
  await loginAs(page, ADMIN_EMAIL);
  await page.goto(`/admin/${calendarId}`);
  await page.getByRole("button", { name: `${label(EDITOR_WARNING_DATE)} — vídeo asignado` }).click();
  const dialog = page.getByRole("dialog", { name: `Editar día — ${label(EDITOR_WARNING_DATE)}` });
  await dialog.locator('input[name="videoUrl"]').fill(HIDDEN_VIMEO);
  await dialog.getByRole("button", { name: "Guardar día" }).click();
  await expect(dialog.getByRole("status")).toHaveText(NON_EMBEDDABLE_VIDEO_WARNING);
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  const box = await dialog.getByRole("status").boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(clientWidth);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "7-aviso-375.png") });
  await page.context().close();
});
