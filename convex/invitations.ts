import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

// Idempotente por (calendarId, email normalizado) — invitar dos veces al
// mismo email al mismo calendario es un no-op, mismo criterio que
// `inviteGuest` en Prisma (TAL-7, docs/invitados.md).
//
// internalMutation, no mutation — ver docs/convex-modelo-de-datos.md §
// "Sin autenticación/autorización todavía".
export const inviteGuest = internalMutation({
  args: { calendarId: v.id("calendars"), email: v.string() },
  handler: async (ctx, args) => {
    // Integridad referencial (hallazgo de auditoría, ronda 1) — ver
    // calendars.ts::createCalendar.
    const calendar = await ctx.db.get(args.calendarId);
    if (!calendar) throw new Error("El calendario indicado no existe.");

    const email = args.email.trim().toLowerCase();
    const existing = await ctx.db
      .query("invitations")
      .withIndex("by_calendar_and_email", (q) => q.eq("calendarId", args.calendarId).eq("email", email))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("invitations", { calendarId: args.calendarId, email });
  },
});
