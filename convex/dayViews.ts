import { internal } from "./_generated/api";
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

// Muy por debajo de los límites de una transacción de Convex (32.000
// documentos escaneados, 16.000 escritos, 16 MiB, 1s — ver
// https://docs.convex.dev/production/state/limits), con margen amplio
// para que el resto de trabajo de cada lote (la propia consulta + los
// borrados) quepa cómodo dentro de esos límites.
const DELETE_BATCH_SIZE = 200;

/**
 * Borra las `dayViews` de un día, por lotes — nunca todas de golpe en una
 * sola transacción (hallazgo de auditoría, TAL-13 ronda 1): sin cota,
 * `.collect()` + borrado uno a uno de TODAS las vistas de un día en la
 * misma mutation que borra el propio `Day` (versión anterior de
 * `deleteDayHandler`, `convex/days.ts`) podía, en teoría, exceder los
 * límites de tamaño de transacción de Convex si un día acumulaba
 * suficientes vistas — y entonces la mutation entera se revertiría, sin
 * ninguna forma de borrar ese día nunca (ni sus vistas, ni el día mismo,
 * porque las dos escrituras van en la misma transacción que ya no cabe).
 *
 * Se decidió NO inventar un límite de producto nuevo (p. ej. "máximo N
 * invitados por calendario") para garantizar caber en una sola
 * transacción — no hay ningún límite así hoy en el producto
 * (`convex/invitations.ts::inviteGuest` no acota cuántos invitados puede
 * tener un calendario), y añadir uno solo para esquivar un límite técnico
 * de la plataforma sería una decisión de producto que no le corresponde
 * decidir a esta tarea (ver CLAUDE.md — el alcance/producto lo decide
 * siempre el PM). En su lugar, el borrado se rediseña para no depender de
 * caber en una única transacción: `deleteDayHandler` borra el propio
 * `Day` de inmediato (el calendario deja de mostrarlo ya mismo) y
 * reprograma esta función para limpiar sus `dayViews` en segundo plano,
 * en lotes de `DELETE_BATCH_SIZE` — si queda más por borrar tras un lote,
 * se reprograma a sí misma (`ctx.scheduler.runAfter`) hasta vaciarlas
 * todas. Que el `Day` desaparezca del calendario antes de que sus
 * `dayViews` terminen de limpiarse no rompe ninguna invariante: nada en
 * el proyecto consulta `dayViews` de un día que ya no existe (mismo
 * criterio de "referencia rota inofensiva mientras no se lea" que el
 * resto de huecos de integridad referencial ya documentados en
 * docs/convex-modelo-de-datos.md § "Integridad referencial").
 */
export const cleanupDayViewsBatch = internalMutation({
  args: { dayId: v.id("days") },
  handler: async (ctx, args) => {
    const batch = await ctx.db
      .query("dayViews")
      .withIndex("by_day_and_user", (q) => q.eq("dayId", args.dayId))
      .take(DELETE_BATCH_SIZE);

    for (const view of batch) {
      await ctx.db.delete(view._id);
    }

    if (batch.length === DELETE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.dayViews.cleanupDayViewsBatch, { dayId: args.dayId });
    }
  },
});
