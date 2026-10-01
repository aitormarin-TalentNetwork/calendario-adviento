import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { loginAs, loginAsWithoutCallback, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-58 — modo Usuario "Tus calendarios" (`/c`) + los invitados puros
 * nunca aterrizan en `/admin`. Criterios de aceptación del issue + caso
 * del Super Admin sin memberships (sugerencia de auditoría del plan).
 *
 * Sembrado (tras TAL-57, `createCalendarPublic` solo lo admite para el
 * Super Admin y lo hace Admin a él mismo): un actor Super Admin propio de
 * esta spec crea los calendarios; el Admin no Super Admin se nombra con
 * `superadmin.addAdminPublic`; los invitados son invitaciones pendientes
 * (`invitations.inviteGuestPublic`). Emails únicos por ejecución.
 */
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const email = (role: string) => `e2e-tal58-${role}-${runId}@example.com`;
const ACTOR_EMAIL = email("actor");
const ADMIN_EMAIL = email("admin");
const GUEST_ONE_EMAIL = email("guest-one");
const GUEST_MANY_EMAIL = email("guest-many");
const GUEST_LINK_EMAIL = email("guest-link");
const NOBODY_EMAIL = email("nobody");
const SUPER_EMPTY_EMAIL = email("superadmin-empty");
const EVIDENCE_DIR = path.resolve(__dirname, "..", "docs", "evidence", "tal58");

const TITLE_A = `TAL-58 A ${runId}`;
const TITLE_B = `TAL-58 B ${runId}`;

let actorId: Id<"users">;
let calendarA: Id<"calendars">;
let calendarB: Id<"calendars">;
const createdCalendarIds = new Set<Id<"calendars">>();

async function createCalendar(coverTitle: string, startDate: string, endDate: string): Promise<Id<"calendars">> {
  const id = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: actorId,
    name: `${coverTitle} (interno)`,
    coverTitle,
    startDate,
    endDate,
    creationKey: `e2e-tal58-${coverTitle}`,
  });
  createdCalendarIds.add(id);
  return id;
}

async function invite(calendarId: Id<"calendars">, guestEmail: string): Promise<void> {
  await convex.mutation(api.invitations.inviteGuestPublic, {
    serverSecret: serverSecret(),
    calendarId,
    email: guestEmail,
  });
}

async function newPage(browser: Browser, viewport?: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext(viewport ? { viewport } : {});
  return await context.newPage();
}

test.beforeAll(async () => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  actorId = await seedUser({ email: ACTOR_EMAIL, superAdmin: true });
  await seedUser({ email: SUPER_EMPTY_EMAIL, superAdmin: true });

  calendarA = await createCalendar(TITLE_A, "2026-12-01", "2026-12-24");
  calendarB = await createCalendar(TITLE_B, "2026-12-28", "2027-01-06");

  const added = await convex.mutation(api.superadmin.addAdminPublic, {
    serverSecret: serverSecret(),
    actorUserId: actorId,
    calendarId: calendarA,
    email: ADMIN_EMAIL,
  });
  expect(added).toMatchObject({ ok: true });
  await invite(calendarB, ADMIN_EMAIL);

  await invite(calendarA, GUEST_ONE_EMAIL);
  await invite(calendarA, GUEST_MANY_EMAIL);
  await invite(calendarB, GUEST_MANY_EMAIL);
  await invite(calendarA, GUEST_LINK_EMAIL);
});

test.afterAll(async () => {
  // Mismo patrón que TAL-57: borrar cada calendario sembrado por separado.
  // Los usuarios se quedan (no hay mutation pública para borrarlos).
  const failures: string[] = [];
  for (const id of createdCalendarIds) {
    try {
      await convex.mutation(api.calendars.deleteCalendarAsUserPublic, {
        serverSecret: serverSecret(),
        calendarId: id,
        userId: actorId,
      });
    } catch (err) {
      failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  expect(failures, "calendarios de prueba sin limpiar").toEqual([]);
});

test("1 · invitado con un calendario: tras login sin callbackUrl va directo a su calendario", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAsWithoutCallback(page, GUEST_ONE_EMAIL);
  await expect(page).toHaveURL(new RegExp(`/c/${calendarA}$`));
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "1-guest-one-direct.png") });
  await page.context().close();
});

