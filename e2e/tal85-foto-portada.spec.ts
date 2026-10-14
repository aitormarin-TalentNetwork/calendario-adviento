import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { COVER_PREVIEW_BROKEN, COVER_PREVIEW_HELP, COVER_PREVIEW_OK } from "../src/app/admin/[calendarId]/cover-image-preview";
import { IMAGE_URL_WARNING } from "../src/lib/image-url-warning";
import { seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";
import { openAccountMenu } from "./helpers/account-menu";

/**
 * TAL-85 — foto de portada visible en todas partes
 * (design/design-system.md § "Foto de portada visible en todas partes";
 * mockup design/propuesta-foto-portada-en-todas-partes.html):
 *
 * - tarjetas de "Tus calendarios" con la foto, y su respaldo (decisión del
 *   PM, opción A: sin foto o rota, la portada de siempre —con
 *   `backgroundImageUrl` si existe—);
 * - un solo calendario → directo y con bienvenida;
 * - bienvenida en CADA entrada (`navSeq` + `renderId`,
 *   src/lib/navigation-entry.ts), también `/c/<id>` → `/c` → redirect al
 *   mismo `/c/<id>` (harness `window.__e2eRouter`, solo con
 *   `E2E_ROUTER_HARNESS=1` del webServer) y nunca al volver dentro;
 * - fondo tenue con la portada como respaldo;
 * - vista previa en el editor;
 * - 375 px y escritorio, claro y oscuro.
 *
 * SIN RED: las fotos las sirve el propio test (`context.route`): una PNG
 * válida, una "página web" (HTML con 200) y una 404.
 */
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const S_EMAIL = `e2e-tal85-super-${runId}@example.com`;
const ADM_EMAIL = `e2e-tal85-admin-${runId}@example.com`;
const MANY_EMAIL = `e2e-tal85-varios-${runId}@example.com`;
const ONE_EMAIL = `e2e-tal85-uno-${runId}@example.com`;
const EVIDENCE_DIR = path.resolve(__dirname, "..", "docs", "evidence", "tal85");
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3000}`;
const TZ = "Europe/Madrid";

const PHOTO_HOST = "https://tal85-e2e.example.com";
const PHOTO = `${PHOTO_HOST}/portada.png`;
const BG_PHOTO = `${PHOTO_HOST}/fondo.png`;
const PAGE_URL = `${PHOTO_HOST}/noticias/una-pagina-web`;
const MISSING = `${PHOTO_HOST}/no-existe.png`;
const VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

/** PNG de 32x32 de un color (RGB), para servir como foto. */
function solidPng([r, g, b]: [number, number, number]): Buffer {
  const size = 32;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) raw.set([r, g, b], y * (size * 3 + 1) + 1 + x * 3);
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PHOTO_PNG = solidPng([214, 64, 69]);
const BG_PNG = solidPng([40, 120, 200]);

let sId: Id<"users">;
const created = new Set<Id<"calendars">>();

const LIVE = { startDate: "2026-09-01", endDate: "2026-12-24" };
const UPCOMING = { startDate: "2026-11-20", endDate: "2026-12-24" };
const FINISHED = { startDate: "2026-01-01", endDate: "2026-01-24" };

type CalendarOpts = { coverImageUrl?: string; backgroundImageUrl?: string; dates?: { startDate: string; endDate: string } };

/** Calendario creado por el Super Admin, con `guests` invitados y ya miembros, y `admins` como ADMIN. */
async function createCalendar(name: string, guests: string[], opts: CalendarOpts = {}, admins: string[] = []) {
  const { dates = LIVE, ...urls } = opts;
  const id = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: sId,
    name: `TAL85 ${name} ${runId}`,
    coverTitle: `TAL85 ${name}`,
    ...dates,
    creationKey: `e2e-tal85-${runId}-${name}`,
    ...urls,
  });
  created.add(id);
  for (const email of admins) {
    await convex.mutation(api.superadmin.addAdminPublic, { serverSecret: serverSecret(), actorUserId: sId, calendarId: id, email });
  }
  for (const email of guests) {
    await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId: id, email });
    const userId = await seedUser({ email });
    await convex.mutation(api.access.resolveMemberAccessPublic, { serverSecret: serverSecret(), calendarId: id, userId });
  }
  return id;
}

async function newContext(browser: Browser, extra: Parameters<Browser["newContext"]>[0] = {}, withTz = true): Promise<BrowserContext> {
  const context = await browser.newContext({ timezoneId: TZ, ...extra });
  if (withTz) await context.addCookies([{ name: "tz", value: TZ, url: BASE }]);
  await context.route(`${PHOTO_HOST}/**`, (route) => {
    const url = route.request().url();
    if (url === PHOTO) return route.fulfill({ status: 200, contentType: "image/png", body: PHOTO_PNG });
    if (url === BG_PHOTO) return route.fulfill({ status: 200, contentType: "image/png", body: BG_PNG });
    if (url === PAGE_URL) return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Noticia</title><p>Una página web</p>" });
    return route.fulfill({ status: 404, body: "no" });
  });
  // Sin red real: el vídeo del día se queda sin cargar (no hace falta).
  await context.route(/^https:\/\/(www\.)?(youtube|youtube-nocookie)\.com\//, (route) => route.fulfill({ status: 204, body: "" }));
  return context;
}

async function login(page: Page, email: string, callbackUrl: string) {
  await page.goto(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  const devForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Entrar (dev)" }) });
  await devForm.locator('input[name="email"]').fill(email);
  await devForm.getByRole("button", { name: "Entrar (dev)" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function pageAs(browser: Browser, email: string, callbackUrl = "/c", extra: Parameters<Browser["newContext"]>[0] = {}) {
  const context = await newContext(browser, extra);
  const page = await context.newPage();
  await login(page, email, callbackUrl);
  return page;
}

const welcome = (page: Page) => page.locator(".welcome-overlay");
const card = (page: Page, name: string): Locator => page.locator(".calendar-card", { hasText: `TAL85 ${name}` });
const coverOf = (page: Page, name: string): Locator => card(page, name).locator(".calendar-card-cover");

async function closeWelcome(page: Page) {
  await expect(welcome(page)).toHaveAttribute("data-welcome-phase", "shown");
  await page.getByRole("button", { name: "Abrir mi calendario" }).click();
  await expect(welcome(page)).toHaveCount(0);
}

/** Marca el documento actual: si sigue ahí después, no hubo recarga. */
async function markDocument(page: Page) {
  return await page.evaluate(() => {
    (window as unknown as { __tal85: number }).__tal85 = 1;
    return { timeOrigin: performance.timeOrigin, navEntries: performance.getEntriesByType("navigation").length };
  });
}

