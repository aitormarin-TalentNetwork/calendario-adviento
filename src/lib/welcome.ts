import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { MarkSeenResult } from "../../convex/welcomeViews";
import { todayInTimeZone } from "@/lib/calendars";
import { convexAppServerSecret } from "@/lib/convex-server";

/**
 * TAL-70 — "¿ya vio hoy la bienvenida de este calendario?" y su marca. El
 * día es el natural de la persona, calculado SIEMPRE aquí, en el servidor,
 * con la zona horaria de la cookie `tz` (nunca una fecha que mande el
 * navegador). Ver convex/welcomeViews.ts y docs/bienvenida.md.
 */
export function welcomeDate(timeZone: string, now: Date = new Date()): string {
  return todayInTimeZone(now, timeZone).toISOString().slice(0, 10);
}

export async function hasSeenWelcomeToday(userId: string, calendarId: string, timeZone: string): Promise<boolean> {
  return await fetchQuery(api.welcomeViews.hasSeenTodayPublic, {
    serverSecret: convexAppServerSecret(),
    userId: userId as Id<"users">,
    calendarId: calendarId as Id<"calendars">,
    date: welcomeDate(timeZone),
  });
}

export async function markWelcomeSeen(userId: string, calendarId: string, timeZone: string): Promise<MarkSeenResult> {
  return await fetchMutation(api.welcomeViews.markSeenPublic, {
    serverSecret: convexAppServerSecret(),
    userId: userId as Id<"users">,
    calendarId: calendarId as Id<"calendars">,
    date: welcomeDate(timeZone),
  });
}
