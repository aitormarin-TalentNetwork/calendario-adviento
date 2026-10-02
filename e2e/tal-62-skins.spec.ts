import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import type { SkinPalette } from "../convex/skinCatalog2026";
import { loginAs, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";
import HERO_TEXT from "../scripts/tal62-hero-text-sizes.json";

/**
 * TAL-62 (parte visual) — los 8 skins en la pantalla del invitado como en el
 * mockup normativo (design/propuesta-skins-modernos.html, colores finales):
 * fondo, bloque de la cuenta atrás, tarjeta del mes, casillas (abierta, fin
 * de semana, hoy, bloqueada, vista con su píldora), recuadro del icono,
 * modal; tratamientos de Tira Cómica y Rojiblanco; un skin nunca cambia la
 * fuente; respaldo Alegre para un skin antiguo sin migrar; selector y vista
 * previa del editor con los 8; Alegre por defecto. Capturas de cada skin a
 * 375px y en escritorio, en claro y oscuro.
 *
 * Requiere el catálogo 2026 sembrado en el deployment de desarrollo
 * (`skins:seedSkinCatalog2026`).
 */
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const ACTOR_EMAIL = `e2e-tal62v-actor-${runId}@example.com`;
const GUEST_EMAIL = `e2e-tal62v-guest-${runId}@example.com`;
const EVIDENCE_DIR = path.resolve(__dirname, "..", "docs", "evidence", "tal62");

type CatalogRow = { _id: string; key: string; name: string; palette: SkinPalette; treatment?: string; swatches: string[] };
let actorId: Id<"users">;
let catalog: CatalogRow[];
const calendarBySkin: Record<string, Id<"calendars">> = {};
let legacyCalendar: Id<"calendars">;
let defaultCalendar: Id<"calendars">;
const createdIds = new Set<Id<"calendars">>();

const rgb = (hex: string) => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};
// Etiqueta del día tal como la pinta la app (formatCalendarDate, es-ES, UTC).
const label = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("es-ES", { timeZone: "UTC" });
// Fechas relativas a HOY (zona horaria local, la misma que usa el navegador
// de Playwright): el calendario va de hoy-7 a hoy+18; hoy-3 tiene vídeo y se
// marca como visto; hoy-7 es una casilla abierta sin vídeo; hoy+4, bloqueada.
const isoDay = (d: Date) => d.toLocaleDateString("sv-SE");
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return isoDay(d);
};
const TODAY = isoDay(new Date());
const START = addDays(TODAY, -7);
const END = addDays(TODAY, 18);
const SEEN = addDays(TODAY, -3);
const OPEN = START;
const LOCKED = addDays(TODAY, 4);
// Un sábado o domingo abierto (entre hoy-6 y hoy-1 siempre hay dos) que no sea el visto.
const WEEKEND = [1, 2, 3, 4, 5, 6].map((n) => addDays(TODAY, -n)).find((d) => [0, 6].includes(new Date(`${d}T12:00:00`).getDay()) && d !== SEEN)!;

async function css(page: Page, selector: string, prop: string): Promise<string> {
  return await page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
}

/**
 * Los textos del bloque no bajan del tamaño/peso con el que la puerta de
 * contraste decide su umbral (scripts/tal62-hero-text-sizes.json).
 *
 * Sin cookie `tz` (1ª visita, diálogo de la vista previa) la cuenta atrás se
 * calcula en el navegador tras montar: primero se pinta un "…" provisional y
 * React lo SUSTITUYE por el número. Medir en ese instante daba NaN (elemento
 * recién reemplazado, intermitente). Por eso: se espera a que el número
 * esté visible y cada medida va en `expect.poll`, que reintenta hasta tener
 * un estilo computado válido que cumpla — sin bajar ningún umbral.
 */