async function expectSameDocument(page: Page, before: { timeOrigin: number; navEntries: number }) {
  const after = await page.evaluate(() => ({
    marker: (window as unknown as { __tal85?: number }).__tal85,
    timeOrigin: performance.timeOrigin,
    navEntries: performance.getEntriesByType("navigation").length,
  }));
  expect(after, "sin recarga del documento").toEqual({ marker: 1, ...before });
}

/** Espera sostenida: la bienvenida no aparece durante `ms`. */
async function expectNoWelcomeFor(page: Page, ms = 2000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    expect(await welcome(page).count(), "la bienvenida no debe reaparecer").toBe(0);
    await page.waitForTimeout(200);
  }
}

function luminance([r, g, b]: number[]) {
  const ch = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
function contrast(a: number[], b: number[]) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
const rgb = (css: string) => css.match(/[\d.]+/g)!.slice(0, 3).map(Number);

/** Color del texto y primer fondo opaco de sus antepasados (el que se ve detrás). */
function textAndBackdrop(el: Element) {
  let node: Element | null = el;
  let bg = "rgb(255, 255, 255)";
  while (node) {
    const c = getComputedStyle(node).backgroundColor;
    if (c && c !== "transparent" && !/rgba\(.*, 0\)$/.test(c)) {
      bg = c;
      break;
    }
    node = node.parentElement;
  }
  return { color: getComputedStyle(el).color, bg };
}

function countWelcomeRows(calendarIds: string[]): number {
  const out = execFileSync("npx", ["convex", "run", "welcomeViews:countForCalendars", JSON.stringify({ calendarIds })], { encoding: "utf8" });
  return Number(out.trim());
}

// --- Datos ---
let photoLive: Id<"calendars">;
let photoNext: Id<"calendars">;
let bgOnly: Id<"calendars">;
let photoWithBg: Id<"calendars">;
let plain: Id<"calendars">;
let single: Id<"calendars">;
let adminCal: Id<"calendars">;

test.beforeAll(async () => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  sId = await seedUser({ email: S_EMAIL, superAdmin: true });
  await seedUser({ email: MANY_EMAIL });
  await seedUser({ email: ONE_EMAIL });
  await seedUser({ email: ADM_EMAIL });
  const many = [MANY_EMAIL];
  photoLive = await createCalendar("foto-en-marcha", many, { coverImageUrl: PHOTO });
  photoNext = await createCalendar("foto-proximo", many, { coverImageUrl: PHOTO, dates: UPCOMING });
  await createCalendar("foto-terminado", many, { coverImageUrl: PHOTO, dates: FINISHED });
  await createCalendar("portada-pagina", many, { coverImageUrl: PAGE_URL });
  await createCalendar("portada-404", many, { coverImageUrl: MISSING });
  bgOnly = await createCalendar("solo-fondo", many, { backgroundImageUrl: BG_PHOTO });
  await createCalendar("fondo-con-portada-404", many, { coverImageUrl: MISSING, backgroundImageUrl: BG_PHOTO });
  photoWithBg = await createCalendar("foto-con-fondo", many, { coverImageUrl: PHOTO, backgroundImageUrl: BG_PHOTO });
  plain = await createCalendar("sin-nada", many);
  // Un día con vídeo (ya pasado) en el calendario con foto, para abrir su diálogo.
  await convex.mutation(api.days.upsertDayPublic, { serverSecret: serverSecret(), calendarId: photoLive, date: "2026-09-01", videoUrl: VIDEO_URL });
  single = await createCalendar("unico", [ONE_EMAIL], { coverImageUrl: PHOTO });
  adminCal = await createCalendar("administrado", [], { coverImageUrl: PHOTO }, [ADM_EMAIL]);
});

