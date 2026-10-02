import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type {
  CalendarPerson,
  InviteToCalendarResult,
  RemovePersonResult,
  SetPersonRoleResult,
} from "../../convex/calendarPeople";
import { convexAppServerSecret } from "@/lib/convex-server";
import type { CalendarRole } from "@/lib/roles";

export type { CalendarPerson };

/**
 * TAL-65 — "Personas del calendario" (ver `convex/calendarPeople.ts` y
 * docs/invitados.md § "Invitar con rol (TAL-65)"). Envoltorios finos: la
 * autorización NO se decide aquí — se pasa `actorUserId` (identidad pura) y
 * cada función de Convex relee el rol del actor en la misma transacción que
 * el efecto. Un fallo real de Convex (red, secreto) se deja propagar, mismo
 * criterio que `src/lib/guests.ts`.
 */

/** Valor del control segmentado: cualquier cosa que no sea "ADMIN" es Visitante. */
export function parseCalendarRole(value: unknown): CalendarRole {
  return value === "ADMIN" ? "ADMIN" : "GUEST";
}

export async function listCalendarPeople(actorUserId: string, calendarId: string): Promise<CalendarPerson[]> {
  return await fetchQuery(api.calendarPeople.listCalendarPeoplePublic, {
    serverSecret: convexAppServerSecret(),
    actorUserId: actorUserId as Id<"users">,
    calendarId: calendarId as Id<"calendars">,
  });
}

export async function inviteToCalendar(
  actorUserId: string,
  calendarId: string,
  email: string,
  role: CalendarRole
): Promise<InviteToCalendarResult> {
  return await fetchMutation(api.calendarPeople.inviteToCalendarPublic, {
    serverSecret: convexAppServerSecret(),
    actorUserId: actorUserId as Id<"users">,
    calendarId: calendarId as Id<"calendars">,
    email,
    role,
  });
}

export async function setPersonRole(
  actorUserId: string,
  calendarId: string,
  email: string,
  role: CalendarRole
): Promise<SetPersonRoleResult> {
  return await fetchMutation(api.calendarPeople.setPersonRolePublic, {
    serverSecret: convexAppServerSecret(),
    actorUserId: actorUserId as Id<"users">,
    calendarId: calendarId as Id<"calendars">,
    email,
    role,
  });
}

export async function removePersonFromCalendar(
  actorUserId: string,
  calendarId: string,
  email: string
): Promise<RemovePersonResult> {
  return await fetchMutation(api.calendarPeople.removePersonFromCalendarPublic, {
    serverSecret: convexAppServerSecret(),
    actorUserId: actorUserId as Id<"users">,
    calendarId: calendarId as Id<"calendars">,
    email,
  });
}