async function expectHeroTextSizes(hero: Locator, where: string) {
  await expect(hero.locator(".skin-hero-num"), `${where}: número de la cuenta atrás`).toBeVisible();
  for (const [key, usage] of Object.entries(HERO_TEXT)) {
    if (key.startsWith("_")) continue;
    const { selector, px, weight } = usage as { selector: string; px: number; weight: number };
    const el = hero.locator(selector).first();
    await expect(el, `${where} ${key}`).toBeVisible();
    await expect
      .poll(async () => await el.evaluate((node) => parseFloat(getComputedStyle(node).fontSize)), { message: `${where} ${key} tamaño` })
      .toBeGreaterThanOrEqual(px - 0.01);
    await expect
      .poll(async () => await el.evaluate((node) => parseInt(getComputedStyle(node).fontWeight, 10)), { message: `${where} ${key} peso` })
      .toBeGreaterThanOrEqual(weight);
  }
}

async function guestPage(browser: Browser, opts: { colorScheme?: "light" | "dark"; viewport?: { width: number; height: number } } = {}) {
  const page = await (await browser.newContext({ colorScheme: opts.colorScheme ?? "light", ...(opts.viewport ? { viewport: opts.viewport } : {}) })).newPage();
  await loginAs(page, GUEST_EMAIL);
  return page;
}

async function createCalendar(name: string, skinId?: string): Promise<Id<"calendars">> {
  const id = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: actorId,
    name: `${name} ${runId}`,
    coverTitle: name,
    startDate: START,
    endDate: END,
    creationKey: `tal62v-${name}-${runId}`,
    ...(skinId ? { skinId: skinId as Id<"skins"> } : {}),
  });
  createdIds.add(id);
  await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId: id, email: GUEST_EMAIL });
  return id;
}

test.beforeAll(async ({ browser }) => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  actorId = await seedUser({ email: ACTOR_EMAIL, superAdmin: true });
  catalog = (await convex.query(api.skins.listCatalogPublic, { serverSecret: serverSecret() })) as CatalogRow[];
  expect(catalog.map((c) => c.key)).toEqual(["alegre", "navidad-pop", "caramelo", "noche", "nieve", "minimal", "tira-comica", "rojiblanco"]);
  for (const skin of catalog) {
    const id = await createCalendar(`Skin ${skin.name}`, skin._id);
    calendarBySkin[skin.key] = id;
    await convex.mutation(api.days.upsertDayPublic, { serverSecret: serverSecret(), calendarId: id, date: SEEN, videoUrl: "https://example.com/video" });
  }
  defaultCalendar = await createCalendar("Por defecto");

  // Calendario con un skin ANTIGUO (sin estilo), como uno de producción antes
  // de migrar: crudo con `import --append` (la barrera de escritura lo
  // convertiría a Alegre si pasara por las mutations).
  const all = await convex.query(api.skins.listAllPublic, { serverSecret: serverSecret() });
  const legacySkin = all.find((s) => !catalog.some((c) => c._id === s._id));
  expect(legacySkin, "hace falta un skin antiguo en el deployment de desarrollo").toBeTruthy();
  const file = path.join(mkdtempSync(path.join(tmpdir(), "tal62v-")), "legacy.jsonl");
  writeFileSync(file, JSON.stringify({ name: `tal62v-legacy-${runId}`, coverTitle: "Antiguo sin migrar", startDate: START, endDate: END, updatedAt: Date.now(), skinId: legacySkin!._id }) + "\n");
  execFileSync("npx", ["convex", "import", "--table", "calendars", "--append", "-y", file], { stdio: "pipe" });
  const listed = await convex.query(api.superadmin.listCalendarsWithStatsPublic, { serverSecret: serverSecret(), actorUserId: actorId, now: TODAY });
  legacyCalendar = listed.find((c) => c.name === `tal62v-legacy-${runId}`)!.id;
  createdIds.add(legacyCalendar);
  await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId: legacyCalendar, email: GUEST_EMAIL });

  // Marcar como visto el 29/9 de cada calendario (abrir y cerrar el día).
  const page = await guestPage(browser);
  for (const skin of catalog) {
    await page.goto(`/c/${calendarBySkin[skin.key]}`);
    await page.getByRole("button", { name: new RegExp(`^${label(SEEN)}`) }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Cerrar" }).click();
  }
  await page.context().close();
});

