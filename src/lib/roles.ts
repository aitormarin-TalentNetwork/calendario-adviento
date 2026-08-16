import { Prisma, type CalendarRole } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export type CalendarAccess =
  | { kind: "super-admin" }
  | { kind: "member"; role: CalendarRole };

/**
 * Resuelve el acceso de un usuario autenticado a un calendario concreto:
 * - Super Admin: acceso global, sin necesidad de membership.
 * - Si ya hay CalendarMembership (ADMIN o GUEST), esa es la fuente de verdad.
 * - Si no la hay pero existe una Invitation para su email en ese calendario,
 *   se resuelve aquí mismo: se crea la CalendarMembership como GUEST (ver
 *   docs/modelo-de-datos.md — así es como se "acepta" una invitación).
 * - Si no hay membership ni invitación, no tiene acceso (null).
 */
export async function resolveCalendarAccess(
  user: { id: string; email: string; isSuperAdmin: boolean },
  calendarId: string
): Promise<CalendarAccess | null> {
  if (user.isSuperAdmin) return { kind: "super-admin" };

  const membership = await prisma.calendarMembership.findUnique({
    where: { calendarId_userId: { calendarId, userId: user.id } },
  });
  if (membership) return { kind: "member", role: membership.role };

  // Comparación insensible a mayúsculas: el email de sesión ya se guarda en
  // minúsculas (ver auth.ts), pero una Invitation puede haberse creado con
  // otra capitalización (p. ej. "Persona@Gmail.com"). `findFirst` +
  // `mode: "insensitive"` no depende de que la columna sea citext a nivel de
  // BD — defensa a nivel de aplicación (hallazgo de auditoría, ronda 1).
  const invitation = await prisma.invitation.findFirst({
    where: { calendarId, email: { equals: user.email, mode: "insensitive" } },
  });
  if (!invitation) return null;

  // Idempotente ante condiciones de carrera (doble pestaña, doble clic): si
  // dos peticiones concurrentes intentan aceptar la misma invitación, la
  // segunda no debe chocar con el índice único `(calendarId, userId)`
  // (hallazgo de auditoría, ronda 1). El `upsert` de Prisma NO es atómico a
  // nivel de BD para este conector (comprobado con peticiones paralelas
  // reales: el "find-or-create" interno de dos upserts simultáneos puede
  // hacer que ambos intenten el create y uno de los dos reciba P2002) — así
  // que además de intentarlo con upsert (`update: {}` preserva cualquier
  // rol ya existente, nunca degrada un ADMIN a GUEST), se atrapa ese error
  // concreto: si salta, quien "perdió la carrera" solo tiene que releer la
  // fila que ganó, no es un fallo real.
  let membershipRow;
  try {
    membershipRow = await prisma.calendarMembership.upsert({
      where: { calendarId_userId: { calendarId, userId: user.id } },
      update: {},
      create: { calendarId, userId: user.id, role: "GUEST" },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      membershipRow = await prisma.calendarMembership.findUniqueOrThrow({
        where: { calendarId_userId: { calendarId, userId: user.id } },
      });
    } else {
      throw err;
    }
  }
  return { kind: "member", role: membershipRow.role };
}
