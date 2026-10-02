import { expect, test } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { loginAs, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-67 — compatibilidad del despliegue: Convex sale primero, así que
 * durante la ventana sirve el Next ANTERIOR contra el Convex NUEVO
 * (docs/dias.md § "Despliegue y compatibilidad"). Solo corre con
 * `OLD_FRONTEND=1` contra un `next dev` del commit anterior a TAL-67 ya
 * levantado en `E2E_PORT`. El primer test comprueba que de verdad responde el
 * editor antiguo (sin el campo "Imagen del día").
 */
test.skip(process.env.OLD_FRONTEND !== "1", "Solo con OLD_FRONTEND=1 contra el Next anterior a TAL-67");
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const S_EMAIL = `e2e-tal67compat-super-${runId}@example.com`;
const G_EMAIL = `e2e-tal67compat-guest-${runId}@example.com`;
const YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const YOUTUBE_2 = "https://www.youtube.com/watch?v=9bZkp7q19f0";
let sId: Id<"users">;
let gId: Id<"users">;
let cal: Id<"calendars">;

const labelOf = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return `${d}/${m}/${y}`;
};
const dayData = async (date: string) =>
  (await convex.query(api.days.getCalendarDaysPublic, { serverSecret: serverSecret(), calendarId: cal })).days.find((d) => d.date === date) ?? null;

test.beforeAll(async () => {
  sId = await seedUser({ email: S_EMAIL, superAdmin: true });
  gId = await seedUser({ email: G_EMAIL });
  cal = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: sId,
    name: `TAL-67 compat ${runId}`,
    coverTitle: "compat",
    startDate: "2026-09-01",
    endDate: "2026-09-30",
    creationKey: `e2e-tal67compat-${runId}`,
  });
  await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId: cal, email: G_EMAIL });
  await convex.mutation(api.access.resolveMemberAccessPublic, { serverSecret: serverSecret(), calendarId: cal, userId: gId });
});

test.afterAll(async () => {
  await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId: cal, userId: sId });
});

test("1 · editor antiguo: guarda un día (sin copia), cambia la URL de un día con copia (la copia vieja da 404) y lo borra", async ({ page, request }) => {
  await loginAs(page, S_EMAIL);
  await page.goto(`/admin/${cal}`);
  // Guardar con el editor antiguo.
  await page.locator(`button[aria-label^="${labelOf("2026-09-01")} — "]`).click();
  const dialog = page.getByRole("dialog", { name: `Editar día — ${labelOf("2026-09-01")}` });
  // Prueba de que responde el editor ANTIGUO: no tiene el campo nuevo.
  await expect(dialog.getByText("Imagen del día (opcional)")).toHaveCount(0);
  await dialog.locator('input[name="videoUrl"]').fill(YOUTUBE);
  await dialog.getByRole("button", { name: "Guardar día" }).click();
  await expect.poll(async () => (await dayData("2026-09-01"))?.videoUrl).toBe(YOUTUBE);
  expect((await dayData("2026-09-01"))!.imageUrl).toBeNull(); // el Next antiguo no pide copia

  // Un día con copia propia (guardado con el Next nuevo) que el Admin cambia desde el editor antiguo.
  await convex.action(api.days.saveDayPublic, { serverSecret: serverSecret(), actorUserId: sId, calendarId: cal, date: "2026-09-02", videoUrl: YOUTUBE });
  const copy = (await dayData("2026-09-02"))!.imageUrl!;
  expect((await request.get(copy)).status()).toBe(200);
  await page.goto(`/admin/${cal}`);
  await page.locator(`button[aria-label^="${labelOf("2026-09-02")} — "]`).click();
  const dialog2 = page.getByRole("dialog", { name: `Editar día — ${labelOf("2026-09-02")}` });
  await dialog2.locator('input[name="videoUrl"]').fill(YOUTUBE_2);
  await dialog2.getByRole("button", { name: "Guardar día" }).click();
  await expect.poll(async () => (await dayData("2026-09-02"))?.videoUrl).toBe(YOUTUBE_2);
  expect((await request.get(copy, { failOnStatusCode: false })).status()).toBe(404);

  // Borrar un día con copia desde el editor antiguo → el fichero se borra.
  await convex.action(api.days.saveDayPublic, { serverSecret: serverSecret(), actorUserId: sId, calendarId: cal, date: "2026-09-03", videoUrl: YOUTUBE });
  const copy3 = (await dayData("2026-09-03"))!.imageUrl!;
  await page.goto(`/admin/${cal}`);
  await page.locator(`button[aria-label^="${labelOf("2026-09-03")} — "]`).click();
  await page.getByRole("dialog", { name: `Editar día — ${labelOf("2026-09-03")}` }).getByRole("button", { name: "Quitar vídeo" }).click();
  await expect.poll(async () => await dayData("2026-09-03")).toBeNull();
  expect((await request.get(copy3, { failOnStatusCode: false })).status()).toBe(404);
});

test("2 · vista antigua del invitado contra el Convex nuevo: carga y pinta la miniatura de YouTube como siempre", async ({ page }) => {
  const view = await convex.query(api.guestCalendar.resolveCalendarDaysForGuestPublic, { serverSecret: serverSecret(), calendarId: cal, userId: gId });
  const day = view!.days.find((d) => d.date === "2026-09-01")!;
  await convex.mutation(api.dayViews.markDayViewedAsUserPublic, {
    serverSecret: serverSecret(),
    calendarId: cal,
    dayId: day.dayId,
    userId: gId,
    todayDate: "2026-10-02",
  });
  await loginAs(page, G_EMAIL);
  await page.goto(`/c/${cal}`);
  const cell = page.locator(`button[aria-label^="${labelOf("2026-09-01")}"]`).first();
  await expect(cell).toBeVisible();
  expect((await cell.getAttribute("style")) ?? "").toContain("img.youtube.com");
});
