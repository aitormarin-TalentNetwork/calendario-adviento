import { Prisma, type CalendarRole } from "@/generated/prisma/client";
import { withSerializableRetry } from "@/lib/db-retry";
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
 *
 * Todo el bloque no-Super-Admin corre en una transacción SERIALIZABLE con
 * reintento (hallazgo de auditoría, TAL-7 ronda 1): sin esto, "aceptar
 * invitación" aquí y "quitar invitado" (src/lib/guests.ts) podían
 * entrelazarse bajo el aislamiento por defecto de Postgres de forma que la
 * persona expulsada se quedara con acceso — SERIALIZABLE hace que Postgres
 * aborte una de las dos transacciones en conflicto en vez de dejarlas
 * entrelazarse; `withSerializableRetry` la repite.
 */
export async function resolveCalendarAccess(
  user: { id: string; email: string; isSuperAdmin: boolean },
  calendarId: string
): Promise<CalendarAccess | null> {
  if (user.isSuperAdmin) return { kind: "super-admin" };

  return withSerializableRetry(
    () =>
      prisma.$transaction(
        async (tx) => {
          const membership = await tx.calendarMembership.findUnique({
            where: { calendarId_userId: { calendarId, userId: user.id } },
          });
          if (membership) return { kind: "member" as const, role: membership.role };

          // Comparación insensible a mayúsculas: el email de sesión ya se
          // guarda en minúsculas (ver auth.ts), pero una Invitation puede
          // haberse creado con otra capitalización (p. ej.
          // "Persona@Gmail.com"). `findFirst` + `mode: "insensitive"` no
          // depende de que la columna sea citext a nivel de BD — defensa a
          // nivel de aplicación (hallazgo de auditoría, ronda 1).
          const invitation = await tx.invitation.findFirst({
            where: { calendarId, email: { equals: user.email, mode: "insensitive" } },
          });
          if (!invitation) return null;

          // Si esto choca con el índice único (P2002), es porque otra
          // transacción concurrente ganó la carrera y ya creó la
          // membership entre nuestro SELECT de arriba y este INSERT — NO
          // se puede "recuperar" releyendo aquí mismo: una violación de
          // unicidad aborta el resto de ESTA transacción de Postgres,
          // cualquier consulta posterior en ella fallaría con "current
          // transaction is aborted" (hallazgo de auditoría, TAL-7 ronda 2
          // — la ronda 1 intentaba precisamente esa relectura fallida
          // dentro del mismo `tx`). Se deja propagar el error tal cual:
          // `withSerializableRetry` lo trata igual que un conflicto de
          // serialización (ver `alsoRetryOn` más abajo) y reintenta la
          // transacción ENTERA desde cero — en el reintento, el `findUnique`
          // de arriba ya encuentra la fila que ganó la carrera y sale por
          // la vía normal, sin necesitar ningún caso especial aquí.
          const created = await tx.calendarMembership.create({
            data: { calendarId, userId: user.id, role: "GUEST" },
          });
          return { kind: "member" as const, role: created.role };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      ),
    {
      alsoRetryOn: (err) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002",
    }
  );
}
