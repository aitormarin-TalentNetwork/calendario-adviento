import { internalMutation, internalQuery, mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireServerSecret } from "./serverAuth";

// Mismo patrón que TAL-4/TAL-7 (`src/lib/superadmin.ts`/`guests.ts` en la
// versión Prisma): local-part + "@" + dominio con al menos un punto, sin
// espacios.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Idempotente por (calendarId, email normalizado) — invitar dos veces al
// mismo email al mismo calendario es un no-op, mismo criterio que
// `inviteGuest` en Prisma (TAL-7, docs/invitados.md).
//
// TAL-16 — extendida con validación de formato de email (hallazgo de
// auditoría TAL-7: el `type="email"` del HTML es solo una ayuda de UI, no
// sustituye validar en servidor). La versión de TAL-9 comprobaba
// integridad referencial pero no formato — ver
// docs/convex-diseno-tal16-gestion-invitados.md para el porqué de extender
// esta función en vez de crear una paralela: es una adición de
// comprobación, no un cambio de comportamiento para quien ya la llama con
// un email bien formado.
//
// internalMutation, no mutation — ver docs/convex-modelo-de-datos.md §
// "Sin autenticación/autorización todavía".
async function inviteGuestHandler(
  ctx: MutationCtx,
  args: { calendarId: Id<"calendars">; email: string }
): Promise<Id<"invitations">> {
  const email = args.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new Error("Email inválido.");

  // Integridad referencial (hallazgo de auditoría, ronda 1) — ver
  // calendars.ts::createCalendar.
  const calendar = await ctx.db.get(args.calendarId);
  if (!calendar) throw new Error("El calendario indicado no existe.");

  const existing = await ctx.db
    .query("invitations")
    .withIndex("by_calendar_and_email", (q) => q.eq("calendarId", args.calendarId).eq("email", email))
    .unique();
  if (existing) return existing._id;
  return await ctx.db.insert("invitations", { calendarId: args.calendarId, email });
}

export const inviteGuest = internalMutation({
  args: { calendarId: v.id("calendars"), email: v.string() },
  handler: inviteGuestHandler,
});

// --- Frontera pública (TAL-11) — ver convex/serverAuth.ts ---
export const inviteGuestPublic = mutation({
  args: { serverSecret: v.string(), calendarId: v.id("calendars"), email: v.string() },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await inviteGuestHandler(ctx, { calendarId: args.calendarId, email: args.email });
  },
});

// --- TAL-65 — runbook de rollback (docs/invitados.md § "Runbook de rollback
// (TAL-65)"). Solo por la CLI (`npx convex run`), nunca desde la app: son
// `internal*`, sin frontera pública. El schema anterior a TAL-65 no acepta
// `invitations.role`, así que Convex rechazaría el deploy del código viejo
// mientras quede alguna fila con rol. Por lotes (`.paginate()`), para no
// acercarse a los límites de una transacción aunque la tabla crezca.

const rollbackPageArgs = {
  cursor: v.optional(v.union(v.string(), v.null())),
  batchSize: v.optional(v.number()),
};

/**
 * Quita `role` de un lote de invitaciones. Repetir con `continueCursor`
 * hasta `isDone: true`. Consecuencia aceptada: las invitaciones pendientes
 * como Admin pasan a Visitante (las memberships ADMIN ya aceptadas no se
 * tocan: `calendarMemberships.role` existe en los dos schemas). Antes,
 * congelar escrituras con `INVITATION_ROLES_FROZEN=1` (ver
 * `calendarPeople.ts::invitationRolesFrozen`).
 */
export const stripRolesForRollback = internalMutation({
  args: rollbackPageArgs,
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("invitations")
      .paginate({ cursor: args.cursor ?? null, numItems: args.batchSize ?? 200 });
    let stripped = 0;
    for (const invitation of page.page) {
      if (invitation.role === undefined) continue;
      await ctx.db.patch(invitation._id, { role: undefined });
      stripped += 1;
    }
    return { processed: page.page.length, stripped, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** Cuenta invitaciones que aún tienen `role`, por lotes (misma mecánica). */
export const countInvitationsWithRole = internalQuery({
  args: rollbackPageArgs,
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("invitations")
      .paginate({ cursor: args.cursor ?? null, numItems: args.batchSize ?? 1000 });
    const withRole = page.page.filter((invitation) => invitation.role !== undefined).length;
    return { processed: page.page.length, withRole, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});
