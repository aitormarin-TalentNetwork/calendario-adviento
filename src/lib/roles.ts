import { fetchMutation } from "convex/nextjs";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { convexAppServerSecret } from "@/lib/convex-server";

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
 * Resuelve el acceso de un usuario autenticado a un calendario concreto:
 * - Super Admin: acceso global, sin necesidad de membership — resuelto
 *   enteramente en Next.js (`user.isSuperAdmin` ya viene fresco de
 *   `getAuthorizedUser`), nunca toca Convex para esta rama, igual que
 *   nunca tocó Prisma.
 * - Si no, delega en `access.resolveMemberAccessPublic` (`convex/access.ts`)
 *   — la parte que en Prisma consultaba/creaba `CalendarMembership`/
 *   `Invitation` dentro de una transacción `SERIALIZABLE` con reintento
 *   (hallazgo de auditoría, TAL-7 ronda 1 — ver `docs/invitados.md`).
 *
 * TAL-11 — traducida a Convex con el secreto compartido
 * (`docs/convex-auth-investigacion-tal11.md` § "Recomendación cerrada").
 * Deliberadamente UNA sola llamada (`fetchMutation`, no varias
 * `fetchQuery` sueltas combinadas aquí): la propia documentación de Convex
 * avisa que `fetchQuery`/`preloadQuery` no da consistencia entre llamadas
 * separadas (Gotcha 3 de la investigación) — repartir "leer membership,
 * leer invitación, crear si falta" en varias llamadas desde este fichero
 * reabriría la misma carrera expulsión-vs-aceptación que costó dos rondas
 * de auditoría en TAL-7. Toda esa lógica vive en una única mutation de
 * Convex, que ya corre con aislamiento serializable y reintento
 * automático (mismo mecanismo verificado con concurrencia real en TAL-9).
 *
 * Esta función NO es una lectura de negocio (hallazgo de auditoría, TAL-10
 * ronda 1: `listCalendarGuests` y similares SÍ mentían con `[]`, y ahora
 * lanzan `DataLayerUnavailableError` — siguen sin reconectar, eso es
 * TAL-12+). Es una comprobación de autorización: sigue fallando cerrado
 * ante CUALQUIER error (Convex no configurado, red caída, secreto no
 * coincide, calendarId con forma inválida) — `null` ("sin acceso") es la
 * postura de seguridad correcta, no un dato inventado (mismo criterio ya
 * confirmado por el auditor en TAL-10 rondas 1-2, ver
 * `src/lib/current-user.ts`).
 *
 * Solo se manda `userId` a Convex, nunca `user.email` como argumento aparte
 * (hallazgo de auditoría, ronda 1 — `resolveMemberAccessPublic` deriva el
 * email dentro de la propia mutation a partir del usuario cargado por
 * `userId`, ver `convex/access.ts`; aceptar aquí un email independiente
 * habría abierto la puerta a que el contrato de la función permitiera un
 * segundo canal de identidad, el mismo error que TAL-2 ya corrigió una vez
 * para `getAuthorizedUser`).
 */
export async function resolveCalendarAccess(
  user: { id: string; email: string; isSuperAdmin: boolean },
  calendarId: string
): Promise<CalendarAccess | null> {
  if (user.isSuperAdmin) return { kind: "super-admin" };

  try {
    const result = await fetchMutation(api.access.resolveMemberAccessPublic, {
      serverSecret: convexAppServerSecret(),
      calendarId: calendarId as Id<"calendars">,
      userId: user.id as Id<"users">,
    });
    if (!result) return null;
    return { kind: "member", role: result.role };
  } catch {
    return null;
  }
}
