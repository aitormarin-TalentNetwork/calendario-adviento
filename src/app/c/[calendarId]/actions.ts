"use server";

import { todayInTimeZone } from "@/lib/calendars";
import { markDayViewed, resolveDoors, type DoorGridResult } from "@/lib/guest-calendar";
import { getAuthorizedUser } from "@/lib/current-user";
import { DataLayerUnavailableError } from "@/lib/not-migrated";
import { resolveCalendarAccess } from "@/lib/roles";

/**
 * `timeZone` la manda `door-grid.tsx` con
 * `Intl.DateTimeFormat().resolvedOptions().timeZone`, leída en el propio
 * momento del clic — no depende de que la cookie `tz` (TimezoneSync) ya
 * haya llegado al servidor. Es un dato de cliente sin validar: pasa por
 * `todayInTimeZone`/`safeTimeZone`, que cae a UTC ante cualquier valor que
 * no sea una zona horaria IANA real en vez de romper la petición.
 */
export async function markDayViewedAction(calendarId: string, dayId: string, timeZone: string) {
  const user = await getAuthorizedUser();
  if (!user) return { ok: false as const, error: "not-found" as const };

  // Mismo criterio de acceso que la propia página del calendario del
  // Invitado (Guest o Admin con membership, o Super Admin) — una server
  // action es un endpoint invocable directamente, no solo lo que ya
  // renderizó la página.
  const access = await resolveCalendarAccess(user, calendarId);
  if (!access) return { ok: false as const, error: "not-found" as const };

  const today = todayInTimeZone(new Date(), timeZone);
  // TAL-10 — Prisma/Postgres se retiran de la infraestructura:
  // `markDayViewed` lanza `DataLayerUnavailableError`. Se atrapa aquí para
  // seguir devolviendo la forma tipada `MarkViewedResult` en vez de dejar
  // la promesa rechazada sin gestionar (`startTransition` en
  // `door-grid.tsx` se comía el rechazo en silencio y `setMarkError` nunca
  // se disparaba) — pero el motivo se mapea a `"unavailable"`, no a
  // `"not-found"` (hallazgo de auditoría, ronda 2: la capa de datos no
  // determinó que el día no exista, solo que no se pudo consultar —
  // devolver `"not-found"` aquí era exactamente la clasificación falsa que
  // esta tarea pretendía eliminar en el resto de la app, aunque hoy
  // `door-grid.tsx` solo mire `result.ok` y no el motivo concreto, un
  // consumidor futuro que sí lo lea no debe encontrarse un dato inventado).
  try {
    return await markDayViewed(calendarId, dayId, user.id, today);
  } catch (err) {
    if (!(err instanceof DataLayerUnavailableError)) throw err;
    return { ok: false as const, error: "unavailable" as const };
  }
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
 * que ya se mandó). Mismo criterio de acceso que `markDayViewedAction`.
 */
export async function getDoorsAction(calendarId: string, timeZone: string): Promise<GetDoorsResult> {
  const user = await getAuthorizedUser();
  if (!user) return { ok: false, reason: "unauthorized" };

  const access = await resolveCalendarAccess(user, calendarId);
  if (!access) return { ok: false, reason: "unauthorized" };

  const today = todayInTimeZone(new Date(), timeZone);
  return resolveDoors(calendarId, user.id, today);
}
