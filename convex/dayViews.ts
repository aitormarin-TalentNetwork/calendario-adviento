import { mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Marca un día como visto — idempotente por (dayId, userId). Este es
 * exactamente el caso que en Prisma necesitó capturar P2002 bajo
 * concurrencia real (TAL-8, ronda 1, `markDayViewed`) porque el `upsert`
 * de Prisma no era atómico a nivel de BD para ese conector. Aquí NO hace
 * falta ningún try/catch equivalente: verificado con concurrencia real
 * (ver docs/convex-modelo-de-datos.md § "Concurrencia") que el
 * check-then-insert de abajo nunca duplica fila — Convex serializa
 * mutations concurrentes que leen/escriben el mismo rango de índice.
 */
export const markViewed = mutation({
  args: { dayId: v.id("days"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("dayViews")
      .withIndex("by_day_and_user", (q) => q.eq("dayId", args.dayId).eq("userId", args.userId))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("dayViews", args);
  },
});
