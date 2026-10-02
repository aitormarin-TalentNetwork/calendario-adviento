import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { loginAs, loginAsWithoutCallback, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-65 — invitar como Visitante o Administrador, cambiar roles, quitar y
 * último Admin protegido (UI y servidor, también en /superadmin), link
 * compartido sin rol propio y ~375px. Criterios del issue + carreras con
 * concurrencia real (plan aprobado, punto 6).
 *
 * Sembrado: un Super Admin propio (`S`) crea los calendarios (TAL-57) y
 * queda como su Admin; el resto de Admins se nombran con
 * `superadmin.addAdminPublic`. Emails únicos por ejecución.
 */
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const email = (role: string) => `e2e-tal65-${role}-${runId}@example.com`;
const S_EMAIL = email("super");
const A_EMAIL = email("admin-a");
const X_EMAIL = email("invited-admin");
const V_EMAIL = email("visitor");
const P_EMAIL = email("pending");
const U_EMAIL = email("uninvited");
const LEGACY_EMAIL = email("legacy");
const LAST_EMAIL = email("last-admin");
const SECOND_EMAIL = email("second-admin");
const OUTSIDER_EMAIL = email("outsider-admin");
const EVIDENCE_DIR = path.resolve(__dirname, "..", "docs", "evidence", "tal65");

const LINK_NOTE = "Cada persona entra con el rol con el que la invitaste (Visitante por defecto).";
const LAST_ADMIN_HINT = "Es el único Admin del calendario: nombra a otro antes de cambiar su rol o quitarlo.";

let sId: Id<"users">;
let mainCalendar: Id<"calendars">;
const MAIN_NAME = `TAL-65 principal ${runId}`;
const createdCalendarIds = new Set<Id<"calendars">>();

async function createCalendar(name: string): Promise<Id<"calendars">> {
  const id = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: sId,
    name,
    coverTitle: name,
    startDate: "2026-09-01",
    endDate: "2026-12-24",
    creationKey: `e2e-tal65-${name}`,
  });
  createdCalendarIds.add(id);
  return id;
}

async function addAdmin(calendarId: Id<"calendars">, adminEmail: string): Promise<void> {
  const result = await convex.mutation(api.superadmin.addAdminPublic, {
    serverSecret: serverSecret(),
    actorUserId: sId,
    calendarId,
    email: adminEmail,
  });
  expect(result).toMatchObject({ ok: true });
}

async function people(calendarId: Id<"calendars">) {
  return await convex.query(api.calendarPeople.listCalendarPeoplePublic, {
    serverSecret: serverSecret(),
    actorUserId: sId,
    calendarId,
  });
}

async function personOf(calendarId: Id<"calendars">, personEmail: string) {
  return (await people(calendarId)).find((p) => p.email === personEmail) ?? null;
}

async function effectiveAdminCount(calendarId: Id<"calendars">): Promise<number> {
  return (await people(calendarId)).filter((p) => p.role === "ADMIN" && !p.pending).length;
}

function setRole(actorUserId: Id<"users">, calendarId: Id<"calendars">, personEmail: string, role: "ADMIN" | "GUEST") {
  return convex.mutation(api.calendarPeople.setPersonRolePublic, {
    serverSecret: serverSecret(),
    actorUserId,
    calendarId,
    email: personEmail,
    role,
  });
}

function removePerson(actorUserId: Id<"users">, calendarId: Id<"calendars">, personEmail: string) {
  return convex.mutation(api.calendarPeople.removePersonFromCalendarPublic, {
    serverSecret: serverSecret(),
    actorUserId,
    calendarId,
    email: personEmail,
  });
}

async function newPage(browser: Browser, viewport?: { width: number; height: number }): Promise<Page> {
  const context = await browser.newContext(viewport ? { viewport } : {});
  return await context.newPage();
}

function row(page: Page, personEmail: string) {
  return page.locator(`li.people-row[data-email="${personEmail}"]`);
}

async function inviteFromUi(page: Page, personEmail: string, role: "Visitante" | "Administrador" | null) {
  const form = page.locator("form.people-invite");
  await form.locator('input[name="email"]').fill(personEmail);
  if (role) await form.getByRole("radio", { name: role }).check();
  await form.getByRole("button", { name: "Invitar ahora" }).click();
  await expect(row(page, personEmail)).toBeVisible();
}

