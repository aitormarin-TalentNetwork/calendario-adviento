import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { assertValidCalendarDate } from "./dates";

/**
 * Upsert por (calendarId, date) — equivalente a `saveDayAction` (TAL-6).
 * También valida que la fecha está dentro del rango del Calendar en este
 * mismo momento: la otra mitad de la invariante de rango (la mitad que en
 * la versión Prisma vivía en el `SELECT ... FOR UPDATE` de la transacción
 * de aplicación, no en el trigger — ver `updateCalendarRange` en
 * calendars.ts y docs/convex-modelo-de-datos.md). La comprobación de que
 * `calendarId` existe de verdad (integridad referencial, hallazgo de
 * auditoría ronda 1) ya la hacía `ctx.db.get` de abajo — no hacía falta
 * añadir nada aquí, a diferencia de `createCalendar`/`addMembership`.
 *
 * `internalMutation`, no `mutation` — ver docs/convex-modelo-de-datos.md §
 * "Sin autenticación/autorización todavía".
 */
export const upsertDay = internalMutation({
  args: {
    calendarId: v.id("calendars"),
    date: v.string(),
    videoUrl: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    assertValidCalendarDate(args.date);

    const calendar = await ctx.db.get(args.calendarId);
    if (!calendar) throw new Error("El calendario ya no existe.");
    if (args.date < calendar.startDate || args.date > calendar.endDate) {
      throw new Error("Esa fecha no está dentro del rango del calendario.");
    }

    const existing = await ctx.db
      .query("days")
      .withIndex("by_calendar_and_date", (q) => q.eq("calendarId", args.calendarId).eq("date", args.date))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { videoUrl: args.videoUrl, message: args.message });
      return existing._id;
    }
    return await ctx.db.insert("days", args);
  },
});
