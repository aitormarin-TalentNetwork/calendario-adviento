import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireServerSecret } from "./serverAuth";

/**
 * Resuelve (y, si hace falta, crea) el acceso de un usuario ya autenticado
 * a un calendario concreto — equivalente Convex a la parte no-Super-Admin
 * de `resolveCalendarAccess` en Prisma (`src/lib/roles.ts`, versión TAL-7):
 * - Si ya hay `calendarMemberships` (ADMIN o GUEST), esa es la fuente de verdad.
 * - Si no la hay pero existe una `invitations` para su email en ese
 *   calendario, se "acepta" aquí mismo: se crea la membership como GUEST.
 * - Si no hay ni membership ni invitación, no tiene acceso (`null`) — igual
 *   que si el propio calendario no existe (referencia inválida/borrada):
 *   ninguno de los dos casos es un error, los dos son "sin acceso".
 *
 * El atajo de Super Admin NO vive aquí — `src/lib/roles.ts` lo resuelve
 * enteramente en Next.js sin tocar Convex (nunca necesitó BD, ver la
 * versión Prisma). Esta función solo cubre la rama de membership.
 *
 * TODA la lógica vive dentro de esta ÚNICA mutation (docs/convex-auth-investigacion-tal11.md
 * § "Gotcha 3"): la versión Prisma necesitaba una transacción SERIALIZABLE
 * con reintento (TAL-7 ronda 1) para que "aceptar invitación" aquí y
 * "quitar invitado" (`src/lib/guests.ts`) no se entrelazaran dejando con
 * acceso a alguien ya expulsado. Partir esto en varias llamadas sueltas de
 * `fetchQuery`/`fetchMutation` desde Next.js reabriría exactamente ese
 * hueco (`fetchQuery`/`preloadQuery` no da consistencia entre llamadas
 * separadas). Una mutation de Convex ya corre con aislamiento
 * serializable y reintento automático ante conflicto (mismo mecanismo que
 * TAL-9 verificó con concurrencia real para `users.createUser`/
 * `calendarMemberships.addMembership`) — el check-then-insert de abajo es
 * seguro tal cual, sin necesitar ningún nivel de aislamiento explícito ni
 * `withSerializableRetry`.
 *
 * La lógica vive en `resolveMemberAccessHandler`, una función plana
 * normal, invocada directamente tanto por `resolveMemberAccess` (internal)
 * como por `resolveMemberAccessPublic` (frontera pública, TAL-11) — en vez
 * de que la pública delegue en la interna vía `ctx.runMutation`, lo que
 * crearía una referencia circular de tipos dentro del propio fichero
 * (mismo motivo que en `convex/users.ts`).
 */
async function resolveMemberAccessHandler(
  ctx: MutationCtx,
  args: { calendarId: Id<"calendars">; userId: Id<"users">; userEmail: string }
): Promise<{ role: "ADMIN" | "GUEST" } | null> {
  const [calendar, user] = await Promise.all([ctx.db.get(args.calendarId), ctx.db.get(args.userId)]);
  if (!calendar || !user) return null;

  const membership = await ctx.db
    .query("calendarMemberships")
    .withIndex("by_calendar_and_user", (q) => q.eq("calendarId", args.calendarId).eq("userId", args.userId))
    .unique();
  if (membership) return { role: membership.role };

  // Las invitaciones se normalizan a minúsculas al escribir
  // (`invitations.ts::inviteGuest`) — se normaliza también aquí el email
  // recibido, por si la sesión llegara con otra capitalización (defensa a
  // nivel de aplicación, mismo criterio que la versión Prisma con `mode:
  // "insensitive"`).
  const email = args.userEmail.trim().toLowerCase();
  const invitation = await ctx.db
    .query("invitations")
    .withIndex("by_calendar_and_email", (q) => q.eq("calendarId", args.calendarId).eq("email", email))
    .unique();
  if (!invitation) return null;

  await ctx.db.insert("calendarMemberships", { calendarId: args.calendarId, userId: args.userId, role: "GUEST" });
  return { role: "GUEST" as const };
}

export const resolveMemberAccess = internalMutation({
  args: { calendarId: v.id("calendars"), userId: v.id("users"), userEmail: v.string() },
  handler: resolveMemberAccessHandler,
});

// --- Frontera pública (TAL-11) — ver convex/serverAuth.ts ---
export const resolveMemberAccessPublic = mutation({
  args: { serverSecret: v.string(), calendarId: v.id("calendars"), userId: v.id("users"), userEmail: v.string() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret);
    return await resolveMemberAccessHandler(ctx, {
      calendarId: args.calendarId,
      userId: args.userId,
      userEmail: args.userEmail,
    });
  },
});
