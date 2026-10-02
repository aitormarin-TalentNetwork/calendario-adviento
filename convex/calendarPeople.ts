import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireServerSecret } from "./serverAuth";

/**
 * TAL-65 — "Personas del calendario": invitar como Visitante o
 * Administrador, cambiar el rol de quien ya está y quitar a cualquiera, sin
 * dejar nunca un calendario sin Admin (design/design-system.md § "Personas
 * del calendario"; ver docs/invitados.md § "Invitar con rol (TAL-65)").
 *
 * Una persona del calendario es la unión de dos fuentes, igual que en
 * `guests.ts` (TAL-16): una `calendarMemberships` (ya entró; su `role` es
 * la fuente de verdad) o, si todavía no ha entrado, una `invitations`
 * pendiente (su `role ?? "GUEST"` es el rol con el que entrará, ver
 * `access.ts::resolveMemberAccessHandler`).
 *
 * Autorización DENTRO de cada función (mismo criterio que
 * `superadmin.ts::requireSuperAdmin` y
 * `guests.ts::removeGuestEverywhereHandler`): se recibe `actorUserId`
 * (identidad pura) y se relee aquí, en la misma transacción que el efecto,
 * si es Super Admin o Admin (membership ADMIN) de ese calendario. Nunca se
 * acepta un rol ya calculado en Next.js.
 *
 * Último Admin: solo cuentan las memberships ADMIN (Admins efectivos), no
 * las invitaciones pendientes como Admin — un invitado que nunca entra no
 * puede sostener el calendario. Contar y escribir pasan por el mismo rango
 * del índice `by_calendar_and_user` (prefijo `calendarId`), así que dos
 * mutations que degradan/quitan Admins a la vez entran en conflicto en el
 * OCC serializable de Convex y se ordenan: la segunda vuelve a contar y ve
 * que ya solo queda uno. Probado con concurrencia real (e2e de TAL-65).
 */

export type CalendarRole = "ADMIN" | "GUEST";

// Mismo patrón que `invitations.ts`/`superadmin.ts`.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Congelación de escrituras con rol (runbook de rollback, docs/invitados.md):
 * con `INVITATION_ROLES_FROZEN=1` en las variables de entorno del deployment
 * de Convex, invitar y cambiar rol se rechazan, para que ninguna escritura
 * nueva con `role` se cuele entre `invitations:stripRolesForRollback` y el
 * deploy del schema anterior. Quitar sigue funcionando (no escribe `role`).
 */
export function invitationRolesFrozen(): boolean {
  return process.env.INVITATION_ROLES_FROZEN === "1";
}

export async function isCalendarAdminActor(
  ctx: QueryCtx | MutationCtx,
  actorUserId: Id<"users">,
  calendarId: Id<"calendars">
): Promise<boolean> {
  const actor = await ctx.db.get(actorUserId);
  if (!actor) return false;
  if (actor.isSuperAdmin) return true;
  const membership = await ctx.db
    .query("calendarMemberships")
    .withIndex("by_calendar_and_user", (q) => q.eq("calendarId", calendarId).eq("userId", actorUserId))
    .unique();
  return membership?.role === "ADMIN";
}

/** Admins efectivos (memberships ADMIN) del calendario. */
export async function countCalendarAdmins(ctx: QueryCtx | MutationCtx, calendarId: Id<"calendars">): Promise<number> {
  const memberships = await ctx.db
    .query("calendarMemberships")
    .withIndex("by_calendar_and_user", (q) => q.eq("calendarId", calendarId))
    .collect();
  return memberships.filter((m) => m.role === "ADMIN").length;
}

async function findInvitation(
  ctx: QueryCtx | MutationCtx,
  calendarId: Id<"calendars">,
  email: string
): Promise<Doc<"invitations"> | null> {
  return await ctx.db
    .query("invitations")
    .withIndex("by_calendar_and_email", (q) => q.eq("calendarId", calendarId).eq("email", email))
    .unique();
}

async function findMembershipByEmail(
  ctx: QueryCtx | MutationCtx,
  calendarId: Id<"calendars">,
  email: string
): Promise<Doc<"calendarMemberships"> | null> {
  const user = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  if (!user) return null;
  return await ctx.db
    .query("calendarMemberships")
    .withIndex("by_calendar_and_user", (q) => q.eq("calendarId", calendarId).eq("userId", user._id))
    .unique();
}

