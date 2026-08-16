import { mutation } from "./_generated/server";
import { v } from "convex/values";

// Idempotente por (calendarId, email normalizado) — invitar dos veces al
// mismo email al mismo calendario es un no-op, mismo criterio que
// `inviteGuest` en Prisma (TAL-7, docs/invitados.md).
export const inviteGuest = mutation({
  args: { calendarId: v.id("calendars"), email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const existing = await ctx.db
      .query("invitations")
      .withIndex("by_calendar_and_email", (q) => q.eq("calendarId", args.calendarId).eq("email", email))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("invitations", { calendarId: args.calendarId, email });
  },
});
