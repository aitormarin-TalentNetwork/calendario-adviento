import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-70 — login genérico, bienvenida con foto (primera vez de cada día, por
 * persona y calendario) e imagen de fondo tenue. Las fotos las sirve el
 * propio test (`page.route`), así que no depende de la red: blanca pura
 * (peor caso de contraste), y una URL que da 404 (foto rota). El "día" lo
 * controla la zona horaria del navegador y su cookie `tz`: Kiritimati
 * (UTC+14) y Pago Pago (UTC-11) están siempre en días naturales distintos.
 */
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const A_EMAIL = `e2e-tal70-admin-${runId}@example.com`;
const G_EMAIL = `e2e-tal70-guest-${runId}@example.com`;
const S_EMAIL = `e2e-tal70-super-${runId}@example.com`;
const OUT_EMAIL = `e2e-tal70-outsider-${runId}@example.com`;
const G_NAME = "Aitziber Marín";
const EVIDENCE_DIR = path.resolve(__dirname, "..", "docs", "evidence", "tal70");

const PHOTO_HOST = "https://tal70-e2e.example.com";
const WHITE_PHOTO = `${PHOTO_HOST}/white.png`;
const BLACK_PHOTO = `${PHOTO_HOST}/black.png`;
const BROKEN_PHOTO = `${PHOTO_HOST}/missing.png`;
const TZ_A = "Pacific/Kiritimati";
const TZ_B = "Pacific/Pago_Pago";

/** PNG de 16x16 de un color, para servir como foto. */
function solidPng(gray: number): Buffer {
  const size = 16;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size * 3; x++) raw[y * (size * 3 + 1) + 1 + x] = gray;
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
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
const WHITE_PNG = solidPng(255);
const BLACK_PNG = solidPng(0);

let aId: Id<"users">;
let gId: Id<"users">;
let sId: Id<"users">;
const createdCalendarIds = new Set<Id<"calendars">>();
let skins: { _id: Id<"skins">; key: string; name: string }[] = [];

/** Fecha natural de hoy en una zona horaria (la misma cuenta que `welcomeDate` del servidor). */
function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function countRows(calendarIds: string[]): number {
  const out = execFileSync("npx", ["convex", "run", "welcomeViews:countForCalendars", JSON.stringify({ calendarIds })], { encoding: "utf8" });
  return Number(out.trim());
}

async function createCalendar(name: string, opts: { coverImageUrl?: string; backgroundImageUrl?: string; skinId?: Id<"skins"> } = {}) {
  const id = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: sId,
    name,
    coverTitle: `${name}: una sorpresa cada día para ti`,
    startDate: "2026-09-01",
    endDate: "2026-12-24",
    creationKey: `e2e-tal70-${runId}-${name}`,
    ...opts,
  });
  createdCalendarIds.add(id);
  await convex.mutation(api.superadmin.addAdminPublic, { serverSecret: serverSecret(), actorUserId: sId, calendarId: id, email: A_EMAIL });
  await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId: id, email: G_EMAIL });
  await convex.mutation(api.access.resolveMemberAccessPublic, { serverSecret: serverSecret(), calendarId: id, userId: gId });
  return id;
}

async function newContext(browser: Browser, timeZone: string, extra: Parameters<Browser["newContext"]>[0] = {}): Promise<BrowserContext> {
  const context = await browser.newContext({ timezoneId: timeZone, ...extra });
  await context.addCookies([{ name: "tz", value: timeZone, url: `http://localhost:${process.env.E2E_PORT ?? 3000}` }]);
  await context.route(`${PHOTO_HOST}/**`, (route) => {
    const url = route.request().url();
    if (url === WHITE_PHOTO) return route.fulfill({ status: 200, contentType: "image/png", body: WHITE_PNG });
    if (url === BLACK_PHOTO) return route.fulfill({ status: 200, contentType: "image/png", body: BLACK_PNG });
    return route.fulfill({ status: 404, body: "no" });
  });
  return context;
}

