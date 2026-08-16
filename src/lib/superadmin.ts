import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { convexAppServerSecret } from "@/lib/convex-server";

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
 * Fecha "YYYY-MM-DD" a medianoche UTC, mismo formato que Convex guarda
 * para `days.date`/`calendars.startDate`/`endDate` (ver
 * docs/convex-modelo-de-datos.md § "Fechas como día natural") — para
 * poder comparar directamente por orden lexicográfico dentro de
 * `convex/superadmin.ts::calendarStatus`, sin conversión a `Date` ahí.
 */
function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Todos los calendarios del sistema con sus stats básicas, para el listado
 * global del Super Admin — ver `docs/superadmin.md`/
 * `docs/convex-modelo-de-datos.md`. `now` se pasa desde fuera (en vez de
 * `new Date()` aquí) para que el cálculo de estado sea determinista en
 * pruebas.
 *
 * `actorUserId` es el `id` de quien hace la petición (ya autenticado,
 * `getAuthorizedUser()`), NO un booleano `isSuperAdmin` afirmado desde
 * aquí — Convex vuelve a comprobar el privilegio en fresco, dentro de la
 * propia función, por ese id (hallazgo de auditoría en TAL-12/TAL-16,
 * ver `convex/superadmin.ts::requireSuperAdmin`). Esta función en sí NO
 * decide autorización, solo la traslada.
 *
 * TAL-15 — reconectado contra Convex (`convex/superadmin.ts`,
 * `listCalendarsWithStatsPublic`). `viewedCount` se calcula de verdad
 * ahora (antes, siempre `0` — un dato ya falso en producción desde TAL-8,
 * ver docs/superadmin.md).
 */
export async function listCalendarsWithStats(actorUserId: string, now: Date): Promise<CalendarSummary[]> {
  const calendars = await fetchQuery(api.superadmin.listCalendarsWithStatsPublic, {
    serverSecret: convexAppServerSecret(),
    actorUserId: actorUserId as Id<"users">,
    now: toDateOnly(now),
  });

  return calendars.map((calendar) => ({
    id: calendar.id,
    name: calendar.name,
    startDate: new Date(`${calendar.startDate}T00:00:00.000Z`),
    endDate: new Date(`${calendar.endDate}T00:00:00.000Z`),
    status: calendar.status,
    admins: calendar.admins.map((admin) => ({ id: admin.id, name: admin.name ?? null, email: admin.email })),
    daysCount: calendar.daysCount,
    invitedCount: calendar.invitedCount,
    viewedCount: calendar.viewedCount,
  }));
}

export type AdminSummary = {
  userId: string;
  name: string | null;
  email: string;
  createdAt: Date;
  calendarsCount: number;
};

/**
 * Personas con rol ADMIN en al menos un calendario, una fila por persona
 * — ver `docs/superadmin.md`.
 *
 * TAL-15 — reconectado contra Convex.
 */
export async function listAdmins(actorUserId: string): Promise<AdminSummary[]> {
  const admins = await fetchQuery(api.superadmin.listAdminsPublic, {
    serverSecret: convexAppServerSecret(),
    actorUserId: actorUserId as Id<"users">,
  });

  return admins.map((admin) => ({
    userId: admin.userId,
    name: admin.name ?? null,
    email: admin.email,
    createdAt: new Date(admin.createdAt), // _creationTime de Convex, epoch-ms — no un día natural, un instante real
    calendarsCount: admin.calendarsCount,
  }));
}

export type CalendarOption = { id: string; name: string };

/** TAL-15 — reconectado contra Convex. */
export async function listCalendarOptions(actorUserId: string): Promise<CalendarOption[]> {
  return await fetchQuery(api.superadmin.listCalendarOptionsPublic, {
    serverSecret: convexAppServerSecret(),
    actorUserId: actorUserId as Id<"users">,
  });
}

export type AddAdminResult =
  | { ok: true }
  | { ok: false; error: "invalid-email" | "calendar-not-found" };

/**
 * Da de alta a alguien como ADMIN de un calendario concreto — ver
 * `docs/superadmin.md`.
 *
 * TAL-15 — reconectado contra Convex (`addAdminPublic`). La validación de
 * formato de email también se repite del lado de Convex
 * (`convex/superadmin.ts::addAdminHandler`) — defensa en profundidad,
 * mismo criterio que el resto de esta serie (el secreto compartido prueba
 * "esta llamada viene de nuestro servidor", no "nuestro servidor validó
 * todo correctamente").
 */
export async function addAdmin(actorUserId: string, calendarId: string, rawEmail: string): Promise<AddAdminResult> {
  return await fetchMutation(api.superadmin.addAdminPublic, {
    serverSecret: convexAppServerSecret(),
    actorUserId: actorUserId as Id<"users">,
    calendarId: calendarId as Id<"calendars">,
    email: rawEmail,
  });
}

/**
 * Quita a una persona del rol de Admin en TODOS los calendarios donde lo
 * tuviera — ver `docs/superadmin.md`.
 *
 * TAL-15 — reconectado contra Convex (`removeAdminEverywherePublic`).
 */
export async function removeAdminEverywhere(actorUserId: string, userId: string): Promise<void> {
  await fetchMutation(api.superadmin.removeAdminEverywherePublic, {
    serverSecret: convexAppServerSecret(),
    actorUserId: actorUserId as Id<"users">,
    userId: userId as Id<"users">,
  });
}
