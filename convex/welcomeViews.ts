import { internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireServerSecret } from "./serverAuth";

/**
 * TAL-70 — "bienvenida con foto vista hoy" (por persona, calendario y día
 * natural en su zona horaria). La fecha la calcula SIEMPRE el servidor de
 * Next con la cookie `tz` (`src/app/c/[calendarId]/welcome-actions.ts`),
 * nunca el navegador. Ver docs/bienvenida.md.
 *
 * TAL-85 — SIN USO desde TAL-85: la bienvenida sale en cada entrada y el
 * Next nuevo ya no lee ni escribe esta marca (se borraron
 * `src/lib/welcome.ts` y `welcome-actions.ts`). Se conserva íntegra —
 * funciones, tabla e índices— por compatibilidad con el Next anterior
 * durante el despliegue o un rollback; su retirada del schema va en una
 * tarea aparte con el procedimiento de migración (como TAL-82).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type MarkSeenResult =
  | { ok: true; inserted: boolean }
  | { ok: false; error: "calendar-not-found" | "not-authorized" | "bad-date" };

/**
 * Autorización releída dentro de la transacción: Super Admin en fresco o
 * membership vigente (ADMIN o GUEST). Una invitación pendiente ya se ha
 * aceptado antes, en el render (`resolveCalendarAccess`).
 */
async function canSeeCalendar(ctx: QueryCtx | MutationCtx, userId: Id<"users">, calendarId: Id<"calendars">): Promise<boolean> {
  const user = await ctx.db.get(userId);
  if (!user) return false;
  if (user.isSuperAdmin) return true;
  const membership = await ctx.db
    .query("calendarMemberships")
    .withIndex("by_calendar_and_user", (q) => q.eq("calendarId", calendarId).eq("userId", userId))
    .first();
  return membership !== null;
}

/**
 * UNA sola mutation (plan loop3 § 2), en este orden:
 * 1. el calendario tiene que existir — antes de autorizar, para todo actor
 *    (también el Super Admin, autorizado de forma global): una marca que
 *    llega después del borrado lee que no existe y no escribe nada. Leer
 *    el calendario y borrarlo (`deleteCalendarHandler`, que además borra
 *    las `welcomeViews` en su misma transacción) tocan el mismo documento,
 *    así que el OCC serializa las dos y nunca queda una fila huérfana;
 * 2. autorización releída aquí mismo;
 * 3. consulta por `by_user_calendar_date` e inserción solo si no existe.
 *    Dos marcas simultáneas leen el mismo rango del índice: el OCC hace
 *    que la segunda se reintente, vea la fila y no inserte → exactamente 1.
 */
export async function markSeenHandler(
  ctx: MutationCtx,
  args: { userId: Id<"users">; calendarId: Id<"calendars">; date: string }
): Promise<MarkSeenResult> {
  if (!DATE_RE.test(args.date)) return { ok: false, error: "bad-date" };
  const calendar = await ctx.db.get(args.calendarId);
  if (!calendar) return { ok: false, error: "calendar-not-found" };
  if (!(await canSeeCalendar(ctx, args.userId, args.calendarId))) return { ok: false, error: "not-authorized" };
  const existing = await ctx.db
    .query("welcomeViews")
    .withIndex("by_user_calendar_date", (q) => q.eq("userId", args.userId).eq("calendarId", args.calendarId).eq("date", args.date))
    .first();
  if (existing) return { ok: true, inserted: false };
  await ctx.db.insert("welcomeViews", { userId: args.userId, calendarId: args.calendarId, date: args.date });
  return { ok: true, inserted: true };
}

export const markSeenPublic = mutation({
  args: { serverSecret: v.string(), userId: v.id("users"), calendarId: v.id("calendars"), date: v.string() },
  handler: async (ctx, args): Promise<MarkSeenResult> => {
    await requireServerSecret(args.serverSecret);
    return await markSeenHandler(ctx, { userId: args.userId, calendarId: args.calendarId, date: args.date });
  },
});

/**
 * Lectura del render de `/c/<id>`, después de `resolveCalendarAccess`.
 * Sin acceso o fecha mal formada → `true` ("no la enseñes"): la
 * bienvenida nunca sale para quien no puede ver el calendario.
 */
export const hasSeenTodayPublic = query({
  args: { serverSecret: v.string(), userId: v.id("users"), calendarId: v.id("calendars"), date: v.string() },
  handler: async (ctx, args): Promise<boolean> => {
    await requireServerSecret(args.serverSecret);
    if (!DATE_RE.test(args.date)) return true;
    if (!(await canSeeCalendar(ctx, args.userId, args.calendarId))) return true;
    const existing = await ctx.db
      .query("welcomeViews")
      .withIndex("by_user_calendar_date", (q) => q.eq("userId", args.userId).eq("calendarId", args.calendarId).eq("date", args.date))
      .first();
    return existing !== null;
  },
});

/**
 * Auditoría y tests (`npx convex run welcomeViews:countForCalendars`):
 * filas de `welcomeViews` de esos calendarios (también ya borrados — así se
 * comprueba que no queda ninguna huérfana).
 */
export const countForCalendars = internalQuery({
  args: { calendarIds: v.array(v.string()) },
  handler: async (ctx, args): Promise<number> => {
    let total = 0;
    for (const calendarId of args.calendarIds) {
      const rows = await ctx.db
        .query("welcomeViews")
        .withIndex("by_calendar", (q) => q.eq("calendarId", calendarId as Id<"calendars">))
        .collect();
      total += rows.length;
    }
    return total;
  },
});
