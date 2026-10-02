import { execSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { loginAs, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-65 — paso 0 del runbook de rollback (docs/invitados.md): con
 * `INVITATION_ROLES_FROZEN=1` en el deployment de Convex, ninguna función
 * escribe `invitations.role`. Invitar y cambiar rol responden `frozen` (y
 * la UI lo dice); "Quitar" de /superadmin sigue funcionando sin tocar el
 * `role` de la invitación.
 *
 * Solo corre con `ROLLBACK_FROZEN=1`. Activa y desactiva la congelación él
 * mismo (`npx convex env set/remove`) contra el deployment de `.env.local`,
 * y se niega a hacerlo si ese deployment es de producción.
 */
test.skip(process.env.ROLLBACK_FROZEN !== "1", "Solo durante la prueba del runbook (activa la congelación en el Convex de dev)");
test.describe.configure({ mode: "serial" });

const ROOT = path.resolve(__dirname, "..");

function convexEnv(args: string): void {
  const deployment = process.env.CONVEX_DEPLOYMENT ?? "";
  if (!deployment.startsWith("dev:")) throw new Error(`Solo contra un deployment de dev (CONVEX_DEPLOYMENT=${deployment}).`);
  execSync(`npx convex env ${args}`, { cwd: ROOT, stdio: "pipe" });
}

const runId = uniqueRunId();
const S_EMAIL = `e2e-tal65frz-super-${runId}@example.com`;
const L_EMAIL = `e2e-tal65frz-admin-${runId}@example.com`;
let sId: Id<"users">;
let calendarId: Id<"calendars">;

async function personOf(personEmail: string) {
  const rows = await convex.query(api.calendarPeople.listCalendarPeoplePublic, {
    serverSecret: serverSecret(),
    actorUserId: sId,
    calendarId,
  });
  return rows.find((p) => p.email === personEmail) ?? null;
}

test.beforeAll(async () => {
  sId = await seedUser({ email: S_EMAIL, superAdmin: true });
  calendarId = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: sId,
    name: `TAL-65 congelado ${runId}`,
    coverTitle: "TAL-65 congelado",
    startDate: "2026-09-01",
    endDate: "2026-12-24",
    creationKey: `e2e-tal65frz-${runId}`,
  });
  // Antes de congelar: L tiene invitación con `role: "ADMIN"` (pendiente) y
  // después membership ADMIN (nombrado desde /superadmin). S sigue siendo
  // Admin, así que L no es el último.
  expect(
    await convex.mutation(api.calendarPeople.inviteToCalendarPublic, {
      serverSecret: serverSecret(),
      actorUserId: sId,
      calendarId,
      email: L_EMAIL,
      role: "ADMIN",
    })
  ).toEqual({ ok: true });
  expect(
    await convex.mutation(api.superadmin.addAdminPublic, {
      serverSecret: serverSecret(),
      actorUserId: sId,
      calendarId,
      email: L_EMAIL,
    })
  ).toEqual({ ok: true });
  convexEnv("set INVITATION_ROLES_FROZEN 1");
});

test.afterAll(async () => {
  convexEnv("remove INVITATION_ROLES_FROZEN");
  await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId, userId: sId });
});

test("congelado: invitar y cambiar rol → frozen (llamada directa y UI)", async ({ page }) => {
  const target = `e2e-tal65frz-p-${runId}@example.com`;
  expect(
    await convex.mutation(api.calendarPeople.inviteToCalendarPublic, {
      serverSecret: serverSecret(),
      actorUserId: sId,
      calendarId,
      email: target,
      role: "ADMIN",
    })
  ).toEqual({ ok: false, error: "frozen" });
  expect(
    await convex.mutation(api.calendarPeople.setPersonRolePublic, {
      serverSecret: serverSecret(),
      actorUserId: sId,
      calendarId,
      email: S_EMAIL,
      role: "GUEST",
    })
  ).toEqual({ ok: false, error: "frozen" });

  await loginAs(page, S_EMAIL);
  await page.goto(`/admin/${calendarId}`);
  const form = page.locator("form.people-invite");
  await form.locator('input[name="email"]').fill(target);
  await form.getByRole("button", { name: "Invitar ahora" }).click();
  await expect(page.locator("p.people-error")).toHaveText("La gestión de roles está en mantenimiento, inténtalo más tarde.");
  await expect(page.locator(`li.people-row[data-email="${target}"]`)).toHaveCount(0);
});

test("congelado: «Quitar» de /superadmin sigue funcionando y no escribe el role de la invitación", async ({ page }) => {
  expect(await personOf(L_EMAIL)).toMatchObject({ role: "ADMIN", pending: false });

  await loginAs(page, S_EMAIL);
  await page.goto("/superadmin");
  await page.locator("tr", { hasText: L_EMAIL }).getByRole("button", { name: "Quitar" }).click();
  await expect(page).toHaveURL(/\/superadmin$/);
  await expect(page.locator("tr", { hasText: L_EMAIL })).toHaveCount(0);

  // La membership pasó a GUEST (tenía invitación, así que se degrada).
  expect(await personOf(L_EMAIL)).toMatchObject({ role: "GUEST", pending: false });

  // ¿Se escribió `role` en la invitación? Se retira la membership GUEST con la
  // función antigua, que solo borra la invitación si su rol es GUEST o no
  // tiene: si la congelación no hubiera protegido la invitación, habría
  // pasado a GUEST y desaparecería. Sigue en ADMIN (pendiente): no se escribió.
  await convex.mutation(api.guests.removeGuestFromCalendarPublic, {
    serverSecret: serverSecret(),
    calendarId,
    email: L_EMAIL,
  });
  expect(await personOf(L_EMAIL)).toMatchObject({ role: "ADMIN", pending: true });
});
