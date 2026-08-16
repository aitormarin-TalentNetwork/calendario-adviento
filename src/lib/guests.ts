import { DataLayerUnavailableError } from "@/lib/not-migrated";

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
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: lanza
 * `DataLayerUnavailableError` en vez de `[]` (hallazgo de auditoría, ronda
 * 1 — una lista vacía se leería como "sin invitados todavía", un hecho
 * falso, no "no se pudo consultar"). Quien llama debe usar
 * `tryDataLayer` y mostrar un mensaje honesto de "no disponible".
 */
export async function listCalendarGuests(calendarId: string): Promise<CalendarGuest[]> {
  void calendarId;
  throw new DataLayerUnavailableError("listCalendarGuests");
}

export type InviteGuestResult =
  | { ok: true }
  | { ok: false; error: "invalid-email" | "calendar-not-found" };

/**
 * Invita a alguien a un calendario por email — ver `docs/invitados.md`.
 *
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: la validación
 * de formato de email es una función pura (no toca Prisma) y sigue
 * funcionando de verdad — se mantiene, no hay motivo para fingir que
 * también está "no disponible". Lo que sí falla es la escritura real
 * (`Invitation` upsert): lanza `DataLayerUnavailableError` en vez de
 * devolver `{ok:false, error:"calendar-not-found"}` (hallazgo de
 * auditoría, ronda 1 — ese calendario casi seguro SÍ existe, solo que no
 * se pudo comprobar; "calendar-not-found" sería un motivo inventado).
 */
export async function inviteGuest(calendarId: string, rawEmail: string): Promise<InviteGuestResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) return { ok: false, error: "invalid-email" };

  void calendarId;
  throw new DataLayerUnavailableError("inviteGuest");
}

/**
 * ¿Es este email invitado (o ya invitado-aceptado) de este calendario
 * concreto? — ver `docs/invitados.md`, usado para acotar "borrar por
 * completo" a alguien con relación real con el calendario.
 *
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: a diferencia
 * del resto de este fichero, esto NO es una lectura que se muestre como
 * dato al usuario — es una comprobación de autorización que gatea un
 * borrado global peligroso (`removeGuestEverywhereAction`). `false`
 * (fallar cerrado — "no autorizado") es la postura de seguridad correcta
 * ante la incertidumbre, no una mentira sobre datos de negocio: es el
 * mismo criterio que ya usa `getAuthorizedUser`/`resolveCalendarAccess`
 * (`src/lib/current-user.ts`/`roles.ts`) para negar acceso por defecto.
 * En la práctica da igual: `removeGuestEverywhere` (más abajo) también
 * lanza, así que el borrado no llegaría a ejecutarse aunque esta
 * comprobación devolviera `true` por error.
 */
export async function isCalendarGuest(calendarId: string, rawEmail: string): Promise<boolean> {
  void calendarId;
  void rawEmail;
  return false;
}

/**
 * "Quitar del calendario" — ver `docs/invitados.md`.
 *
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: sin
 * representación de "vacío" razonable para una escritura de borrado que no
 * devuelve nada (`Promise<void>`) — fingir éxito dejaría a quien lo llama
 * pensando que expulsó a alguien que en realidad sigue teniendo acceso.
 * Falla explícitamente. Pendiente de reescribir contra Convex en TAL-12+.
 */
export async function removeGuestFromCalendar(calendarId: string, rawEmail: string): Promise<void> {
  void calendarId;
  void rawEmail;
  throw new DataLayerUnavailableError("removeGuestFromCalendar");
}

/**
 * "Borrar por completo" — ver `docs/invitados.md`. Mismo motivo que
 * `removeGuestFromCalendar` para fallar en vez de degradar.
 */
export async function removeGuestEverywhere(rawEmail: string): Promise<void> {
  void rawEmail;
  throw new DataLayerUnavailableError("removeGuestEverywhere");
}
