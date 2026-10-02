import { expect, test } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { loginAs, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-65 — paso 0 del runbook de rollback (docs/invitados.md): con
 * `INVITATION_ROLES_FROZEN=1` en el deployment de Convex, invitar y cambiar
 * rol se rechazan (`frozen`) y la UI lo dice. Solo corre con
 * `ROLLBACK_FROZEN=1`, después de `npx convex env set INVITATION_ROLES_FROZEN 1`
 * en el Convex de DEV de la terminal (nunca producción).
 */
test.skip(process.env.ROLLBACK_FROZEN !== "1", "Solo durante la prueba del runbook, con la congelación activa");
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const S_EMAIL = `e2e-tal65frz-super-${runId}@example.com`;
let sId: Id<"users">;
let calendarId: Id<"calendars">;

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
});

test.afterAll(async () => {
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
