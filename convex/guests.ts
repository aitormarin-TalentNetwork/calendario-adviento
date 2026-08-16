import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireServerSecret } from "./serverAuth";

// TAL-16 — equivalente Convex a `src/lib/guests.ts` (versión Prisma,
// TAL-7 ronda 3, la que pasó auditoría con `withSerializableRetry`). Un
// invitado es la unión de dos fuentes, ya existentes desde TAL-9: una
// `invitations` (todavía no ha entrado) o una `calendarMemberships` con
// `role: "GUEST"` (ya entró y se le resolvió el acceso, ver
// `convex/access.ts`, TAL-11).
//
// `removeGuestFromCalendar`/`inviteGuest`/`listCalendarGuests` siguen
// confiando en que Next.js (`guests-actions.ts::requireCalendarAdmin`) ya
// resolvió "¿quién administra este calendario?" antes de llamarlas — su
// radio de efecto está siempre acotado a UN calendario, así que una
// autorización quedada obsoleta en el hueco entre esa comprobación y la
// llamada no puede tocar datos fuera de ese calendario (ver el comentario
// de `removeGuestFromCalendarAction`, `guests-actions.ts`).
// `removeGuestEverywhere` es distinta a propósito: su efecto es GLOBAL
// (cualquier calendario del email objetivo), así que ni la pertenencia del
// objetivo ni el rol del actor se aceptan como hechos ya resueltos en
// Next.js — las dos se releen DENTRO de la propia mutation, en la misma
// transacción que el borrado (correcciones de auditoría TAL-16, rondas 1 y
// 2 — ver el comentario de `removeGuestEverywhereHandler`).

/**
 * ¿Es este email invitado (o ya invitado-aceptado) de ESTE calendario
 * concreto? — usada por `removeGuestEverywhereHandler` (más abajo, mismo
 * fichero) para acotar el borrado global al OBJETIVO (el email a borrar)
 * teniendo relación real con el calendario que autoriza la operación, en
 * la MISMA transacción que el borrado (corrección de auditoría TAL-16,
 * ronda 1 — ver el comentario de `removeGuestEverywhereHandler`; antes se
 * llamaba por separado desde Next.js, dejando una ventana TOCTOU). Se
 * mantiene exportada como `internalQuery` porque sigue siendo una
 * comprobación de autorización útil por sí misma (hallazgo de auditoría
 * TAL-7, ver docs/invitados.md § "El efecto global exige que el objetivo
 * sea de verdad invitado...").
 */
async function isCalendarGuestHandler(
  ctx: QueryCtx,
  args: { calendarId: Id<"calendars">; email: string }
): Promise<boolean> {
  const email = args.email.trim().toLowerCase();
  const invitation = await ctx.db
    .query("invitations")
    .withIndex("by_calendar_and_email", (q) => q.eq("calendarId", args.calendarId).eq("email", email))
    .unique();
  if (invitation) return true;

  const user = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  if (!user) return false;

  const membership = await ctx.db
    .query("calendarMemberships")
    .withIndex("by_calendar_and_user", (q) => q.eq("calendarId", args.calendarId).eq("userId", user._id))
    .unique();
  return membership?.role === "GUEST";
}

export const isCalendarGuest = internalQuery({
  args: { calendarId: v.id("calendars"), email: v.string() },
  handler: isCalendarGuestHandler,
});

/**
 * "Quitar del calendario" — borra la `invitations` y la
 * `calendarMemberships` (solo si `role: "GUEST"`, nunca `ADMIN` — mismo
 * defensivo que la versión Prisma) de ESE calendario concreto para ese
 * email. Si solo se borrara la membership, la invitation que queda
 * volvería a resolver el acceso sola en el siguiente login (ver
 * `convex/access.ts::resolveMemberAccessHandler`) — la "expulsión"
 * quedaría deshecha sin que nadie lo pidiera (docs/invitados.md).
 *
 * Punto crítico de esta tarea — carrera expulsión-vs-aceptación
 * (docs/convex-diseno-tal16-gestion-invitados.md): esta mutation borra la
 * fila de `invitations` indexada por la clave EXACTA `(calendarId, email)`
 * (`by_calendar_and_email`), la misma clave que
 * `resolveMemberAccessHandler` (`convex/access.ts`, TAL-11) lee dentro de
 * su propia transacción para "aceptar". Como las dos mutations leen/escriben
 * el mismo rango de índice, el OCC de Convex las serializa: en CUALQUIER
 * orden, el resultado final es correcto (expulsión-primero deja sin
 * invitation ni membership; aceptación-primero crea la membership pero la
 * expulsión que llega después se la lleva igual). Probado con concurrencia
 * real contra el deployment — ver docs/invitados.md § "Carrera
 * expulsión-vs-aceptación (TAL-16)".
 */
