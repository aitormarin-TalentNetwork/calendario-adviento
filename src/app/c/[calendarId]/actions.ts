"use server";

import { markDayViewed } from "@/lib/guest-calendar";
import { getAuthorizedUser } from "@/lib/current-user";
import { resolveCalendarAccess } from "@/lib/roles";

export async function markDayViewedAction(calendarId: string, dayId: string) {
  const user = await getAuthorizedUser();
  if (!user) return { ok: false as const, error: "not-found" as const };

  // Mismo criterio de acceso que la propia página del calendario del
  // Invitado (Guest o Admin con membership, o Super Admin) — una server
  // action es un endpoint invocable directamente, no solo lo que ya
  // renderizó la página.
  const access = await resolveCalendarAccess(user, calendarId);
  if (!access) return { ok: false as const, error: "not-found" as const };

  return markDayViewed(calendarId, dayId, user.id, new Date());
}