test.beforeAll(async () => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  sId = await seedUser({ email: S_EMAIL, superAdmin: true });
  await seedUser({ email: A_EMAIL });
  mainCalendar = await createCalendar(MAIN_NAME);
  await addAdmin(mainCalendar, A_EMAIL);
});

test.afterAll(async () => {
  const failures: string[] = [];
  for (const id of createdCalendarIds) {
    try {
      await convex.mutation(api.calendars.deleteCalendarAsUserPublic, {
        serverSecret: serverSecret(),
        calendarId: id,
        userId: sId,
      });
    } catch (err) {
      failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  expect(failures, "calendarios de prueba sin limpiar").toEqual([]);
});

test("1 · un Admin invita como Administrador → esa persona entra y lo ve en «Mis calendarios» con permisos de Admin", async ({
  browser,
}) => {
  const adminPage = await newPage(browser);
  await loginAs(adminPage, A_EMAIL);
  await adminPage.goto(`/admin/${mainCalendar}`);
  await expect(adminPage.getByRole("heading", { name: "Personas del calendario" })).toBeVisible();
  await inviteFromUi(adminPage, X_EMAIL, "Administrador");
  await expect(row(adminPage, X_EMAIL).locator("select")).toHaveValue("ADMIN");
  await expect(row(adminPage, X_EMAIL)).toContainText("· pendiente");
  await adminPage.screenshot({ path: path.join(EVIDENCE_DIR, "1-invitado-como-admin.png"), fullPage: true });
  await adminPage.context().close();

  expect(await personOf(mainCalendar, X_EMAIL)).toMatchObject({ role: "ADMIN", pending: true });

  const invitedPage = await newPage(browser);
  await loginAsWithoutCallback(invitedPage, X_EMAIL);
  await expect(invitedPage).toHaveURL(/\/admin$/);
  await expect(invitedPage.getByRole("heading", { name: "Mis calendarios" })).toBeVisible();
  await invitedPage.locator("table").getByRole("link", { name: MAIN_NAME }).click();
  await expect(invitedPage).toHaveURL(new RegExp(`/admin/${mainCalendar}$`));
  await expect(invitedPage.getByRole("heading", { name: "Editar calendario" })).toBeVisible();
  await invitedPage.screenshot({ path: path.join(EVIDENCE_DIR, "1-admin-invitado-en-editor.png"), fullPage: true });
  await invitedPage.context().close();

  expect(await personOf(mainCalendar, X_EMAIL)).toMatchObject({ role: "ADMIN", pending: false });
});

test("2 · invitar como Visitante (por defecto) → entra, pero no tiene acceso al editor", async ({ browser }) => {
  const adminPage = await newPage(browser);
  await loginAs(adminPage, A_EMAIL);
  await adminPage.goto(`/admin/${mainCalendar}`);
  await inviteFromUi(adminPage, V_EMAIL, null);
  await expect(row(adminPage, V_EMAIL).locator("select")).toHaveValue("GUEST");
  await adminPage.context().close();

  const visitorPage = await newPage(browser);
  await loginAsWithoutCallback(visitorPage, V_EMAIL);
  await expect(visitorPage).toHaveURL(new RegExp(`/c/${mainCalendar}$`));
  await visitorPage.goto(`/admin/${mainCalendar}`);
  await expect(visitorPage).toHaveURL(/\/unauthorized$/);
  await visitorPage.context().close();

  expect(await personOf(mainCalendar, V_EMAIL)).toMatchObject({ role: "GUEST", pending: false });
});

test("3 · cambiar rol desde la UI en los dos sentidos (ya entró y pendiente)", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAs(page, A_EMAIL);
  await page.goto(`/admin/${mainCalendar}`);

  await row(page, V_EMAIL).locator("select").selectOption("ADMIN");
  await expect.poll(async () => (await personOf(mainCalendar, V_EMAIL))?.role).toBe("ADMIN");
  await page.reload();
  await expect(row(page, V_EMAIL).locator("select")).toHaveValue("ADMIN");
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "3-visitante-a-admin.png"), fullPage: true });

  await row(page, V_EMAIL).locator("select").selectOption("GUEST");
  await expect.poll(async () => (await personOf(mainCalendar, V_EMAIL))?.role).toBe("GUEST");

  await inviteFromUi(page, P_EMAIL, null);
  await row(page, P_EMAIL).locator("select").selectOption("ADMIN");
  await expect.poll(async () => await personOf(mainCalendar, P_EMAIL)).toMatchObject({ role: "ADMIN", pending: true });
  await page.reload();
  await row(page, P_EMAIL).locator("select").selectOption("GUEST");
  await expect.poll(async () => await personOf(mainCalendar, P_EMAIL)).toMatchObject({ role: "GUEST", pending: true });
  await page.context().close();
});

