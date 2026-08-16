import { internalQuery, query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireServerSecret } from "./serverAuth";

/**
 * Calendario (rango) + sus días asignados, con el estado de visto de un
 * usuario concreto — lo que necesita la rejilla de puertas del Invitado
 * (`src/lib/guest-calendar.ts`, TAL-14). Vive en su propio fichero, no en
 * `days.ts`/`dayViews.ts` (TAL-13, dominio de T2) — solo lee esas tablas
 * vía `ctx.db`, mismo criterio que `calendars.ts::assertNoDayOutsideRange`
 * ya lee `days` directamente sin necesitar nada de `days.ts`.
 *
 * `null` si el calendario no existe. La autorización (¿tiene este usuario
 * acceso real a este calendario?) se resuelve en Next.js ANTES de llamar
 * (`resolveCalendarAccess`, TAL-11) — mismo criterio que el resto de
 * lecturas de esta frontera pública (`calendars.getPublic`, TAL-12): una
 * lectura no tiene la ventana de carrera que sí tienen las escrituras
 * (`calendars.deleteCalendarAsUser`, TAL-12;
 * `dayViews.markDayViewedAsUser`, TAL-14) — releer un instante después de
 * comprobar acceso no permite a nadie escalar privilegio ni actuar sobre
 * nada, a diferencia de "comprobar y luego escribir".
 */
async function resolveCalendarDaysForGuestHandler(
  ctx: QueryCtx,
  args: { calendarId: Id<"calendars">; userId: Id<"users"> }
): Promise<{
  startDate: string;
  endDate: string;
  days: { date: string; dayId: Id<"days">; videoUrl: string; message?: string; watched: boolean }[];
} | null> {
  const calendar = await ctx.db.get(args.calendarId);
  if (!calendar) return null;

  const days = await ctx.db
    .query("days")
    .withIndex("by_calendar_and_date", (q) => q.eq("calendarId", args.calendarId))
    .collect();

  const daysWithViewStatus = await Promise.all(
    days.map(async (day) => {
      const view = await ctx.db
        .query("dayViews")
        .withIndex("by_day_and_user", (q) => q.eq("dayId", day._id).eq("userId", args.userId))
        .unique();
      return { date: day.date, dayId: day._id, videoUrl: day.videoUrl, message: day.message, watched: view !== null };
    })
  );

  return { startDate: calendar.startDate, endDate: calendar.endDate, days: daysWithViewStatus };
}

export const resolveCalendarDaysForGuest = internalQuery({
  args: { calendarId: v.id("calendars"), userId: v.id("users") },
  handler: resolveCalendarDaysForGuestHandler,
});

export const resolveCalendarDaysForGuestPublic = query({
  args: { serverSecret: v.string(), calendarId: v.id("calendars"), userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await resolveCalendarDaysForGuestHandler(ctx, { calendarId: args.calendarId, userId: args.userId });
  },
});
