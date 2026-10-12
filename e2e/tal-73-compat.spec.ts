import { expect, test } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { loginAs, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-73 — compatibilidad entre versiones en la ventana de despliegue de
 * Railway (Convex se despliega ANTES que Next). Solo contra el deployment de
 * DESARROLLO de la terminal:
 *
 * - `E2E_TAL73_COMPAT=old-next-new-convex` (la ventana REAL): Convex de
 *   TAL-73 desplegado y un `next dev` del código de main ANTERIOR a TAL-73
 *   levantado aparte (git archive de main + `npx next dev -p 3011`):
 *     E2E_TAL73_COMPAT=old-next-new-convex E2E_PORT=3011 npx playwright test e2e/tal-73-compat.spec.ts
 *   → "Tus calendarios" sigue pintando sus tarjetas (los campos nuevos no le afectan).
 * - `E2E_TAL73_COMPAT=new-next-old-convex` (rollback de Convex): funciones de
 *   main desplegadas (`npx convex dev --once` desde el git archive) y el Next
 *   de TAL-73 en 3001:
 *     E2E_TAL73_COMPAT=new-next-old-convex E2E_PORT=3001 npx playwright test e2e/tal-73-compat.spec.ts
 *   → `listUserModeCalendarsWithProgressPublic` no existe: /c cae a la
 *   consulta de siempre — tarjetas SIN barra, sin error; los chips siguen.
 * Sin la variable se salta.
 */
const MODE = process.env.E2E_TAL73_COMPAT;
test.skip(MODE !== "old-next-new-convex" && MODE !== "new-next-old-convex", "Necesita E2E_TAL73_COMPAT=old-next-new-convex|new-next-old-convex");
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const ACTOR_EMAIL = `e2e-tal73c-actor-${runId}@example.com`;
const GUEST_EMAIL = `e2e-tal73c-guest-${runId}@example.com`;
const today = new Date().toLocaleDateString("sv-SE");
const shift = (n: number) => {
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE");
};

let actorId: Id<"users">;
const ids: Id<"calendars">[] = [];

test.beforeAll(async () => {
  actorId = await seedUser({ email: ACTOR_EMAIL, superAdmin: true });
  const guestId = await seedUser({ email: GUEST_EMAIL });
  for (const [tag, start, end] of [["en-marcha", shift(-5), shift(10)], ["proximo", shift(9), shift(20)]] as const) {
    const id = await convex.mutation(api.calendars.createCalendarPublic, {
      serverSecret: serverSecret(),
      userId: actorId,
      name: `TAL-73 compat ${tag} ${runId}`,
      coverTitle: `TAL-73 compat ${tag}`,
      startDate: start,
      endDate: end,
      creationKey: `tal73c-${tag}-${runId}`,
    });
    await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId: id, email: GUEST_EMAIL });
    ids.push(id);
  }
  const dayId = await convex.mutation(api.days.upsertDayPublic, { serverSecret: serverSecret(), calendarId: ids[0], date: shift(-2), videoUrl: "https://example.com/v" });
  await convex.mutation(api.dayViews.markDayViewedAsUserPublic, { serverSecret: serverSecret(), calendarId: ids[0], dayId, userId: guestId, todayDate: today });
});

test.afterAll(async () => {
  for (const calendarId of ids) {
    await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId, userId: actorId });
  }
});

test(`${MODE}: "Tus calendarios" carga y pinta las dos tarjetas, sin error`, async ({ page }) => {
  await loginAs(page, GUEST_EMAIL);
  const response = await page.goto("/c");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Tus calendarios" })).toBeVisible();
  for (const id of ids) await expect(page.locator(`a.calendar-card[href="/c/${id}"]`)).toBeVisible();
  if (MODE === "new-next-old-convex") {
    // Sin la consulta nueva: sin barra en ninguna tarjeta; el estado (Next) sigue.
    await expect(page.locator(".calendar-card-progress")).toHaveCount(0);
    await expect(page.locator(`li:has(a[href="/c/${ids[1]}"]) .calendar-card-starts`)).toHaveText("Empieza en 9 días");
    await expect(page.getByRole("group", { name: "Filtrar calendarios" })).toBeVisible();
  } else {
    // Next anterior: no conoce progreso ni chips; los campos nuevos de Convex no le afectan.
    await expect(page.getByRole("group", { name: "Filtrar calendarios" })).toHaveCount(0);
  }
});
