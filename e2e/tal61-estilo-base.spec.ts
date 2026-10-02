import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { loginAs, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";
import { measureEditor, measureGuestCalendar, type Box, type Geometry } from "./helpers/tal61-geometry";

/**
 * TAL-61 — estilo base "Estilo 2026": Plus Jakarta Sans como única familia,
 * paleta "Alegre" (claro y oscuro) con los tokens de contraste AA, botones
 * de texto opt-in y geometría intacta de lo que NO es botón de texto.
 */
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const SA_EMAIL = `e2e-tal61-superadmin-${runId}@example.com`;
const EVIDENCE_DIR = path.resolve(__dirname, "..", "docs", "evidence", "tal61");

let saId: Id<"users">;
let calendarId: Id<"calendars">;
let otherCalendarId: Id<"calendars">;

// --- Tablas del DS (design/design-system.md § "Estilo 2026 → Color") ---
const TOKENS = {
  light: {
    "--bg": "#fff8ee",
    "--surface": "#ffffff",
    "--surface-2": "#f7f6f3",
    "--ink": "#1d2320",
    "--ink-dim": "#6b726e",
    "--line": "#ebe8e1",
    "--primary": "#7b61ff",
    "--sun": "#ffd23f",
    "--coral": "#ff5a5f",
    "--mint": "#3ddc97",
    "--primary-soft": "#e6e0ff",
    "--coral-soft": "#ffd9d6",
    "--mint-soft": "#cdf7e3",
    "--primary-ink": "#6b52f5",
    "--primary-btn": "#6b52f5",
    "--on-sun": "#1d2320",
    "--coral-ink": "#d0353a",
    "--coral-btn": "#d0353a",
    "--icon-tile-bg": "#e6e0ff",
    "--icon-tile-fg": "#7b61ff",
  },
  dark: {
    "--bg": "#111513",
    "--surface": "#1a201d",
    "--surface-2": "#212825",
    "--ink": "#f2f1ec",
    "--ink-dim": "#a3aba6",
    "--line": "#2a322e",
    "--primary": "#8f7bff",
    "--sun": "#ffd23f",
    "--coral": "#ff7a7e",
    "--mint": "#3ddc97",
    "--primary-soft": "#2a2645",
    "--coral-soft": "#3b2620",
    "--mint-soft": "#1f3a2e",
    "--primary-ink": "#8f7bff",
    "--primary-btn": "#7157ff",
    "--on-sun": "#1d2320",
    "--coral-ink": "#ff7a7e",
    "--coral-btn": "#d0353a",
    "--icon-tile-bg": "#2a2645",
    "--icon-tile-fg": "#8f7bff",
  },
} as const;

// --- Geometría de referencia ---
// Medida con e2e/helpers/tal61-geometry.ts sobre main 941e8b2 (con TAL-60:
// los cierres ✕ ya son iconos Lucide), es decir, ANTES de TAL-61, y otra vez
// tras los commits solo de tipografía de TAL-61 (familia heredada, no
// tamaño). Lo que no lleva texto (puertas, casillas, muestras, cierres) es
// idéntico al píxel en las dos medidas; lo que lleva texto (segmentados
// URL/Subir y la columna en la que vive la miniatura de la vista previa)
// cambia 1-14px solo por las métricas de la nueva familia. Tras los
// cambios de color y forma, todo debe seguir igual que la medida
// post-tipografía (± 1px).
// TAL-62: la rejilla de puertas del invitado pasa a `gap: 5px` (mockup
// normativo design/propuesta-skins-modernos.html, `.days`), así que en
// escritorio la puerta mide 112px en vez de 118px, y en móvil 38px en vez
// de 43px; además lleva radio 10px (`.d` del mockup). Cambio deliberado de
// TAL-62, no de TAL-61.
const PRE_TAL61 = {
  desktop: { door: [112, 112], cell: [118, 118], skinSwatch: [34, 34], previewDialogClose: [30, 30], doorModalClose: [20, 20], dayDialogClose: [28, 28], iconPickerClose: [28, 28] },
  mobile: { door: [38, 38], cell: [64, 64], skinSwatch: [34, 34], previewDialogClose: [30, 30], doorModalClose: [20, 20], dayDialogClose: [28, 28], iconPickerClose: [28, 28] },
} as const;
const REFERENCE: Record<"desktop" | "mobile", Geometry> = {
  desktop: {
    door: { w: 112, h: 112, padding: "0px", radius: "10px" },
    doorColumns: 7,
    doorModalClose: { w: 20, h: 20, padding: "0px", radius: "0px" },
    cell: { w: 118, h: 118, padding: "0px", radius: "0px" },
    cellColumns: 7,
    dayDialogClose: { w: 28, h: 28, padding: "4px", radius: "0px" },
    segmentedLink: { w: 109, h: 29, padding: "6px 16px", radius: "0px" },
    segmentedUpload: { w: 112, h: 29, padding: "6px 16px", radius: "0px" },
    previewThumbnail: { w: 306, h: 172, padding: "0px", radius: "12px" },
    previewDialogClose: { w: 30, h: 30, padding: "0px", radius: "999px" },
    iconPickerClose: { w: 28, h: 28, padding: "4px", radius: "0px" },
    skinSwatch: { w: 34, h: 34, padding: "3px", radius: "8px" },
  },
  mobile: {
    door: { w: 38, h: 38, padding: "0px", radius: "10px" },
    doorColumns: 7,
    doorModalClose: { w: 20, h: 20, padding: "0px", radius: "0px" },
    cell: { w: 64, h: 64, padding: "0px", radius: "0px" },
    cellColumns: 7,
    dayDialogClose: { w: 28, h: 28, padding: "4px", radius: "0px" },
    segmentedLink: { w: 109, h: 29, padding: "6px 16px", radius: "0px" },
    segmentedUpload: { w: 112, h: 29, padding: "6px 16px", radius: "0px" },
    previewThumbnail: { w: 311, h: 175, padding: "0px", radius: "12px" },
    previewDialogClose: { w: 30, h: 30, padding: "0px", radius: "999px" },
    iconPickerClose: { w: 28, h: 28, padding: "4px", radius: "0px" },
    skinSwatch: { w: 34, h: 34, padding: "3px", radius: "8px" },
  },
};

// --- WCAG ---
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
function rgbToHex(rgb: string): string {
  const m = rgb.match(/\d+/g)!.slice(0, 3).map(Number);
  return "#" + m.map((n) => n.toString(16).padStart(2, "0")).join("");
}

async function newPage(browser: Browser, opts: { colorScheme?: "light" | "dark"; viewport?: { width: number; height: number } } = {}): Promise<Page> {
  const page = await (await browser.newContext(opts)).newPage();
  await loginAs(page, SA_EMAIL);
  return page;
}

/**
 * Recorre todos los elementos visibles con texto propio y devuelve los que
 * no usan Plus Jakarta Sans como primera familia, o que llevan una familia
 * genérica serif/monospace en la pila.
 */
async function fontOffenders(page: Page): Promise<string[]> {
  await page.evaluate(() => document.fonts.ready);
  return await page.evaluate(() => {
    const bad: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const hasText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
      const isControl = ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(el.tagName);
      if (!hasText && !isControl) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) continue;
      const family = getComputedStyle(el).fontFamily;
      const stack = family.split(",").map((f) => f.trim().replace(/["']/g, "").toLowerCase());
      const firstOk = /plus jakarta sans/.test(stack[0]);
      const generic = stack.some((f) => f === "serif" || f === "monospace");
      if (!firstOk || generic) bad.push(`${el.tagName} "${el.textContent!.trim().slice(0, 30)}" → ${family}`);
    }
    return bad;
  });
}

function expectBox(actual: Box | number, expected: Box | number, label: string) {
  if (typeof expected === "number") {
    expect(actual, label).toBe(expected);
    return;
  }
  const a = actual as Box;
  expect(Math.abs(a.w - expected.w), `${label} ancho ${a.w} vs ${expected.w}`).toBeLessThanOrEqual(1);
  expect(Math.abs(a.h - expected.h), `${label} alto ${a.h} vs ${expected.h}`).toBeLessThanOrEqual(1);
  expect(a.padding, `${label} padding`).toBe(expected.padding);
  expect(a.radius, `${label} radio`).toBe(expected.radius);
}

test.beforeAll(async () => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  saId = await seedUser({ email: SA_EMAIL, superAdmin: true });
  const create = (name: string, key: string) =>
    convex.mutation(api.calendars.createCalendarPublic, {
      serverSecret: serverSecret(),
      userId: saId,
      name,
      coverTitle: name,
      startDate: "2026-09-28",
      endDate: "2026-10-04",
      creationKey: `e2e-tal61-${key}-${runId}`,
    });
  calendarId = await create(`TAL-61 estilo ${runId}`, "main");
  otherCalendarId = await create(`TAL-61 estilo 2 ${runId}`, "other");
  await convex.mutation(api.days.upsertDayPublic, {
    serverSecret: serverSecret(),
    calendarId,
    date: "2026-09-29",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  });
  await convex.mutation(api.invitations.inviteGuestPublic, {
    serverSecret: serverSecret(),
    calendarId,
    email: `e2e-tal61-invitado-${runId}@example.com`,
  });
});

test.afterAll(async () => {
  const failures: string[] = [];
  for (const id of [calendarId, otherCalendarId]) {
    try {
      await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId: id, userId: saId });
    } catch (err) {
      failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  expect(failures, "calendarios de prueba sin limpiar").toEqual([]);
});

test("1 · ninguna serifa ni monoespaciada en ninguna pantalla (diálogos y menú abiertos incluidos)", async ({ browser }) => {
  const anon = await (await browser.newContext()).newPage();
  await anon.goto("/login");
  expect(await fontOffenders(anon), "/login").toEqual([]);
  expect(await anon.evaluate(() => document.fonts.check('16px "Plus Jakarta Sans"'))).toBe(true);
  // --icon-tile-fg* solo se admite en .cover-icon-box porque ahí solo hay un
  // <svg> (icono), nunca texto (caso 10).
  const tiles = await anon.locator(".cover-icon-box").evaluateAll((els) =>
    els.map((el) => ({ text: (el.textContent ?? "").trim(), svg: el.querySelectorAll("svg").length, children: el.children.length }))
  );
  expect(tiles.length).toBeGreaterThan(0);
  for (const tile of tiles) expect(tile).toEqual({ text: "", svg: 1, children: 1 });
  await anon.context().close();

  const page = await newPage(browser);
  const check = async (label: string) => expect(await fontOffenders(page), label).toEqual([]);

  for (const route of ["/admin", "/superadmin", "/c", "/unauthorized", `/c/${calendarId}`]) {
    await page.goto(route);
    await check(route);
  }

  await page.goto(`/c/${calendarId}`);
  await page.getByRole("button", { name: /^29\/9\/2026/ }).click();
  await check("/c/<id> con el modal del vídeo abierto");
  await page.getByRole("dialog").getByRole("button", { name: "Cerrar" }).click();

  await page.goto(`/admin/${calendarId}`);
  await check("/admin/<id>");
  await page.getByRole("button", { name: "Eliminar calendario" }).click();
  await check("diálogo de borrar");
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar" }).click();
  await page.locator('button[aria-label$=" — sin vídeo"]').first().click();
  await check("diálogo de día");
  await page.getByRole("dialog", { name: /^Editar día/ }).getByRole("button", { name: "Cerrar" }).click();
  await page.getByRole("button", { name: "Ver vista previa a tamaño completo" }).click();
  await check("diálogo de vista previa");
  await page.getByRole("dialog", { name: "Vista previa del calendario" }).getByRole("button", { name: "Cerrar" }).click();
  await page.getByRole("button", { name: "Icono" }).click();
  await check("selector de icono");
  await page.getByRole("dialog", { name: "Elegir icono de portada" }).getByRole("button", { name: "Cerrar" }).click();

  await page.goto("/admin");
  await page.getByRole("button", { name: "Menú de la cuenta" }).click();
  await check("menú de la cuenta abierto");
  await page.context().close();
});

test("2 · la fuente la sirve la propia app, sin pedir nada a Google", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const fontRequests: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "font" || /fonts\.(googleapis|gstatic)\.com/.test(r.url())) fontRequests.push(r.url());
  });
  await page.goto("/login");
  await page.evaluate(() => document.fonts.ready);
  expect(fontRequests.length, fontRequests.join("\n")).toBeGreaterThan(0);
  const origin = new URL(page.url()).origin;
  for (const url of fontRequests) {
    expect(url.startsWith(`${origin}/_next/static/media/`), url).toBe(true);
  }
  await context.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`3 · tokens y colores computados en ${scheme === "light" ? "claro" : "oscuro"} = tablas del DS`, async ({ browser }) => {
    const page = await newPage(browser, { colorScheme: scheme });
    await page.goto(`/admin/${calendarId}`);
    const values = await page.evaluate((names) => {
      const s = getComputedStyle(document.documentElement);
      // El navegador puede abreviar el hex computado (#ffffff → #fff).
      const expand = (v: string) => (/^#[0-9a-f]{3}$/.test(v) ? "#" + [...v.slice(1)].map((c) => c + c).join("") : v);
      return Object.fromEntries(names.map((n) => [n, expand(s.getPropertyValue(n).trim().toLowerCase())]));
    }, Object.keys(TOKENS[scheme]));
    expect(values).toEqual(TOKENS[scheme]);

    const t = TOKENS[scheme];
    const colorOf = async (selector: string, prop: "color" | "backgroundColor") =>
      rgbToHex(await page.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p as "color"], prop));
    expect(rgbToHex(await page.evaluate(() => getComputedStyle(document.body).backgroundColor))).toBe(t["--bg"]);
    expect(await colorOf(".btn-primary", "backgroundColor")).toBe(t["--primary-btn"]);
    expect(await colorOf(".btn-primary", "color")).toBe("#ffffff");
    expect(await colorOf(".btn-danger", "color")).toBe(t["--coral-ink"]);
    expect(await colorOf(".btn-danger-solid", "backgroundColor")).toBe(t["--coral-btn"]);
    expect(await colorOf(".btn-danger-solid", "color")).toBe("#ffffff");

    await page.goto("/admin");
    const link = page.getByRole("link", { name: `TAL-61 estilo ${runId}`, exact: true });
    expect(rgbToHex(await link.evaluate((el) => getComputedStyle(el).color))).toBe(t["--primary-ink"]);

    await page.screenshot({ path: path.join(EVIDENCE_DIR, `admin-${scheme}.png`), fullPage: false });
    await page.goto(`/admin/${calendarId}`);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `editor-${scheme}.png`), fullPage: true });
    await page.goto("/superadmin");
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `superadmin-${scheme}.png`), fullPage: false });
    await page.goto("/c");
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `usuario-${scheme}.png`), fullPage: false });
    await page.goto("/admin");
    await page.getByRole("button", { name: "Menú de la cuenta" }).click();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `menu-${scheme}.png`) });
    await page.context().close();

    const anon = await (await browser.newContext({ colorScheme: scheme })).newPage();
    await anon.goto("/login");
    await anon.screenshot({ path: path.join(EVIDENCE_DIR, `login-${scheme}.png`) });
    await anon.context().close();
  });
}

