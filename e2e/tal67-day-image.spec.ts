import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { loginAs, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-67 — imagen de la casilla "Visto": imagen subida por el Admin, copia
 * propia de la miniatura (YouTube, Vimeo, Drive), respaldo directo de YouTube
 * y fondo del skin; validación de tipo y tamaño; autenticación y autorización
 * de las funciones nuevas; sin ficheros sueltos (las URLs viejas dan 404);
 * nunca una casilla rota; claro, oscuro y ~375px. Sin ayudas de test del
 * backend: todo por la UI, por las funciones públicas o por HTTP.
 */
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const S_EMAIL = `e2e-tal67-super-${runId}@example.com`;
const A_EMAIL = `e2e-tal67-admin-${runId}@example.com`;
const G_EMAIL = `e2e-tal67-guest-${runId}@example.com`;
const OTHER_ADMIN_EMAIL = `e2e-tal67-other-${runId}@example.com`;
const EVIDENCE_DIR = path.resolve(__dirname, "..", "docs", "evidence", "tal67");
const SITE_URL = process.env.NEXT_PUBLIC_CONVEX_SITE_URL!;

const YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const YOUTUBE_2 = "https://www.youtube.com/watch?v=9bZkp7q19f0";
const VIMEO = "https://vimeo.com/1084537";
const DRIVE_PUBLIC = "https://drive.google.com/file/d/1Cp4lqVEdadmvOxUvpqR96KfOAeqcTFD4/view?usp=sharing";
const DRIVE_MISSING = "https://drive.google.com/file/d/1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/view";
const NON_EMBEDDABLE = "https://example.com/video.mp4";
const THUMBNAIL_WARNING = "No hemos podido sacar una imagen de este vídeo. Puedes subir una tú.";

// Imágenes mínimas válidas (1x1) y ficheros inválidos.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const JPEG_1PX = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64"
);
const WEBP_1PX = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64");
const GIF_1PX = Buffer.from("R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==", "base64");
const TEXT_AS_JPG = Buffer.from("esto no es una imagen");
const TOO_LARGE = Buffer.concat([PNG_1PX, Buffer.alloc(5 * 1024 * 1024 + 1 - PNG_1PX.length)]);

let sId: Id<"users">;
let aId: Id<"users">;
let gId: Id<"users">;
let otherAdminId: Id<"users">;
const createdCalendarIds = new Set<Id<"calendars">>();

const labelOf = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return `${d}/${m}/${y}`;
};

async function createCalendar(name: string): Promise<Id<"calendars">> {
  const id = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: sId,
    name,
    coverTitle: name,
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    creationKey: `e2e-tal67-${name}`,
  });
  createdCalendarIds.add(id);
  await convex.mutation(api.superadmin.addAdminPublic, { serverSecret: serverSecret(), actorUserId: sId, calendarId: id, email: A_EMAIL });
  await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId: id, email: G_EMAIL });
  await convex.mutation(api.access.resolveMemberAccessPublic, { serverSecret: serverSecret(), calendarId: id, userId: gId });
  return id;
}

function saveDay(calendarId: Id<"calendars">, date: string, videoUrl: string, actor: Id<"users"> = aId, secret = serverSecret()) {
  return convex.action(api.days.saveDayPublic, { serverSecret: secret, actorUserId: actor, calendarId, date, videoUrl });
}

async function dayData(calendarId: Id<"calendars">, date: string) {
  const data = await convex.query(api.days.getCalendarDaysPublic, { serverSecret: serverSecret(), calendarId });
  return data.days.find((d) => d.date === date) ?? null;
}

/** Marca el día como visto por el invitado (estado "Visto" en su vista). */
async function markWatched(calendarId: Id<"calendars">, date: string) {
  const guestView = await convex.query(api.guestCalendar.resolveCalendarDaysForGuestPublic, {
    serverSecret: serverSecret(),
    calendarId,
    userId: gId,
  });
  const day = guestView!.days.find((d) => d.date === date)!;
  await convex.mutation(api.dayViews.markDayViewedAsUserPublic, {
    serverSecret: serverSecret(),
    calendarId,
    dayId: day.dayId,
    userId: gId,
    todayDate: "2026-10-02",
  });
}

