"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { inviteGuest, removeGuestEverywhere, removeGuestFromCalendar } from "@/lib/guests";
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

export async function inviteGuestAction(calendarId: string, formData: FormData) {
  await requireCalendarAdmin(calendarId);

  const email = formData.get("email")?.toString() ?? "";
  // TAL-16 — reconectada contra Convex: `inviteGuest` (`src/lib/guests.ts`)
  // ya escribe de verdad. Solo queda el caso tipado `invalid-email`
  // (`{ok:false,...}`) — un fallo real e inesperado de la mutation (p. ej.
  // el calendario ya no existe) se deja propagar tal cual, no se mapea a
  // ningún resultado tipado (ver comentario en `src/lib/guests.ts`).
  const result = await inviteGuest(calendarId, email);
  if (!result.ok) {
    throw new Error("Introduce un email válido.");
  }

  revalidatePath(`/admin/${calendarId}`);
}

export async function removeGuestFromCalendarAction(calendarId: string, email: string) {
  await requireCalendarAdmin(calendarId);
  // No hace falta comprobar aparte que `email` sea invitado de este
  // calendario: removeGuestFromCalendar ya filtra sus borrados por
  // `calendarId`, así que llamarla con un email que no tiene relación con
  // este calendario es, como mucho, un no-op — nunca toca datos de otro
  // calendario (a diferencia de removeGuestEverywhereAction, ver abajo).
  await removeGuestFromCalendar(calendarId, email);
  revalidatePath(`/admin/${calendarId}`);
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
