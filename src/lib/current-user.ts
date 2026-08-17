import { fetchQuery } from "convex/nextjs";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { auth } from "@/lib/auth";
import { convexAppServerSecret } from "@/lib/convex-server";

export type AuthorizedUser = { id: string; email: string; isSuperAdmin: boolean; image: string | null };

/**
 * Usuario autenticado, con `isSuperAdmin` leído siempre en fresco de la base
 * de datos — nunca del JWT/sesión (hallazgo de auditoría, TAL-2 ronda 1:
 * usar el JWT como fuente de privilegios significa que revocar/conceder
 * Super Admin no surtiría efecto hasta que expire o se recree la sesión).
 * Búsqueda por `session.user.id`, nunca por email (hallazgo TAL-2 ronda 2 —
 * ver `src/lib/auth.ts`: `token.userId` es el id inmutable de Convex, no el
 * email).
 *
 * TAL-11 — vuelve a consultar datos reales: `session.user.id` se resuelve
 * contra Convex vía la función pública delgada `users.getByIdPublic`
 * (`convex/users.ts`, `convex/serverAuth.ts`), con el mismo secreto
 * compartido que usa el resto de esta frontera (decisión cerrada en
 * `docs/convex-auth-investigacion-tal11.md`).
 *
 * Esta función NO es una lectura de negocio como `listAdminCalendars`/
 * `listCalendarGuests` (esas sí mentían con `[]`/`ok:true` — hallazgo de
 * auditoría, TAL-10 ronda 1 — y ahora lanzan `DataLayerUnavailableError` en
 * vez de fingir; siguen sin reconectar, eso es TAL-12+, no esta tarea). Es
 * la comprobación de autorización que gatea el acceso a TODA la app: se
 * mantiene fallando cerrado ante CUALQUIER error (Convex no configurado,
 * red caída, secreto no coincide, id con forma inválida) — `null` ("nadie
 * está autorizado") es la postura de seguridad correcta ante la
 * incertidumbre, no un dato inventado sobre qué existe en el mundo (ningún
 * sistema de autenticación real concede acceso cuando no puede verificar
 * quién eres). Es además la única opción que no rompe la app entera —
 * lanzar aquí reventaría cada página protegida en cada visita, sin ninguna
 * forma de "no disponible" razonable para un guard que se invoca en cada
 * render (mismo criterio ya confirmado por el auditor en TAL-10 rondas
 * 1-2).
 */
export async function getAuthorizedUser(): Promise<AuthorizedUser | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  try {
    const user = await fetchQuery(api.users.getByIdPublic, {
      serverSecret: convexAppServerSecret(),
      userId: session.user.id as Id<"users">,
    });
    if (!user) return null;
    return { id: user._id, email: user.email, isSuperAdmin: user.isSuperAdmin, image: user.image ?? null };
  } catch {
    return null;
  }
}