async function newPage(browser: Browser, opts: { viewport?: { width: number; height: number }; colorScheme?: "light" | "dark" } = {}): Promise<Page> {
  const context = await browser.newContext({ viewport: opts.viewport, colorScheme: opts.colorScheme });
  return await context.newPage();
}

async function statusOf(request: APIRequestContext, url: string): Promise<number> {
  return (await request.get(url, { failOnStatusCode: false })).status();
}

/** Estilo inline de la casilla del invitado para una fecha. */
async function guestCellStyle(page: Page, date: string): Promise<string> {
  const cell = page.locator(`button[aria-label^="${labelOf(date)}"]`).first();
  await expect(cell).toBeVisible();
  return (await cell.getAttribute("style")) ?? "";
}

async function openDayDialog(page: Page, calendarId: Id<"calendars">, date: string) {
  await page.goto(`/admin/${calendarId}`);
  await page.locator(`button[aria-label^="${labelOf(date)} — "]`).first().click();
  const dialog = page.getByRole("dialog", { name: `Editar día — ${labelOf(date)}` });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Espera a que la imagen subida del día cambie respecto a `previous` y la devuelve. */
async function waitUploadedChange(calendarId: Id<"calendars">, date: string, previous: string | null): Promise<string> {
  let current: string | null = null;
  await expect
    .poll(async () => {
      current = (await dayData(calendarId, date))?.uploadedImageUrl ?? null;
      return current !== null && current !== previous;
    })
    .toBe(true);
  return current!;
}

async function uploadInDialog(page: Page, calendarId: Id<"calendars">, date: string, file: { name: string; mimeType: string; buffer: Buffer }) {
  const dialog = await openDayDialog(page, calendarId, date);
  await dialog.locator('input[name="image"]').setInputFiles(file);
  await dialog.getByRole("button", { name: /Subir imagen|Sustituir imagen/ }).click();
  return dialog;
}

test.beforeAll(async () => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  sId = await seedUser({ email: S_EMAIL, superAdmin: true });
  aId = await seedUser({ email: A_EMAIL });
  gId = await seedUser({ email: G_EMAIL });
  otherAdminId = await seedUser({ email: OTHER_ADMIN_EMAIL });
});

test.afterAll(async () => {
  for (const id of createdCalendarIds) {
    await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId: id, userId: sId });
  }
});

