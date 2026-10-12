import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { loginAs, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-73 — "Tus calendarios" (/c): barra de progreso vistos/total de ESA
 * persona, "Empieza en N días" en los próximos y chips Todos / En marcha /
 * Próximos (solo con más de un calendario; los terminados solo en Todos).
 * Fechas relativas a hoy (zona local, la misma del navegador de Playwright).
 */
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const ACTOR_EMAIL = `e2e-tal73-actor-${runId}@example.com`;
const GUEST_EMAIL = `e2e-tal73-guest-${runId}@example.com`;
const SOLO_EMAIL = `e2e-tal73-solo-${runId}@example.com`;
const EVIDENCE_DIR = path.resolve(__dirname, "..", "docs", "evidence", "tal73");

const today = new Date().toLocaleDateString("sv-SE");
const shift = (n: number) => {
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE");
};
const label = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-ES", { timeZone: "UTC" });

let actorId: Id<"users">;
let guestId: Id<"users">;
const ids: Record<"live" | "upcoming" | "finished" | "solo", Id<"calendars">> = {} as never;
const liveDays: Id<"days">[] = [];

async function calendar(tag: string, start: string, end: string, email: string) {
  const id = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: actorId,
    name: `TAL-73 ${tag} ${runId}`,
    coverTitle: `TAL-73 ${tag}`,
    startDate: start,
    endDate: end,
    creationKey: `tal73-${tag}-${runId}`,
  });
  await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId: id, email });
  return id;
}

const card = (page: Page, id: string) => page.locator(`li:has(a[href="/c/${id}"])`);
const chip = (page: Page, name: string) => page.getByRole("group", { name: "Filtrar calendarios" }).getByRole("button", { name, exact: true });
const visibleIds = async (page: Page) =>
  await page.locator(".user-calendars-grid a.calendar-card").evaluateAll((els) => els.map((el) => el.getAttribute("href")!.slice(3)));

test.beforeAll(async () => {
  actorId = await seedUser({ email: ACTOR_EMAIL, superAdmin: true });
  guestId = await seedUser({ email: GUEST_EMAIL });
  await seedUser({ email: SOLO_EMAIL });
  ids.live = await calendar("en-marcha", shift(-5), shift(10), GUEST_EMAIL);
  ids.upcoming = await calendar("proximo", shift(9), shift(20), GUEST_EMAIL);
  ids.finished = await calendar("terminado", shift(-30), shift(-20), GUEST_EMAIL);
  ids.solo = await calendar("solo", shift(-5), shift(10), SOLO_EMAIL);
  for (const n of [-3, -2, 5]) {
    liveDays.push(await convex.mutation(api.days.upsertDayPublic, { serverSecret: serverSecret(), calendarId: ids.live, date: shift(n), videoUrl: "https://example.com/v" }));
  }
  await convex.mutation(api.days.upsertDayPublic, { serverSecret: serverSecret(), calendarId: ids.finished, date: shift(-25), videoUrl: "https://example.com/v" });
  // 1 visto en el calendario en marcha (el resto, desde la UI más abajo).
  expect(await convex.mutation(api.dayViews.markDayViewedAsUserPublic, { serverSecret: serverSecret(), calendarId: ids.live, dayId: liveDays[0], userId: guestId, todayDate: today })).toBe("marked");
});

test.afterAll(async () => {
  for (const calendarId of Object.values(ids)) {
    await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId, userId: actorId });
  }
});

test("1 · barra vistos/total de esa persona; «Empieza en 9 días» en el próximo, sin barra", { tag: "@regresion" }, async ({ page }) => {
  await loginAs(page, GUEST_EMAIL);
  await page.goto("/c");
  const live = card(page, ids.live);
  await expect(live.locator(".calendar-card-progress")).toHaveAttribute("data-progress", "1/3");
  await expect(live.locator(".calendar-card-progress-text")).toHaveText("1/3");
  await expect(live.getByRole("progressbar", { name: "Días vistos" })).toHaveAttribute("aria-valuenow", "1");
  const ratio = await live.locator(".calendar-card-progress-track").evaluate((track) => {
    const fill = track.querySelector(".calendar-card-progress-fill") as HTMLElement;
    return fill.getBoundingClientRect().width / track.clientWidth;
  });
  expect(ratio).toBeGreaterThan(0.32);
  expect(ratio).toBeLessThan(0.35);
  // Pista --surface-2 con borde --line; relleno --ink.
  const styles = await live.locator(".calendar-card-progress-track").evaluate((track) => ({
    bg: getComputedStyle(track).backgroundColor,
    border: getComputedStyle(track).borderTopStyle,
    fill: getComputedStyle(track.querySelector(".calendar-card-progress-fill")!).backgroundColor,
  }));
  expect(styles).toEqual({ bg: "rgb(247, 246, 243)", border: "solid", fill: "rgb(29, 35, 32)" });

  const upcoming = card(page, ids.upcoming);
  await expect(upcoming.locator(".calendar-card-starts")).toHaveText("Empieza en 9 días");
  await expect(upcoming.locator(".calendar-card-progress")).toHaveCount(0);
  await expect(card(page, ids.finished).locator(".calendar-card-progress")).toHaveAttribute("data-progress", "0/1");
});

