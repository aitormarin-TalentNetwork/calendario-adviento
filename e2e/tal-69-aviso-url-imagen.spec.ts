import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { STUB_IMAGE_URL, STUB_PAGE_URL } from "../src/lib/image-checker";
import { IMAGE_URL_WARNING } from "../src/lib/image-url-warning";
import { loginAs, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-69 — aviso en el editor cuando la URL de "Foto de portada" o "Imagen
 * de fondo" es una página web. SIN RED: el `webServer` de Playwright define
 * `E2E_IMAGE_CHECK_STUB=1` y el comprobador es el stub determinista
 * (src/lib/image-checker.ts). Un calendario por caso (el enfriamiento por
 * calendario es de 10 s).
 */
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const ADMIN_EMAIL = `e2e-tal69-admin-${runId}@example.com`;
const EVIDENCE_DIR = path.resolve(__dirname, "..", "docs", "evidence", "tal69");
let adminId: Id<"users">;
const created: Id<"calendars">[] = [];

async function newCalendar(tag: string): Promise<Id<"calendars">> {
  const id = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: adminId,
    name: `TAL-69 ${tag} ${runId}`,
    coverTitle: `TAL-69 ${tag}`,
    startDate: "2026-12-01",
    endDate: "2026-12-24",
    creationKey: `tal69-${tag}-${runId}`,
  });
  created.push(id);
  return id;
}

const COVER = "#calendar-coverImageUrl";
const BACKGROUND = "#calendar-backgroundImageUrl";
// El error del formulario es su <p role="alert">; Next tiene además un
// anunciador de rutas con role="alert" fuera del formulario.
const formError = (page: Page) => page.locator("form", { has: page.locator(COVER) }).getByRole("alert");
const field = (page: Page, input: string) => page.locator(".editor-field", { has: page.locator(input) });

async function saveWith(page: Page, calendarId: string, values: { cover?: string; background?: string }) {
  await page.goto(`/admin/${calendarId}`);
  if (values.cover !== undefined) await page.locator(COVER).fill(values.cover);
  if (values.background !== undefined) await page.locator(BACKGROUND).fill(values.background);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
}

async function stored(calendarId: Id<"calendars">) {
  const calendar = await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId });
  return { cover: calendar?.coverImageUrl, background: calendar?.backgroundImageUrl };
}

test.beforeAll(async () => {
  adminId = await seedUser({ email: ADMIN_EMAIL, superAdmin: true });
});

test.afterAll(async () => {
  for (const calendarId of created) {
    await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId, userId: adminId });
  }
});

test("0 · el stub está activo (si no, el servidor reutilizado no tiene E2E_IMAGE_CHECK_STUB=1)", async ({ page }) => {
  const id = await newCalendar("sonda");
  await loginAs(page, ADMIN_EMAIL);
  await saveWith(page, id, { cover: "https://tal69.invalid/stub-page" });
  await expect(field(page, COVER).getByRole("status"), "levanta el dev server desde Playwright (con la variable del webServer)").toHaveText(IMAGE_URL_WARNING);
});

test("1 · la URL de fcbarcelona.com (página) avisa; la .jpg directa no; las dos se guardan", async ({ page }) => {
  const id = await newCalendar("fcb");
  await loginAs(page, ADMIN_EMAIL);
  await saveWith(page, id, { cover: STUB_PAGE_URL, background: STUB_IMAGE_URL });
  const warning = field(page, COVER).getByRole("status");
  await expect(warning).toHaveText(IMAGE_URL_WARNING);
  await expect(warning).toHaveClass("day-video-warning");
  // El aviso de la portada demuestra que la comprobación ya terminó: el fondo (imagen) no avisa.
  await expect(field(page, BACKGROUND).getByRole("status")).toHaveCount(0);
  await expect(formError(page)).toHaveCount(0);
  expect(await stored(id)).toEqual({ cover: STUB_PAGE_URL, background: STUB_IMAGE_URL });
});

test("2 · la página en «Imagen de fondo» avisa en ese campo; editar el campo oculta el aviso", async ({ page }) => {
  const id = await newCalendar("fondo");
  await loginAs(page, ADMIN_EMAIL);
  await saveWith(page, id, { background: STUB_PAGE_URL });
  await expect(field(page, BACKGROUND).getByRole("status")).toHaveText(IMAGE_URL_WARNING);
  await expect(field(page, COVER).getByRole("status")).toHaveCount(0);
  await page.locator(BACKGROUND).fill(STUB_IMAGE_URL);
  await expect(field(page, BACKGROUND).getByRole("status")).toHaveCount(0);
});

test("3 · comprobación lenta: el guardado no la espera, persiste y no hay aviso ni error (plazo de 3 s)", async ({ page }) => {
  const id = await newCalendar("lenta");
  await loginAs(page, ADMIN_EMAIL);
  const slow = "https://tal69.invalid/stub-slow.jpg";
  const started = Date.now();
  await saveWith(page, id, { cover: slow });
  await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeEnabled({ timeout: 2_000 });
  expect(Date.now() - started).toBeLessThan(2_000 + 1_500); // goto + rellenar + guardar, sin esperar a los 10 s del stub
  expect((await stored(id)).cover).toBe(slow);
  await page.waitForTimeout(4_000); // pasado el plazo de 3 s de la acción
  await expect(field(page, COVER).getByRole("status")).toHaveCount(0);
  await expect(formError(page)).toHaveCount(0);
});

test("4 · el comprobador lanza: guardado, sin aviso y sin error de formulario", async ({ page }) => {
  const id = await newCalendar("lanza");
  await loginAs(page, ADMIN_EMAIL);
  const throwing = "https://tal69.invalid/stub-throw.jpg";
  await saveWith(page, id, { cover: throwing });
  await expect(page.getByRole("button", { name: "Guardar cambios" })).toBeEnabled();
  expect((await stored(id)).cover).toBe(throwing);
  await page.waitForTimeout(1_500);
  await expect(field(page, COVER).getByRole("status")).toHaveCount(0);
  await expect(formError(page)).toHaveCount(0);
});

test("5 · capturas a 375 px (claro y oscuro) con el aviso, sin scroll horizontal", async ({ browser }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    const id = await newCalendar(`captura-${colorScheme}`);
    const page = await (await browser.newContext({ colorScheme, viewport: { width: 375, height: 900 } })).newPage();
    await loginAs(page, ADMIN_EMAIL);
    await saveWith(page, id, { cover: STUB_PAGE_URL });
    const warning = field(page, COVER).getByRole("status");
    await expect(warning).toHaveText(IMAGE_URL_WARNING);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    await field(page, COVER).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `aviso-portada-${colorScheme}-375.png`) });
    await page.context().close();
  }
});