test("1 · subir JPG, PNG y WebP → vista previa, y la casilla Visto del invitado la usa sea cual sea el proveedor", async ({ browser }) => {
  const cal = await createCalendar(`TAL-67 subida ${runId}`);
  const cases = [
    { date: "2026-09-01", video: YOUTUBE, file: { name: "a.jpg", mimeType: "image/jpeg", buffer: JPEG_1PX } },
    { date: "2026-09-02", video: VIMEO, file: { name: "b.png", mimeType: "image/png", buffer: PNG_1PX } },
    { date: "2026-09-03", video: DRIVE_PUBLIC, file: { name: "c.webp", mimeType: "image/webp", buffer: WEBP_1PX } },
    { date: "2026-09-04", video: NON_EMBEDDABLE, file: { name: "d.png", mimeType: "image/png", buffer: PNG_1PX } },
  ];
  for (const c of cases) await saveDay(cal, c.date, c.video);

  const admin = await newPage(browser);
  await loginAs(admin, A_EMAIL);
  for (const c of cases) {
    const dialog = await uploadInDialog(admin, cal, c.date, c.file);
    await expect(dialog.locator("img.day-image-preview")).toHaveAttribute("src", /\/api\/storage\//);
  }
  await admin.screenshot({ path: path.join(EVIDENCE_DIR, "1-dialogo-con-imagen.png") });
  await admin.context().close();

  const guest = await newPage(browser);
  await loginAs(guest, G_EMAIL);
  for (const c of cases) {
    await markWatched(cal, c.date);
    const uploaded = (await dayData(cal, c.date))!.uploadedImageUrl!;
    expect(uploaded).toMatch(/\/api\/storage\//);
    await guest.goto(`/c/${cal}`);
    expect(await guestCellStyle(guest, c.date)).toContain(uploaded);
  }
  await guest.screenshot({ path: path.join(EVIDENCE_DIR, "1-invitado-visto-con-imagen.png"), fullPage: true });
  await guest.context().close();
});

test("2 · más de 5 MB, GIF y texto renombrado a .jpg → mensaje claro y nada cambia", async ({ browser, request }) => {
  const cal = await createCalendar(`TAL-67 rechazos ${runId}`);
  await saveDay(cal, "2026-09-05", YOUTUBE);
  const admin = await newPage(browser);
  await loginAs(admin, A_EMAIL);

  const tooLarge = await uploadInDialog(admin, cal, "2026-09-05", { name: "grande.png", mimeType: "image/png", buffer: TOO_LARGE });
  await expect(tooLarge.getByRole("alert")).toHaveText("La imagen no puede superar los 5 MB.");
  const gif = await uploadInDialog(admin, cal, "2026-09-05", { name: "x.gif", mimeType: "image/gif", buffer: GIF_1PX });
  await expect(gif.getByRole("alert")).toHaveText("Formato no admitido: sube un JPG, PNG o WebP.");
  const txt = await uploadInDialog(admin, cal, "2026-09-05", { name: "falso.jpg", mimeType: "image/jpeg", buffer: TEXT_AS_JPG });
  await expect(txt.getByRole("alert")).toHaveText("Formato no admitido: sube un JPG, PNG o WebP.");
  await admin.screenshot({ path: path.join(EVIDENCE_DIR, "2-formato-no-admitido.png") });
  await admin.context().close();
  expect((await dayData(cal, "2026-09-05"))!.uploadedImageUrl).toBeNull();

  // La segunda capa (Convex) rechaza igual si alguien se salta Next.
  const headers = {
    "x-server-secret": serverSecret(),
    "x-actor-user-id": aId,
    "x-calendar-id": cal,
    "x-day-date": "2026-09-05",
  };
  const big = await request.post(`${SITE_URL}/tal67/day-image`, { headers, data: TOO_LARGE, failOnStatusCode: false });
  expect(big.status()).toBe(413);
  const html = await request.post(`${SITE_URL}/tal67/day-image`, { headers, data: Buffer.from("<html>hola</html>"), failOnStatusCode: false });
  expect(html.status()).toBe(415);
  expect((await dayData(cal, "2026-09-05"))!.uploadedImageUrl).toBeNull();
});

test("3 · quitar, sustituir, borrar el día y borrar el calendario → la URL anterior da 404", async ({ browser, request }) => {
  const cal = await createCalendar(`TAL-67 borrados ${runId}`);
  await saveDay(cal, "2026-09-06", YOUTUBE);
  await saveDay(cal, "2026-09-07", VIMEO);
  const admin = await newPage(browser);
  await loginAs(admin, A_EMAIL);

  // Sustituir.
  await uploadInDialog(admin, cal, "2026-09-06", { name: "a.png", mimeType: "image/png", buffer: PNG_1PX });
  const first = await waitUploadedChange(cal, "2026-09-06", null);
  const dialog = await uploadInDialog(admin, cal, "2026-09-06", { name: "b.jpg", mimeType: "image/jpeg", buffer: JPEG_1PX });
  const second = await waitUploadedChange(cal, "2026-09-06", first);
  expect(await statusOf(request, first)).toBe(404);

  // Quitar.
  expect(await statusOf(request, second)).toBe(200);
  await dialog.getByRole("button", { name: "Quitar", exact: true }).click();
  await expect.poll(async () => (await dayData(cal, "2026-09-06"))!.uploadedImageUrl).toBeNull();
  expect(await statusOf(request, second)).toBe(404);
  await admin.context().close();

  // Borrar el día: imagen subida + copia propia.
  await convex.action(api.days.saveDayPublic, { serverSecret: serverSecret(), actorUserId: aId, calendarId: cal, date: "2026-09-07", videoUrl: VIMEO });
  const admin2 = await newPage(browser);
  await loginAs(admin2, A_EMAIL);
  await uploadInDialog(admin2, cal, "2026-09-07", { name: "c.png", mimeType: "image/png", buffer: PNG_1PX });
  const uploaded7 = await waitUploadedChange(cal, "2026-09-07", null);
  await admin2.context().close();
  expect(await statusOf(request, uploaded7)).toBe(200);
  await convex.mutation(api.days.deleteDayPublic, { serverSecret: serverSecret(), calendarId: cal, date: "2026-09-07" });
  expect(await statusOf(request, uploaded7)).toBe(404);

  // Borrar el calendario: la copia propia de cada día desaparece.
  await saveDay(cal, "2026-09-08", YOUTUBE);
  const copy8 = (await dayData(cal, "2026-09-08"))!.imageUrl!;
  expect(await statusOf(request, copy8)).toBe(200);
  await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId: cal, userId: sId });
  createdCalendarIds.delete(cal);
  expect(await statusOf(request, copy8)).toBe(404);
});

