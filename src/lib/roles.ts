// Antes venía de `@/generated/prisma/client` — TAL-10 retira Prisma de la
// infraestructura, así que el tipo se declara localmente. Mismos dos
// valores que el `enum CalendarRole` de prisma/schema.prisma y el
// `v.union(v.literal("ADMIN"), v.literal("GUEST"))` del schema de Convex
// (TAL-9) — ninguno de los tres perdió ni ganó un valor, solo cambió dónde
// vive la declaración.
export type CalendarRole = "ADMIN" | "GUEST";

export type CalendarAccess =
  | { kind: "super-admin" }
  | { kind: "member"; role: CalendarRole };

/**
 * Resuelve el acceso de un usuario autenticado a un calendario concreto —
 * ver el resto de reglas (Super Admin, CalendarMembership, aceptación de
 * Invitation) en `docs/modelo-de-datos.md` y `docs/invitados.md`.
 *
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: la parte que
 * consultaba/creaba `CalendarMembership`/`Invitation` en una transacción
 * `SERIALIZABLE` (hallazgo de auditoría, TAL-7 ronda 1 — ver
 * `docs/invitados.md`) todavía no tiene equivalente conectado a Convex
 * (TAL-12+), así que esa rama devuelve `null`. Mismo criterio que
 * `getAuthorizedUser` (`src/lib/current-user.ts`, hallazgo de auditoría,
 * ronda 1 de esta tarea): esto NO es una lectura de negocio como
 * `listCalendarGuests` (que sí mentía con `[]`, y ahora lanza) — es una
 * comprobación de autorización, "sin acceso" es fallar cerrado ante la
 * incertidumbre, la postura de seguridad correcta, no un dato inventado.
 * El atajo de Super Admin, que nunca tocó Prisma (`user.isSuperAdmin` ya
 * viene resuelto por `getAuthorizedUser`), se mantiene sin cambios —
 * aunque en la práctica no se alcanza hoy, porque `getAuthorizedUser`
 * (TAL-10) devuelve siempre `null` también.
 */
export async function resolveCalendarAccess(
  user: { id: string; email: string; isSuperAdmin: boolean },
  calendarId: string
): Promise<CalendarAccess | null> {
  if (user.isSuperAdmin) return { kind: "super-admin" };

  void calendarId;
  return null;
}
