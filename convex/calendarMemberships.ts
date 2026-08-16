import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

// Idempotente por (calendarId, userId) — equivalente al `@@unique` de
// Prisma. `update: {}` en el upsert de Prisma nunca degradaba un rol ya
// existente; aquí, igual, si ya existe la membership se devuelve tal cual
// sin tocar `role`.
//
// internalMutation, no mutation — ver docs/convex-modelo-de-datos.md §
// "Sin autenticación/autorización todavía".
export const addMembership = internalMutation({
  args: {
    calendarId: v.id("calendars"),
    userId: v.id("users"),
    role: v.union(v.literal("ADMIN"), v.literal("GUEST")),
  },
  handler: async (ctx, args) => {
    // Integridad referencial (hallazgo de auditoría, ronda 1): ver el
    // mismo comentario en calendars.ts::createCalendar — `v.id(...)` no
    // comprueba que el documento exista de verdad.
    const [calendar, user] = await Promise.all([ctx.db.get(args.calendarId), ctx.db.get(args.userId)]);
    if (!calendar) throw new Error("El calendario indicado no existe.");
    if (!user) throw new Error("El usuario indicado no existe.");

    const existing = await ctx.db
      .query("calendarMemberships")
      .withIndex("by_calendar_and_user", (q) => q.eq("calendarId", args.calendarId).eq("userId", args.userId))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("calendarMemberships", args);
  },
});
