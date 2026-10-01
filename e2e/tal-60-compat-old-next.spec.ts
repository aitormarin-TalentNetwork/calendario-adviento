import { expect, test } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { loginAs, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-60 — ventana "Next ANTIGUO + Convex NUEVO" del despliegue
 * (docs/iconos.md, fase a): mientras el Next anterior a TAL-60 sigue
 * sirviendo, las funciones de Convex ya son las nuevas. Comprueba que el
 * Next antiguo sigue funcionando: pinta sus emojis, y lo que guarda o crea
 * se queda como EMOJI (la escritura nueva los acepta y los guarda tal cual,
 * sin convertirlos a nombres Lucide que él no sabría pintar).
 *
 * Solo tiene sentido contra un `next dev` del código de main ANTERIOR a
 * TAL-60, levantado aparte (no lo arranca Playwright):
 *   git worktree add --detach <dir> e158e07 && (cd <dir> && npm ci && npx convex codegen && npx next dev -p 3002)
 *   E2E_OLD_NEXT=1 E2E_PORT=3002 npx playwright test e2e/tal-60-compat-old-next.spec.ts
 * Sin `E2E_OLD_NEXT=1` se salta (en la suite normal no hay Next antiguo).
 */
test.skip(process.env.E2E_OLD_NEXT !== "1", "Necesita un Next anterior a TAL-60 en E2E_PORT (E2E_OLD_NEXT=1).");
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const ACTOR_EMAIL = `e2e-tal60o-actor-${runId}@example.com`;
const ADMIN_EMAIL = `e2e-tal60o-admin-${runId}@example.com`;
const GUEST_EMAIL = `e2e-tal60o-guest-${runId}@example.com`;
const TITLE = `TAL-60 antiguo ${runId}`;
const NEW_NAME = `tal60o-creado-${runId}`;

let actorId: Id<"users">;
let calendarId: Id<"calendars">;
const createdCalendarIds = new Set<Id<"calendars">>();

async function storedCoverIcon(id: Id<"calendars">) {
  return (await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId: id }))?.coverIcon;
}

test.beforeAll(async () => {
  actorId = await seedUser({ email: ACTOR_EMAIL, superAdmin: true });
  calendarId = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: actorId,
    name: `${TITLE} (interno)`,
    coverTitle: TITLE,
    coverIcon: "🎁",
    startDate: "2026-12-01",
    endDate: "2026-12-24",
    creationKey: `tal60o-${runId}`,
  });
  createdCalendarIds.add(calendarId);
  expect(await convex.mutation(api.superadmin.addAdminPublic, { serverSecret: serverSecret(), actorUserId: actorId, calendarId, email: ADMIN_EMAIL })).toMatchObject({ ok: true });
  await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId, email: GUEST_EMAIL });
});

test.afterAll(async () => {
  const failures: string[] = [];
  for (const id of createdCalendarIds) {
    try {
      await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId: id, userId: actorId });
    } catch (err) {
      failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  expect(failures, "calendarios de prueba sin limpiar").toEqual([]);
});

test("es de verdad el Next antiguo (sin el marcador data-cover-icon de TAL-60)", async ({ page }) => {
  await page.goto("/login");
  expect(await page.locator("[data-cover-icon]").count()).toBe(0);
});

test("el Next antiguo pinta su emoji en la portada", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await loginAs(page, GUEST_EMAIL);
  await page.goto(`/c/${calendarId}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("🎁");
  await page.context().close();
});

test("el Admin edita el icono en el Next antiguo → se guarda el EMOJI tal cual (no un nombre Lucide)", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await loginAs(page, ADMIN_EMAIL);
  await page.goto(`/admin/${calendarId}`);
  const trigger = page.getByRole("button", { name: "Icono", exact: true });
  await expect(trigger).toHaveText("🎁");
  await trigger.click();
  await page.getByRole("dialog", { name: "Elegir icono de portada" }).getByTitle("árbol de navidad").click();
  await expect(trigger).toHaveText("🎄");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect.poll(() => storedCoverIcon(calendarId), { timeout: 20_000 }).toBe("🎄");
  await page.context().close();
});

test("el Super Admin crea un calendario en el Next antiguo → coverIcon '🎄' (el valor por defecto antiguo)", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await loginAs(page, ACTOR_EMAIL);
  await page.goto("/admin");
  await page.getByPlaceholder("Nombre del calendario").fill(NEW_NAME);
  await page.getByRole("button", { name: "+ Nuevo calendario" }).click();
  await expect(page).toHaveURL(/\/admin\/[^/]+$/);
  const all = await convex.query(api.superadmin.listCalendarsWithStatsPublic, {
    serverSecret: serverSecret(),
    actorUserId: actorId,
    now: new Date().toISOString().slice(0, 10),
  });
  const created = all.find((c) => c.name === NEW_NAME)!;
  createdCalendarIds.add(created.id);
  expect(await storedCoverIcon(created.id)).toBe("🎄");
  await page.context().close();
});