export type CalendarPerson = {
  email: string;
  role: CalendarRole;
  // true = solo hay invitación, todavía no ha entrado ("· pendiente").
  pending: boolean;
  // `_creationTime` de la invitación; si no la hay (creador del calendario,
  // Admin nombrado desde /superadmin), el de la membership.
  invitedAt: number;
  isSelf: boolean;
  // Membership ADMIN y es la única del calendario: la UI deshabilita su
  // desplegable y su "Quitar" (el servidor lo rechaza igualmente).
  isLastAdmin: boolean;
};

async function listCalendarPeopleHandler(
  ctx: QueryCtx,
  args: { actorUserId: Id<"users">; calendarId: Id<"calendars"> }
): Promise<CalendarPerson[]> {
  if (!(await isCalendarAdminActor(ctx, args.actorUserId, args.calendarId))) throw new Error("No autorizado.");
  const actor = await ctx.db.get(args.actorUserId);
  const actorEmail = actor?.email.toLowerCase();

  const [memberships, invitations] = await Promise.all([
    ctx.db
      .query("calendarMemberships")
      .withIndex("by_calendar_and_user", (q) => q.eq("calendarId", args.calendarId))
      .collect(),
    ctx.db
      .query("invitations")
      .withIndex("by_calendar_and_email", (q) => q.eq("calendarId", args.calendarId))
      .collect(),
  ]);
  const invitationByEmail = new Map(invitations.map((i) => [i.email.toLowerCase(), i]));
  const adminCount = memberships.filter((m) => m.role === "ADMIN").length;

  const byEmail = new Map<string, CalendarPerson>();
  for (const membership of memberships) {
    const user = await ctx.db.get(membership.userId);
    if (!user) continue; // referencia rota — defensivo
    const email = user.email.toLowerCase();
    const previous = byEmail.get(email);
    // `by_calendar_and_user` no es único en Convex: si hubiera dos, ADMIN gana.
    if (previous && previous.role === "ADMIN") continue;
    byEmail.set(email, {
      email: user.email,
      role: membership.role,
      pending: false,
      invitedAt: invitationByEmail.get(email)?._creationTime ?? membership._creationTime,
      isSelf: email === actorEmail,
      isLastAdmin: membership.role === "ADMIN" && adminCount === 1,
    });
  }
  for (const invitation of invitations) {
    const email = invitation.email.toLowerCase();
    if (byEmail.has(email)) continue;
    byEmail.set(email, {
      email: invitation.email,
      role: invitation.role ?? "GUEST",
      pending: true,
      invitedAt: invitation._creationTime,
      isSelf: email === actorEmail,
      isLastAdmin: false,
    });
  }

  const rank = (p: CalendarPerson) => (p.isSelf ? 0 : p.role === "ADMIN" ? 1 : 2);
  return [...byEmail.values()].sort((a, b) => rank(a) - rank(b) || a.email.localeCompare(b.email));
}

export type InviteToCalendarResult =
  | { ok: true }
  | { ok: false; error: "invalid-email" | "not-authorized" | "frozen" };

/**
 * Invitar con rol. Sin invitación → se crea con `role`. Invitación pendiente
 * → se le cambia el rol. Si la persona ya ENTRÓ (tiene membership), no se
 * toca su rol: eso va por `setPersonRole`, que es quien aplica la
 * protección del último Admin — así "invitar como Visitante" no puede
 * usarse de atajo para degradar al último Admin.
 */
async function inviteToCalendarHandler(
  ctx: MutationCtx,
  args: { actorUserId: Id<"users">; calendarId: Id<"calendars">; email: string; role: CalendarRole }
): Promise<InviteToCalendarResult> {
  if (!(await isCalendarAdminActor(ctx, args.actorUserId, args.calendarId))) {
    return { ok: false, error: "not-authorized" };
  }
  if (invitationRolesFrozen()) return { ok: false, error: "frozen" };

  const email = args.email.trim().toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) return { ok: false, error: "invalid-email" };

  const membership = await findMembershipByEmail(ctx, args.calendarId, email);
  if (membership) return { ok: true };

  const invitation = await findInvitation(ctx, args.calendarId, email);
  if (invitation) {
    if ((invitation.role ?? "GUEST") !== args.role) await ctx.db.patch(invitation._id, { role: args.role });
  } else {
    await ctx.db.insert("invitations", { calendarId: args.calendarId, email, role: args.role });
  }
  return { ok: true };
}

export type SetPersonRoleResult =
  | { ok: true }
  | { ok: false; error: "not-authorized" | "not-found" | "last-admin" | "frozen" };

