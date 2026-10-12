import { deflateSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-71 — recorrido de punta a punta de la batería de regresión: lo único
 * que no cubren los tests etiquetados `@regresion` sueltos es que las piezas
 * encajen ENTRE SÍ y entre roles. Super Admin crea A desde la UI → invita a
 * Ad como Administrador → Ad guarda un vídeo, sube una imagen e invita a V
 * como Visitante → V entra por el link (login genérico), ve la bienvenida,
 * el vídeo (iframe, `src` determinista: no depende de que cargue YouTube) y
 * la imagen en «Visto» → salta de A a B desde el menú → Ad cambia a modo
 * Usuario y ve A y B como Admin. Datos `e2e-tal71-*` propios; fechas
 * relativas a hoy (sin bomba de fecha) y zona horaria UTC fija.
 */
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const S_EMAIL = `e2e-tal71-super-${runId}@example.com`;
const AD_EMAIL = `e2e-tal71-admin-${runId}@example.com`;
const V_EMAIL = `e2e-tal71-visitor-${runId}@example.com`;
const NAME_A = `TAL-71 A ${runId}`;
const NAME_B = `TAL-71 B ${runId}`;
const PHOTO = "https://tal71-e2e.example.com/portada.png";
const YOUTUBE_ID = "dQw4w9WgXcQ";
const BASE = `http://localhost:${process.env.E2E_PORT ?? 3000}`;

const DAY_MS = 86_400_000;
const isoDay = (offset: number) => new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
const labelOf = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return `${d}/${m}/${y}`;
};
const START = isoDay(-5);
const END = isoDay(30);
const VIDEO_DAY = isoDay(-2);

/** PNG 8x8 gris válido (portada y foto del día). */
function grayPng(): Buffer {
  const size = 8;
  const raw = Buffer.alloc((size * 3 + 1) * size, 128);
  for (let y = 0; y < size; y++) raw[y * (size * 3 + 1)] = 0;
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8);
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
const PNG = grayPng();

let sId: Id<"users">;
const createdCalendarIds = new Set<Id<"calendars">>();

async function newContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({ timezoneId: "UTC" });
  await context.addCookies([{ name: "tz", value: "UTC", url: BASE }]);
  await context.route("https://tal71-e2e.example.com/**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  return context;
}

