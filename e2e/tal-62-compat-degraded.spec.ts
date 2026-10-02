import { expect, test } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { SKIN_CATALOG_2026 } from "../convex/skinCatalog2026";
import { loginAs, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-62 — Next NUEVO sin catálogo 2026 utilizable (modo degradado,
 * docs/skins.md § "Parte visual"):
 * - `E2E_SKIN_DEGRADED=old-convex`: funciones de Convex anteriores a TAL-62
 *   desplegadas (rollback de Convex; `listCatalogPublic` no existe);
 * - `E2E_SKIN_DEGRADED=not-seeded`: Convex de TAL-62 con `skinStyles` vacía
 *   (runbook, entre las fases b y c; `listCatalogPublic` devuelve []).
 * En los dos casos la portada y las tarjetas de "Tus calendarios" se pintan
 * con el respaldo Alegre (`data-skin-style="fallback"`), el selector ofrece
 * las filas antiguas (`listAllPublic`) y se puede guardar.
 *
 * Solo contra el deployment de DESARROLLO de la terminal:
 *   old-convex:  (cd <checkout del main anterior a TAL-62> && npx convex dev --once)
 *                E2E_SKIN_DEGRADED=old-convex E2E_PORT=3001 npx playwright test e2e/tal-62-compat-degraded.spec.ts
 *                npx convex dev --once   # desde la rama de TAL-62
 *   not-seeded:  vaciar `skinStyles` (import --replace de un ZIP con la tabla vacía)
 *                E2E_SKIN_DEGRADED=not-seeded E2E_PORT=3001 npx playwright test e2e/tal-62-compat-degraded.spec.ts
 *                npx convex run skins:seedSkinCatalog2026 '{}'
 * Sin `E2E_SKIN_DEGRADED` se salta.
 */
const MODE = process.env.E2E_SKIN_DEGRADED;
test.skip(MODE !== "old-convex" && MODE !== "not-seeded", "Necesita Convex sin catálogo 2026 (E2E_SKIN_DEGRADED=old-convex|not-seeded).");
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const ACTOR_EMAIL = `e2e-tal62d-actor-${runId}@example.com`;
const GUEST_EMAIL = `e2e-tal62d-guest-${runId}@example.com`;
const ALEGRE = SKIN_CATALOG_2026.find((s) => s.key === "alegre")!.palette;
const rgb = (hex: string) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(", ")})`;

let actorId: Id<"users">;
let calendarId: Id<"calendars">;
let secondCalendarId: Id<"calendars">;

test.beforeAll(async () => {
  actorId = await seedUser({ email: ACTOR_EMAIL, superAdmin: true });
  calendarId = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: actorId,
    name: `TAL-62 degradado ${runId}`,
    coverTitle: "Degradado",
    startDate: "2026-12-01",
    endDate: "2026-12-24",
    creationKey: `tal62d-${runId}`,
  });
  await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId, email: GUEST_EMAIL });
  // Un segundo calendario para que `/c` muestre tarjetas (con uno solo redirige).
  secondCalendarId = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: actorId,
    name: `TAL-62 degradado 2 ${runId}`,
    coverTitle: "Degradado 2",
    startDate: "2026-12-01",
    endDate: "2026-12-24",
    creationKey: `tal62d2-${runId}`,
  });
  await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId: secondCalendarId, email: GUEST_EMAIL });
});

test.afterAll(async () => {
  await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId, userId: actorId });
  await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId: secondCalendarId, userId: actorId });
});

test(`${MODE}: la portada del invitado se pinta con el respaldo Alegre`, async ({ page }) => {
  await loginAs(page, GUEST_EMAIL);
  await page.goto(`/c/${calendarId}`);
  const main = page.locator("main[data-skin-style]");
  await expect(main).toHaveAttribute("data-skin-style", "fallback");
  expect(await main.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgb(ALEGRE.bg));
  await expect(page.locator("[data-skin-hero]")).toBeVisible();
});

test(`${MODE}: las tarjetas de "Tus calendarios" se pintan con el respaldo Alegre`, async ({ page }) => {
  await loginAs(page, GUEST_EMAIL);
  await page.goto("/c");
  for (const id of [calendarId, secondCalendarId]) {
    const cover = page.locator(`a[href="/c/${id}"] .calendar-card-cover`);
    await expect(cover).toHaveAttribute("data-skin-style", "fallback");
    expect(await cover.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgb(ALEGRE.bg));
    expect(await cover.locator(".cover-icon-box").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(rgb(ALEGRE.tile));
  }
});

test(`${MODE}: el selector ofrece las filas antiguas y se puede guardar`, async ({ page }) => {
  const allSkins = await convex.query(api.skins.listAllPublic, { serverSecret: serverSecret() });
  await loginAs(page, ACTOR_EMAIL);
  await page.goto(`/admin/${calendarId}`);
  const options = page.locator("[data-skin-option]");
  await expect(options).toHaveCount(allSkins.length);
  const current = (await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId }))!.skinId;
  const target = allSkins.find((s) => s._id !== current)!;
  await page.locator(`[data-skin-option="${target._id}"]`).click();
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect
    .poll(async () => (await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId }))?.skinId)
    .toBe(target._id);
});
