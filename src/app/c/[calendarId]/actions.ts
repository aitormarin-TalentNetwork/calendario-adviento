"use server";

import { todayInTimeZone } from "@/lib/calendars";
import { markDayViewed, resolveDoors, type DoorGridResult } from "@/lib/guest-calendar";
import { getAuthorizedUser } from "@/lib/current-user";
import { resolveCalendarAccess } from "@/lib/roles";

/**
 * `timeZone` la manda `door-grid.tsx` con
 * `Intl.DateTimeFormat().resolvedOptions().timeZone`, leída en el propio
 * momento del clic — no depende de que la cookie `tz` (TimezoneSync) ya
 * haya llegado al servidor. Es un dato de cliente sin validar: pasa por
 * `todayInTimeZone`/`safeTimeZone`, que cae a UTC ante cualquier valor que
 * no sea una zona horaria IANA real en vez de romper la petición.
 *
 * TAL-14 — hallazgo de auditoría de las rondas anteriores de esta serie
 * (TAL-12/TAL-16): esta action YA NO llama a `resolveCalendarAccess` por
 * su cuenta antes de marcar como visto. Antes lo hacía (comprobar acceso
 * aquí, marcar visto en una llamada Convex aparte) — exactamente el
 * patrón que abrió la ventana de carrera de TAL-12: dos peticiones
 * solapadas podían las dos pasar la comprobación y la segunda actuar
 * sobre un estado ya obsoleto. `markDayViewed`
 * (`src/lib/guest-calendar.ts` → `convex/dayViews.ts::markDayViewedAsUserHandler`)
 * resuelve autorización + validez del día + escritura en UNA sola
 * mutation de Convex — la identidad (`user.id`) sigue resolviéndose aquí
 * (dato, no una conclusión de privilegio), la decisión de "¿tiene acceso?"
 * vive enteramente dentro de esa mutation.
 */
export async function markDayViewedAction(calendarId: string, dayId: string, timeZone: string) {
  const user = await getAuthorizedUser();
  if (!user) return { ok: false as const, error: "not-found" as const };

  const today = todayInTimeZone(new Date(), timeZone);
  return await markDayViewed(calendarId, dayId, user.id, today);
}

export type GetDoorsResult = DoorGridResult | { ok: false; reason: "unauthorized" | "network-error" };

/**
 * Resuelve las puertas en la zona horaria real del cliente — la usa
 * `DoorGridLoader` (door-grid.tsx) en la primerísima visita, cuando
 * `page.tsx` todavía no tiene la cookie `tz` y por eso no resuelve nada de
 * puertas en el servidor (hallazgo de auditoría, ronda 2: resolverlas ahí
 * con un valor por defecto podía filtrar en la respuesta inicial el
 * vídeo/mensaje de un día que en la zona horaria real de quien mira
 * todavía es futuro — el refresco posterior de `TimezoneSync` no revoca lo
 * que ya se mandó).
 *
 * Esta sí comprueba `resolveCalendarAccess` por separado antes de leer —
 * es una LECTURA, no tiene la ventana de carrera de una escritura (releer
 * un instante después de comprobar acceso no permite a nadie actuar sobre
 * nada ni escalar privilegio), mismo criterio ya confirmado por el
 * auditor para las lecturas de TAL-12 (`calendars.getPublic`).
 */
export async function getDoorsAction(calendarId: string, timeZone: string): Promise<GetDoorsResult> {
  const user = await getAuthorizedUser();
  if (!user) return { ok: false, reason: "unauthorized" };

  const access = await resolveCalendarAccess(user, calendarId);
  if (!access) return { ok: false, reason: "unauthorized" };

  const today = todayInTimeZone(new Date(), timeZone);
  return resolveDoors(calendarId, user.id, today);
}