test.afterAll(async () => {
  const failures: string[] = [];
  for (const id of created) {
    try {
      await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId: id, userId: sId });
    } catch (err) {
      failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  expect(failures, "calendarios de prueba sin limpiar").toEqual([]);
});

test("0 · el harness de navegación está activo (si no, el servidor reutilizado no tiene E2E_ROUTER_HARNESS=1)", async ({ browser }) => {
  const page = await pageAs(browser, ONE_EMAIL, `/c/${single}`);
  await expect
    .poll(() => page.evaluate(() => typeof window.__e2eRouter?.push), {
      message: "levanta el dev server desde Playwright (con la variable del webServer)",
    })
    .toBe("function");
  await page.context().close();
});

test("1 · «Tus calendarios»: foto de portada con degradado y píldora; sin foto o rota, la portada de siempre (con imagen de fondo si existe)", async ({ browser }) => {
  const page = await pageAs(browser, MANY_EMAIL, "/c");
  await expect(page).toHaveURL(/\/c$/);
  await expect(page.getByRole("heading", { level: 1, name: "Tus calendarios" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Filtrar calendarios" })).toBeVisible();

  // Con foto válida: la foto se ve, 130 px, degradado y píldora según estado.
  for (const [name, pill] of [["foto-en-marcha", "En marcha"], ["foto-proximo", "Próximo"], ["foto-terminado", null], ["foto-con-fondo", "En marcha"]] as const) {
    const cover = coverOf(page, name);
    await expect(cover, name).toHaveAttribute("data-cover-photo", "loaded");
    await expect(cover.locator(".calendar-card-photo")).toHaveCSS("opacity", "1");
    expect((await cover.boundingBox())!.height, name).toBeCloseTo(130, 0);
    expect(await cover.evaluate((el) => getComputedStyle(el, "::after").backgroundImage), name).toBe(
      "linear-gradient(to top, rgba(10, 8, 30, 0.55), rgba(10, 8, 30, 0) 60%)"
    );
    if (pill) {
      await expect(cover.locator(".calendar-card-status"), name).toHaveText(pill);
      const box = (await cover.locator(".calendar-card-status").boundingBox())!;
      const coverBox = (await cover.boundingBox())!;
      expect(box.x - coverBox.x, "arriba a la izquierda").toBeCloseTo(10, 0);
      expect(box.y - coverBox.y).toBeCloseTo(10, 0);
    } else {
      await expect(cover.locator(".calendar-card-status"), `${name}: terminado, sin píldora`).toHaveCount(0);
    }
  }
  await expect(coverOf(page, "foto-en-marcha").locator(".calendar-card-status")).toHaveClass(/status-pill--live/);
  await expect(coverOf(page, "foto-proximo").locator(".calendar-card-status")).toHaveClass(/status-pill--upcoming/);

  // Portada que es una página web o 404: la de siempre (skin + icono), sin píldora ni degradado.
  for (const name of ["portada-pagina", "portada-404"]) {
    const cover = coverOf(page, name);
    await expect(cover, name).toHaveAttribute("data-cover-photo", "error");
    await expect(cover.locator(".calendar-card-photo")).toHaveCSS("opacity", "0");
    await expect(cover.locator("[data-cover-icon]")).toBeVisible();
    await expect(cover.locator(".calendar-card-status")).toHaveCount(0);
    expect(await cover.evaluate((el) => getComputedStyle(el, "::after").content)).toBe("none");
    expect(await cover.evaluate((el) => getComputedStyle(el).backgroundImage), name).not.toContain(PHOTO_HOST);
  }

  // Decisión del PM (opción A): sin portada, o rota, con imagen de fondo → la imagen de fondo de siempre.
  for (const name of ["solo-fondo", "fondo-con-portada-404"]) {
    const cover = coverOf(page, name);
    await expect(cover, name).toHaveAttribute("data-cover-photo", name === "solo-fondo" ? "none" : "error");
    expect(await cover.evaluate((el) => getComputedStyle(el).backgroundImage), name).toBe(
      `linear-gradient(rgba(0, 0, 0, 0.6), rgba(0, 0, 0, 0.6)), url("${BG_PHOTO}")`
    );
    await expect(cover.locator(".calendar-card-status")).toHaveCount(0);
  }
  // Con portada válida Y fondo: la foto por delante (la base sigue debajo).
  expect(await coverOf(page, "foto-con-fondo").evaluate((el) => getComputedStyle(el).backgroundImage)).toContain(BG_PHOTO);

  // Sin nada: exactamente como antes, 110 px.
  const plainCover = coverOf(page, "sin-nada");
  await expect(plainCover).toHaveAttribute("data-cover-photo", "none");
  expect((await plainCover.boundingBox())!.height).toBeCloseTo(110, 0);
  await expect(plainCover.locator(".calendar-card-photo")).toHaveCount(0);

  // Barra de progreso y "Empieza en" sin cambios.
  await expect(card(page, "foto-en-marcha").getByRole("progressbar", { name: "Días vistos" })).toBeVisible();
  await expect(card(page, "foto-proximo").locator(".calendar-card-starts")).toHaveText(/^Empieza en \d+ días$/);
  await page.context().close();
});

test("2 · un solo calendario: /c abre directamente /c/<id> y sale la bienvenida con foto", async ({ browser }) => {
  const page = await pageAs(browser, ONE_EMAIL, "/start");
  await page.goto("/c");
  await expect(page).toHaveURL(new RegExp(`/c/${single}$`));
  await expect(welcome(page)).toHaveAttribute("data-welcome-phase", "shown");
  await expect(page.getByRole("heading", { level: 2, name: "TAL85 unico" })).toBeVisible();
  await page.context().close();
});

test("3a · la bienvenida sale en cada entrada: recargar y volver a entrar el mismo día; sin filas en welcomeViews", async ({ browser }) => {
  const page = await pageAs(browser, ONE_EMAIL, `/c/${single}`);
  await closeWelcome(page);
  await page.reload();
  await closeWelcome(page);
  await page.goto(`/c/${single}`);
  await closeWelcome(page);
  expect(countWelcomeRows([single])).toBe(0);
  await page.context().close();
});

test("3b · /c/<id> → /c → redirect al mismo /c/<id> sin recargar: sale otra vez; router.refresh() no", async ({ browser }) => {
  const page = await pageAs(browser, ONE_EMAIL, `/c/${single}`);
  await expect(page).toHaveURL(new RegExp(`/c/${single}$`));
  await closeWelcome(page);
  await expect.poll(() => page.evaluate(() => typeof window.__e2eRouter?.push)).toBe("function");

  const before = await markDocument(page);
  const rscToList = page.waitForRequest((r) => new URL(r.url()).pathname === "/c" && r.headers()["rsc"] === "1");
  await page.evaluate(() => window.__e2eRouter!.push("/c"));
  await rscToList; // pasó por /c (navegación de cliente, petición RSC)
  await expect(welcome(page)).toHaveAttribute("data-welcome-phase", "shown");
  await expect(page).toHaveURL(new RegExp(`/c/${single}$`));
  await expectSameDocument(page, before);

  // Contraprueba: un router.refresh() (lo que hace TimezoneSync) no la reabre.
  await closeWelcome(page);
  const refreshed = page.waitForResponse((r) => new URL(r.url()).pathname === `/c/${single}` && r.request().headers()["rsc"] === "1");
  await page.evaluate(() => window.__e2eRouter!.refresh());
  await refreshed;
  await expectNoWelcomeFor(page);
  await expectSameDocument(page, before);
  await page.context().close();
});

test("3c · menú de la cuenta (enlace real): pulsar el calendario actual vuelve a sacarla sin recargar; saltar a otro, también", async ({ browser }) => {
  const page = await pageAs(browser, MANY_EMAIL, `/c/${photoLive}`);
  await closeWelcome(page);
  const before = await markDocument(page);

  let menu = await openAccountMenu(page);
  const current = menu.getByRole("menuitem", { name: "TAL85 foto-en-marcha" });
  await expect(current).toHaveAttribute("aria-current", "page");
  const rsc = page.waitForRequest((r) => new URL(r.url()).pathname === `/c/${photoLive}` && r.headers()["rsc"] === "1");
  await current.click();
  await rsc;
  await expect(welcome(page)).toHaveAttribute("data-welcome-phase", "shown");
  await expectSameDocument(page, before);
  await closeWelcome(page);

  menu = await openAccountMenu(page);
  await menu.getByRole("menuitem", { name: "TAL85 foto-proximo" }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${photoNext}$`));
  await expect(welcome(page)).toHaveAttribute("data-welcome-phase", "shown");
  await expect(page.getByRole("heading", { level: 2, name: "TAL85 foto-proximo" })).toBeVisible();
  await expectSameDocument(page, before);
  await page.context().close();
});

test("3d · atrás/adelante: volver a /c/<id> desde la lista la vuelve a sacar", async ({ browser }) => {
  const page = await pageAs(browser, MANY_EMAIL, "/c");
  await card(page, "foto-en-marcha").click();
  await expect(page).toHaveURL(new RegExp(`/c/${photoLive}$`));
  await closeWelcome(page);
  const before = await markDocument(page);
  await page.evaluate(() => window.__e2eRouter!.push("/c"));
  await expect(page.getByRole("heading", { level: 1, name: "Tus calendarios" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/c/${photoLive}$`));
  await expect(welcome(page)).toHaveAttribute("data-welcome-phase", "shown");
  await expectSameDocument(page, before);
  await page.context().close();
});

test("3e · no sale al volver dentro: diálogo de un vídeo (con su server action), ni con el router.refresh de TimezoneSync en la primera visita", async ({ browser }) => {
  // Primera visita sin cookie `tz`: TimezoneSync la pone y hace router.refresh().
  const context = await newContext(browser, {}, false);
  const page = await context.newPage();
  await login(page, MANY_EMAIL, "/start");
  await context.clearCookies({ name: "tz" });
  const tzRefresh = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `/c/${photoLive}` && r.request().headers()["rsc"] === "1",
    { timeout: 15_000 }
  );
  await page.goto(`/c/${photoLive}`);
  await closeWelcome(page);
  await tzRefresh;
  expect((await context.cookies()).some((c) => c.name === "tz"), "TimezoneSync puso la cookie").toBe(true);
  await expectNoWelcomeFor(page);

  // Abrir el día con vídeo (marca "visto": server action) y cerrarlo.
  const action = page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]);
  await page.locator('button[aria-label^="1/9/2026"]').click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await action;
  await page.getByRole("button", { name: "Cerrar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectNoWelcomeFor(page);
  await context.close();
});

test("3f · menú de la cuenta: el modo activo no la reabre; cambiar a Admin navega sin parpadeo de la bienvenida", async ({ browser }) => {
  const page = await pageAs(browser, ADM_EMAIL, `/c/${adminCal}`);
  // Modo Usuario (recordado) para que este /c/<id> sea su pantalla de invitado.
  await expect(page).toHaveURL(new RegExp(`/c/${adminCal}$`));
  await closeWelcome(page);
  let menu = await openAccountMenu(page);
  await menu.getByRole("menuitemradio", { name: "Usuario" }).click();
  await expectNoWelcomeFor(page, 1500);
  await expect(page).toHaveURL(new RegExp(`/c/${adminCal}$`));

  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __tal85Seen: string[] }).__tal85Seen = seen;
    new MutationObserver(() => {
      const el = document.querySelector(".welcome-overlay");
      if (el) seen.push(el.getAttribute("data-welcome-phase") ?? "?");
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  menu = await openAccountMenu(page);
  await menu.getByRole("menuitemradio", { name: "Admin" }).click();
  await expect(page).toHaveURL(/\/admin(\/|$)/);
  const seen = await page.evaluate(() => (window as unknown as { __tal85Seen?: string[] }).__tal85Seen ?? null);
  // Si el documento se hubiera recargado, el observador no existiría: aquí sí sigue.
  expect(seen, "sin bienvenida durante la transición").toEqual([]);
  await page.context().close();
});

test("4 · fondo tenue: sin imagen de fondo, la foto de portada; con las dos, gana la imagen de fondo; sin ninguna, sin capa", async ({ browser }) => {
  const page = await pageAs(browser, MANY_EMAIL, "/start");
  const layerImage = async (id: string) => {
    await page.goto(`/c/${id}`);
    await expect(page.locator(".skin-month-card")).toBeVisible();
    return await page.evaluate(() => {
      const layer = document.querySelector("#calendar-main > .faint-bg-layer");
      if (!layer) return null;
      const cs = getComputedStyle(layer);
      return { image: cs.backgroundImage, opacity: cs.opacity, filter: cs.filter };
    });
  };
  const coverOnly = await layerImage(photoLive);
  expect(coverOnly).toEqual({ image: `url("${PHOTO}")`, opacity: "0.1", filter: "saturate(0.7)" });
  expect((await layerImage(photoWithBg))?.image).toBe(`url("${BG_PHOTO}")`);
  expect((await layerImage(bgOnly))?.image).toBe(`url("${BG_PHOTO}")`);
  expect(await layerImage(plain)).toBeNull();
  await page.context().close();
});

test("5 · editor: vista previa en vivo (correcta / página web), sin el aviso de TAL-69 en la portada, y ayuda en «Imagen de fondo»", async ({ browser }) => {
  const page = await pageAs(browser, ADM_EMAIL, `/admin/${adminCal}`);
  await page.goto(`/admin/${adminCal}`);
  const coverInput = page.locator("#calendar-coverImageUrl");
  const coverField = page.locator(".editor-field", { has: coverInput });
  const bgField = page.locator(".editor-field", { has: page.locator("#calendar-backgroundImageUrl") });

  await expect(bgField.locator(".editor-field-hint")).toHaveText("Si la dejas vacía, dentro del calendario se usa la foto de portada como fondo tenue.");

  // Guardada con foto válida: vista previa de 120 px, radio 16 px, y el texto verde.
  await expect(coverField.locator(".cover-preview")).toHaveAttribute("data-cover-preview", "loaded");
  const box = coverField.locator(".cover-preview-box");
  expect((await box.boundingBox())!.height).toBeCloseTo(120, 0);
  await expect(box).toHaveCSS("border-radius", "16px");
  await expect(coverField.locator(".cover-preview-ok")).toHaveText(COVER_PREVIEW_OK);

  // Una página web: recuadro, aviso coral y borde del input en coral; nunca el texto de TAL-69.
  await coverInput.fill(PAGE_URL);
  await expect(coverField.locator(".cover-preview")).toHaveAttribute("data-cover-preview", "error");
  await expect(coverField.locator(".cover-preview-broken")).toHaveText(COVER_PREVIEW_BROKEN);
  await expect(coverField.locator(".cover-preview-help")).toHaveText(COVER_PREVIEW_HELP);
  await expect(coverField.locator(".cover-preview-ok")).toHaveCount(0);
  const coralInk = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--coral-ink").trim());
  const helpColor = await coverField.locator(".cover-preview-help").evaluate((el) => getComputedStyle(el).color);
  expect(rgb(helpColor)).toEqual(rgb(coralInk.replace(/^#(..)(..)(..)$/, (_, r, g, b) => `rgb(${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)})`)));
  await expect(coverInput).toHaveCSS("border-top-color", helpColor);
  await expect(coverField.getByText(IMAGE_URL_WARNING)).toHaveCount(0);

  // 404 también es "no carga".
  await coverInput.fill(MISSING);
  await expect(coverField.locator(".cover-preview")).toHaveAttribute("data-cover-preview", "error");

  // Vuelta a la foto válida: en vivo, sin guardar.
  await coverInput.fill(PHOTO);
  await expect(coverField.locator(".cover-preview-ok")).toHaveText(COVER_PREVIEW_OK);

  // Vacío o no https: sin vista previa.
  await coverInput.fill("");
  await expect(coverField.locator(".cover-preview")).toHaveCount(0);
  await coverInput.fill("http://tal85-e2e.example.com/portada.png");
  await expect(coverField.locator(".cover-preview")).toHaveCount(0);

  // Guardar una página web en la portada: tampoco sale el aviso de TAL-69 tras la comprobación.
  await coverInput.fill(PAGE_URL);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeEnabled();
  await page.waitForTimeout(1500);
  await expect(coverField.locator(".day-video-warning")).toHaveCount(0);
  await expect(coverField.locator(".cover-preview-help")).toHaveText(COVER_PREVIEW_HELP);
  // Se deja como estaba para el resto de casos.
  await coverInput.fill(PHOTO);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeEnabled();
  await expect.poll(async () => (await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId: adminCal }))?.coverImageUrl).toBe(PHOTO);
  await page.context().close();
});

for (const [label, viewport] of [["375", { width: 375, height: 812 }], ["escritorio", { width: 1280, height: 860 }]] as const) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`6 · ${label} ${colorScheme}: tarjetas, bienvenida, fondo tenue y editor sin scroll horizontal; contraste de lo nuevo`, async ({ browser }) => {
      const tag = `${label}-${colorScheme}`;
      const noHorizontalScroll = (page: Page) =>
        page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      const rows: string[] = [];

      // Tarjetas.
      const page = await pageAs(browser, MANY_EMAIL, "/c", { viewport, colorScheme });
      await expect(coverOf(page, "foto-en-marcha")).toHaveAttribute("data-cover-photo", "loaded");
      await expect(coverOf(page, "foto-proximo")).toHaveAttribute("data-cover-photo", "loaded");
      expect(await noHorizontalScroll(page), "tarjetas").toBe(true);
      for (const name of ["foto-en-marcha", "foto-proximo"]) {
        const pill = coverOf(page, name).locator(".calendar-card-status");
        const [pb, cb] = [(await pill.boundingBox())!, (await coverOf(page, name).boundingBox())!];
        expect(pb.x + pb.width <= cb.x + cb.width && pb.y + pb.height <= cb.y + cb.height, `${name}: píldora dentro de la portada`).toBe(true);
        const { color, bg } = await pill.evaluate((el) => ({ color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
        const ratio = contrast(rgb(color), rgb(bg));
        rows.push(`píldora ${name}: ${color} sobre ${bg} → ${ratio.toFixed(2)}:1`);
        expect(ratio, rows.at(-1)).toBeGreaterThanOrEqual(4.5);
      }
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `tarjetas-${tag}.png`), fullPage: true });

      // Bienvenida.
      await page.goto(`/c/${photoLive}`);
      await expect(welcome(page)).toHaveAttribute("data-welcome-phase", "shown");
      expect(await noHorizontalScroll(page), "bienvenida").toBe(true);
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `bienvenida-${tag}.png`) });

      // Dentro, con la portada como fondo tenue.
      await page.getByRole("button", { name: "Abrir mi calendario" }).click();
      await expect(page.locator("#calendar-main > .faint-bg-layer")).toHaveCSS("background-image", `url("${PHOTO}")`);
      expect(await noHorizontalScroll(page), "fondo tenue").toBe(true);
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `fondo-portada-${tag}.png`), fullPage: true });
      await page.context().close();

      // Editor: vista previa correcta y rota.
      const admin = await pageAs(browser, ADM_EMAIL, `/admin/${adminCal}`, { viewport, colorScheme });
      await admin.goto(`/admin/${adminCal}`);
      const coverInput = admin.locator("#calendar-coverImageUrl");
      const coverField = admin.locator(".editor-field", { has: coverInput });
      await expect(coverField.locator(".cover-preview-ok")).toBeVisible();
      const okColors = await coverField.locator(".cover-preview-ok").evaluate(textAndBackdrop);
      const okRatio = contrast(rgb(okColors.color), rgb(okColors.bg));
      rows.push(`«Imagen correcta»: ${okColors.color} sobre ${okColors.bg} → ${okRatio.toFixed(2)}:1`);
      expect(okRatio, rows.at(-1)).toBeGreaterThanOrEqual(4.5);
      expect(await noHorizontalScroll(admin), "editor").toBe(true);
      await coverField.scrollIntoViewIfNeeded();
      await admin.screenshot({ path: path.join(EVIDENCE_DIR, `editor-ok-${tag}.png`) });

      await coverInput.fill(PAGE_URL);
      await expect(coverField.locator(".cover-preview-help")).toBeVisible();
      const helpColors = await coverField.locator(".cover-preview-help").evaluate(textAndBackdrop);
      const helpRatio = contrast(rgb(helpColors.color), rgb(helpColors.bg));
      rows.push(`aviso coral: ${helpColors.color} sobre ${helpColors.bg} → ${helpRatio.toFixed(2)}:1`);
      expect(helpRatio, rows.at(-1)).toBeGreaterThanOrEqual(4.5);
      const brokenColors = await coverField.locator(".cover-preview-broken").evaluate((el) => ({ color: getComputedStyle(el).color, bg: getComputedStyle(el).backgroundColor }));
      const brokenRatio = contrast(rgb(brokenColors.color), rgb(brokenColors.bg));
      rows.push(`recuadro «No se puede mostrar»: ${brokenColors.color} sobre ${brokenColors.bg} → ${brokenRatio.toFixed(2)}:1`);
      expect(brokenRatio, rows.at(-1)).toBeGreaterThanOrEqual(4.5);
      expect(await noHorizontalScroll(admin), "editor con aviso").toBe(true);
      const [previewBox, fieldBox] = [(await coverField.locator(".cover-preview-box").boundingBox())!, (await coverField.boundingBox())!];
      expect(previewBox.x + previewBox.width, "vista previa dentro de su fila").toBeLessThanOrEqual(fieldBox.x + fieldBox.width + 0.5);
      await admin.screenshot({ path: path.join(EVIDENCE_DIR, `editor-pagina-${tag}.png`) });
      await admin.context().close();

      test.info().annotations.push({ type: `contraste ${tag}`, description: rows.join(" · ") });
      console.log(`contraste ${tag}:\n  ${rows.join("\n  ")}`);
    });
  }
}
