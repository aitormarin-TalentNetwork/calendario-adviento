"use server";

import { todayInTimeZone } from "@/lib/calendars";
import { markDayViewed } from "@/lib/guest-calendar";
import { getAuthorizedUser } from "@/lib/current-user";
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
  return markDayViewed(calendarId, dayId, user.id, today);
}
