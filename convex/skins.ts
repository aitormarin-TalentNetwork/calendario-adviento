import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// Equivalente al seed idempotente de prisma/seed.ts (upsert por `key`).
export const createSkin = mutation({
  args: { key: v.string(), name: v.string(), description: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("skins")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("skins", args);
  },
});

export const getByKey = query({
  args: { key: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("skins")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique(),
});
