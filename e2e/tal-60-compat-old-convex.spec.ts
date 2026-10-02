import { expect, test } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { loginAs, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-60 — "Next NUEVO + Convex ANTIGUO" (rollback de Convex,
 * docs/iconos.md § "Rollback"): con las funciones de Convex anteriores a
 * TAL-60 desplegadas (validación por longitud ≤ 16), el Next nuevo sigue
 * funcionando y puede guardar cualquier nombre del catálogo — el más largo,
 * `heart-handshake` (15 caracteres).
 *
 * Solo tiene sentido con las funciones antiguas desplegadas en el
 * deployment de DESARROLLO de la terminal:
 *   (cd <checkout del main anterior a TAL-60> && npx convex dev --once)
 *   E2E_OLD_CONVEX=1 E2E_PORT=3001 npx playwright test e2e/tal-60-compat-old-convex.spec.ts
 *   npx convex dev --once   # desde la rama de TAL-60, para volver a las funciones nuevas
 * Sin `E2E_OLD_CONVEX=1` se salta.
 */
test.skip(process.env.E2E_OLD_CONVEX !== "1", "Necesita las funciones de Convex anteriores a TAL-60 desplegadas (E2E_OLD_CONVEX=1).");
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const ACTOR_EMAIL = `e2e-tal60k-actor-${runId}@example.com`;
const ADMIN_EMAIL = `e2e-tal60k-admin-${runId}@example.com`;
const GUEST_EMAIL = `e2e-tal60k-guest-${runId}@example.com`;

let actorId: Id<"users">;
let calendarId: Id<"calendars">;

async function storedCoverIcon(id: Id<"calendars">) {
  return (await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId: id }))?.coverIcon;
}

test.beforeAll(async () => {
  actorId = await seedUser({ email: ACTOR_EMAIL, superAdmin: true });
  calendarId = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: actorId,
    name: `TAL-60 Convex antiguo ${runId}`,
    coverTitle: `TAL-60 Convex antiguo ${runId}`,
    coverIcon: "cake",
    startDate: "2026-12-01",
    endDate: "2026-12-24",
    creationKey: `tal60k-${runId}`,
  });
  expect(await convex.mutation(api.superadmin.addAdminPublic, { serverSecret: serverSecret(), actorUserId: actorId, calendarId, email: ADMIN_EMAIL })).toMatchObject({ ok: true });
  await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId, email: GUEST_EMAIL });
});

test.afterAll(async () => {
  await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId, userId: actorId });
});

test("las funciones desplegadas son las antiguas (no existe coverIconMigration)", async () => {
  // La validación antigua NO es la lista blanca: acepta un valor arbitrario ≤ 16 caracteres.
  const calendar = (await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId }))!;
  await convex.mutation(api.calendars.updateCalendarPublic, {
    serverSecret: serverSecret(),
    calendarId,
    name: calendar.name,
    coverTitle: calendar.coverTitle,
    coverIcon: "🚀",
    startDate: calendar.startDate,
    endDate: calendar.endDate,
    skinId: calendar.skinId,
  });
  expect(await storedCoverIcon(calendarId)).toBe("🚀");
});

test("el Next nuevo guarda 'heart-handshake' (el nombre más largo) contra el Convex antiguo", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await loginAs(page, ADMIN_EMAIL);
  await page.goto(`/admin/${calendarId}`);
  const trigger = page.getByRole("button", { name: "Icono", exact: true });
  // 🚀 (dato que el Convex antiguo aceptó) se pinta con el respaldo "gift".
  await expect(trigger.locator("[data-cover-icon]")).toHaveAttribute("data-cover-icon", "gift");
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Elegir icono de portada" });
  await dialog.getByPlaceholder("Buscar icono…").fill("abrazo");
  await dialog.locator("[data-icon-name='heart-handshake']").click();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect.poll(() => storedCoverIcon(calendarId), { timeout: 20_000 }).toBe("heart-handshake");

  const guest = await (await browser.newContext()).newPage();
  await loginAs(guest, GUEST_EMAIL);
  await guest.goto(`/c/${calendarId}`);
  await expect(guest.locator(".cover-icon-box[data-cover-icon='heart-handshake'] svg.lucide")).toBeVisible();
  await guest.context().close();
  await page.context().close();
});