async function removeGuestFromCalendarHandler(
  ctx: MutationCtx,
  args: { calendarId: Id<"calendars">; email: string }
): Promise<void> {
  const email = args.email.trim().toLowerCase();

  const invitation = await ctx.db
    .query("invitations")
    .withIndex("by_calendar_and_email", (q) => q.eq("calendarId", args.calendarId).eq("email", email))
    .unique();
  if (invitation) await ctx.db.delete(invitation._id);

  const user = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  if (user) {
    const membership = await ctx.db
      .query("calendarMemberships")
      .withIndex("by_calendar_and_user", (q) => q.eq("calendarId", args.calendarId).eq("userId", user._id))
      .unique();
    if (membership?.role === "GUEST") await ctx.db.delete(membership._id);
  }
}

export const removeGuestFromCalendar = internalMutation({
  args: { calendarId: v.id("calendars"), email: v.string() },
  handler: removeGuestFromCalendarHandler,
});

export type RemoveGuestEverywhereResult = { ok: true } | { ok: false; error: "not-authorized" };

/**
 * "Borrar por completo" — borra TODAS las `invitations` de ese email
 * (cualquier calendario) y todas sus `calendarMemberships` con
 * `role: "GUEST"` (cualquier calendario), deliberadamente global — así lo
 * especifica el brief de TAL-7 (docs/invitados.md § "Borrar por completo
 * es deliberadamente global"). Nunca toca membership `ADMIN` ni el `users`
 * en sí.
 *
 * `calendarId`/`email` (corrección de auditoría, ronda 1, TAL-16): la
 * pertenencia del objetivo (¿el email de verdad sigue siendo invitado del
 * calendario que autoriza la operación?) se comprueba AQUÍ DENTRO, en la
 * misma transacción que el borrado — no en una llamada aparte desde
 * Next.js. Ver el razonamiento completo (ventana TOCTOU, por qué Convex
 * serializa comprobación+efecto como una unidad) en
 * `docs/invitados.md` § "Corrección de auditoría, ronda 1 (TAL-16):
 * ventana TOCTOU en 'Borrar por completo'".
 *
 * `actorUserId` (corrección de auditoría, ronda 2, TAL-16): la ronda 2
 * seguía aceptando la AUTORIZACIÓN DEL ACTOR como un hecho ya resuelto en
 * Next.js — `requireCalendarAdmin` comprobaba ahí que quien llama sigue
 * siendo Admin/Super Admin, y esta mutation confiaba en ese resultado
 * (pasado como `requireGuestOfCalendarId: calendarId | null`, `null`
 * para Super Admin). Misma clase de bug que el de ronda 1, pero sobre el
 * ROL DEL ACTOR en vez de la pertenencia del objetivo: si el rol de quien
 * llama se revoca entre la comprobación en Next.js y esta mutation (le
 * quitan la membership ADMIN, o Super Admin deja de serlo), el borrado
 * global se ejecuta igual con una autorización ya obsoleta.
 *
 * Corrección: la mutation recibe `actorUserId` (identificador puro, nunca
 * un booleano/rol ya calculado) y resuelve su rol AQUÍ DENTRO, en la misma
 * transacción — releyendo `users.isSuperAdmin` y, si no lo es,
 * `calendarMemberships` para `(calendarId, actorUserId)` — exactamente
 * igual que `getAuthorizedUser()`/`resolveCalendarAccess()` hacen en
 * Next.js (nunca confiar en un valor ya calculado, releer en fresco), pero
 * ahora también dentro del propio Convex, atómico con el efecto. Ni
 * siquiera el caso de Super Admin se acepta como argumento afirmado: se
 * relee `users.isSuperAdmin` aquí mismo. Regla de fondo para el resto de
 * esta serie: cualquier función que autoriza y actúa debe resolver la
 * identidad del actor dentro de sí misma, nunca aceptarla como argumento
 * afirmado desde Next.js.
 *
 * Devuelve un resultado tipado (`{ok:false, error:"not-authorized"}`) en
 * vez de lanzar (nota no bloqueante de auditoría, ronda 2): una carrera
 * legítima (el rol o la pertenencia cambiaron de verdad entre medias, sin
 * que nadie esté atacando nada) no debería reventar como un 500 crudo —
 * `guests-actions.ts` lo traduce a un `redirect("/unauthorized")` limpio,
 * mismo criterio que el resto de rutas protegidas de la app.
 */
