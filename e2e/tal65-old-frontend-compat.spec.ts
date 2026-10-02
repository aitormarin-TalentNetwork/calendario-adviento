import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { loginAs, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-65 — compatibilidad del despliegue: el build de Railway despliega
 * Convex ANTES de construir el Next nuevo, así que durante la ventana sirve
 * el Next ANTIGUO contra el Convex NUEVO (docs/invitados.md § "Despliegue").
 *
 * Solo corre con `OLD_FRONTEND=1` y contra un `next dev` del commit anterior
 * a TAL-65 ya levantado en `E2E_PORT` (worktree temporal, ver el export de
 * TAL-65). El primer test comprueba que de verdad responde el editor
 * antiguo (sección "Invitados", no "Personas del calendario"): si
 * Playwright hubiera arrancado el Next nuevo por error, falla.
 */
test.skip(process.env.OLD_FRONTEND !== "1", "Solo con OLD_FRONTEND=1 contra el Next anterior a TAL-65");
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const email = (role: string) => `e2e-tal65compat-${role}-${runId}@example.com`;
const S_EMAIL = email("super");
const PENDING_ADMIN = email("pending-admin");
const PENDING_GUEST = email("pending-guest");
const LAST_EMAIL = email("last-admin");
const EVIDENCE_DIR = path.resolve(__dirname, "..", "docs", "evidence", "tal65");

let sId: Id<"users">;
let calendarId: Id<"calendars">;
let lastCalendarId: Id<"calendars">;
const createdCalendarIds = new Set<Id<"calendars">>();

async function createCalendar(name: string): Promise<Id<"calendars">> {
  const id = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: sId,
    name,
    coverTitle: name,
    startDate: "2026-09-01",
    endDate: "2026-12-24",
    creationKey: `e2e-tal65compat-${name}`,
  });
  createdCalendarIds.add(id);
  return id;
}

async function personOf(id: Id<"calendars">, personEmail: string) {
  const rows = await convex.query(api.calendarPeople.listCalendarPeoplePublic, {
    serverSecret: serverSecret(),
    actorUserId: sId,
    calendarId: id,
  });
  return rows.find((p) => p.email === personEmail) ?? null;
}

async function newPage(browser: Browser): Promise<Page> {
  return await (await browser.newContext()).newPage();
}

test.beforeAll(async () => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  sId = await seedUser({ email: S_EMAIL, superAdmin: true });
  calendarId = await createCalendar(`TAL-65 compat ${runId}`);
  // Invitación pendiente como ADMIN (solo la puede crear el Convex nuevo) y
  // una de Visitante por la función antigua.
  expect(
    await convex.mutation(api.calendarPeople.inviteToCalendarPublic, {
      serverSecret: serverSecret(),
      actorUserId: sId,
      calendarId,
      email: PENDING_ADMIN,
      role: "ADMIN",
    })
  ).toEqual({ ok: true });
  await convex.mutation(api.invitations.inviteGuestPublic, {
    serverSecret: serverSecret(),
    calendarId,
    email: PENDING_GUEST,
  });
});

test.afterAll(async () => {
  for (const id of createdCalendarIds) {
    await convex.mutation(api.calendars.deleteCalendarAsUserPublic, {
      serverSecret: serverSecret(),
      calendarId: id,
      userId: sId,
    });
  }
});

test("1 · editor antiguo: la invitación ADMIN no se pinta como invitado; la de Visitante sí y se puede quitar", async ({
  browser,
}) => {
  const page = await newPage(browser);
  await loginAs(page, S_EMAIL);
  await page.goto(`/admin/${calendarId}`);
  // Prueba de que responde el frontend ANTIGUO.
  await expect(page.getByRole("heading", { name: "Invitados", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Personas del calendario" })).toHaveCount(0);

  await expect(page.locator("tr", { hasText: PENDING_GUEST })).toBeVisible();
  await expect(page.locator("tr", { hasText: PENDING_ADMIN })).toHaveCount(0);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "compat-1-editor-antiguo.png"), fullPage: true });

  await page.locator("tr", { hasText: PENDING_GUEST }).getByRole("button", { name: "Quitar del calendario" }).click();
  await expect(page.locator("tr", { hasText: PENDING_GUEST })).toHaveCount(0);
  await page.context().close();

  expect(await personOf(calendarId, PENDING_GUEST)).toBeNull();
  expect(await personOf(calendarId, PENDING_ADMIN)).toMatchObject({ role: "ADMIN", pending: true });
});

test("2 · funciones antiguas no tocan la invitación ADMIN (quitar y re-invitar)", async () => {
  await convex.mutation(api.guests.removeGuestFromCalendarPublic, {
    serverSecret: serverSecret(),
    calendarId,
    email: PENDING_ADMIN,
  });
  await convex.mutation(api.invitations.inviteGuestPublic, {
    serverSecret: serverSecret(),
    calendarId,
    email: PENDING_ADMIN,
  });
  expect(await personOf(calendarId, PENDING_ADMIN)).toMatchObject({ role: "ADMIN", pending: true });
});

test("3 · el invitado como Admin entra por el link con el frontend antiguo y queda ADMIN", async ({ browser }) => {
  await seedUser({ email: PENDING_ADMIN });
  const page = await newPage(browser);
  await page.goto(`/c/${calendarId}`);
  const devForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Entrar (dev)" }) });
  await devForm.locator('input[name="email"]').fill(PENDING_ADMIN);
  await devForm.getByRole("button", { name: "Entrar (dev)" }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${calendarId}$`));
  await page.goto(`/admin/${calendarId}`);
  await expect(page.getByRole("heading", { name: "Editar calendario" })).toBeVisible();
  await page.context().close();
  expect(await personOf(calendarId, PENDING_ADMIN)).toMatchObject({ role: "ADMIN", pending: false });
});

test("4 · «Quitar» antiguo de /superadmin sobre el último Admin: no cambia nada", async ({ browser }) => {
  lastCalendarId = await createCalendar(`TAL-65 compat último ${runId}`);
  expect(
    await convex.mutation(api.superadmin.addAdminPublic, {
      serverSecret: serverSecret(),
      actorUserId: sId,
      calendarId: lastCalendarId,
      email: LAST_EMAIL,
    })
  ).toEqual({ ok: true });
  expect(
    await convex.mutation(api.calendarPeople.removePersonFromCalendarPublic, {
      serverSecret: serverSecret(),
      actorUserId: sId,
      calendarId: lastCalendarId,
      email: S_EMAIL,
    })
  ).toEqual({ ok: true });

  const page = await newPage(browser);
  await loginAs(page, S_EMAIL);
  await page.goto("/superadmin");
  await page.locator("tr", { hasText: LAST_EMAIL }).getByRole("button", { name: "Quitar" }).click();
  await expect(page).toHaveURL(/\/superadmin$/);
  await expect(page.locator("tr", { hasText: LAST_EMAIL })).toBeVisible();
  await page.context().close();
  expect(await personOf(lastCalendarId, LAST_EMAIL)).toMatchObject({ role: "ADMIN", pending: false });
});
