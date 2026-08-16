import { DataLayerUnavailableError } from "@/lib/not-migrated";

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
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: lanza
 * `DataLayerUnavailableError` en vez de `[]` (hallazgo de auditoría, ronda
 * 1 — una lista vacía se leería como "no hay calendarios en el sistema",
 * un hecho falso). Quien llama debe usar `tryDataLayer` y mostrar un
 * mensaje honesto de "no disponible".
 */
export async function listCalendarsWithStats(now: Date): Promise<CalendarSummary[]> {
  void now;
  throw new DataLayerUnavailableError("listCalendarsWithStats");
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
 * Mismo motivo que `listCalendarsWithStats` para lanzar en vez de `[]`.
 */
export async function listAdmins(): Promise<AdminSummary[]> {
  throw new DataLayerUnavailableError("listAdmins");
}

export type CalendarOption = { id: string; name: string };

/** Mismo motivo que `listCalendarsWithStats` para lanzar en vez de `[]`. */
export async function listCalendarOptions(): Promise<CalendarOption[]> {
  throw new DataLayerUnavailableError("listCalendarOptions");
}

export type AddAdminResult =
  | { ok: true }
  | { ok: false; error: "invalid-email" | "calendar-not-found" };

// Validación real de formato — el `type="email"` del HTML es solo una
// ayuda de UI, no sustituye validar en servidor (hallazgo de auditoría,
// ronda 1, TAL-4).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Da de alta a alguien como ADMIN de un calendario concreto — ver
 * `docs/superadmin.md`.
 *
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: la validación
 * de formato de email sigue funcionando de verdad (no toca Prisma) y se
 * mantiene. La escritura real lanza `DataLayerUnavailableError` en vez de
 * devolver `{ok:false, error:"calendar-not-found"}` (hallazgo de
 * auditoría, ronda 1 — ese calendario casi seguro SÍ existe, "not-found"
 * sería un motivo inventado).
 */
export async function addAdmin(calendarId: string, rawEmail: string): Promise<AddAdminResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) return { ok: false, error: "invalid-email" };

  void calendarId;
  throw new DataLayerUnavailableError("addAdmin");
}

/**
 * Quita a una persona del rol de Admin en TODOS los calendarios donde lo
 * tuviera — ver `docs/superadmin.md`. Sin representación de "vacío"
 * razonable para una escritura que no devuelve nada (`Promise<void>`) —
 * falla explícitamente. Pendiente de reescribir contra Convex en TAL-12+.
 */
export async function removeAdminEverywhere(userId: string): Promise<void> {
  void userId;
  throw new DataLayerUnavailableError("removeAdminEverywhere");
}