test("4 · contraste WCAG de los pares de uso (claro y oscuro)", () => {
  for (const scheme of ["light", "dark"] as const) {
    const t = TOKENS[scheme];
    const text: [string, string, string][] = [
      ["--ink", t["--ink"], t["--bg"]],
      ["--ink", t["--ink"], t["--surface"]],
      ["--ink-dim", t["--ink-dim"], t["--bg"]],
      ["--ink-dim", t["--ink-dim"], t["--surface"]],
      ["--primary-ink", t["--primary-ink"], t["--bg"]],
      ["--primary-ink", t["--primary-ink"], t["--surface"]],
      ["--primary-ink", t["--primary-ink"], t["--surface-2"]],
      ["blanco/--primary-btn", "#ffffff", t["--primary-btn"]],
      ["--coral-ink", t["--coral-ink"], t["--bg"]],
      ["--coral-ink", t["--coral-ink"], t["--surface"]],
      ["--coral-ink", t["--coral-ink"], t["--surface-2"]],
      ["blanco/--coral-btn", "#ffffff", t["--coral-btn"]],
      ["--on-sun/--sun", t["--on-sun"], t["--sun"]],
      ["--ink/--primary-soft (píldoras)", t["--ink"], t["--primary-soft"]],
      ["--ink/--surface-2 (aviso de vídeo, TAL-66)", t["--ink"], t["--surface-2"]],
    ];
    for (const [label, fg, bg] of text) {
      expect(contrast(fg, bg), `${scheme} ${label} sobre ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
    const graphics: [string, string, string][] = [
      ["icono/--icon-tile-bg", t["--icon-tile-fg"], t["--icon-tile-bg"]],
      ["--coral-btn/--bg", t["--coral-btn"], t["--bg"]],
      ["--coral-btn/--surface", t["--coral-btn"], t["--surface"]],
      ["--coral-btn/--surface-2", t["--coral-btn"], t["--surface-2"]],
    ];
    for (const [label, fg, bg] of graphics) {
      expect(contrast(fg, bg), `${scheme} ${label}`).toBeGreaterThanOrEqual(3);
    }
  }
});

for (const [vp, viewport] of [
  ["desktop", { width: 1280, height: 900 }],
  ["mobile", { width: 375, height: 812 }],
] as const) {
  test(`5 · geometría intacta de puertas, casillas, cierres, segmentados, vista previa y muestras (${vp})`, async ({ browser }) => {
    const page = await newPage(browser, { viewport });
    const measured: Geometry = {
      ...(await measureGuestCalendar(page, calendarId, /^28\/9\/2026$/, /^29\/9\/2026/)),
      ...(await measureEditor(page, calendarId)),
    };
    for (const [key, expected] of Object.entries(REFERENCE[vp])) {
      expectBox(measured[key], expected, `${vp} ${key}`);
    }
    // Lo que no lleva texto, igual que ANTES de TAL-61.
    for (const [key, [w, h]] of Object.entries(PRE_TAL61[vp])) {
      const b = measured[key] as Box;
      expect(Math.abs(b.w - w) <= 1 && Math.abs(b.h - h) <= 1, `${vp} ${key} pre-TAL-61 ${w}×${h} vs ${b.w}×${b.h}`).toBe(true);
    }
    // Puertas y casillas cuadradas.
    for (const key of ["door", "cell"]) {
      const b = measured[key] as Box;
      expect(Math.abs(b.w - b.h), `${vp} ${key} cuadrada`).toBeLessThanOrEqual(1);
    }

    // Ninguno de los botones excluidos lleva .btn.
    await page.goto(`/c/${calendarId}`);
    expect(await page.locator('button[aria-label*="/2026"].btn').count(), "puertas con .btn").toBe(0);
    await page.goto(`/admin/${calendarId}`);
    const excluded = page.locator(
      [
        'button[aria-label$=" — sin vídeo"]',
        'button[aria-label$=" — vídeo asignado"]',
        'button[aria-label="Ver vista previa a tamaño completo"]',
        "button.skin-swatch",
        "button.cover-icon-trigger",
        "button.copy-icon-button",
        'button[aria-label="Menú de la cuenta"]',
      ].join(", ")
    );
    expect(await excluded.count()).toBeGreaterThan(10);
    expect(await excluded.evaluateAll((els) => els.filter((el) => el.classList.contains("btn")).length)).toBe(0);
    await page.context().close();
  });
}

test("6 · números y fechas con tabular-nums", async ({ browser }) => {
  const page = await newPage(browser);
  const numeric = async (locator: ReturnType<Page["locator"]>) =>
    await locator.first().evaluate((el) => getComputedStyle(el).fontVariantNumeric);

  await page.goto(`/c/${calendarId}`);
  expect(await numeric(page.getByRole("button", { name: /^28\/9\/2026$/ }).locator("span"))).toContain("tabular-nums");
  expect(await numeric(page.getByText(/^Faltan \d+ días?/))).toContain("tabular-nums");

  await page.goto(`/admin/${calendarId}`);
  expect(await numeric(page.locator('button[aria-label$=" — sin vídeo"] span'))).toContain("tabular-nums");
  expect(await numeric(page.locator(".invite-link-url"))).toContain("tabular-nums");
  expect(await numeric(page.locator("#calendar-startDate"))).toContain("tabular-nums");

  await page.goto("/admin");
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: `TAL-61 estilo ${runId}`, exact: true }) });
  expect(await numeric(row.locator("td.num"))).toContain("tabular-nums");

  await page.goto("/c");
  expect(await numeric(page.locator(".calendar-card-meta"))).toContain("tabular-nums");
  await page.context().close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`7 · 375px sin scroll horizontal en todas las pantallas (${scheme === "light" ? "claro" : "oscuro"})`, async ({ browser }) => {
    const page = await newPage(browser, { colorScheme: scheme, viewport: { width: 375, height: 812 } });
    for (const [label, route] of [
      ["admin", "/admin"],
      ["editor", `/admin/${calendarId}`],
      ["superadmin", "/superadmin"],
      ["usuario", "/c"],
      ["calendario", `/c/${calendarId}`],
      ["unauthorized", "/unauthorized"],
    ] as const) {
      await page.goto(route);
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth, `${label}: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.clientWidth);
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `${label}-375-${scheme}.png`), fullPage: label === "editor" });
    }
    await page.context().close();

    const anon = await (await browser.newContext({ colorScheme: scheme, viewport: { width: 375, height: 812 } })).newPage();
    await anon.goto("/login");
    const overflow = await anon.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(overflow, "login 375").toBe(true);
    await anon.screenshot({ path: path.join(EVIDENCE_DIR, `login-375-${scheme}.png`) });
    await anon.context().close();
  });
}

