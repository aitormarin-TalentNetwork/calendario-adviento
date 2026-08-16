import { internalMutation, internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { requireServerSecret } from "./serverAuth";

// Equivalente al seed idempotente de prisma/seed.ts (upsert por `key`).
// internalMutation, no mutation — ver docs/convex-modelo-de-datos.md §
// "Sin autenticación/autorización todavía".
export const createSkin = internalMutation({
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

export const getByKey = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("skins")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique(),
});

/**
 * TAL-12 — catálogo completo, para el selector de skin del formulario de
 * edición de calendario (`src/app/admin/[calendarId]/page.tsx`). Catálogo
 * fijo y pequeño (unas pocas filas) — `.collect()` sin índice es
 * suficiente, mismo criterio que `resolveDefaultSkinId` en
 * `convex/calendars.ts`. Frontera pública con secreto compartido, mismo
 * patrón que el resto de TAL-11/TAL-12 (`convex/serverAuth.ts`).
 */
export const listAllPublic = query({
  args: { serverSecret: v.string() },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await ctx.db.query("skins").collect();
  },
});
