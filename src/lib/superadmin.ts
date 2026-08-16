export type CalendarStatus = "upcoming" | "live" | "finished";

export type CalendarSummary = {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  status: CalendarStatus;
  admins: { id: string; name: string | null; email: string }[];
  daysCount: number;
  invitedCount: number;
  viewedCount: number;
};

/**
 * Todos los calendarios del sistema con sus stats básicas — ver
 * `docs/superadmin.md`/`docs/convex-modelo-de-datos.md`.
 *
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: la consulta
 * real todavía no tiene equivalente conectado a Convex (TAL-12+). `[]` es
 * la degradación segura para una lista.
 */
export async function listCalendarsWithStats(now: Date): Promise<CalendarSummary[]> {
  void now;
  return [];
}

export type AdminSummary = {
  userId: string;
  name: string | null;
  email: string;
  createdAt: Date;
  calendarsCount: number;
};

/**
 * Personas con rol ADMIN en al menos un calendario — ver `docs/superadmin.md`.
 *
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: `[]` es la
 * degradación segura para una lista.
 */
export async function listAdmins(): Promise<AdminSummary[]> {
  return [];
}

export type CalendarOption = { id: string; name: string };

/**
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: `[]` es la
 * degradación segura para una lista.
 */
export async function listCalendarOptions(): Promise<CalendarOption[]> {
  return [];
}

export type AddAdminResult =
  | { ok: true }
  | { ok: false; error: "invalid-email" | "calendar-not-found" };

/**
 * Da de alta a alguien como ADMIN de un calendario concreto — ver
 * `docs/superadmin.md`.
 *
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: la escritura
 * real todavía no tiene equivalente conectado a Convex (TAL-12+).
 * `{ok:false, error:"calendar-not-found"}` es la degradación segura ya
 * contemplada por el tipo de retorno existente.
 */
export async function addAdmin(calendarId: string, rawEmail: string): Promise<AddAdminResult> {
  void calendarId;
  void rawEmail;
  return { ok: false, error: "calendar-not-found" };
}

/**
 * Quita a una persona del rol de Admin en TODOS los calendarios donde lo
 * tuviera — ver `docs/superadmin.md`.
 *
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: sin
 * representación de "vacío" razonable para una escritura que no devuelve
 * nada (`Promise<void>`) — fingir éxito dejaría a quien lo llama pensando
 * que quitó privilegios que en realidad siguen vigentes. Falla
 * explícitamente. Pendiente de reescribir contra Convex en TAL-12+.
 */
export async function removeAdminEverywhere(userId: string): Promise<void> {
  void userId;
  throw new Error(
    "removeAdminEverywhere: Prisma/Postgres se retiraron de la infraestructura en TAL-10 (migración a Convex). Pendiente de reescribir contra Convex en TAL-12+."
  );
}
