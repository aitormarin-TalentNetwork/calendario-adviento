import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { convexAppServerSecret } from "@/lib/convex-server";

export type CalendarGuest = {
  email: string;
  // true = ya existe CalendarMembership GUEST (entró con Gmail y se le
  // resolvió el acceso, ver src/lib/roles.ts). false = solo hay
  // Invitation todavía, no ha entrado.
  accepted: boolean;
};

// Mismo patrón que TAL-4 (src/lib/superadmin.ts): local-part + "@" + dominio
// con al menos un punto, sin espacios.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Invitados de un calendario — ver `docs/invitados.md` para las reglas
 * completas (unión de `Invitation` y `CalendarMembership` GUEST).
 *
 * TAL-16 — reconectada contra Convex (`convex/guests.ts::listCalendarGuestsPublic`,
 * frontera pública con el secreto compartido de TAL-11 — ver
 * `src/lib/roles.ts`/`current-user.ts` para el mismo patrón). Ya no lanza
 * `DataLayerUnavailableError`: esta lectura sí está disponible desde esta
 * tarea. Un fallo real de Convex (red caída, secreto no coincide) se deja
 * propagar tal cual — mismo criterio que el resto de este fichero para
 * escrituras, y honesto con el contrato de `DataLayerUnavailableError`
 * (documentado como "Prisma/Postgres retirados, pendiente de reescribir",
 * que ya no aplica aquí).
 */
export async function listCalendarGuests(calendarId: string): Promise<CalendarGuest[]> {
  return await fetchQuery(api.guests.listCalendarGuestsPublic, {
    serverSecret: convexAppServerSecret(),
    calendarId: calendarId as Id<"calendars">,
  });
}

export type InviteGuestResult = { ok: true } | { ok: false; error: "invalid-email" };

/**
 * Invita a alguien a un calendario por email — ver `docs/invitados.md`.
 *
 * TAL-16 — reconectada contra Convex
 * (`convex/invitations.ts::inviteGuestPublic`). La validación de formato
 * se mantiene aquí (evita el viaje de red para el caso más común, y sigue
 * dando el resultado tipado que espera `inviteGuestAction`) — la mutation
 * de Convex también valida el formato por su cuenta (defensa en
 * profundidad, TAL-16), así que un llamador futuro que se salte esta capa
 * no puede colar un email mal formado. `"calendar-not-found"` desaparece
 * del tipo de resultado (existía en TAL-10 solo porque Prisma/Postgres
 * estaban retirados y ese motivo era inventado — ver comentario histórico
 * en `docs/invitados.md`); si la mutation lanza de verdad porque el
 * calendario no existe, es un error real e inesperado (quien llama ya
 * resolvió acceso a ESE calendario antes de llegar aquí) y se deja
 * propagar, no se finge un resultado tipado para él.
 */
export async function inviteGuest(calendarId: string, rawEmail: string): Promise<InviteGuestResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) return { ok: false, error: "invalid-email" };

  await fetchMutation(api.invitations.inviteGuestPublic, {
    serverSecret: convexAppServerSecret(),
    calendarId: calendarId as Id<"calendars">,
    email,
  });
  return { ok: true };
}

/**
 * "Quitar del calendario" — ver `docs/invitados.md`.
 *
 * TAL-16 — reconectada contra Convex
 * (`convex/guests.ts::removeGuestFromCalendarPublic`). Sin representación
 * de "vacío" razonable para una escritura de borrado que no devuelve nada:
 * un fallo real se deja propagar tal cual, fingir éxito dejaría a quien
 * llama pensando que expulsó a alguien que en realidad sigue teniendo
 * acceso (mismo criterio que TAL-10 dejó documentado para este fichero).
 */
export async function removeGuestFromCalendar(calendarId: string, rawEmail: string): Promise<void> {
  await fetchMutation(api.guests.removeGuestFromCalendarPublic, {
    serverSecret: convexAppServerSecret(),
    calendarId: calendarId as Id<"calendars">,
    email: rawEmail.trim().toLowerCase(),
  });
}

export type RemoveGuestEverywhereResult = { ok: true } | { ok: false; error: "not-authorized" };

/**
 * "Borrar por completo" — ver `docs/invitados.md`.
 *
 * TAL-16 — reconectada contra Convex
 * (`convex/guests.ts::removeGuestEverywherePublic`).
 *
 * `calendarId`/`email` (corrección de auditoría, ronda 1, TAL-16): antes
 * esta función no recibía ningún `calendarId`, y la comprobación de "¿el
 * email de verdad pertenece al calendario que administra quien llama?"
 * vivía en una llamada aparte (`isCalendarGuest`, ya retirada de este
 * fichero) desde `guests-actions.ts` — dos llamadas independientes dejaban
 * una ventana TOCTOU real entre comprobar y borrar.
 *
 * `actorUserId` (corrección de auditoría, ronda 2, TAL-16): la ronda 2
 * seguía dejando que Next.js decidiera si el actor está autorizado
 * (`requireCalendarAdmin`) y solo pasaba el resultado ya calculado
 * (`requireGuestOfCalendarId: calendarId | null`, `null` para Super
 * Admin) — la misma clase de ventana TOCTOU, pero sobre el ROL DEL ACTOR
 * en vez de la pertenencia del objetivo. Ahora se pasa `actorUserId` (un
 * identificador puro, nunca un booleano/rol ya calculado) y la propia
 * mutation de Convex relee su rol actual — igual que Super Admin/Admin
 * de este calendario — dentro de la MISMA transacción que la pertenencia
 * del objetivo y el borrado (ver
 * `convex/guests.ts::removeGuestEverywhereHandler`).
 *
 * Devuelve un resultado tipado en vez de lanzar (a diferencia del resto de
 * escrituras de este fichero) — nota de auditoría, ronda 2: una carrera
 * legítima de autorización (rol o pertenencia cambiaron de verdad entre
 * medias) no debería reventar como un error crudo; `guests-actions.ts` lo
 * traduce a un `redirect("/unauthorized")` limpio. Cualquier OTRO fallo
 * (red caída, secreto no coincide) sigue sin atraparse aquí y se deja
 * propagar tal cual.
 */
export async function removeGuestEverywhere(
  actorUserId: string,
  calendarId: string,
  rawEmail: string
): Promise<RemoveGuestEverywhereResult> {
  return await fetchMutation(api.guests.removeGuestEverywherePublic, {
    serverSecret: convexAppServerSecret(),
    actorUserId: actorUserId as Id<"users">,
    calendarId: calendarId as Id<"calendars">,
    email: rawEmail.trim().toLowerCase(),
  });
}