test("4 · autenticación (secreto) y autorización (actor) en cada función pública nueva", async ({ request }) => {
  const cal = await createCalendar(`TAL-67 seguridad ${runId}`);
  await saveDay(cal, "2026-09-09", YOUTUBE);
  const before = await dayData(cal, "2026-09-09");

  // saveDayPublic: sin secreto, secreto incorrecto, y suplantación (secreto incorrecto + Admin legítimo).
  await expect(
    convex.action(api.days.saveDayPublic, { actorUserId: aId, calendarId: cal, date: "2026-09-09", videoUrl: VIMEO } as never)
  ).rejects.toThrow();
  await expect(saveDay(cal, "2026-09-09", VIMEO, aId, "secreto-incorrecto")).rejects.toThrow(/Secreto de servidor inválido/);
  await expect(saveDay(cal, "2026-09-09", VIMEO, sId, "otro-secreto-incorrecto")).rejects.toThrow(/Secreto de servidor inválido/);
  // Secreto correcto, actor sin permiso (invitado y Admin de otro calendario).
  expect(await saveDay(cal, "2026-09-09", VIMEO, gId)).toEqual({ ok: false, error: "not-authorized" });
  expect(await saveDay(cal, "2026-09-09", VIMEO, otherAdminId)).toEqual({ ok: false, error: "not-authorized" });
  expect(await dayData(cal, "2026-09-09")).toEqual(before);

  // removeDayImagePublic.
  const remove = (secret: string | undefined, actor: Id<"users">) =>
    convex.mutation(api.dayFiles.removeDayImagePublic, { serverSecret: secret, actorUserId: actor, calendarId: cal, date: "2026-09-09" } as never);
  await expect(remove(undefined, aId)).rejects.toThrow();
  await expect(remove("secreto-incorrecto", aId)).rejects.toThrow(/Secreto de servidor inválido/);
  expect(await remove(serverSecret(), gId)).toEqual({ ok: false, error: "not-authorized" });

  // httpAction de subida.
  const headers = (secret: string | null, actor: string) => {
    const h: Record<string, string> = { "x-actor-user-id": actor, "x-calendar-id": cal, "x-day-date": "2026-09-09" };
    if (secret !== null) h["x-server-secret"] = secret;
    return h;
  };
  const post = (h: Record<string, string>) =>
    request.post(`${SITE_URL}/tal67/day-image`, { headers: h, data: PNG_1PX, failOnStatusCode: false });
  expect((await post(headers(null, aId))).status()).toBe(401);
  expect((await post(headers("secreto-incorrecto", aId))).status()).toBe(401);
  expect((await post(headers("secreto-incorrecto", sId))).status()).toBe(401);
  const guestUpload = await post(headers(serverSecret(), gId));
  expect(guestUpload.status()).toBe(403);
  expect(await guestUpload.json()).toEqual({ ok: false, error: "not-authorized" });
  expect((await post(headers(serverSecret(), otherAdminId))).status()).toBe(403);
  expect(await dayData(cal, "2026-09-09")).toEqual(before);
});