async function setPersonRoleHandler(
  ctx: MutationCtx,
  args: { actorUserId: Id<"users">; calendarId: Id<"calendars">; email: string; role: CalendarRole }
): Promise<SetPersonRoleResult> {
  if (!(await isCalendarAdminActor(ctx, args.actorUserId, args.calendarId))) {
    return { ok: false, error: "not-authorized" };
  }
  if (invitationRolesFrozen()) return { ok: false, error: "frozen" };

  const email = args.email.trim().toLowerCase();
  const [membership, invitation] = await Promise.all([
    findMembershipByEmail(ctx, args.calendarId, email),
    findInvitation(ctx, args.calendarId, email),
  ]);

  if (membership) {
    if (membership.role === args.role) return { ok: true };
    if (membership.role === "ADMIN" && (await countCalendarAdmins(ctx, args.calendarId)) <= 1) {
      return { ok: false, error: "last-admin" };
    }
    await ctx.db.patch(membership._id, { role: args.role });
    // Mantiene coherente el rol de la invitación, si queda alguna.
    if (invitation && (invitation.role ?? "GUEST") !== args.role) await ctx.db.patch(invitation._id, { role: args.role });
    return { ok: true };
  }

  if (invitation) {
    if ((invitation.role ?? "GUEST") !== args.role) await ctx.db.patch(invitation._id, { role: args.role });
    return { ok: true };
  }
  return { ok: false, error: "not-found" };
}

export type RemovePersonResult = { ok: true } | { ok: false; error: "not-authorized" | "last-admin" };

/**
 * "Quitar" — borra invitación y membership de CUALQUIER rol en este
 * calendario (a diferencia de `guests.ts::removeGuestFromCalendar`, que
 * solo toca Visitantes). Las dos filas, por el mismo motivo que TAL-7/16:
 * si quedara la invitación, volvería a dar acceso sola en el siguiente
 * login. El último Admin no se puede quitar.
 */
async function removePersonFromCalendarHandler(
  ctx: MutationCtx,
  args: { actorUserId: Id<"users">; calendarId: Id<"calendars">; email: string }
): Promise<RemovePersonResult> {
  if (!(await isCalendarAdminActor(ctx, args.actorUserId, args.calendarId))) {
    return { ok: false, error: "not-authorized" };
  }

  const email = args.email.trim().toLowerCase();
  const [membership, invitation] = await Promise.all([
    findMembershipByEmail(ctx, args.calendarId, email),
    findInvitation(ctx, args.calendarId, email),
  ]);

  if (membership?.role === "ADMIN" && (await countCalendarAdmins(ctx, args.calendarId)) <= 1) {
    return { ok: false, error: "last-admin" };
  }
  if (membership) await ctx.db.delete(membership._id);
  if (invitation) await ctx.db.delete(invitation._id);
  return { ok: true };
}

// --- Frontera pública (TAL-11) — ver convex/serverAuth.ts ---
const calendarRole = v.union(v.literal("ADMIN"), v.literal("GUEST"));

export const listCalendarPeoplePublic = query({
  args: { serverSecret: v.string(), actorUserId: v.id("users"), calendarId: v.id("calendars") },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await listCalendarPeopleHandler(ctx, { actorUserId: args.actorUserId, calendarId: args.calendarId });
  },
});

export const inviteToCalendarPublic = mutation({
  args: {
    serverSecret: v.string(),
    actorUserId: v.id("users"),
    calendarId: v.id("calendars"),
    email: v.string(),
    role: calendarRole,
  },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await inviteToCalendarHandler(ctx, {
      actorUserId: args.actorUserId,
      calendarId: args.calendarId,
      email: args.email,
      role: args.role,
    });
  },
});

export const setPersonRolePublic = mutation({
  args: {
    serverSecret: v.string(),
    actorUserId: v.id("users"),
    calendarId: v.id("calendars"),
    email: v.string(),
    role: calendarRole,
  },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await setPersonRoleHandler(ctx, {
      actorUserId: args.actorUserId,
      calendarId: args.calendarId,
      email: args.email,
      role: args.role,
    });
  },
});

export const removePersonFromCalendarPublic = mutation({
  args: { serverSecret: v.string(), actorUserId: v.id("users"), calendarId: v.id("calendars"), email: v.string() },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await removePersonFromCalendarHandler(ctx, {
      actorUserId: args.actorUserId,
      calendarId: args.calendarId,
      email: args.email,
    });
  },
});