/** Guarda en el día 30/9 una URL que no se puede incrustar, para que aparezca el aviso de TAL-66. */
async function openNonEmbeddableWarning(page: Page) {
  await page.goto(`/admin/${calendarId}`);
  await page.locator('button[aria-label^="30/9/2026"]').click();
  const dialog = page.getByRole("dialog", { name: /^Editar día/ });
  await dialog.locator('input[name="videoUrl"]').fill("https://example.com/mi-video.mp4");
  await dialog.getByRole("button", { name: "Guardar día" }).click();
  const warning = dialog.locator(".day-video-warning");
  await expect(warning).toBeVisible();
  return { dialog, warning };
}

for (const scheme of ["light", "dark"] as const) {
  test(`8 · aviso de vídeo no incrustable (TAL-66) con tokens Alegre y sin desbordar a 375px (${scheme === "light" ? "claro" : "oscuro"})`, async ({ browser }) => {
    const page = await newPage(browser, { colorScheme: scheme, viewport: { width: 375, height: 812 } });
    const { warning } = await openNonEmbeddableWarning(page);
    const t = TOKENS[scheme];
    const style = await warning.evaluate((el) => {
      const s = getComputedStyle(el);
      return { color: s.color, background: s.backgroundColor, stripe: s.borderLeftColor, family: s.fontFamily };
    });
    expect(rgbToHex(style.color)).toBe(t["--ink"]);
    expect(rgbToHex(style.background)).toBe(t["--surface-2"]);
    expect(rgbToHex(style.stripe)).toBe(t["--sun"]);
    expect(style.family.toLowerCase()).toContain("plus jakarta sans");
    expect(await fontOffenders(page), "diálogo de día con el aviso").toEqual([]);
    const box = (await warning.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(overflow, "sin scroll horizontal con el aviso").toBe(true);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `aviso-video-375-${scheme}.png`) });
    await page.context().close();
  });
}

