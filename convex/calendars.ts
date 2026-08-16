import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { assertValidCalendarDate } from "./dates";

/**
 * Idempotente por `creationKey` — mismo motivo que TAL-5 ronda 1 en Prisma
 * (doble clic/reenvío del formulario "+ Nuevo calendario" no debe crear
 * dos filas).
 */
export const createCalendar = mutation({
  args: {
    name: v.string(),
    coverTitle: v.string(),
    coverImageUrl: v.optional(v.string()),
    startDate: v.string(),
    endDate: v.string(),
    skinId: v.id("skins"),
    creationKey: v.string(),
  },
  handler: async (ctx, args) => {
    assertValidCalendarDate(args.startDate);
    assertValidCalendarDate(args.endDate);

    const existing = await ctx.db
      .query("calendars")
      .withIndex("by_creation_key", (q) => q.eq("creationKey", args.creationKey))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("calendars", { ...args, updatedAt: Date.now() });
  },
});

/**
 * Equivalente Convex al trigger `BEFORE UPDATE ON "Calendar"` de Postgres
 * (TAL-6 ronda 3, docs/dias.md) que impedía reducir el rango del
 * calendario dejando algún `Day` existente fuera de él. Convex no tiene
 * triggers de base de datos — ver docs/convex-modelo-de-datos.md §
 * "Invariante de rango Calendar/Day" para la decisión completa de dónde
 * vive esta comprobación ahora y qué garantía se pierde al no ser un
 * trigger (depende de que TODO código que cambie startDate/endDate pase
 * por esta mutation, no lo impone la plataforma).
 */
export const updateCalendarRange = mutation({
  args: { calendarId: v.id("calendars"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, args) => {
    assertValidCalendarDate(args.startDate);
    assertValidCalendarDate(args.endDate);

    const days = await ctx.db
      .query("days")
      .withIndex("by_calendar_and_date", (q) => q.eq("calendarId", args.calendarId))
      .collect();
    const outOfRange = days.filter((day) => day.date < args.startDate || day.date > args.endDate);
    if (outOfRange.length > 0) {
      throw new Error(
        `No se puede cambiar el rango: ${outOfRange.length} día(s) con vídeo asignado quedarían fuera del rango nuevo.`
      );
    }
    await ctx.db.patch(args.calendarId, {
      startDate: args.startDate,
      endDate: args.endDate,
      updatedAt: Date.now(),
    });
  },
});

export const get = query({
  args: { calendarId: v.id("calendars") },
  handler: async (ctx, args) => ctx.db.get(args.calendarId),
});