test("2 · el progreso coincide con lo visto de verdad: abrir otro día en la UI → 2/3", async ({ page }) => {
  await loginAs(page, GUEST_EMAIL);
  await page.goto(`/c/${ids.live}`);
  await page.getByRole("button", { name: new RegExp(`^${label(shift(-2))}`) }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cerrar" }).click();
  await expect(page.getByRole("button", { name: new RegExp(`^${label(shift(-2))} — ya visto`) })).toBeVisible();
  await page.goto("/c");
  await expect(card(page, ids.live).locator(".calendar-card-progress")).toHaveAttribute("data-progress", "2/3");
});

test("3 · chips: filtran por fechas, aria-pressed, teclado (Enter/Espacio) y foco visible", { tag: "@regresion" }, async ({ page }) => {
  await loginAs(page, GUEST_EMAIL);
  await page.goto("/c");
  const pressed = async () =>
    await page.getByRole("group", { name: "Filtrar calendarios" }).getByRole("button").evaluateAll((els) => els.map((el) => `${el.textContent}:${el.getAttribute("aria-pressed")}`));
  expect(await pressed()).toEqual(["Todos:true", "En marcha:false", "Próximos:false"]);
  expect((await visibleIds(page)).sort()).toEqual([ids.live, ids.upcoming, ids.finished].sort());

  await chip(page, "En marcha").click();
  expect(await pressed()).toEqual(["Todos:false", "En marcha:true", "Próximos:false"]);
  expect(await visibleIds(page)).toEqual([ids.live]);

  // Teclado: foco por Tab (foco de teclado → :focus-visible) y Enter / Espacio.
  await chip(page, "Todos").focus();
  await page.keyboard.press("Tab"); // → En marcha
  await page.keyboard.press("Tab"); // → Próximos
  await expect(chip(page, "Próximos")).toBeFocused();
  const outline = await chip(page, "Próximos").evaluate((el) => ({ style: getComputedStyle(el).outlineStyle, width: getComputedStyle(el).outlineWidth }));
  expect(outline).toEqual({ style: "solid", width: "2px" });
  await page.keyboard.press("Enter");
  expect(await pressed()).toEqual(["Todos:false", "En marcha:false", "Próximos:true"]);
  expect(await visibleIds(page)).toEqual([ids.upcoming]);

  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab"); // → Todos
  await page.keyboard.press("Space");
  expect(await pressed()).toEqual(["Todos:true", "En marcha:false", "Próximos:false"]);
  expect(await visibleIds(page)).toHaveLength(3); // el terminado solo en Todos
});

test("4 · con un solo calendario: sin chips y se abre directamente", async ({ page }) => {
  await loginAs(page, SOLO_EMAIL);
  await page.goto("/c");
  await expect(page).toHaveURL(new RegExp(`/c/${ids.solo}$`));
  await expect(page.getByRole("group", { name: "Filtrar calendarios" })).toHaveCount(0);
});

test("5 · claro, oscuro y 375 px: sin scroll horizontal; capturas", async ({ browser }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    for (const viewport of [{ width: 375, height: 900 }, { width: 1280, height: 900 }]) {
      const page = await (await browser.newContext({ colorScheme, viewport })).newPage();
      await loginAs(page, GUEST_EMAIL);
      await page.goto("/c");
      await expect(card(page, ids.live).locator(".calendar-card-progress")).toBeVisible();
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
      expect(scrollWidth, `${colorScheme} ${viewport.width}`).toBeLessThanOrEqual(clientWidth);
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `tus-calendarios-${colorScheme}-${viewport.width}.png`), fullPage: true });
      await page.context().close();
    }
  }
});