/** Entra por el login de desarrollo con nombre (para "Hola, <nombre>"). */
async function login(page: Page, email: string, name = "", callbackUrl = "/start") {
  await page.goto(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`);
  const devForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Entrar (dev)" }) });
  await devForm.locator('input[name="email"]').fill(email);
  if (name) await devForm.locator('input[name="name"]').fill(name);
  await devForm.getByRole("button", { name: "Entrar (dev)" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function guestPage(browser: Browser, timeZone = TZ_A, extra: Parameters<Browser["newContext"]>[0] = {}) {
  const context = await newContext(browser, timeZone, extra);
  const page = await context.newPage();
  await login(page, G_EMAIL, G_NAME);
  return page;
}

function hasSeen(userId: Id<"users">, calendarId: Id<"calendars">, date: string) {
  return convex.query(api.welcomeViews.hasSeenTodayPublic, { serverSecret: serverSecret(), userId, calendarId, date });
}

const welcome = (page: Page) => page.locator(".welcome-overlay");

/**
 * `ConvexHttpClient` encola las mutations de un mismo cliente (una detrás de
 * otra): para que la concurrencia sea real, cada llamada simultánea usa su
 * propio cliente.
 */
const freshClient = () => new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

test.beforeAll(async () => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  aId = await seedUser({ email: A_EMAIL });
  gId = await seedUser({ email: G_EMAIL });
  sId = await seedUser({ email: S_EMAIL, superAdmin: true });
  await seedUser({ email: OUT_EMAIL });
  skins = await convex.query(api.skins.listCatalogPublic, { serverSecret: serverSecret() });
  expect(skins).toHaveLength(8);
});

test.afterAll(async () => {
  const failures: string[] = [];
  for (const id of createdCalendarIds) {
    try {
      await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId: id, userId: aId });
    } catch (err) {
      failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  expect(failures, "calendarios de prueba sin limpiar").toEqual([]);
  expect(countRows([...createdCalendarIds]), "welcomeViews huérfanas tras borrar").toBe(0);
});

test("1 · /login genérico, con y sin callbackUrl; entrar conserva el callbackUrl", async ({ browser }) => {
  const calendarId = await createCalendar("login", { coverImageUrl: WHITE_PHOTO });
  const context = await newContext(browser, TZ_A);
  const page = await context.newPage();
  for (const url of ["/login", `/login?callbackUrl=/c/${calendarId}`]) {
    const response = await page.goto(url);
    expect(response?.status(), url).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: "Calendario de Adviento" })).toBeVisible();
    await expect(page.getByText("Una sorpresa cada día.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Entrar con Google" })).toBeVisible();
    await expect(page.locator(".login-logo svg.lucide")).toBeVisible();
    // Nada del calendario: ni título, ni icono, ni foto.
    await expect(page.getByText("login: una sorpresa cada día para ti")).toHaveCount(0);
    await expect(page.locator("[data-cover-icon]")).toHaveCount(0);
    await expect(page.locator("img")).toHaveCount(0);
    const html = await page.content();
    expect(html).not.toContain(WHITE_PHOTO);
  }
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "login-callback.png") });
  const devForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Entrar (dev)" }) });
  await devForm.locator('input[name="email"]').fill(G_EMAIL);
  await devForm.getByRole("button", { name: "Entrar (dev)" }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${calendarId}$`));
  await context.close();
});