test.afterAll(async () => {
  const failures: string[] = [];
  for (const id of createdIds) {
    try {
      await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId: id, userId: actorId });
    } catch (err) {
      failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  expect(failures, "calendarios de prueba sin limpiar").toEqual([]);
});

test("1 · cada skin pinta la pantalla del invitado con sus colores (como el mockup)", async ({ browser }) => {
  const page = await guestPage(browser, { viewport: { width: 420, height: 1000 } });
  let alegreFont = "";
  for (const skin of catalog) {
    const p = skin.palette;
    await page.goto(`/c/${calendarBySkin[skin.key]}`);
    await page.waitForLoadState("networkidle");
    const main = "main[data-skin-style]";
    await expect(page.locator(main)).toHaveAttribute("data-skin-style", skin.key);
    expect(await css(page, main, "background-color"), `${skin.key} fondo`).toBe(rgb(p.bg));
    expect(await css(page, main, "--skin-seen-bg"), `${skin.key} --skin-seen-bg`).toContain(p.seenA);

    // Bloque de la cuenta atrás.
    const hero = "[data-skin-hero]";
    if (p.hero.startsWith("#")) expect(await css(page, hero, "background-color")).toBe(rgb(p.hero));
    else expect(await css(page, hero, "background-image")).toMatch(/gradient/);
    expect(await css(page, ".skin-hero-num", "color")).toBe(rgb(p.heroNum));
    expect(await css(page, ".skin-hero-label", "opacity")).toBe("1");
    expect(parseFloat(await css(page, ".skin-hero-label", "font-size"))).toBeGreaterThanOrEqual(18.66);

    // Recuadro del icono, tarjeta del mes, casillas.
    expect(await css(page, ".cover-icon-box", "background-color")).toBe(rgb(p.tile));
    expect(await css(page, ".cover-icon-box", "color")).toBe(rgb(p.tileInk));
    expect(await css(page, ".skin-month-card", "background-color")).toBe(rgb(p.card));
    const door = (d: string) => `button[aria-label^="${label(d)}"]`;
    expect(await css(page, door(OPEN), "background-color"), `${skin.key} casilla abierta`).toBe(rgb(p.cell));
    expect(await css(page, `${door(WEEKEND)} span`, "color"), `${skin.key} fin de semana`).toBe(rgb(p.weekend));
    expect(await css(page, door(TODAY), "background-color"), `${skin.key} hoy`).toBe(rgb(p.today));
    expect(await css(page, `${door(TODAY)} span`, "color")).toBe(rgb(p.todayInk));
    expect(await css(page, door(LOCKED), "border-top-style"), `${skin.key} bloqueada`).toBe("dashed");
    const seen = door(SEEN);
    await expect(page.locator(seen)).toHaveAttribute("aria-label", /ya visto/);
    expect(await css(page, seen, "background-image"), `${skin.key} visto`).toMatch(/gradient/);
    expect(await css(page, `${seen} span`, "background-color"), `${skin.key} píldora del visto`).toBe("rgba(15, 24, 18, 0.6)");
    expect(await page.locator(".dg-out-of-range").evaluateAll((els) => els.every((e) => e.getAttribute("aria-hidden") === "true"))).toBe(true);

    // Un skin nunca cambia la fuente.
    const font = await css(page, "h1", "font-family");
    if (skin.key === "alegre") alegreFont = font;
    expect(font, `${skin.key} misma fuente que Alegre`).toBe(alegreFont);

    // Modal sobre la tarjeta del skin.
    await page.locator(door(OPEN)).click();
    const dialogCard = page.getByRole("dialog").locator("> div");
    expect(await dialogCard.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgb(p.card));
    await page.getByRole("dialog").getByRole("button", { name: "Cerrar" }).click();
  }
  await page.context().close();
});

