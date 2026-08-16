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
 * devuelve siempre `null` — "nadie está autorizado" es una degradación
 * segura y ya contemplada por el tipo de retorno existente (`| null`),
 * NO un dato inventado: cualquier página que compruebe `if (!user)
 * redirect(...)` sigue funcionando igual, solo que ahora nadie pasa el
 * filtro. Se mantiene la llamada a `auth()` (no toca Prisma, solo decodifica
 * el JWT) para no perder ni siquiera esa parte del comportamiento real.
 */
export async function getAuthorizedUser(): Promise<AuthorizedUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  return null;
}