test("4 · «Quitar» a un Visitante y a un Admin (no el último) → fuera de la lista y sin acceso", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAs(page, A_EMAIL);
  await page.goto(`/admin/${mainCalendar}`);

  await row(page, V_EMAIL).getByRole("button", { name: "Quitar" }).click();
  await expect(row(page, V_EMAIL)).toHaveCount(0);
  await row(page, X_EMAIL).getByRole("button", { name: "Quitar" }).click();
  await expect(row(page, X_EMAIL)).toHaveCount(0);
  await page.context().close();

  expect(await personOf(mainCalendar, V_EMAIL)).toBeNull();
  expect(await personOf(mainCalendar, X_EMAIL)).toBeNull();

  const formerAdmin = await newPage(browser);
  await loginAs(formerAdmin, X_EMAIL);
  await formerAdmin.goto(`/admin/${mainCalendar}`);
  await expect(formerAdmin).toHaveURL(/\/unauthorized$/);
  await formerAdmin.goto(`/c/${mainCalendar}`);
  await expect(formerAdmin).toHaveURL(/\/unauthorized$/);
  await formerAdmin.context().close();
});

test("5 · último Admin: desplegable y «Quitar» deshabilitados con aviso; el servidor también lo rechaza", async ({
  browser,
}) => {
  // Calendario cuyo único Admin es A (el Super Admin creador se quita a sí mismo).
  const soloCalendar = await createCalendar(`TAL-65 solo A ${runId}`);
  await addAdmin(soloCalendar, A_EMAIL);
  expect(await removePerson(sId, soloCalendar, S_EMAIL)).toEqual({ ok: true });
  expect(await effectiveAdminCount(soloCalendar)).toBe(1);

  const page = await newPage(browser);
  await loginAs(page, A_EMAIL);
  await page.goto(`/admin/${soloCalendar}`);
  const own = row(page, A_EMAIL);
  await expect(own).toContainText("Tú");
  await expect(own.locator("select")).toBeDisabled();
  await expect(own.getByRole("button", { name: "Quitar" })).toBeDisabled();
  await expect(own.getByText(LAST_ADMIN_HINT)).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "5-ultimo-admin.png"), fullPage: true });
  await page.context().close();

  const aId = await seedUser({ email: A_EMAIL });
  expect(await setRole(aId, soloCalendar, A_EMAIL, "GUEST")).toEqual({ ok: false, error: "last-admin" });
  expect(await removePerson(aId, soloCalendar, A_EMAIL)).toEqual({ ok: false, error: "last-admin" });
  expect(await setRole(sId, soloCalendar, A_EMAIL, "GUEST")).toEqual({ ok: false, error: "last-admin" });
  expect(await removePerson(sId, soloCalendar, A_EMAIL)).toEqual({ ok: false, error: "last-admin" });
  expect(await personOf(soloCalendar, A_EMAIL)).toMatchObject({ role: "ADMIN", pending: false, isLastAdmin: true });
});