test("2 · Tira Cómica: contorno negro 2.5px y sombra dura 3px 3px 0", async ({ browser }) => {
  const page = await guestPage(browser);
  await page.goto(`/c/${calendarBySkin["tira-comica"]}`);
  // Chrome redondea hacia abajo el grosor computado del borde (2.5px → 2px):
  // se comprueba el valor DECLARADO en la hoja de estilos y, en pantalla,
  // contorno sólido negro de ≥ 2px y la sombra dura.
  const declared = await page.evaluate(() => {
    for (const sheet of Array.from(document.styleSheets)) {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSStyleRule && rule.selectorText.includes(".skin-comic .skin-hero")) return rule.style.getPropertyValue("border");
      }
    }
    return null;
  });
  expect(declared).toMatch(/^2\.5px solid/);
  for (const sel of ["[data-skin-hero]", ".skin-month-card", ".cover-icon-box", `button[aria-label^="${label(OPEN)}"]`, `button[aria-label^="${label(TODAY)}"]`]) {
    expect(await css(page, sel, "border-top-style"), sel).toBe("solid");
    expect(await css(page, sel, "border-top-color"), sel).toBe("rgb(26, 26, 26)");
    expect(parseFloat(await css(page, sel, "border-top-width")), sel).toBeGreaterThanOrEqual(2);
    expect(await css(page, sel, "box-shadow"), sel).toBe("rgb(26, 26, 26) 3px 3px 0px 0px");
  }
  await page.context().close();
});

test("3 · Rojiblanco: rayas SOLO en el bloque de la cuenta atrás y textos sobre píldora blanca", async ({ browser }) => {
  const page = await guestPage(browser);
  await page.goto(`/c/${calendarBySkin.rojiblanco}`);
  expect(await css(page, "[data-skin-hero]", "background-image")).toContain("repeating-linear-gradient");
  for (const sel of [".skin-hero-label", ".skin-hero-big", ".skin-hero-for"]) {
    expect(await css(page, sel, "background-color"), sel).toBe("rgb(255, 255, 255)");
  }
  expect(await css(page, "main[data-skin-style]", "background-image")).toBe("none");
  expect(await css(page, ".skin-month-card", "background-image")).toBe("none");
  await page.context().close();
});

test("4 · un calendario con un skin antiguo sin migrar se ve con el respaldo Alegre", async ({ browser }) => {
  const page = await guestPage(browser);
  await page.goto(`/c/${legacyCalendar}`);
  await expect(page.locator("main[data-skin-style]")).toHaveAttribute("data-skin-style", "fallback");
  const alegre = catalog.find((c) => c.key === "alegre")!.palette;
  expect(await css(page, "main[data-skin-style]", "background-color")).toBe(rgb(alegre.bg));
  expect(await css(page, "[data-skin-hero]", "background-color")).toBe(rgb(alegre.hero));
  await page.context().close();
});

test("5 · un calendario nuevo nace con Alegre", async ({ browser }) => {
  const page = await guestPage(browser);
  await page.goto(`/c/${defaultCalendar}`);
  await expect(page.locator("main[data-skin-style]")).toHaveAttribute("data-skin-style", "alegre");
  await page.context().close();
});