test("2 · invitado con varios: ve la lista y puede abrir cada uno", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAsWithoutCallback(page, GUEST_MANY_EMAIL);
  await expect(page).toHaveURL(/\/c$/);
  await expect(page.getByRole("heading", { name: "Tus calendarios" })).toBeVisible();
  await expect(page.getByText("Elige cuál quieres abrir.")).toBeVisible();

  const cards = page.locator(".calendar-card");
  await expect(cards).toHaveCount(2);
  const cardA = cards.filter({ hasText: TITLE_A });
  const cardB = cards.filter({ hasText: TITLE_B });
  await expect(cardA).toContainText("1 dic – 24 dic 2026");
  await expect(cardB).toContainText("28 dic 2026 – 6 ene 2027");
  await expect(page.locator(".calendar-card-tag")).toHaveCount(0);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "2-guest-many-desktop.png"), fullPage: true });

  await cardA.click();
  await expect(page).toHaveURL(new RegExp(`/c/${calendarA}$`));
  await page.goto("/c");
  await page.locator(".calendar-card", { hasText: TITLE_B }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${calendarB}$`));
  await page.context().close();
});

test("3 · Admin en modo Usuario: ve invitados + administrados, con etiqueta Admin", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAs(page, ADMIN_EMAIL);
  await page.goto("/c");
  await expect(page).toHaveURL(/\/c$/);

  const cards = page.locator(".calendar-card");
  await expect(cards).toHaveCount(2);
  const administered = cards.filter({ hasText: TITLE_A });
  const invited = cards.filter({ hasText: TITLE_B });
  await expect(administered.locator(".calendar-card-tag")).toHaveText("Admin");
  await expect(administered).toContainText("Lo administras tú");
  await expect(invited.locator(".calendar-card-tag")).toHaveCount(0);
  await expect(invited).toContainText("28 dic 2026 – 6 ene 2027");
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "3-admin-user-mode.png"), fullPage: true });
  await page.context().close();
});

test("3b · membership ADMIN + invitación pendiente al MISMO calendario → una sola tarjeta, como Admin", async ({
  browser,
}) => {
  // El Admin ya es ADMIN de A (addAdminPublic en beforeAll); además se le
  // invita a A como invitado. `listUserModeCalendarsHandler` debe deduplicar
  // por calendarId y dejar ganar a ADMIN — sin tarjeta repetida.
  await invite(calendarA, ADMIN_EMAIL);

  const adminId = await seedUser({ email: ADMIN_EMAIL });
  const rows = await convex.query(api.calendars.listUserModeCalendarsPublic, {
    serverSecret: serverSecret(),
    userId: adminId,
  });
  const rowsA = rows.filter((row) => row.id === calendarA);
  expect(rowsA).toHaveLength(1);
  expect(rowsA[0].isAdmin).toBe(true);
  expect(rows).toHaveLength(2);

  const page = await newPage(browser);
  await loginAs(page, ADMIN_EMAIL);
  await page.goto("/c");
  const cards = page.locator(".calendar-card");
  await expect(cards).toHaveCount(2);
  const cardsA = cards.filter({ hasText: TITLE_A });
  await expect(cardsA).toHaveCount(1);
  await expect(cardsA.locator(".calendar-card-tag")).toHaveText("Admin");
  await expect(cardsA).toContainText("Lo administras tú");
  await page.context().close();
});

test("4 · invitado puro que visita /admin acaba en modo Usuario, sin nada de administración", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAs(page, GUEST_MANY_EMAIL);
  const response = await page.goto("/admin");
  expect(response?.ok()).toBe(true);
  await expect(page).toHaveURL(/\/c$/);
  await expect(page.getByText("Mis calendarios")).toHaveCount(0);
  await expect(page.getByText("+ Nuevo calendario")).toHaveCount(0);
  await page.context().close();
});

test("5 · el link de invitación (/c/<id> con callbackUrl) sigue funcionando igual", async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto(`/c/${calendarA}`);
  await expect(page).toHaveURL(new RegExp(`/login\\?callbackUrl=${encodeURIComponent(`/c/${calendarA}`)}$`));
  const devForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Entrar (dev)" }) });
  await devForm.locator('input[name="email"]').fill(GUEST_LINK_EMAIL);
  await devForm.getByRole("button", { name: "Entrar (dev)" }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${calendarA}$`));
  await page.context().close();
});

test("6 · sin ningún calendario: /c muestra un mensaje claro", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAsWithoutCallback(page, NOBODY_EMAIL);
  await expect(page).toHaveURL(/\/c$/);
  await expect(
    page.getByText("Todavía no tienes ningún calendario. Cuando alguien te invite, aparecerá aquí.")
  ).toBeVisible();
  await expect(page.locator(".calendar-card")).toHaveCount(0);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "6-empty.png") });
  await page.context().close();
});

test("7 · Admin no Super Admin sigue aterrizando en /admin tras login sin callbackUrl", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAsWithoutCallback(page, ADMIN_EMAIL);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Mis calendarios" })).toBeVisible();
  await page.context().close();
});

test("8 · Super Admin sin memberships: se queda en /admin y /c muestra el estado vacío", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAsWithoutCallback(page, SUPER_EMPTY_EMAIL);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Mis calendarios" })).toBeVisible();
  await page.goto("/c");
  await expect(page).toHaveURL(/\/c$/);
  await expect(
    page.getByText("Todavía no tienes ningún calendario. Cuando alguien te invite, aparecerá aquí.")
  ).toBeVisible();
  await page.context().close();
});

test("9 · responsive a 375px: lista sin scroll horizontal", async ({ browser }) => {
  const page = await newPage(browser, { width: 375, height: 812 });
  await loginAs(page, GUEST_MANY_EMAIL);
  await page.goto("/c");
  await expect(page.locator(".calendar-card")).toHaveCount(2);
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  // Una sola columna: las dos tarjetas apiladas, misma x.
  const boxes = await page.locator(".calendar-card").evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect()).map((r) => ({ x: Math.round(r.x), right: Math.round(r.right) }))
  );
  expect(boxes[0].x).toBe(boxes[1].x);
  for (const box of boxes) expect(box.right).toBeLessThanOrEqual(clientWidth);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "9-guest-many-375.png"), fullPage: true });
  await page.context().close();
});
