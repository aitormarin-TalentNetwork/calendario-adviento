"use server";

import { cookies } from "next/headers";
import { getAuthorizedUser } from "@/lib/current-user";
import { markWelcomeSeen } from "@/lib/welcome";

export type MarkWelcomeSeenResult = { ok: true } | { ok: false; error: "not-authorized" | "no-timezone" | "failed" };

/**
 * TAL-70 — la llama `welcome-overlay.tsx` SOLO cuando la foto ha cargado de
 * verdad (`onLoad`): un prefetch, un render sin pintar o una foto rota
 * nunca "gastan" la bienvenida del día. Recibe solo el calendario: la
 * persona sale de la sesión y la fecha se calcula aquí con la cookie `tz`.
 * Acceso, existencia del calendario y la inserción única se deciden dentro
 * de UNA mutation (`convex/welcomeViews.ts::markSeenPublic`), mismo
 * criterio que `markDayViewedAction` (actions.ts): aquí solo se resuelve la
 * identidad, nunca una conclusión de privilegio.
 */
export async function markWelcomeSeenAction(calendarId: string): Promise<MarkWelcomeSeenResult> {
  const user = await getAuthorizedUser();
  if (!user) return { ok: false, error: "not-authorized" };
  const tz = (await cookies()).get("tz")?.value;
  if (!tz) return { ok: false, error: "no-timezone" };
  try {
    const result = await markWelcomeSeen(user.id, calendarId, tz);
    if (result.ok) return { ok: true };
    return { ok: false, error: result.error === "not-authorized" || result.error === "calendar-not-found" ? "not-authorized" : "failed" };
  } catch {
    return { ok: false, error: "failed" };
  }
}