async function devLogin(page: Page, email: string, name: string, callbackUrl?: string) {
  await page.goto(callbackUrl ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/login");
  const devForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Entrar (dev)" }) });
  await devForm.locator('input[name="email"]').fill(email);
  await devForm.locator('input[name="name"]').fill(name);
  await devForm.getByRole("button", { name: "Entrar (dev)" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

const accountMenu = (page: Page) => page.getByRole("menu", { name: "Menú de la cuenta" });
async function openMenu(page: Page) {
  await page.getByRole("button", { name: "Menú de la cuenta" }).click();
  await expect(accountMenu(page)).toBeVisible();
}

async function inviteFromUi(page: Page, email: string, role: "Visitante" | "Administrador") {
  const form = page.locator("form.people-invite");
  await form.locator('input[name="email"]').fill(email);
  await form.getByRole("radio", { name: role }).check();
  await form.getByRole("button", { name: "Invitar ahora" }).click();
  await expect(page.locator(`li.people-row[data-email="${email}"]`)).toBeVisible();
}

/** Fechas relativas a hoy, título de portada y foto de portada (el formulario de creación solo pide el nombre). */
async function setDatesAndPhoto(calendarId: Id<"calendars">) {
  const current = (await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId }))!;
  await convex.mutation(api.calendars.updateCalendarPublic, {
    serverSecret: serverSecret(),
    calendarId,
    name: current.name,
    // Título de portada = nombre: es lo que muestran la portada, la bienvenida y el menú.
    coverTitle: current.name,
    coverIcon: current.coverIcon,
    coverImageUrl: PHOTO,
    countdownLabel: current.countdownLabel,
    startDate: START,
    endDate: END,
    skinId: current.skinId,
  });
}

test.beforeAll(async () => {
  sId = await seedUser({ email: S_EMAIL, superAdmin: true });
});

test.afterAll(async () => {
  const failures: string[] = [];
  for (const id of createdCalendarIds) {
    try {
      await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId: id, userId: sId });
    } catch (err) {
      failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  expect(failures, "calendarios de prueba sin limpiar").toEqual([]);
  const orphans = execFileSync("npx", ["convex", "run", "welcomeViews:countForCalendars", JSON.stringify({ calendarIds: [...createdCalendarIds] })], { encoding: "utf8" });
  expect(Number(orphans.trim()), "welcomeViews huérfanas").toBe(0);
});

test(
  "recorrido de punta a punta entre roles: crear, invitar con rol, vídeo, imagen, bienvenida, saltar de calendario y cambiar de modo",
  { tag: "@regresion" },
  async ({ browser }) => {
    test.skip(process.env.TAL71_FORCE_SKIP === "1", "Control negativo del lanzador: un omitido debe hacer fallar la batería.");

    // 1 · Super Admin: crea A desde la UI e invita a Ad como Administrador.
    const superPage = await (await newContext(browser)).newPage();
    await devLogin(superPage, S_EMAIL, "Sara Super");
    await superPage.goto("/admin");
    await superPage.getByPlaceholder("Nombre del calendario").fill(NAME_A);
    await superPage.getByRole("button", { name: "+ Nuevo calendario" }).click();
    await superPage.waitForURL(/\/admin\/[^/?#]+$/);
    const calA = new URL(superPage.url()).pathname.split("/").pop() as Id<"calendars">;
    createdCalendarIds.add(calA);
    await setDatesAndPhoto(calA);
    await superPage.reload();
    await inviteFromUi(superPage, AD_EMAIL, "Administrador");

    // 2 · B: segundo calendario (para el salto), con Ad de Admin y V invitado.
    const calB = await convex.mutation(api.calendars.createCalendarPublic, {
      serverSecret: serverSecret(),
      userId: sId,
      name: NAME_B,
      coverTitle: NAME_B,
      startDate: START,
      endDate: END,
      creationKey: `e2e-tal71-b-${runId}`,
    });
    createdCalendarIds.add(calB);
    await convex.mutation(api.superadmin.addAdminPublic, { serverSecret: serverSecret(), actorUserId: sId, calendarId: calB, email: AD_EMAIL });
    await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId: calB, email: V_EMAIL });
    await superPage.context().close();

    // 3 · Ad: entra sin callbackUrl, ve A en «Mis calendarios» sin «+ Nuevo».
    const adPage = await (await newContext(browser)).newPage();
    await devLogin(adPage, AD_EMAIL, "Ada Admin");
    await expect(adPage).toHaveURL(/\/admin$/);
    await expect(adPage.getByRole("link", { name: new RegExp(NAME_A) }).first()).toBeVisible();
    await expect(adPage.getByRole("button", { name: "+ Nuevo calendario" })).toHaveCount(0);

    // 4 · Ad: guarda el vídeo del día, sube su imagen e invita a V como Visitante.
    await adPage.goto(`/admin/${calA}`);
    await adPage.locator(`button[aria-label^="${labelOf(VIDEO_DAY)} — "]`).first().click();
    let dialog = adPage.getByRole("dialog", { name: `Editar día — ${labelOf(VIDEO_DAY)}` });
    await dialog.locator('input[name="videoUrl"]').fill(`https://www.youtube.com/watch?v=${YOUTUBE_ID}`);
    await dialog.getByRole("button", { name: "Guardar día" }).click();
    await expect(dialog).toHaveCount(0);
    await adPage.locator(`button[aria-label^="${labelOf(VIDEO_DAY)} — "]`).first().click();
    dialog = adPage.getByRole("dialog", { name: `Editar día — ${labelOf(VIDEO_DAY)}` });
    await dialog.locator('input[name="image"]').setInputFiles({ name: "dia.png", mimeType: "image/png", buffer: PNG });
    await dialog.getByRole("button", { name: /Subir imagen|Sustituir imagen/ }).click();
    await expect(dialog.locator("img.day-image-preview")).toHaveAttribute("src", /\/api\/storage\//);
    const uploaded = (await convex.query(api.days.getCalendarDaysPublic, { serverSecret: serverSecret(), calendarId: calA })).days.find(
      (d) => d.date === VIDEO_DAY
    )!.uploadedImageUrl!;
    expect(uploaded).toMatch(/\/api\/storage\//);
    await adPage.keyboard.press("Escape");
    await inviteFromUi(adPage, V_EMAIL, "Visitante");

    // 5 · V: link de A → login genérico → bienvenida → vídeo → «Visto» con la imagen.
    const vPage = await (await newContext(browser)).newPage();
    await vPage.goto(`/c/${calA}`);
    await expect(vPage).toHaveURL(/\/login\?callbackUrl=/);
    await expect(vPage.getByRole("heading", { level: 1, name: "Calendario de Adviento" })).toBeVisible();
    await expect(vPage.locator("[data-cover-icon]")).toHaveCount(0);
    await devLogin(vPage, V_EMAIL, "Vera Visitante", `/c/${calA}`);
    await expect(vPage).toHaveURL(new RegExp(`/c/${calA}$`));
    const welcome = vPage.locator(".welcome-overlay");
    await expect(welcome).toHaveAttribute("data-welcome-phase", "shown");
    await expect(vPage.locator(".welcome-hello")).toHaveText("Hola, Vera");
    await vPage.getByRole("button", { name: "Abrir mi calendario" }).click();
    await expect(welcome).toHaveCount(0);

    await vPage.locator(`button[aria-label^="${labelOf(VIDEO_DAY)}"]`).first().click();
    const videoDialog = vPage.getByRole("dialog").filter({ has: vPage.locator("iframe") });
    await expect(videoDialog.locator("iframe")).toHaveAttribute("src", `https://www.youtube.com/embed/${YOUTUBE_ID}`);
    await vPage.getByRole("button", { name: "Cerrar" }).click();
    await vPage.reload();
    await expect.poll(async () => (await vPage.locator(`button[aria-label^="${labelOf(VIDEO_DAY)}"]`).first().getAttribute("style")) ?? "").toContain(uploaded);

    // 6 · V salta de A a B desde el menú (origen y destino).
    await expect(vPage).toHaveURL(new RegExp(`/c/${calA}$`));
    await expect(vPage.getByRole("heading", { level: 1 })).toContainText(NAME_A);
    await openMenu(vPage);
    await expect(accountMenu(vPage).getByRole("menuitem", { name: NAME_A })).toHaveAttribute("aria-current", "page");
    await accountMenu(vPage).getByRole("menuitem", { name: NAME_B }).click();
    await vPage.waitForURL(new RegExp(`/c/${calB}$`));
    await expect(vPage.getByRole("heading", { level: 1 })).toContainText(NAME_B);
    await openMenu(vPage);
    await expect(accountMenu(vPage).getByRole("menuitem", { name: NAME_B })).toHaveAttribute("aria-current", "page");
    await expect(accountMenu(vPage).getByRole("menuitem", { name: NAME_A })).not.toHaveAttribute("aria-current", /.*/);
    await vPage.context().close();

    // 7 · Ad cambia a modo Usuario: /c con A y B, ambos con la etiqueta Admin.
    await openMenu(adPage);
    await accountMenu(adPage).getByRole("menuitemradio", { name: "Usuario" }).click();
    await adPage.waitForURL(/\/c$/);
    for (const name of [NAME_A, NAME_B]) {
      await expect(adPage.locator(".calendar-card", { hasText: name }).locator(".calendar-card-tag")).toHaveText("Admin");
    }
    await adPage.context().close();
  }
);