test("2 · bienvenida: sale la primera vez del día y queda marcada; mismo día no; otro día sí", async ({ browser }) => {
  const calendarId = await createCalendar("dia", { coverImageUrl: WHITE_PHOTO });
  const dateA = todayIn(TZ_A);
  const dateB = todayIn(TZ_B);
  expect(dateA).not.toBe(dateB);

  const page = await guestPage(browser, TZ_A);
  await page.goto(`/c/${calendarId}`);
  await expect(welcome(page)).toHaveAttribute("data-welcome-phase", "shown");
  await expect(page.locator(".welcome-hello")).toHaveText("Hola, Aitziber");
  await expect(page.getByRole("heading", { level: 2, name: "dia: una sorpresa cada día para ti" })).toBeVisible();
  await expect(page.locator(".welcome-countdown")).toHaveText(/^Faltan \d+ días para la Navidad$/);
  await expect(page.getByRole("button", { name: "Abrir mi calendario" })).toBeFocused();
  await expect.poll(() => hasSeen(gId, calendarId, dateA)).toBe(true);
  expect(await hasSeen(gId, calendarId, dateB)).toBe(false);

  await page.goto(`/c/${calendarId}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);
  await page.context().close();

  // Otro día natural (otra zona horaria) → vuelve a salir.
  const pageB = await guestPage(browser, TZ_B);
  await pageB.goto(`/c/${calendarId}`);
  await expect(welcome(pageB)).toHaveAttribute("data-welcome-phase", "shown");
  await expect.poll(() => hasSeen(gId, calendarId, dateB)).toBe(true);
  await pageB.context().close();
  expect(countRows([calendarId])).toBe(2);
});

test("3 · sin foto → directo al calendario; foto rota (404) → sin bienvenida y sin marcar", async ({ browser }) => {
  const noPhoto = await createCalendar("sinfoto");
  const broken = await createCalendar("rota", { coverImageUrl: BROKEN_PHOTO });
  const page = await guestPage(browser);
  await page.goto(`/c/${noPhoto}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);

  await page.goto(`/c/${broken}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(welcome(page)).toHaveCount(0);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "foto-rota.png") });
  // Nunca se marca: ni hoy ni en ninguna fecha.
  await page.waitForTimeout(1500);
  expect(countRows([noPhoto, broken])).toBe(0);
  await page.context().close();
});

for (const [label, viewport] of [["375", { width: 375, height: 812 }], ["escritorio", { width: 1280, height: 800 }]] as const) {
  test(`4 · «Abrir mi calendario» cierra y deja el calendario usable; contraste sobre foto blanca (${label})`, async ({ browser }) => {
    const calendarId = await createCalendar(`abrir-${label}`, { coverImageUrl: WHITE_PHOTO });
    const page = await guestPage(browser, TZ_A, { viewport });
    await page.goto(`/c/${calendarId}`);
    await expect(welcome(page)).toHaveAttribute("data-welcome-phase", "shown");
    // El menú de la cuenta queda por encima de la bienvenida.
    await page.getByRole("button", { name: "Menú de la cuenta" }).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    // Ese Escape era del menú: la bienvenida sigue ahí.
    await expect(welcome(page)).toHaveAttribute("data-welcome-phase", "shown");

    // Contraste: alpha del degradado a la altura del borde SUPERIOR de cada
    // texto (el punto más claro de su caja), compuesto sobre #fff.
    const measures = await page.evaluate(() => {
      const overlay = document.querySelector(".welcome-overlay")!.getBoundingClientRect();
      const alphaAt = (y: number) => {
        const f = (overlay.bottom - y) / overlay.height; // 0 abajo, 1 arriba
        return f <= 0.5 ? 0.85 + (0.6 - 0.85) * (f / 0.5) : 0.6 + (0.1 - 0.6) * ((f - 0.5) / 0.5);
      };
      const shade = getComputedStyle(document.querySelector(".welcome-shade")!).backgroundImage;
      return {
        shade,
        texts: [".welcome-hello", ".welcome-title", ".welcome-countdown"].map((sel) => {
          const el = document.querySelector(sel)!;
          const cs = getComputedStyle(el);
          return { sel, top: el.getBoundingClientRect().top, alpha: alphaAt(el.getBoundingClientRect().top), color: cs.color, px: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) };
        }),
        button: { color: getComputedStyle(document.querySelector(".welcome-open")!).color, bg: getComputedStyle(document.querySelector(".welcome-open")!).backgroundColor },
      };
    });
    // Parada intermedia 0.6 (aprobada por el PM; el mockup tenía 0.35).
    expect(measures.shade).toBe("linear-gradient(to top, rgba(10, 8, 30, 0.85) 0%, rgba(10, 8, 30, 0.6) 50%, rgba(10, 8, 30, 0.1) 100%)");
    const lum = (c: number[]) => {
      const ch = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
    };
    const ratio = (a: number[], b: number[]) => {
      const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (l1 + 0.05) / (l2 + 0.05);
    };
    const rows: string[] = [];
    for (const t of measures.texts) {
      expect(t.color, t.sel).toBe("rgb(255, 255, 255)");
      const bg = [10, 8, 30].map((v) => v * t.alpha + 255 * (1 - t.alpha));
      const large = t.px >= 24 || (t.px >= 18.66 && t.weight >= 700);
      const r = ratio([255, 255, 255], bg);
      rows.push(`${t.sel} ${t.px}px/${t.weight} alpha=${t.alpha.toFixed(3)} → ${r.toFixed(2)}:1 (mín ${large ? 3 : 4.5})`);
      expect.soft(r, rows.at(-1)).toBeGreaterThanOrEqual(large ? 3 : 4.5);
    }
    const rgb = (s: string) => s.match(/\d+/g)!.slice(0, 3).map(Number);
    const buttonRatio = ratio(rgb(measures.button.color), rgb(measures.button.bg));
    rows.push(`.welcome-open ${measures.button.color} sobre ${measures.button.bg} → ${buttonRatio.toFixed(2)}:1`);
    expect(buttonRatio).toBeGreaterThanOrEqual(4.5);
    test.info().annotations.push({ type: `contraste ${label}`, description: rows.join(" · ") });
    console.log(`contraste ${label}:\n  ${rows.join("\n  ")}`);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `bienvenida-${label}.png`) });

    await page.getByRole("button", { name: "Abrir mi calendario" }).click();
    await expect(welcome(page)).toHaveCount(0);
    await expect(page.locator("#calendar-main")).toBeFocused();
    await page.locator('button[aria-label^="1/9/2026"]').click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.context().close();
  });
}

test("5 · fondo tenue: capa al 10 % con saturate(0.7), sin capa oscura; 8 skins a 375 px en claro y oscuro; puerta de contraste", async ({ browser }) => {
  for (const skin of skins) {
    const calendarId = await createCalendar(`skin-${skin.key}`, { backgroundImageUrl: BLACK_PHOTO, skinId: skin._id });
    // Ya vista hoy, para que la bienvenida no tape la captura (no tiene foto de portada de todos modos).
    for (const scheme of ["light", "dark"] as const) {
      const page = await guestPage(browser, TZ_A, { viewport: { width: 375, height: 812 }, colorScheme: scheme });
      await page.goto(`/c/${calendarId}`);
      await expect(page.locator(".skin-month-card")).toBeVisible();
      const layer = await page.evaluate(() => {
        const main = document.getElementById("calendar-main")!;
        const el = main.querySelector(":scope > .faint-bg-layer")!;
        const cs = getComputedStyle(el);
        const card = getComputedStyle(document.querySelector(".skin-month-card")!);
        return {
          opacity: cs.opacity,
          filter: cs.filter,
          image: cs.backgroundImage,
          pointerEvents: cs.pointerEvents,
          mainImage: getComputedStyle(main).backgroundImage,
          cardBg: card.backgroundColor,
          skinCard: getComputedStyle(main).getPropertyValue("--skin-card").trim(),
          noScroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          titleShadow: getComputedStyle(document.querySelector("h1 span, h1")!).textShadow,
        };
      });
      expect(layer.opacity, skin.key).toBe("0.1");
      expect(layer.filter).toBe("saturate(0.7)");
      expect(layer.image).toContain(BLACK_PHOTO);
      expect(layer.pointerEvents).toBe("none");
      // Sin capa oscura: el <main> solo lleva el fondo del skin (sin gradiente ni imagen).
      expect(layer.mainImage).not.toContain("rgba(0, 0, 0, 0.6)");
      expect(layer.mainImage).not.toContain(BLACK_PHOTO);
      expect(layer.titleShadow).toBe("none");
      // Tarjeta al 85 % del color del skin.
      expect(layer.cardBg, `${skin.key} ${layer.skinCard}`).toMatch(/^(color\(srgb [\d. ]+\/ 0\.85\)|rgba\(\d+, \d+, \d+, 0\.85\))$/);
      expect(layer.noScroll, "sin scroll horizontal").toBe(true);
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `fondo-${skin.key}-375-${scheme}.png`), fullPage: true });
      await page.context().close();
    }
  }
  const out = execFileSync("node", ["--no-warnings", "scripts/verify-tal70-faint-background-contrast.mjs"], { encoding: "utf8", env: process.env });
  console.log(out);
  expect(out).toContain("OK — los 40 pares de textos reales cumplen");
});

test("5b · sin imagen de fondo: tarjeta opaca como antes y sin capa", async ({ browser }) => {
  const calendarId = await createCalendar("sinfondo");
  const page = await guestPage(browser);
  await page.goto(`/c/${calendarId}`);
  await expect(page.locator(".faint-bg-layer")).toHaveCount(0);
  const cardBg = await page.locator(".skin-month-card").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(cardBg).toMatch(/^rgb\(/);
  await page.context().close();
});

test("6 · autorización: sin secreto, secreto incorrecto, sin acceso o calendario ajeno → rechazo y 0 filas", async ({ browser }) => {
  const calendarId = await createCalendar("auth", { coverImageUrl: WHITE_PHOTO });
  const other = await createCalendar("ajeno", { coverImageUrl: WHITE_PHOTO });
  const outsider = await seedUser({ email: OUT_EMAIL });
  const date = todayIn(TZ_A);
  await expect(convex.mutation(api.welcomeViews.markSeenPublic, { serverSecret: "", userId: gId, calendarId, date })).rejects.toThrow();
  await expect(convex.mutation(api.welcomeViews.markSeenPublic, { serverSecret: "incorrecto", userId: gId, calendarId, date })).rejects.toThrow();
  await expect(convex.query(api.welcomeViews.hasSeenTodayPublic, { serverSecret: "incorrecto", userId: gId, calendarId, date })).rejects.toThrow();
  expect(await convex.mutation(api.welcomeViews.markSeenPublic, { serverSecret: serverSecret(), userId: outsider, calendarId, date })).toEqual({ ok: false, error: "not-authorized" });
  // Fecha mal formada: nunca se guarda.
  expect(await convex.mutation(api.welcomeViews.markSeenPublic, { serverSecret: serverSecret(), userId: gId, calendarId, date: "02/10/2026" })).toEqual({ ok: false, error: "bad-date" });
  // Persona de otro calendario: sin membership en `other` tras quitarla.
  await convex.mutation(api.guests.removeGuestFromCalendarPublic, { serverSecret: serverSecret(), calendarId: other, email: G_EMAIL });
  expect(await convex.mutation(api.welcomeViews.markSeenPublic, { serverSecret: serverSecret(), userId: gId, calendarId: other, date })).toEqual({ ok: false, error: "not-authorized" });
  expect(countRows([calendarId, other])).toBe(0);

  // Por la UI: quien no tiene acceso no llega a la bienvenida (ni se marca nada).
  const context = await newContext(browser, TZ_A);
  const page = await context.newPage();
  await login(page, OUT_EMAIL);
  await page.goto(`/c/${calendarId}`);
  await expect(page).toHaveURL(/\/unauthorized/);
  await context.close();
  expect(countRows([calendarId, other])).toBe(0);
});

test("7 · concurrencia: 5 marcas simultáneas, N=10 → exactamente 1 fila cada vez", async () => {
  const calendarId = await createCalendar("concurrencia");
  for (let round = 0; round < 10; round++) {
    const date = `2026-11-${String(round + 1).padStart(2, "0")}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => freshClient().mutation(api.welcomeViews.markSeenPublic, { serverSecret: serverSecret(), userId: gId, calendarId, date }))
    );
    expect(results.every((r) => r.ok), JSON.stringify(results)).toBe(true);
    expect(results.filter((r) => r.ok && r.inserted), `ronda ${round}`).toHaveLength(1);
  }
  expect(countRows([calendarId])).toBe(10);
});

