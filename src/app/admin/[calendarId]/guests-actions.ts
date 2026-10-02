"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  inviteToCalendar,
  parseCalendarRole,
  removePersonFromCalendar,
  setPersonRole,
} from "@/lib/calendar-people";
import { removeGuestEverywhere } from "@/lib/guests";
import { getAuthorizedUser, type AuthorizedUser } from "@/lib/current-user";
import { resolveCalendarAccess } from "@/lib/roles";

// Duplicado a propósito del mismo chequeo en src/app/admin/actions.ts (TAL-5)
// — no está exportado de allí, y centralizarlo ahora mismo arriesgaba
// chocar con TAL-6 (T1), que está tocando el mismo directorio en paralelo.
// Queda anotado como posible refactor de seguimiento, no de esta tarea.
//
// Esta comprobación es solo la puerta de entrada RÁPIDA (redirect limpio
// para el caso común de "ni siquiera eres admin de esto") — no es la
// autorización final para `removeGuestEverywhereAction` (corrección de
// auditoría TAL-16, ronda 2: esa mutation vuelve a resolver el rol del
// actor por su cuenta, en fresco, dentro de su propia transacción — ver
// `convex/guests.ts::removeGuestEverywhereHandler`). Devuelve también
// `user` (no solo si es admin) porque esa mutation necesita `user.id`
// como identificador puro del actor, nunca un rol ya calculado.
async function requireCalendarAdmin(calendarId: string): Promise<AuthorizedUser> {
  const user = await getAuthorizedUser();
  if (!user) redirect(`/login?callbackUrl=/admin/${calendarId}`);

  const access = await resolveCalendarAccess(user, calendarId);
  const isAdmin = access?.kind === "super-admin" || access?.role === "ADMIN";
  if (!isAdmin) redirect("/unauthorized");

  return user;
}

// TAL-65 — errores tipados de "Personas del calendario" que se muestran en
// el propio editor (`guests-section.tsx` lee `?people_error=`).
export type PeopleError = "invalid-email" | "last-admin" | "frozen" | "not-found";

function peopleErrorRedirect(calendarId: string, error: PeopleError): never {
  redirect(`/admin/${calendarId}?people_error=${error}`);
}

/**
 * Tras cambiarse el rol a sí mismo (a Visitante) o quitarse del calendario,
 * quien no es Super Admin ya no puede seguir en este editor: `/admin` le
 * lleva a "Mis calendarios", o a "Tus calendarios" si ya no administra
 * ninguno (TAL-58/59).
 */
function leftAdminRole(user: AuthorizedUser, email: string): boolean {
  return !user.isSuperAdmin && user.email.trim().toLowerCase() === email.trim().toLowerCase();
}

export async function inviteToCalendarAction(calendarId: string, formData: FormData) {
  const user = await requireCalendarAdmin(calendarId);

  const email = formData.get("email")?.toString() ?? "";
  const role = parseCalendarRole(formData.get("role"));
  // TAL-65 — `inviteToCalendar` relee el rol del actor dentro de Convex;
  // `requireCalendarAdmin` de arriba es solo la puerta rápida.
  const result = await inviteToCalendar(user.id, calendarId, email, role);
  if (!result.ok) {
    if (result.error === "not-authorized") redirect("/unauthorized");
    peopleErrorRedirect(calendarId, result.error);
  }

  revalidatePath(`/admin/${calendarId}`);
}

export async function setPersonRoleAction(calendarId: string, email: string, formData: FormData) {
  const user = await requireCalendarAdmin(calendarId);

  const role = parseCalendarRole(formData.get("role"));
  const result = await setPersonRole(user.id, calendarId, email, role);
  if (!result.ok) {
    if (result.error === "not-authorized") redirect("/unauthorized");
    peopleErrorRedirect(calendarId, result.error);
  }

  revalidatePath(`/admin/${calendarId}`);
  if (role === "GUEST" && leftAdminRole(user, email)) redirect("/admin");
}

export async function removePersonAction(calendarId: string, email: string) {
  const user = await requireCalendarAdmin(calendarId);

  const result = await removePersonFromCalendar(user.id, calendarId, email);
  if (!result.ok) {
    if (result.error === "not-authorized") redirect("/unauthorized");
    peopleErrorRedirect(calendarId, result.error);
  }

  revalidatePath(`/admin/${calendarId}`);
  if (leftAdminRole(user, email)) redirect("/admin");
}

export async function removeGuestEverywhereAction(calendarId: string, email: string) {
  const user = await requireCalendarAdmin(calendarId);

  // Hallazgo de auditoría TAL-7 ronda 1: `calendarId` y `email` llegan los
  // dos del cliente — sin ninguna comprobación, cualquier Admin de
  // CUALQUIER calendario podía invocar esta action con el email de alguien
  // que no tiene ninguna relación con su calendario y borrarlo por
  // completo de calendarios de terceros que no administra.
  //
  // Corrección de auditoría, rondas 1 y 2, TAL-16: `removeGuestEverywhere`
  // ya no confía en NADA resuelto aquí en Next.js más allá de "ni siquiera
  // pasa la puerta rápida" (el `requireCalendarAdmin` de arriba, solo un
  // redirect de UX para el caso obvio) — ni la pertenencia del objetivo
  // (ronda 1) ni el rol del actor (ronda 2, este mismo hallazgo aplicado
  // al ACTOR en vez de al objetivo: el rol de quien llama podía revocarse
  // en el hueco entre esta comprobación y la mutation, y el borrado global
  // se ejecutaba igual con una autorización ya obsoleta). Se pasa
  // `user.id` como identificador puro del actor — nunca un rol/booleano ya
  // calculado — y `removeGuestEverywhereHandler` (`convex/guests.ts`)
  // relee el rol del actor Y la pertenencia del objetivo dentro de su
  // propia transacción, atómico con el borrado.
  const result = await removeGuestEverywhere(user.id, calendarId, email);
  if (!result.ok) redirect("/unauthorized");

  revalidatePath(`/admin/${calendarId}`);
}