test("5 · copia propia: YouTube, Vimeo y Drive público; Drive inexistente → aviso del PM y color", async ({ browser, request }) => {
  const cal = await createCalendar(`TAL-67 miniaturas ${runId}`);
  expect(await saveDay(cal, "2026-09-10", YOUTUBE)).toMatchObject({ ok: true, thumbnail: "stored" });
  expect(await saveDay(cal, "2026-09-11", VIMEO)).toMatchObject({ ok: true, thumbnail: "stored" });
  expect(await saveDay(cal, "2026-09-12", DRIVE_PUBLIC)).toMatchObject({ ok: true, thumbnail: "stored" });
  for (const date of ["2026-09-10", "2026-09-11", "2026-09-12"]) {
    const url = (await dayData(cal, date))!.imageUrl!;
    expect(url).toMatch(/\/api\/storage\//);
    const res = await request.get(url);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("image/jpeg");
  }

  // Por la UI: Drive inexistente → aviso literal del PM, el diálogo no se cierra solo y la casilla va a color.
  const admin = await newPage(browser);
  await loginAs(admin, A_EMAIL);
  await admin.goto(`/admin/${cal}`);
  await admin.locator(`button[aria-label^="${labelOf("2026-09-13")} — "]`).click();
  const dialog = admin.getByRole("dialog", { name: `Editar día — ${labelOf("2026-09-13")}` });
  await dialog.locator('input[name="videoUrl"]').fill(DRIVE_MISSING);
  await dialog.getByRole("button", { name: "Guardar día" }).click();
  await expect(dialog.getByRole("status")).toHaveText(THUMBNAIL_WARNING);
  await admin.screenshot({ path: path.join(EVIDENCE_DIR, "5-aviso-sin-miniatura.png") });
  await admin.keyboard.press("Escape");
  const style = (await admin.locator(`button[aria-label^="${labelOf("2026-09-13")} — "]`).getAttribute("style")) ?? "";
  expect(style).not.toContain("url(");
  expect(style).toContain("--skin-seen-bg");
  // En el editor, la casilla de YouTube usa la copia de Convex, no img.youtube.com.
  const ytStyle = (await admin.locator(`button[aria-label^="${labelOf("2026-09-10")} — "]`).getAttribute("style")) ?? "";
  expect(ytStyle).toContain("/api/storage/");
  expect(ytStyle).not.toContain("img.youtube.com");
  await admin.context().close();
});

test("5b · respaldo directo de YouTube solo sin copia; Vimeo sin copia nunca va al proveedor desde el navegador", async ({ browser }) => {
  const cal = await createCalendar(`TAL-67 respaldo ${runId}`);
  // Guardado con la función anterior a TAL-67 (como el Next viejo): sin copia propia.
  for (const [date, url] of [["2026-09-14", YOUTUBE], ["2026-09-15", VIMEO]] as const) {
    await convex.mutation(api.days.upsertDayPublic, { serverSecret: serverSecret(), calendarId: cal, date, videoUrl: url });
    await markWatched(cal, date);
  }
  const guest = await newPage(browser);
  await loginAs(guest, G_EMAIL);
  await guest.goto(`/c/${cal}`);
  expect(await guestCellStyle(guest, "2026-09-14")).toContain("https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  const vimeoStyle = await guestCellStyle(guest, "2026-09-15");
  expect(vimeoStyle).not.toContain("url(");
  expect(vimeoStyle).not.toContain("vimeo");
  // Con la copia (guardado con el Next nuevo), la casilla pasa a la URL de Convex.
  await saveDay(cal, "2026-09-14", YOUTUBE);
  await guest.reload();
  const withCopy = await guestCellStyle(guest, "2026-09-14");
  expect(withCopy).toContain("/api/storage/");
  expect(withCopy).not.toContain("img.youtube.com");
  await guest.context().close();
});

test("6 · cambiar la URL → copia nueva y la anterior da 404; misma URL → no se vuelve a descargar", async ({ request }) => {
  const cal = await createCalendar(`TAL-67 cambio url ${runId}`);
  await saveDay(cal, "2026-09-16", YOUTUBE);
  const firstCopy = (await dayData(cal, "2026-09-16"))!.imageUrl!;
  expect(await saveDay(cal, "2026-09-16", YOUTUBE)).toMatchObject({ thumbnail: "unchanged" });
  expect((await dayData(cal, "2026-09-16"))!.imageUrl).toBe(firstCopy);
  expect(await saveDay(cal, "2026-09-16", YOUTUBE_2)).toMatchObject({ thumbnail: "stored" });
  const secondCopy = (await dayData(cal, "2026-09-16"))!.imageUrl!;
  expect(secondCopy).not.toBe(firstCopy);
  expect(await statusOf(request, firstCopy)).toBe(404);
  expect(await statusOf(request, secondCopy)).toBe(200);
});

test("8 · nunca una casilla rota: si la imagen no carga, se ve el fondo del skin", async ({ browser }) => {
  const cal = await createCalendar(`TAL-67 rota ${runId}`);
  await saveDay(cal, "2026-09-17", VIMEO);
  await markWatched(cal, "2026-09-17");
  const guest = await newPage(browser);
  await loginAs(guest, G_EMAIL);
  // Toda petición a storage de Convex falla (404/red) para este navegador.
  await guest.route("**/api/storage/**", (route) => route.abort());
  await guest.goto(`/c/${cal}`);
  const cell = guest.locator(`button[aria-label^="${labelOf("2026-09-17")}"]`).first();
  const style = (await cell.getAttribute("style")) ?? "";
  expect(style).toContain("/api/storage/");
  // La capa inferior (respaldo) sigue presente en el estilo calculado: el navegador la pinta.
  const computed = await cell.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(computed).toContain("linear-gradient");
  const box = await cell.boundingBox();
  expect(box!.width).toBeGreaterThan(10);
  await cell.screenshot({ path: path.join(EVIDENCE_DIR, "8-imagen-fallida-respaldo.png") });
  await guest.context().close();
});

test("10 · claro, oscuro y ~375px (diálogo y grid)", async ({ browser }) => {
  const cal = await createCalendar(`TAL-67 visual ${runId}`);
  await saveDay(cal, "2026-09-18", YOUTUBE);
  await saveDay(cal, "2026-09-19", VIMEO);
  for (const date of ["2026-09-18", "2026-09-19"]) await markWatched(cal, date);
  for (const scheme of ["light", "dark"] as const) {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
      const admin = await newPage(browser, { colorScheme: scheme, viewport });
      await loginAs(admin, A_EMAIL);
      await openDayDialog(admin, cal, "2026-09-18");
      const { scrollWidth, clientWidth } = await admin.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
      await admin.screenshot({ path: path.join(EVIDENCE_DIR, `10-dialogo-${scheme}-${viewport.width}.png`) });
      await admin.context().close();

      const guest = await newPage(browser, { colorScheme: scheme, viewport });
      await loginAs(guest, G_EMAIL);
      await guest.goto(`/c/${cal}`);
      await guest.screenshot({ path: path.join(EVIDENCE_DIR, `10-invitado-${scheme}-${viewport.width}.png`), fullPage: true });
      await guest.context().close();
    }
  }
});

test("14 · URLs de storage: lo observado (sin auth, forma, persistencia, 404 tras borrar)", async ({ request, playwright }) => {
  const cal = await createCalendar(`TAL-67 urls ${runId}`);
  await saveDay(cal, "2026-09-20", YOUTUBE);
  const url = (await dayData(cal, "2026-09-20"))!.imageUrl!;
  // Contexto HTTP nuevo, sin cookies ni cabeceras de ningún tipo.
  const anonymous = await playwright.request.newContext();
  const first = await anonymous.get(url);
  console.log("TAL-67 getUrl forma:", url.replace(/[0-9a-f-]{36}/, "<uuid>"), "→", first.status(), first.headers()["content-type"]);
  expect(first.status()).toBe(200);
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  expect((await anonymous.get(url)).status()).toBe(200);
  expect(await saveDay(cal, "2026-09-20", YOUTUBE_2)).toMatchObject({ thumbnail: "stored" });
  const after = await anonymous.get(url);
  console.log("TAL-67 getUrl tras borrar:", after.status());
  expect(after.status()).toBe(404);
  await anonymous.dispose();
  void request;
});
