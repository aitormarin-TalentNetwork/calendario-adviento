import { mutation } from "./_generated/server";
import { v } from "convex/values";

// Idempotente por (calendarId, userId) — equivalente al `@@unique` de
// Prisma. `update: {}` en el upsert de Prisma nunca degradaba un rol ya
// existente; aquí, igual, si ya existe la membership se devuelve tal cual
// sin tocar `role`.
export const addMembership = mutation({
  args: {
    calendarId: v.id("calendars"),
    userId: v.id("users"),
    role: v.union(v.literal("ADMIN"), v.literal("GUEST")),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("calendarMemberships")
      .withIndex("by_calendar_and_user", (q) => q.eq("calendarId", args.calendarId).eq("userId", args.userId))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("calendarMemberships", args);
  },
});