// --- TAL-65: "Personas del calendario" (segmentado de radios, select de rol, "Quitar") ---
// Medidas de referencia del segmentado Visitante | Administrador, sobre
// main 5b45add (TAL-65 publicada, ANTES de TAL-61) y tras la tipografía de
// TAL-61. El contenedor y las opciones conservan borde, padding y radio de
// main; el ancho/alto de cada opción (lleva texto) se compara con la medida
// post-tipografía. Los dos <input type="radio"> NO reciben el estilo base
// de campos (solo lo reciben los tipos de texto).
const SEG_MAIN = {
  container: { padding: "2px", radius: "999px", border: "1px" },
  option: { padding: "5.6px 13.6px", radius: "999px" },
};
const SEG_POSTFONT = { visitante: [88, 29], admin: [124, 29] } as const;

for (const [vp, viewport] of [
  ["desktop", { width: 1280, height: 900 }],
  ["mobile", { width: 375, height: 812 }],
] as const) {
  test(`9 · TAL-65 «Personas del calendario»: segmentado intacto, radios sin estilo de campo, Quitar/Cambiar con clases opt-in (${vp})`, async ({ browser }) => {
    const page = await newPage(browser, { viewport });
    await page.goto(`/admin/${calendarId}`);
    const m = await page.evaluate(() => {
      const r = (el: Element) => {
        const b = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return { w: Math.round(b.width), h: Math.round(b.height), padding: s.padding, radius: s.borderRadius, border: s.borderTopWidth };
      };
      const seg = document.querySelector(".people-seg")!;
      const spans = Array.from(seg.querySelectorAll("span"));
      const radios = Array.from(seg.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
      return { seg: r(seg), visitante: r(spans[0]), admin: r(spans[1]), radios: radios.map(r), radioClasses: radios.map((x) => x.className) };
    });
    expect(m.seg.padding).toBe(SEG_MAIN.container.padding);
    expect(m.seg.radius).toBe(SEG_MAIN.container.radius);
    expect(m.seg.border).toBe(SEG_MAIN.container.border);
    for (const [key, [w, h]] of Object.entries(SEG_POSTFONT)) {
      const o = m[key as "visitante" | "admin"];
      expect(o.padding, key).toBe(SEG_MAIN.option.padding);
      expect(o.radius, key).toBe(SEG_MAIN.option.radius);
      expect(Math.abs(o.w - w) <= 1 && Math.abs(o.h - h) <= 1, `${key} ${o.w}×${o.h} vs ${w}×${h}`).toBe(true);
    }
    for (const radio of m.radios) {
      expect(radio.padding).toBe("0px");
      expect(radio.border).toBe("0px");
      expect(radio.radius).toBe("0px");
    }

    // Opción marcada (Visitante por defecto): fondo --primary-btn, texto blanco.
    const checked = page.locator(".people-seg input:checked + span");
    const t = TOKENS.light;
    expect(rgbToHex(await checked.evaluate((el) => getComputedStyle(el).backgroundColor))).toBe(t["--primary-btn"]);
    expect(rgbToHex(await checked.evaluate((el) => getComputedStyle(el).color))).toBe("#ffffff");

    // El select de rol sí recibe el estilo base de campos.
    const select = page.locator(".people-role-form select").first();
    expect(await select.evaluate((el) => getComputedStyle(el).borderRadius)).toBe("14px");

    // "Quitar" y "Borrar por completo": .btn .btn-danger con texto --coral-ink.
    const remove = page.locator(".people-remove:not(:disabled)").first();
    await expect(remove).toHaveClass(/\bbtn\b.*\bbtn-danger\b/);
    expect(rgbToHex(await remove.evaluate((el) => getComputedStyle(el).color))).toBe(t["--coral-ink"]);
    await expect(page.getByRole("button", { name: "Borrar por completo" }).first()).toHaveClass(/btn-danger/);

    // "Cambiar" (solo sin JS, dentro de <noscript>): en el HTML servido lleva .btn.
    const html = await (await page.request.get(`/admin/${calendarId}`)).text();
    expect(html).toMatch(/<noscript>[^]*?<button[^>]*class="btn"[^>]*>\s*Cambiar/);

    // 375px: la sección no provoca scroll horizontal.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    expect(overflow, "sin scroll horizontal").toBe(true);
    if (vp === "mobile") {
      await page.locator(".people-section").scrollIntoViewIfNeeded();
      await page.locator(".people-section").screenshot({ path: path.join(EVIDENCE_DIR, "personas-375-light.png") });
    }
    await page.context().close();
  });
}

// --- Barrido de colores de TEXTO en el código (NO-GO loops 1, 2 y 3) ---
// Recorre TODAS las declaraciones de color de src/ (.ts, .tsx y .css), en
// las formas `color:`, `"color":`, `'color':`, `["color"]:` y `['color']:`,
// varias por línea, tras quitar los comentarios /* … */ (aunque estén en la
// misma línea que el código) y, en .ts/.tsx, las líneas `// …`.
// Solo pasa sin más un valor que es EXACTAMENTE un token de texto AA
// (contraste en el caso 4). Cualquier otro valor — literal hex o nombre,
// `inherit`, expresión dinámica, `--accent`/`--primary`/`--coral`, tokens de
// icono — falla, salvo que EXCEPTIONS dispense ESE valor exacto en ESE
// fichero:línea, con su motivo. Una excepción solo dispensa una vez el
// valor declarado: otro valor no-AA, o un segundo color no-AA en la misma
// línea, falla. Si el valor exacto ya no está en esa línea, la excepción
// queda huérfana y también falla (obliga a revisar la lista).
//
// LÍMITES CONOCIDOS (decisión de la Directora, loop 4): no es un parser de
// TypeScript/CSS. No ve una declaración partida en varias líneas
// (`color:` en una y el valor en la siguiente) ni colores que llegan por un
// spread (`...obj`). Es una red estática complementaria; la garantía de
// contraste son los valores computados en el DOM (caso 3) y los pares de
// tokens (caso 4).
const SRC = path.resolve(__dirname, "..", "src");
const AA_TEXT_TOKENS = new Set(["ink", "ink-dim", "primary-ink", "coral-ink", "on-sun"]);
const SKIN = "superficie del calendario: el color lo pone el skin (--accent o su tratamiento de texto); su contraste lo cubre TAL-62";
const TYPE = "anotación de tipo de TypeScript, no un valor de color";
// TAL-62 (NO-GO M2 del loop2): los tokens de texto del skin NO cuentan como
// AA en general — cada uso va aquí con su fondo REAL y el par que verifica,
// en los 8 skins, scripts/verify-tal62-skin-contrast.mjs.
const GATE = "par verificado en los 8 skins por scripts/verify-tal62-skin-contrast.mjs";
type ColorException = { value: string; reason: string };
const EXCEPTIONS: Record<string, ColorException> = {
  // globals.css
  "app/globals.css:189": { value: "#ffffff", reason: "blanco sobre --primary-btn (.btn-primary): 5,06 claro / 4,66 oscuro (caso 4)" },
  "app/globals.css:211": { value: "#ffffff", reason: "blanco sobre --coral-btn (.btn-danger-solid): 4,94 (caso 4)" },
  "app/globals.css:258": { value: "var(--foreground)", reason: "body: --foreground = --ink (alias legacy de Next)" },
  "app/globals.css:272": { value: "inherit", reason: "a { color: inherit }: el enlace hereda un color AA del contenedor; los enlaces visibles fijan --primary-ink" },
  "app/globals.css:337": { value: "#ffffff", reason: "inicial del avatar: blanco sobre --primary-btn (5,06 / 4,66)" },
  "app/globals.css:693": { value: "var(--bg)", reason: ".toast: burbuja invertida, texto --bg sobre fondo --ink (15,2 / 16,3)" },
  "app/globals.css:881": { value: "inherit", reason: ".superadmin-calendar-card: hereda --ink de la página (la tarjeta es un <a>)" },
  "app/globals.css:916": { value: "var(--icon-tile-fg-light, var(--icon-tile-fg))", reason: ".cover-icon-box: solo envuelve un <svg> de <CoverIcon>, nunca texto (icono ≥ 3:1, caso 4; el caso 1 lo comprueba en el DOM)" },
  "app/globals.css:921": { value: "var(--icon-tile-fg-dark, var(--icon-tile-fg))", reason: ".cover-icon-box (oscuro): ídem, solo <svg>" },
  "app/globals.css:926": { value: "var(--icon-tile-fg-dark, var(--icon-tile-fg))", reason: ".cover-icon-box (data-theme=dark): ídem, solo <svg>" },
  "app/globals.css:1011": { value: "#ffffff", reason: "opción marcada del segmentado de TAL-65: blanco sobre --primary-btn (5,06 / 4,66)" },
  "app/globals.css:1124": { value: "var(--skin-hero-ink)", reason: ".skin-hero: textos del bloque (portada y diálogo de la vista previa, TEXTO GRANDE según scripts/tal62-hero-text-sizes.json) sobre --skin-hero, o sobre píldora blanca en Rojiblanco; la miniatura compacta no tiene texto (NO-GO M1); " + GATE },
  "app/globals.css:1156": { value: "var(--skin-hero-num)", reason: ".skin-hero-num: número de la cuenta atrás (texto grande) sobre --skin-hero o píldora blanca; " + GATE },
  "app/globals.css:1204": { value: "var(--skin-ink)", reason: ".skin-month-card: fondo --skin-card en la misma regla: ink/card, " + GATE },
  "app/globals.css:1214": { value: "var(--skin-ink)", reason: ".skin-notice (avisos del invitado, NO-GO M2): fondo --skin-card opaco en la misma regla, haya o no imagen debajo: ink/card, " + GATE },
  // Editor (fuera del calendario)
  "app/admin/[calendarId]/days-grid-editor.tsx:521": { value: 'videoSource === value ? "#ffffff" : "var(--ink-dim)"', reason: "segmentado Link/Subir: blanco sobre --primary-btn si está marcado, --ink-dim si no (ambos AA)" },
  "app/admin/[calendarId]/calendar-preview.tsx:221": { value: '"#ffffff"', reason: "icono ✕ (svg) blanco sobre el círculo oscuro del diálogo de vista previa, encima de la portada del skin" },
  // Superficie del calendario: grid del editor dentro de la sección de días (days-section.tsx fija --accent con el del skin) y /c/[id]
  "app/admin/[calendarId]/days-grid-editor.tsx:60": { value: '"inherit"', reason: "casilla del grid: hereda; " + SKIN },
  "app/admin/[calendarId]/days-grid-editor.tsx:117": { value: '"var(--bg)"', reason: "número sobre miniatura de vídeo (foto arbitraria), «hoy» o no: píldora OPACA --bg sobre --ink (15,2 / 16,3, caso 4) — TAL-62, NO-GO M3 del loop2" },
  "app/admin/[calendarId]/days-grid-editor.tsx:127": { value: 'isToday ? "var(--accent)" : isWeekend ? "var(--coral-ink)" : "var(--ink)"', reason: "número de día: --accent del skin hoy, --coral-ink fin de semana, --ink resto; " + SKIN },
  "app/admin/[calendarId]/days-grid-editor.tsx:280": { value: 'i >= 5 ? "var(--coral-ink)" : undefined', reason: "inicial S/D en --coral-ink, resto heredado; " + SKIN },
  "app/c/[calendarId]/door-grid.tsx:37": { value: '"var(--skin-ink)"', reason: "número de casilla abierta sobre --skin-cell: ink/cell, " + GATE },
  "app/c/[calendarId]/door-grid.tsx:41": { value: '"var(--skin-dim)"', reason: "casilla bloqueada: fondo transparente dentro de la tarjeta del mes (--skin-card): dim/card, " + GATE },
  "app/c/[calendarId]/door-grid.tsx:50": { value: '"var(--skin-today-ink)"', reason: "casilla de hoy sobre --skin-today: todayInk/today, " + GATE },
  "app/c/[calendarId]/door-grid.tsx:94": { value: '"var(--skin-dim)"', reason: "número de casilla FUERA de rango: decorativo, aria-hidden y a opacidad 0.3 (no es contenido; lo comprueba tal-62-skins test 1)" },
  "app/c/[calendarId]/door-grid.tsx:165": { value: '"var(--skin-ink)"', reason: "textTreatment de la cabecera del mes y del modal, ambos sobre --skin-card: ink/card, " + GATE },
  "app/c/[calendarId]/door-grid.tsx:118": { value: '"#ffffff"', reason: "número del día «visto» en blanco sobre su píldora rgba(15,24,18,0.6) compuesta sobre --skin-seen-bg: ≥ 4,5 en los 8 skins (puerta de TAL-62, regla aprobada por el PM)" },
  "app/c/[calendarId]/door-grid.tsx:134": { value: "numColor", reason: "número de día: --skin-dim (bloqueada), --skin-today-ink (hoy), --skin-weekend (fin de semana) o --skin-ink — los cuatro, tokens de texto del skin verificados por la puerta de TAL-62" },
  "app/c/[calendarId]/door-grid.tsx:652": { value: '"var(--skin-ink)"', reason: "cabecera sticky del mes con fondo --skin-card: ink/card, " + GATE },
  "app/c/[calendarId]/door-grid.tsx:667": { value: '"var(--skin-dim)"', reason: "iniciales L–V dentro de la tarjeta del mes (--skin-card): dim/card, " + GATE },
  "app/c/[calendarId]/door-grid.tsx:676": { value: 'i >= 5 ? "var(--skin-weekend)" : undefined', reason: "inicial S/D en --skin-weekend (verificado por la puerta de TAL-62), resto heredado de --skin-dim" },
  "app/c/[calendarId]/door-grid.tsx:846": { value: '"var(--skin-ink)"', reason: "modal del día con fondo --skin-card: ink/card, " + GATE },
  "app/c/[calendarId]/page.tsx:198": { value: '"var(--skin-ink)"', reason: "color heredado del <main> (fondo --skin-bg, o la imagen de fondo): ningún texto lo usa directamente sobre el fondo — el título fija el suyo (TAL-47: ink/bg, o «photo» con imagen), y bloque, tarjeta del mes y avisos (.skin-notice) llevan fondo opaco propio; ink/bg, " + GATE },
  "app/c/[calendarId]/door-grid.tsx:781": { value: '"var(--bg)"', reason: "burbuja de paciencia invertida: --bg sobre --ink (15,2 / 16,3)" },
  "components/cover-text.tsx:37": { value: "treatment.color", reason: "texto de portada: el color lo da el tratamiento del skin (resolveCoverTextTreatment, TAL-47); " + SKIN },
  "components/cover-text.tsx:51": { value: "treatment.color", reason: "ídem (variante píldora); " + SKIN },
  // .ts (desde el loop 4)
  "lib/skin-appearance.ts:186": { value: "string", reason: TYPE },
  "lib/skin-appearance.ts:187": { value: "string", reason: TYPE },
  "lib/skin-appearance.ts:188": { value: "string", reason: TYPE },
  "lib/skin-appearance.ts:221": { value: '"#fff"', reason: "tratamiento «photo»: texto blanco con sombra sobre la foto/imagen de fondo de la portada; " + SKIN },
  "lib/skin-appearance.ts:224": { value: "appearance.textColor", reason: "tratamiento «pill»: textColor del skin sobre píldora oscura; " + SKIN },
  "lib/skin-appearance.ts:226": { value: "appearance.textColor", reason: "tratamiento «flat»: textColor del skin sobre su fondo (verificado en TAL-47, scripts/verify-tal47-textcolor-wcag.mjs); " + SKIN },
  "lib/confetti-canvas.ts:26": { value: "string", reason: TYPE },
  "lib/confetti-canvas.ts:88": { value: "CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0]", reason: "partícula de confeti pintada en <canvas>, decorativa, no texto" },
};

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|css)$/.test(entry)) yield full;
  }
}

