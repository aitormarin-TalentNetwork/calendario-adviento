import { Prisma } from "@/generated/prisma/client";
import { withSerializableRetry } from "@/lib/db-retry";
import { prisma } from "@/lib/prisma";

// Mismo patrón que TAL-4 (src/lib/superadmin.ts): local-part + "@" + dominio
// con al menos un punto, sin espacios. Duplicado a propósito en vez de
// importado de superadmin.ts — son módulos de features distintas
// desarrolladas en paralelo, no vale la pena acoplarlas por seis
// caracteres de regex.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type CalendarGuest = {
  email: string;
  // true = ya existe CalendarMembership GUEST (entró con Gmail y se le
  // resolvió el acceso, ver src/lib/roles.ts). false = solo hay
  // Invitation todavía, no ha entrado.
  accepted: boolean;
};

/**
 * Invitados de un calendario: unión de Invitation (por email) y
 * CalendarMembership GUEST (por User, vía email) — no son la misma tabla
 * porque Invitation no referencia a User (ver docs/modelo-de-datos.md, TAL-3:
 * la invitación se resuelve sola al primer login). Se excluyen los emails
 * que ya son ADMIN de este calendario (una Invitation puede seguir existiendo
 * de antes de que se les diera Admin — ver src/lib/superadmin.ts,
 * removeAdminEverywhere — pero ya no tiene sentido mostrarlos como
 * "invitado pendiente").
 */
export async function listCalendarGuests(calendarId: string): Promise<CalendarGuest[]> {
  const [invitations, memberships] = await Promise.all([
    prisma.invitation.findMany({ where: { calendarId } }),
    prisma.calendarMembership.findMany({
      where: { calendarId },
      include: { user: { select: { email: true } } },
    }),
  ]);

  const adminEmails = new Set(
    memberships.filter((m) => m.role === "ADMIN").map((m) => m.user.email.toLowerCase())
  );

  const byEmail = new Map<string, CalendarGuest>();
  for (const invitation of invitations) {
    const key = invitation.email.toLowerCase();
    if (adminEmails.has(key)) continue;
    byEmail.set(key, { email: invitation.email, accepted: false });
  }
  for (const membership of memberships) {
    if (membership.role !== "GUEST") continue;
    const key = membership.user.email.toLowerCase();
    byEmail.set(key, { email: membership.user.email, accepted: true });
  }

  return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
}

export type InviteGuestResult =
  | { ok: true }
  | { ok: false; error: "invalid-email" | "calendar-not-found" };

/**
 * Invita a alguien a un calendario por email (crea la Invitation). No hace
 * falta que exista ya un User — se resuelve solo la primera vez que esa
 * persona entra con Gmail (src/lib/roles.ts). Idempotente: invitar dos
 * veces al mismo email al mismo calendario no es un error, es un no-op
 * (`@@unique([calendarId, email])` en el schema).
 */
export async function inviteGuest(calendarId: string, rawEmail: string): Promise<InviteGuestResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) return { ok: false, error: "invalid-email" };

  const calendar = await prisma.calendar.findUnique({ where: { id: calendarId } });
  if (!calendar) return { ok: false, error: "calendar-not-found" };

  await prisma.invitation.upsert({
    where: { calendarId_email: { calendarId, email } },
    update: {},
    create: { calendarId, email },
  });

  return { ok: true };
}

/**
 * ¿Es este email invitado (o ya invitado-aceptado, es decir GUEST) de este
 * calendario concreto? Usado para acotar "borrar por completo" a alguien
 * que de verdad tiene relación con el calendario desde el que se dispara
 * la acción — ver removeGuestEverywhere y el comentario en
 * src/app/admin/[calendarId]/guests-actions.ts (hallazgo de auditoría,
 * ronda 1).
 */
export async function isCalendarGuest(calendarId: string, rawEmail: string): Promise<boolean> {
  const email = rawEmail.trim().toLowerCase();
  const [invitation, membership] = await Promise.all([
    prisma.invitation.findUnique({ where: { calendarId_email: { calendarId, email } } }),
    prisma.calendarMembership.findFirst({
      where: { calendarId, role: "GUEST", user: { email } },
    }),
  ]);
  return Boolean(invitation || membership);
}

/**
 * "Quitar del calendario" (mockup): borra la Invitation Y la
 * CalendarMembership GUEST de ese email en ESE calendario concreto —
 * las dos, no solo una. Si solo se borrara la membership, la Invitation
 * que queda volvería a resolverse sola la próxima vez que esa persona
 * visite /c/<calendarId> (ver resolveCalendarAccess) y la "expulsión"
 * quedaría deshecha sin que nadie lo pidiera. `role: "GUEST"` en el
 * `deleteMany` es defensa en profundidad: aunque se llamara por error con
 * el email de un Admin, nunca borra una membership ADMIN.
 *
 * SERIALIZABLE + reintento (hallazgo de auditoría, ronda 1): sin esto, este
 * borrado y una aceptación de invitación concurrente (resolveCalendarAccess,
 * src/lib/roles.ts) podían entrelazarse bajo el aislamiento por defecto de
 * forma que la persona expulsada conservara el acceso — ver
 * src/lib/db-retry.ts.
 */
export async function removeGuestFromCalendar(calendarId: string, rawEmail: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await tx.invitation.deleteMany({ where: { calendarId, email } });
        const user = await tx.user.findUnique({ where: { email } });
        if (user) {
          await tx.calendarMembership.deleteMany({
            where: { calendarId, userId: user.id, role: "GUEST" },
          });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
}

/**
 * "Borrar por completo" (mockup): a diferencia de quitar-de-un-calendario,
 * esto es explícitamente global por diseño (brief de TAL-7 lo pide así) —
 * borra todas las Invitation de ese email (en cualquier calendario) y
 * todas sus CalendarMembership GUEST (en cualquier calendario), aunque el
 * Admin que dispara la acción solo administre el calendario desde cuya
 * tabla se llamó. No toca membership ADMIN en ningún calendario (esto es
 * gestión de invitados, no de Admins — eso es TAL-4) ni borra el User en
 * sí (identidad de la persona, no algo de lo que esta pantalla deba
 * disponer).
 *
 * Quién puede llamar a esto con qué `email` se acota en la server action
 * (isCalendarGuest, arriba) — esta función en sí no vuelve a comprobarlo,
 * confía en su llamador (mismo patrón que el resto de src/lib/*.ts, que no
 * repiten la autorización de src/app/**\/actions.ts).
 *
 * SERIALIZABLE + reintento, mismo motivo que removeGuestFromCalendar.
 */
export async function removeGuestEverywhere(rawEmail: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  await withSerializableRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await tx.invitation.deleteMany({ where: { email } });
        const user = await tx.user.findUnique({ where: { email } });
        if (user) {
          await tx.calendarMembership.deleteMany({ where: { userId: user.id, role: "GUEST" } });
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  );
}
