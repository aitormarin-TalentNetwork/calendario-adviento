export type CalendarGuest = {
  email: string;
  // true = ya existe CalendarMembership GUEST (entró con Gmail y se le
  // resolvió el acceso, ver src/lib/roles.ts). false = solo hay
  // Invitation todavía, no ha entrado.
  accepted: boolean;
};

/**
 * Invitados de un calendario — ver `docs/invitados.md` para las reglas
 * completas (unión de `Invitation` y `CalendarMembership` GUEST).
 *
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: la consulta
 * real todavía no tiene equivalente conectado a Convex (TAL-12+). `[]` es
 * la degradación segura para una lista — la sección de invitados ya sabe
 * pintar "sin invitados todavía" con una lista vacía.
 */
export async function listCalendarGuests(calendarId: string): Promise<CalendarGuest[]> {
  void calendarId;
  return [];
}

export type InviteGuestResult =
  | { ok: true }
  | { ok: false; error: "invalid-email" | "calendar-not-found" };

/**
 * Invita a alguien a un calendario por email — ver `docs/invitados.md`.
 *
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: la escritura
 * real (`Invitation` upsert) todavía no tiene equivalente conectado a
 * Convex (TAL-12+). `{ok:false, error:"calendar-not-found"}` es la
 * degradación segura ya contemplada por el tipo de retorno existente — la
 * UI ya sabe mostrar ese error, y "el calendario no está disponible ahora
 * mismo" es honesto (más que "email inválido", que no es la causa real).
 */
export async function inviteGuest(calendarId: string, rawEmail: string): Promise<InviteGuestResult> {
  void calendarId;
  void rawEmail;
  return { ok: false, error: "calendar-not-found" };
}

/**
 * ¿Es este email invitado (o ya invitado-aceptado) de este calendario
 * concreto? — ver `docs/invitados.md`, usado para acotar "borrar por
 * completo" a alguien con relación real con el calendario.
 *
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: `false`
 * (falla cerrado — "no es invitado de nadie") es la degradación segura
 * para una comprobación de autorización, no `true`.
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
  throw new Error(
    "removeGuestFromCalendar: Prisma/Postgres se retiraron de la infraestructura en TAL-10 (migración a Convex). Pendiente de reescribir contra Convex en TAL-12+."
  );
}

/**
 * "Borrar por completo" — ver `docs/invitados.md`. Mismo motivo que
 * `removeGuestFromCalendar` para fallar en vez de degradar.
 */
export async function removeGuestEverywhere(rawEmail: string): Promise<void> {
  void rawEmail;
  throw new Error(
    "removeGuestEverywhere: Prisma/Postgres se retiraron de la infraestructura en TAL-10 (migración a Convex). Pendiente de reescribir contra Convex en TAL-12+."
  );
}