for (const actor of ["invitado (GUEST)", "Super Admin sin membership"] as const) {
  test(`8 · carrera borrado vs. marca, N=10, marca un ${actor} → 0 filas en cualquier orden`, async () => {
    const ids: Id<"calendars">[] = [];
    const outcomes: string[] = [];
    const markerId = actor === "invitado (GUEST)" ? gId : sId;
    for (let round = 0; round < 10; round++) {
      const calendarId = await createCalendar(`carrera-${actor.slice(0, 5)}-${round}`);
      ids.push(calendarId);
      const date = todayIn(TZ_A);
      // Clientes distintos (concurrencia real) y orden de salida alterno.
      const del = () => freshClient().mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId, userId: aId });
      const mark = () => freshClient().mutation(api.welcomeViews.markSeenPublic, { serverSecret: serverSecret(), userId: markerId, calendarId, date });
      const [deleted, marked] = round % 2 === 0 ? await Promise.all([del(), mark()]) : await Promise.all([mark(), del()]).then(([m, d]) => [d, m] as const);
      expect(deleted).toBe("deleted");
      outcomes.push(marked.ok ? "marca-primero (fila borrada en cascada)" : marked.error);
      createdCalendarIds.delete(calendarId);
    }
    console.log(`8 · ${actor}: ${outcomes.join(", ")}`);
    expect(countRows(ids)).toBe(0);
    if (actor === "Super Admin sin membership") {
      // Marcar un calendario ya borrado → calendar-not-found, 0 filas.
      expect(await convex.mutation(api.welcomeViews.markSeenPublic, { serverSecret: serverSecret(), userId: sId, calendarId: ids[0], date: todayIn(TZ_A) })).toEqual({ ok: false, error: "calendar-not-found" });
      expect(countRows(ids)).toBe(0);
    }
  });
}