test("6 · editor: el selector ofrece exactamente los 8 en orden; la vista previa sigue al skin elegido y se guarda", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await loginAs(page, ACTOR_EMAIL);
  await page.goto(`/admin/${defaultCalendar}`);
  await page.waitForLoadState("networkidle");
  const options = page.locator("[data-skin-option]");
  await expect(options).toHaveCount(8);
  expect(await options.evaluateAll((els) => els.map((e) => e.getAttribute("data-skin-option")))).toEqual(catalog.map((c) => c._id));
  expect(await options.evaluateAll((els) => els.map((e) => e.getAttribute("title")))).toEqual(catalog.map((c) => c.name));
  const preview = page.getByRole("button", { name: "Ver vista previa a tamaño completo" });
  await expect(preview).toHaveAttribute("data-skin-style", "alegre");
  const noche = catalog.find((c) => c.key === "noche")!;
  await page.locator(`[data-skin-option="${noche._id}"]`).click();
  await expect(preview).toHaveAttribute("data-skin-style", "noche");
  // NO-GO M1 (loop2): la miniatura compacta NO tiene texto — barras
  // decorativas con los colores del skin, fuera del árbol accesible.
  const mini = preview.locator("[data-skin-hero]");
  await expect(mini).toBeVisible();
  await expect(mini).toHaveAttribute("aria-hidden", "true");
  expect((await mini.textContent())?.trim()).toBe("");
  expect(await mini.locator(".skin-hero-bar-label").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgb(noche.palette.heroInk));
  expect(await mini.locator(".skin-hero-bar-num").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgb(noche.palette.heroNum));
  // El diálogo a tamaño completo sí lleva los textos, a tamaño de texto grande.
  await preview.click();
  const dialogHero = page.getByRole("dialog").locator("[data-skin-hero]");
  await expect(dialogHero.locator(".skin-hero-label")).toHaveText("Cuenta atrás");
  await expectHeroTextSizes(dialogHero, "diálogo");
  await page.getByRole("dialog").getByRole("button", { name: "Cerrar" }).click();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "6-editor-selector-preview.png"), fullPage: true });
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect
    .poll(async () => (await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId: defaultCalendar }))?.skinId)
    .toBe(noche._id);
  // El grid del editor expone el fondo "visto" del skin (contrato TAL-67).
  await page.reload();
  const section = page.locator("section", { has: page.getByRole("heading", { name: "Días del calendario" }) });
  expect(await section.evaluate((el) => getComputedStyle(el).getPropertyValue("--skin-seen-bg"))).toContain(noche.palette.seenA);
  await page.context().close();
});

test("6b · \"Tus calendarios\" (/c): cada tarjeta con los colores de su skin; el skin antiguo, con el respaldo Alegre", async ({ browser }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    const page = await guestPage(browser, { colorScheme, viewport: { width: 375, height: 900 } });
    await page.goto("/c");
    await expect(page.getByRole("heading", { name: "Tus calendarios" })).toBeVisible();
    const cover = (id: string) => `a[href="/c/${id}"] .calendar-card-cover`;
    for (const skin of catalog) {
      const sel = cover(calendarBySkin[skin.key]);
      await expect(page.locator(sel)).toHaveAttribute("data-skin-style", skin.key);
      expect(await css(page, sel, "background-color"), `${skin.key} portada de la tarjeta`).toBe(rgb(skin.palette.bg));
      expect(await css(page, `${sel} .cover-icon-box`, "background-color"), `${skin.key} recuadro`).toBe(rgb(skin.palette.tile));
      expect(await css(page, `${sel} .cover-icon-box`, "color"), `${skin.key} icono`).toBe(rgb(skin.palette.tileInk));
    }
    const legacy = cover(legacyCalendar);
    const alegre = catalog.find((c) => c.key === "alegre")!.palette;
    await expect(page.locator(legacy)).toHaveAttribute("data-skin-style", "fallback");
    expect(await css(page, legacy, "background-color")).toBe(rgb(alegre.bg));
    expect(await css(page, `${legacy} .cover-icon-box`, "background-color")).toBe(rgb(alegre.tile));
    // Tira Cómica: el recuadro del icono lleva su contorno también aquí.
    expect(await css(page, `${cover(calendarBySkin["tira-comica"])} .cover-icon-box`, "border-top-color")).toBe("rgb(26, 26, 26)");
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `6b-tus-calendarios-${colorScheme}-375.png`), fullPage: true });
    await page.context().close();
  }
});

