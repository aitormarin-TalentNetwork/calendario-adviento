import { mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Upsert por (calendarId, date) — equivalente a `saveDayAction` (TAL-6).
 * También valida que la fecha está dentro del rango del Calendar en este
 * mismo momento: la otra mitad de la invariante de rango (la mitad que en
 * la versión Prisma vivía en el `SELECT ... FOR UPDATE` de la transacción
 * de aplicación, no en el trigger — ver `updateCalendarRange` en
 * calendars.ts y docs/convex-modelo-de-datos.md).
 */
export const upsertDay = mutation({
  args: {
    calendarId: v.id("calendars"),
    date: v.string(),
    videoUrl: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
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