test("6 · carreras con concurrencia real (N=10): nunca queda un calendario sin Admin", async () => {
  test.setTimeout(240_000);
  const N = 10;
  const outcomes: Record<string, number[]> = { demoteDemote: [], demoteRemove: [], superadminVsCalendar: [] };
  const finalInvitationRoles: string[] = [];

  for (let i = 0; i < N; i++) {
    const b1 = email(`race-b1-${i}`);
    const b1Id = await seedUser({ email: b1 });

    // a) dos Admins se degradan a la vez
    const c1 = await createCalendar(`TAL-65 race dd ${i} ${runId}`);
    await addAdmin(c1, b1);
    const dd = await Promise.all([setRole(sId, c1, S_EMAIL, "GUEST"), setRole(sId, c1, b1, "GUEST")]);
    expect(dd.filter((r) => r.ok)).toHaveLength(1);
    expect(dd.filter((r) => !r.ok)).toEqual([{ ok: false, error: "last-admin" }]);
    outcomes.demoteDemote.push(await effectiveAdminCount(c1));

    // b) degradar || quitar
    const c2 = await createCalendar(`TAL-65 race dr ${i} ${runId}`);
    await addAdmin(c2, b1);
    const dr = await Promise.all([setRole(sId, c2, S_EMAIL, "GUEST"), removePerson(sId, c2, b1)]);
    expect(dr.filter((r) => r.ok)).toHaveLength(1);
    outcomes.demoteRemove.push(await effectiveAdminCount(c2));

    // c) "Quitar" de /superadmin (B1 en todas partes) || quitar a S desde el calendario.
    // B1 ya no es Admin de c1/c2 en todos los casos; se le da un usuario propio para c3.
    const b2 = email(`race-b2-${i}`);
    const b2Id = await seedUser({ email: b2 });
    const c3 = await createCalendar(`TAL-65 race sc ${i} ${runId}`);
    await addAdmin(c3, b2);
    const sc = await Promise.all([
      convex.mutation(api.superadmin.removeAdminEverywherePublic, {
        serverSecret: serverSecret(),
        actorUserId: sId,
        userId: b2Id,
      }),
      removePerson(sId, c3, S_EMAIL),
    ]);
    expect(sc.filter((r) => r.ok)).toHaveLength(1);
    outcomes.superadminVsCalendar.push(await effectiveAdminCount(c3));

    // d) cambiar el rol de una invitación pendiente (ADMIN → GUEST) || aceptarla
    const p = email(`race-p-${i}`);
    const pId = await seedUser({ email: p });
    await convex.mutation(api.calendarPeople.inviteToCalendarPublic, {
      serverSecret: serverSecret(),
      actorUserId: sId,
      calendarId: c3,
      email: p,
      role: "ADMIN",
    });
    await Promise.all([
      setRole(sId, c3, p, "GUEST"),
      convex.mutation(api.access.resolveMemberAccessPublic, { serverSecret: serverSecret(), calendarId: c3, userId: pId }),
    ]);
    const finalP = await personOf(c3, p);
    finalInvitationRoles.push(`${finalP?.role}/${finalP?.pending ? "pending" : "member"}`);
    void b1Id;
  }

  console.log("TAL-65 carreras:", JSON.stringify({ ...outcomes, finalInvitationRoles }));
  expect(outcomes.demoteDemote).toEqual(Array(N).fill(1));
  expect(outcomes.demoteRemove).toEqual(Array(N).fill(1));
  expect(outcomes.superadminVsCalendar).toEqual(Array(N).fill(1));
  expect(finalInvitationRoles).toEqual(Array(N).fill("GUEST/member"));
});

test("7 · actores no autorizados llamando a Convex directamente → not-authorized, sin cambios", async () => {
  const visitorId = await seedUser({ email: email("visitor-actor") });
  await convex.mutation(api.calendarPeople.inviteToCalendarPublic, {
    serverSecret: serverSecret(),
    actorUserId: sId,
    calendarId: mainCalendar,
    email: email("visitor-actor"),
    role: "GUEST",
  });
  await convex.mutation(api.access.resolveMemberAccessPublic, {
    serverSecret: serverSecret(),
    calendarId: mainCalendar,
    userId: visitorId,
  });

  const outsiderId = await seedUser({ email: OUTSIDER_EMAIL });
  const otherCalendar = await createCalendar(`TAL-65 otro ${runId}`);
  await addAdmin(otherCalendar, OUTSIDER_EMAIL);

  for (const actor of [visitorId, outsiderId]) {
    expect(await setRole(actor, mainCalendar, email("visitor-actor"), "ADMIN")).toEqual({
      ok: false,
      error: "not-authorized",
    });
    expect(await removePerson(actor, mainCalendar, A_EMAIL)).toEqual({ ok: false, error: "not-authorized" });
    expect(
      await convex.mutation(api.calendarPeople.inviteToCalendarPublic, {
        serverSecret: serverSecret(),
        actorUserId: actor,
        calendarId: mainCalendar,
        email: email("sneaky"),
        role: "ADMIN",
      })
    ).toEqual({ ok: false, error: "not-authorized" });
    await expect(
      convex.query(api.calendarPeople.listCalendarPeoplePublic, {
        serverSecret: serverSecret(),
        actorUserId: actor,
        calendarId: mainCalendar,
      })
    ).rejects.toThrow(/No autorizado/);
  }

  expect(await personOf(mainCalendar, email("visitor-actor"))).toMatchObject({ role: "GUEST" });
  expect(await personOf(mainCalendar, A_EMAIL)).toMatchObject({ role: "ADMIN" });
  expect(await personOf(mainCalendar, email("sneaky"))).toBeNull();
});