test("6d · editor: el número sobre la miniatura de vídeo va en píldora OPACA --bg sobre --ink, sea o no «hoy»", async ({ browser }) => {
  const id = calendarBySkin.minimal;
  await convex.mutation(api.days.upsertDayPublic, { serverSecret: serverSecret(), calendarId: id, date: TODAY, videoUrl: "https://example.com/video-hoy" });
  for (const [colorScheme, ink, bg] of [["light", "#1d2320", "#fff8ee"], ["dark", "#f2f1ec", "#111513"]] as const) {
    const page = await (await browser.newContext({ colorScheme })).newPage();
    await loginAs(page, ACTOR_EMAIL);
    await page.goto(`/admin/${id}`);
    for (const d of [TODAY, SEEN]) {
      const num = page.locator(`button[aria-label="${label(d)} — vídeo asignado"] span`).first();
      await expect(num, `${colorScheme} ${d}`).toBeVisible();
      expect(await num.evaluate((el) => getComputedStyle(el).backgroundColor), `${colorScheme} ${d} fondo`).toBe(rgb(ink));
      expect(await num.evaluate((el) => getComputedStyle(el).color), `${colorScheme} ${d} texto`).toBe(rgb(bg));
    }
    await page.context().close();
  }
});

test("6c · avisos del invitado (rango demasiado largo) sobre tarjeta opaca --skin-card, también con imagen de fondo", async ({ browser }) => {
  const noche = catalog.find((c) => c.key === "noche")!;
  const longId = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: actorId,
    name: `Rango largo ${runId}`,
    coverTitle: "Rango largo",
    startDate: "2026-01-01",
    endDate: "2027-12-31",
    creationKey: `tal62v-long-${runId}`,
    skinId: noche._id as Id<"skins">,
    backgroundImageUrl: "https://example.com/tal62-fondo.jpg",
  });
  createdIds.add(longId);
  await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId: longId, email: GUEST_EMAIL });

  const page = await guestPage(browser, { viewport: { width: 375, height: 900 } });
  await page.context().clearCookies({ name: "tz" });
  const notice = page.locator("p.skin-notice", { hasText: "rango de fechas demasiado largo" });
  // 1ª visita sin cookie `tz` → cargador de cliente (door-grid-loader); al recargar, ya con la cookie → servidor (page.tsx).
  for (const path_ of ["cargador", "servidor"]) {
    if (path_ === "servidor") {
      expect((await page.context().cookies()).some((c) => c.name === "tz"), "cookie tz tras la 1ª visita").toBe(true);
      await page.reload();
    } else {
      await page.goto(`/c/${longId}`);
    }
    await expect(notice, path_).toBeVisible();
    expect(await css(page, "main[data-skin-style]", "background-image"), `${path_}: imagen de fondo debajo`).toContain("tal62-fondo.jpg");
    expect(await notice.evaluate((el) => getComputedStyle(el).backgroundColor), `${path_}: tarjeta opaca`).toBe(rgb(noche.palette.card));
    expect(await notice.evaluate((el) => getComputedStyle(el).color), `${path_}: texto`).toBe(rgb(noche.palette.ink));
  }
  await page.context().close();
});

test("7 · capturas de los 8 skins: 375px y escritorio, claro y oscuro (los colores del skin no dependen del tema)", async ({ browser }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    for (const viewport of [{ width: 375, height: 900 }, { width: 1280, height: 1000 }]) {
      const page = await guestPage(browser, { colorScheme, viewport });
      for (const skin of catalog) {
        await page.goto(`/c/${calendarBySkin[skin.key]}`);
        await page.waitForLoadState("networkidle");
        expect(await css(page, "main[data-skin-style]", "background-color"), `${skin.key} ${colorScheme}`).toBe(rgb(skin.palette.bg));
        const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
        expect(scrollWidth, `${skin.key} sin scroll horizontal`).toBeLessThanOrEqual(clientWidth);
        await expectHeroTextSizes(page.locator("main [data-skin-hero]"), `${skin.key} ${viewport.width}px`);
        await page.screenshot({ path: path.join(EVIDENCE_DIR, `7-${skin.key}-${colorScheme}-${viewport.width}.png`), fullPage: viewport.width === 375 });
      }
      await page.context().close();
    }
  }
});
