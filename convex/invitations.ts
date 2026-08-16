import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
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