async function removeGuestEverywhereHandler(
  ctx: MutationCtx,
  args: { actorUserId: Id<"users">; calendarId: Id<"calendars">; email: string }
): Promise<RemoveGuestEverywhereResult> {
  const actor = await ctx.db.get(args.actorUserId);
  if (!actor) return { ok: false, error: "not-authorized" };

  if (!actor.isSuperAdmin) {
    const actorMembership = await ctx.db
      .query("calendarMemberships")
      .withIndex("by_calendar_and_user", (q) => q.eq("calendarId", args.calendarId).eq("userId", args.actorUserId))
      .unique();
    if (actorMembership?.role !== "ADMIN") return { ok: false, error: "not-authorized" };

    const isTargetGuestHere = await isCalendarGuestHandler(ctx, {
      calendarId: args.calendarId,
      email: args.email,
    });
    if (!isTargetGuestHere) return { ok: false, error: "not-authorized" };
  }

  const email = args.email.trim().toLowerCase();

  const invitations = await ctx.db
    .query("invitations")
    .withIndex("by_email", (q) => q.eq("email", email))
    .collect();
  for (const invitation of invitations) await ctx.db.delete(invitation._id);

  const targetUser = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  if (targetUser) {
    const memberships = (
      await ctx.db
        .query("calendarMemberships")
        .withIndex("by_user", (q) => q.eq("userId", targetUser._id))
        .collect()
    ).filter((membership) => membership.role === "GUEST");
    for (const membership of memberships) await ctx.db.delete(membership._id);
  }

  return { ok: true };
}

export const removeGuestEverywhere = internalMutation({
  args: { actorUserId: v.id("users"), calendarId: v.id("calendars"), email: v.string() },
  handler: removeGuestEverywhereHandler,
});

export type CalendarGuest = { email: string; accepted: boolean };

/**
 * Invitados de un calendario, para la tabla del panel de Admin — mismo
 * patrón de unión en código de aplicación que la versión Prisma (TAL-7 ya
 * lo hacía en JS, no era un `include` relacional real). Se excluyen los
 * emails que ya son `ADMIN` de este calendario (puede quedar una
 * `invitations` suya de antes de que se le diera Admin — ver
 * `docs/invitados.md`), y se prioriza "Ha entrado" (membership GUEST)
 * sobre "Invitado" (solo invitation) cuando hay las dos.
 */
async function listCalendarGuestsHandler(
  ctx: QueryCtx,
  args: { calendarId: Id<"calendars"> }
): Promise<CalendarGuest[]> {
  const invitations = await ctx.db
    .query("invitations")
    .withIndex("by_calendar_and_email", (q) => q.eq("calendarId", args.calendarId))
    .collect();
  const memberships = await ctx.db
    .query("calendarMemberships")
    .withIndex("by_calendar_and_user", (q) => q.eq("calendarId", args.calendarId))
    .collect();
  const membershipsWithUser = await Promise.all(
    memberships.map(async (membership) => ({ ...membership, user: await ctx.db.get(membership.userId) }))
  );

  const adminEmails = new Set(
    membershipsWithUser
      .filter((m): m is typeof m & { user: Doc<"users"> } => m.role === "ADMIN" && m.user !== null)
      .map((m) => m.user.email.toLowerCase())
  );

  const byEmail = new Map<string, CalendarGuest>();
  for (const invitation of invitations) {
    const key = invitation.email.toLowerCase();
    if (adminEmails.has(key)) continue;
    byEmail.set(key, { email: invitation.email, accepted: false });
  }
  for (const membership of membershipsWithUser) {
    if (membership.role !== "GUEST" || !membership.user) continue;
    byEmail.set(membership.user.email.toLowerCase(), { email: membership.user.email, accepted: true });
  }
  return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
}

export const listCalendarGuests = internalQuery({
  args: { calendarId: v.id("calendars") },
  handler: listCalendarGuestsHandler,
});

// --- Frontera pública (TAL-11) — ver convex/serverAuth.ts. Función
// delgada por operación: comprueba el secreto y delega en la función
// plana correspondiente (mismo motivo que en access.ts/users.ts para no
// pasar por `ctx.runMutation`/`ctx.runQuery`: evita una referencia
// circular de tipos dentro del propio fichero, ver esos ficheros). ---

export const removeGuestFromCalendarPublic = mutation({
  args: { serverSecret: v.string(), calendarId: v.id("calendars"), email: v.string() },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    await removeGuestFromCalendarHandler(ctx, { calendarId: args.calendarId, email: args.email });
  },
});

export const removeGuestEverywherePublic = mutation({
  args: {
    serverSecret: v.string(),
    actorUserId: v.id("users"),
    calendarId: v.id("calendars"),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await removeGuestEverywhereHandler(ctx, {
      actorUserId: args.actorUserId,
      calendarId: args.calendarId,
      email: args.email,
    });
  },
});

export const listCalendarGuestsPublic = query({
  args: { serverSecret: v.string(), calendarId: v.id("calendars") },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await listCalendarGuestsHandler(ctx, { calendarId: args.calendarId });
  },
});
