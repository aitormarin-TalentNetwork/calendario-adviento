import { internalMutation } from "./_generated/server";
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
 *
 * `internalMutation`, no `mutation` — ver docs/convex-modelo-de-datos.md §
 * "Sin autenticación/autorización todavía".
 */
export const markViewed = internalMutation({
  args: { dayId: v.id("days"), userId: v.id("users") },
  handler: async (ctx, args) => {
    // Integridad referencial (hallazgo de auditoría, ronda 1) — ver
    // calendars.ts::createCalendar.
    const [day, user] = await Promise.all([ctx.db.get(args.dayId), ctx.db.get(args.userId)]);
    if (!day) throw new Error("El día indicado no existe.");
    if (!user) throw new Error("El usuario indicado no existe.");

    const existing = await ctx.db
      .query("dayViews")
      .withIndex("by_day_and_user", (q) => q.eq("dayId", args.dayId).eq("userId", args.userId))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("dayViews", args);
  },
});