/** Quita los comentarios /* … *\/ (con estado entre líneas) y, en .ts/.tsx, las líneas `// …`. */
function stripComments(lines: string[], isCss: boolean): string[] {
  let inComment = false;
  return lines.map((line) => {
    let out = "";
    let i = 0;
    while (i < line.length) {
      if (inComment) {
        const end = line.indexOf("*/", i);
        if (end < 0) return out;
        inComment = false;
        i = end + 2;
      } else {
        const start = line.indexOf("/*", i);
        if (start < 0) {
          out += line.slice(i);
          break;
        }
        out += line.slice(i, start);
        inComment = true;
        i = start + 2;
      }
    }
    return !isCss && out.trim().startsWith("//") ? "" : out;
  });
}

const COLOR_PROP = /(?<![A-Za-z0-9_$-])(?:color|"color"|'color'|\["color"\]|\['color'\])\s*:\s*/g;

/** Valor de cada declaración de color de la línea (CSS: hasta `;`; TS/TSX: hasta `,`/`;`/`}` fuera de paréntesis). */
function colorValues(line: string, isCss: boolean): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(COLOR_PROP)) {
    const rest = line.slice(m.index! + m[0].length);
    out.push((isCss ? rest.split(";")[0] : rest.split(/[,;](?![^(]*\))|\s\}|\}$/)[0]).trim());
  }
  return out;
}

