import { fetchMutation } from "convex/nextjs";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { convexAppServerSecret } from "@/lib/convex-server";

// TAL-65 — la lista, la invitación y "Quitar" del editor pasan a
// `src/lib/calendar-people.ts` (con rol y comprobación del actor en Convex).
// Aquí queda solo "Borrar por completo". Las funciones públicas antiguas de
// Convex (`listCalendarGuestsPublic`, `inviteGuestPublic`,
// `removeGuestFromCalendarPublic`) se mantienen por compatibilidad con el
// Next anterior durante el despliegue (docs/invitados.md).

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