test("8 · /superadmin «Quitar» al último Admin de un calendario → mensaje que lo nombra y nada cambia", async ({
  browser,
}) => {
  const lastName = `TAL-65 último ${runId}`;
  const lastCalendar = await createCalendar(lastName);
  const lastId = await seedUser({ email: LAST_EMAIL });
  await addAdmin(lastCalendar, LAST_EMAIL);
  expect(await removePerson(sId, lastCalendar, S_EMAIL)).toEqual({ ok: true });

  const page = await newPage(browser);
  await loginAs(page, S_EMAIL);
  await page.goto("/superadmin");
  const adminRow = page.locator("tr", { hasText: LAST_EMAIL });
  await adminRow.getByRole("button", { name: "Quitar" }).click();
  await expect(page.getByText(`No se puede quitar: es el único Admin de «${lastName}». Nombra antes a otro Admin.`)).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "8-superadmin-ultimo-admin.png"), fullPage: true });
  expect(await personOf(lastCalendar, LAST_EMAIL)).toMatchObject({ role: "ADMIN", pending: false });

  // Control positivo: con otro Admin en el calendario, "Quitar" funciona.
  await addAdmin(lastCalendar, SECOND_EMAIL);
  await page.goto("/superadmin");
  await page.locator("tr", { hasText: LAST_EMAIL }).getByRole("button", { name: "Quitar" }).click();
  await expect(page.locator("tr", { hasText: LAST_EMAIL })).toHaveCount(0);
  expect(await personOf(lastCalendar, LAST_EMAIL)).toBeNull();
  expect(await personOf(lastCalendar, SECOND_EMAIL)).toMatchObject({ role: "ADMIN" });
  await page.context().close();
  void lastId;
});

test("9 · link compartido: no eleva a nadie (no invitado sin acceso, invitación legada = Visitante, ?role ignorado)", async ({
  browser,
}) => {
  // El link es `/c/<id>`; el login por el link ya lo cubre TAL-58 (spec 5).
  // Aquí: con sesión, visitar el link con un `?role=ADMIN` inventado.
  await seedUser({ email: U_EMAIL });
  const uninvited = await newPage(browser);
  await loginAs(uninvited, U_EMAIL);
  await uninvited.goto(`/c/${mainCalendar}?role=ADMIN`);
  await expect(uninvited).toHaveURL(/\/unauthorized$/);
  await uninvited.context().close();

  // Invitación anterior a TAL-65 (sin `role`): `inviteGuestPublic` no lo escribe.
  await convex.mutation(api.invitations.inviteGuestPublic, {
    serverSecret: serverSecret(),
    calendarId: mainCalendar,
    email: LEGACY_EMAIL,
  });
  const legacy = await newPage(browser);
  await loginAs(legacy, LEGACY_EMAIL);
  await legacy.goto(`/c/${mainCalendar}?role=ADMIN`);
  await expect(legacy).toHaveURL(new RegExp(`/c/${mainCalendar}\\?role=ADMIN$`));
  await legacy.goto(`/admin/${mainCalendar}?role=ADMIN`);
  await expect(legacy).toHaveURL(/\/unauthorized$/);
  await legacy.context().close();
  expect(await personOf(mainCalendar, LEGACY_EMAIL)).toMatchObject({ role: "GUEST", pending: false });

  const adminPage = await newPage(browser);
  await loginAs(adminPage, A_EMAIL);
  await adminPage.goto(`/admin/${mainCalendar}`);
  await expect(adminPage.getByText(LINK_NOTE)).toBeVisible();
  await adminPage.context().close();
});

test("10 · ~375px: «Personas del calendario» sin scroll horizontal", async ({ browser }) => {
  const page = await newPage(browser, { width: 375, height: 812 });
  await loginAs(page, A_EMAIL);
  await page.goto(`/admin/${mainCalendar}`);
  const section = page.locator("section.people-section");
  await expect(section).toBeVisible();
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  const overflowing = await section.evaluate((el) => {
    const limit = document.documentElement.clientWidth;
    return [...el.querySelectorAll("*")].filter((child) => child.getBoundingClientRect().right > limit + 0.5).length;
  });
  expect(overflowing).toBe(0);
  await section.screenshot({ path: path.join(EVIDENCE_DIR, "10-personas-375.png") });
  await page.context().close();
});
