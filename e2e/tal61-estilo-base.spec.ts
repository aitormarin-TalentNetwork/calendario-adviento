import { mkdirSync } from "node:fs";
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
const PRE_TAL61 = {
  desktop: { door: [118, 118], cell: [118, 118], skinSwatch: [34, 34], previewDialogClose: [30, 30], doorModalClose: [20, 20], dayDialogClose: [28, 28], iconPickerClose: [28, 28] },
  mobile: { door: [43, 43], cell: [64, 64], skinSwatch: [34, 34], previewDialogClose: [30, 30], doorModalClose: [20, 20], dayDialogClose: [28, 28], iconPickerClose: [28, 28] },
} as const;
const REFERENCE: Record<"desktop" | "mobile", Geometry> = {
  desktop: {
    door: { w: 118, h: 118, padding: "0px", radius: "0px" },
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
    door: { w: 43, h: 43, padding: "0px", radius: "0px" },
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
