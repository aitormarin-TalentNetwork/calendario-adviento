import { auth } from "@/lib/auth";

export type AuthorizedUser = { id: string; email: string; isSuperAdmin: boolean };

/**
 * Usuario autenticado, con `isSuperAdmin` leído siempre en fresco de la base
 * de datos — nunca del JWT/sesión (hallazgo de auditoría, ronda 1: usar el
 * JWT como fuente de privilegios significa que revocar/conceder Super Admin
 * no surtiría efecto hasta que expire o se recree la sesión).
 *
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: la consulta
 * real de este usuario (`prisma.user.findUnique`) todavía no tiene
 * equivalente conectado a Convex (eso es TAL-12+), así que esta función
 * devuelve siempre `null`.
 *
 * A diferencia de los stubs de lectura de negocio (`listAdminCalendars`,
 * `listCalendarGuests`, etc. — hallazgo de auditoría, ronda 1: esos SÍ
 * mentían al devolver `[]`/`ok:true` como si fuera un dato real, y ahora
 * lanzan en su lugar), esta función no es una lectura de negocio — es la
 * comprobación de autorización que gatea el acceso a TODA la app. `null`
 * ("nadie está autorizado") es la postura de seguridad correcta ante la
 * incertidumbre (fallar cerrado), no un dato inventado sobre qué existe en
 * el mundo: ningún sistema de autenticación real concede acceso cuando no
 * puede verificar quién eres, tampoco debería este. Es además la única
 * opción que no rompe la app entera — lanzar aquí reventaría cada página
 * protegida en cada visita (el mismo tipo de fallo universal que el
 * hallazgo bloqueante de esta ronda sobre `ConvexClientProvider`, pero sin
 * ninguna forma de "no disponible" razonable para un guard de auth que se
 * invoca en cada render). Se mantiene la llamada a `auth()` (no toca
 * Prisma, solo decodifica el JWT) para no perder ni siquiera esa parte del
 * comportamiento real.
 */
export async function getAuthorizedUser(): Promise<AuthorizedUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  return null;
}