function isAaValue(value: string, isCss: boolean): boolean {
  const m = isCss ? value.match(/^var\(--([a-z0-9-]+)\)$/) : value.match(/^"var\(--([a-z0-9-]+)\)"$/);
  return !!m && AA_TEXT_TOKENS.has(m[1]);
}

test("10 · ningún color de texto fuera de la lista blanca AA sin excepción atada a su valor exacto (barrido de todo src/)", () => {
  const offenders: string[] = [];
  const usedExceptions = new Set<string>();
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file);
    const isCss = file.endsWith(".css");
    stripComments(readFileSync(file, "utf8").split("\n"), isCss).forEach((line, i) => {
      const key = `${rel}:${i + 1}`;
      for (const value of colorValues(line, isCss)) {
        if (isAaValue(value, isCss)) continue;
        const exception = EXCEPTIONS[key];
        if (exception && exception.value === value && !usedExceptions.has(key)) {
          usedExceptions.add(key);
          continue;
        }
        offenders.push(`${key} → color: ${value}${exception ? `  (la excepción de esta línea solo dispensa, una vez, el valor exacto ${exception.value})` : ""}`);
      }
    });
  }
  expect(offenders, offenders.join("\n")).toEqual([]);
  const stale = Object.keys(EXCEPTIONS).filter((k) => !usedExceptions.has(k));
  expect(stale, `excepciones huérfanas (su valor exacto ya no está en esa línea): ${stale.join(", ")}`).toEqual([]);

  // El estado del NO-GO del loop 1 (people === null) usa --coral-ink.
  const guests = readFileSync(path.join(SRC, "app/admin/[calendarId]/guests-section.tsx"), "utf8");
  expect(guests).toMatch(/color: "var\(--coral-ink\)" \}\}>Las personas del calendario no están disponibles ahora mismo\./);
});
