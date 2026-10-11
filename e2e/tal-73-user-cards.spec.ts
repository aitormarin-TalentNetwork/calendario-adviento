import { expect, test } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { MAX_PROGRESS_CALENDARS } from "../convex/calendars";
import { isMissingProgressFunctionError } from "../src/lib/calendars";
import { calendarStatusFor, startsInText, toUserModeCard } from "../src/lib/user-mode-calendars";
import { seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-73 — tests puros del estado/progreso de las tarjetas de "Tus
 * calendarios" y tests contra Convex (deployment de desarrollo) del cálculo
 * de progreso por persona y del tope de calendarios con progreso.
 */
const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const base = { id: "c", name: "N", coverTitle: "T", isAdmin: false, skin: null };

test.describe("puros", () => {
  test("calendarStatusFor en los bordes (mismo criterio que superadmin.calendarStatus)", () => {
    const start = utc("2026-12-01");
    const end = utc("2026-12-24");
    expect(calendarStatusFor(start, end, utc("2026-11-30"))).toBe("upcoming");
    expect(calendarStatusFor(start, end, utc("2026-12-01"))).toBe("live");
    expect(calendarStatusFor(start, end, utc("2026-12-24"))).toBe("live");
    expect(calendarStatusFor(start, end, utc("2026-12-25"))).toBe("finished");
  });
  test("startsInText", () => {
    expect(startsInText(1)).toBe("Empieza mañana");
    expect(startsInText(9)).toBe("Empieza en 9 días");
  });
  test("progreso: en marcha con campos → barra; viewed nunca pasa de total", () => {
    const card = toUserModeCard({ ...base, startDate: utc("2026-12-01"), endDate: utc("2026-12-24"), totalDays: 3, viewedDays: 1 }, utc("2026-12-05"));
    expect(card).toMatchObject({ status: "live", progress: { viewed: 1, total: 3 }, startsInDays: null });
    expect(toUserModeCard({ ...base, startDate: utc("2026-12-01"), endDate: utc("2026-12-24"), totalDays: 2, viewedDays: 5 }, utc("2026-12-05")).progress).toEqual({ viewed: 2, total: 2 });
  });
  test("sin campos (calendario 51+ o Convex anterior) o con total 0 → sin barra, sin error", () => {
    const live = { ...base, startDate: utc("2026-12-01"), endDate: utc("2026-12-24") };
    expect(toUserModeCard(live, utc("2026-12-05")).progress).toBeNull();
    expect(toUserModeCard({ ...live, totalDays: 0, viewedDays: 0 }, utc("2026-12-05")).progress).toBeNull();
  });
  test("próximo → «Empieza en N días», sin barra aunque traiga campos", () => {
    const card = toUserModeCard({ ...base, startDate: utc("2026-12-10"), endDate: utc("2026-12-24"), totalDays: 3, viewedDays: 0 }, utc("2026-12-01"));
    expect(card).toMatchObject({ status: "upcoming", progress: null, startsInDays: 9 });
  });
  test("Convex anterior: solo el mensaje exacto de función inexistente activa la caída sin progreso", () => {
    expect(isMissingProgressFunctionError(new Error("[Request ID: x] Server Error\nCould not find public function for 'calendars:listUserModeCalendarsWithProgressPublic'.\n"))).toBe(true);
    expect(isMissingProgressFunctionError(new Error("Could not find public function for 'calendars:otra'."))).toBe(false);
    expect(isMissingProgressFunctionError(new Error("fetch failed"))).toBe(false);
  });
  test("terminado → mantiene la barra", () => {
    const card = toUserModeCard({ ...base, startDate: utc("2026-11-01"), endDate: utc("2026-11-24"), totalDays: 4, viewedDays: 4 }, utc("2026-12-01"));
    expect(card).toMatchObject({ status: "finished", progress: { viewed: 4, total: 4 } });
  });
});

test.describe("Convex", () => {
  test.describe.configure({ mode: "serial" });
  const runId = uniqueRunId();
  let actorId: Id<"users">;
  const created: Id<"calendars">[] = [];
  const today = new Date().toLocaleDateString("sv-SE");
  const shift = (n: number) => {
    const d = new Date(`${today}T12:00:00`);
    d.setDate(d.getDate() + n);
    return d.toLocaleDateString("sv-SE");
  };

  async function calendar(tag: string) {
    const id = await convex.mutation(api.calendars.createCalendarPublic, {
      serverSecret: serverSecret(),
      userId: actorId,
      name: `TAL-73 ${tag} ${runId}`,
      coverTitle: tag,
      startDate: shift(-5),
      endDate: shift(10),
      creationKey: `tal73u-${tag}-${runId}`,
    });
    created.push(id);
    return id;
  }

  test.beforeAll(async () => {
    actorId = await seedUser({ email: `e2e-tal73u-actor-${runId}@example.com`, superAdmin: true });
  });
  test.afterAll(async () => {
    for (const calendarId of created) {
      await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId, userId: actorId });
    }
  });

  test("el progreso es de ESA persona: lo que vea otra no le cuenta", async () => {
    const id = await calendar("progreso");
    const days: Id<"days">[] = [];
    for (const n of [-3, -2, 5]) {
      days.push(await convex.mutation(api.days.upsertDayPublic, { serverSecret: serverSecret(), calendarId: id, date: shift(n), videoUrl: "https://example.com/v" }));
    }
    const ana = await seedUser({ email: `e2e-tal73u-ana-${runId}@example.com` });
    const bea = await seedUser({ email: `e2e-tal73u-bea-${runId}@example.com` });
    for (const email of [`e2e-tal73u-ana-${runId}@example.com`, `e2e-tal73u-bea-${runId}@example.com`]) {
      await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId: id, email });
    }
    const mark = (userId: Id<"users">, dayId: Id<"days">) =>
      convex.mutation(api.dayViews.markDayViewedAsUserPublic, { serverSecret: serverSecret(), calendarId: id, dayId, userId, todayDate: today });
    expect(await mark(ana, days[0])).toBe("marked");
    expect(await mark(bea, days[0])).toBe("marked");
    expect(await mark(bea, days[1])).toBe("marked");
    const rowFor = async (userId: Id<"users">) =>
      (await convex.query(api.calendars.listUserModeCalendarsWithProgressPublic, { serverSecret: serverSecret(), userId })).find((r) => r.id === id);
    expect(await rowFor(ana)).toMatchObject({ totalDays: 3, viewedDays: 1 });
    expect(await rowFor(bea)).toMatchObject({ totalDays: 3, viewedDays: 2 });
    // La consulta del menú de la cuenta (todas las páginas) NO calcula progreso.
    const menuRow = (await convex.query(api.calendars.listUserModeCalendarsPublic, { serverSecret: serverSecret(), userId: ana })).find((r) => r.id === id);
    expect(menuRow).toBeTruthy();
    expect(menuRow!.totalDays).toBeUndefined();
    expect(menuRow!.viewedDays).toBeUndefined();
  });

  test(`tope: con ${MAX_PROGRESS_CALENDARS + 1} calendarios, el último (el más antiguo) sale sin campos; nunca error`, async () => {
    const guestEmail = `e2e-tal73u-many-${runId}@example.com`;
    const guest = await seedUser({ email: guestEmail });
    const ids: Id<"calendars">[] = [];
    for (let i = 0; i < MAX_PROGRESS_CALENDARS + 1; i++) {
      const id = await calendar(`tope-${String(i).padStart(2, "0")}`);
      await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId: id, email: guestEmail });
      ids.push(id);
    }
    const rows = await convex.query(api.calendars.listUserModeCalendarsWithProgressPublic, { serverSecret: serverSecret(), userId: guest });
    expect(rows).toHaveLength(MAX_PROGRESS_CALENDARS + 1);
    expect(rows.slice(0, MAX_PROGRESS_CALENDARS).every((r) => r.totalDays === 0 && r.viewedDays === 0)).toBe(true);
    const last = rows[MAX_PROGRESS_CALENDARS];
    expect(last.id).toBe(ids[0]); // el más antiguo (orden: más reciente primero)
    expect(last.totalDays).toBeUndefined();
    expect(last.viewedDays).toBeUndefined();
  });
});
