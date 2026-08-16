import { prisma } from "@/lib/prisma";

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
  // Total de DayView del calendario (TAL-8) — cada apertura cuenta una vez
  // por (día, persona), así que puede superar invitedCount (una misma
  // persona ve varios días). No "número de invitados que han visto algo".
  viewedCount: number;
};

function calendarStatus(startDate: Date, endDate: Date, now: Date): CalendarStatus {
  if (now < startDate) return "upcoming";
  if (now > endDate) return "finished";
  return "live";
}

/**
 * Todos los calendarios del sistema con sus stats básicas, para el listado
 * global del Super Admin. `now` se pasa desde fuera (en vez de `new Date()`
 * aquí) para que el cálculo de estado sea determinista en pruebas.
 */
export async function listCalendarsWithStats(now: Date): Promise<CalendarSummary[]> {
  const calendars = await prisma.calendar.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      memberships: {
        where: { role: "ADMIN" },
        include: { user: { select: { id: true, name: true, email: true } } },
      },
      _count: { select: { days: true, invitations: true } },
      // DayView cuelga de Day, no de Calendar directamente — no hay
      // groupBy de Prisma que cuente a través de esa relación en una sola
      // llamada, así que se trae el conteo de views por día (una query,
      // sin N+1) y se suma en JS, mismo patrón que el agregado de
      // `listAdmins` más abajo.
      days: { select: { _count: { select: { views: true } } } },
    },
  });

  return calendars.map((calendar) => ({
    id: calendar.id,
    name: calendar.name,
    startDate: calendar.startDate,
    endDate: calendar.endDate,
    status: calendarStatus(calendar.startDate, calendar.endDate, now),
    admins: calendar.memberships.map((membership) => membership.user),
    daysCount: calendar._count.days,
    invitedCount: calendar._count.invitations,
    viewedCount: calendar.days.reduce((sum, day) => sum + day._count.views, 0),
  }));
}

export type AdminSummary = {
  userId: string;
  name: string | null;
  email: string;
  // Fecha de creación de la cuenta, no de cuándo se le dio el rol de Admin
  // (esa fecha no se guarda aparte — no hay un caso de uso todavía que la
  // necesite; ver CalendarMembership.createdAt si en el futuro hiciera
  // falta por calendario en vez de por persona).
  createdAt: Date;
  calendarsCount: number;
};

/**
 * Personas con rol ADMIN en al menos un calendario, una fila por persona
 * (agregado en JS: el volumen esperado en este MVP no justifica un groupBy
 * con join a User, que Prisma no soporta directamente sobre una relación).
 */
export async function listAdmins(): Promise<AdminSummary[]> {
  const adminMemberships = await prisma.calendarMembership.findMany({
    where: { role: "ADMIN" },
    include: { user: { select: { id: true, name: true, email: true, createdAt: true } } },
  });

  const byUser = new Map<string, AdminSummary>();
  for (const membership of adminMemberships) {
    const existing = byUser.get(membership.user.id);
    if (existing) {
      existing.calendarsCount += 1;
      continue;
    }
    byUser.set(membership.user.id, {
      userId: membership.user.id,
      name: membership.user.name,
      email: membership.user.email,
      createdAt: membership.user.createdAt,
      calendarsCount: 1,
    });
  }

  return [...byUser.values()].sort((a, b) => a.email.localeCompare(b.email));
}

export type CalendarOption = { id: string; name: string };

export async function listCalendarOptions(): Promise<CalendarOption[]> {
  return prisma.calendar.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export type AddAdminResult =
  | { ok: true }
  | { ok: false; error: "invalid-email" | "calendar-not-found" };

// Validación real de formato (local-part + "@" + dominio con al menos un
// punto, sin espacios) — el `type="email"` del HTML es solo una ayuda de
// UI, no sustituye validar en servidor (hallazgo de auditoría, ronda 1):
// dejaba pasar cosas como "a@" o "@dominio".
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Da de alta a alguien como ADMIN de un calendario concreto (el rol es por
 * calendario, no global — ver docs/modelo-de-datos.md). Si la persona no
 * tiene todavía User, se crea (mismo patrón que el alta por Invitation en
 * src/lib/roles.ts); si ya tenía membership GUEST en ese calendario, se
 * asciende a ADMIN.
 *
 * Todo en una única transacción (hallazgo de auditoría, ronda 1): sin
 * ella, si el Calendar desaparecía justo entre el upsert de User y el de
 * CalendarMembership, quedaba un User huérfano creado sin ningún rol real
 * en ningún calendario.
 */
export async function addAdmin(calendarId: string, rawEmail: string): Promise<AddAdminResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) return { ok: false, error: "invalid-email" };

  const calendar = await prisma.calendar.findUnique({ where: { id: calendarId } });
  if (!calendar) return { ok: false, error: "calendar-not-found" };

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email },
      update: {},
      create: { email },
    });

    await tx.calendarMembership.upsert({
      where: { calendarId_userId: { calendarId, userId: user.id } },
      update: { role: "ADMIN" },
      create: { calendarId, userId: user.id, role: "ADMIN" },
    });
  });

  return { ok: true };
}

/**
 * Quita a una persona del rol de Admin en TODOS los calendarios donde lo
 * tuviera (la tabla "Admins" del panel es una fila por persona, no por
 * calendario — ver mockup). Si esa persona era también Guest de algún otro
 * calendario, esa membership GUEST no se toca.
 *
 * Por cada calendario donde era Admin: si todavía existe una Invitation
 * suya para ese calendario (la invitación no se borra al aceptarla, ver
 * docs/modelo-de-datos.md), se degrada a GUEST en vez de borrar la
 * membership — sigue siendo un invitado legítimo de ese calendario. Si no
 * hay Invitation (se le dio Admin directamente, sin haber sido invitado
 * como Guest), se borra la membership entera. Probado en vivo: promover a
 * un Guest ya invitado y luego quitarle el Admin lo deja como GUEST, no lo
 * expulsa del calendario.
 *
 * Todo en una única transacción (hallazgo de auditoría, ronda 1): antes se
 * lanzaban las actualizaciones en paralelo con `Promise.all`, así que un
 * fallo a mitad (BD caída, borrado concurrente) podía dejar a la persona
 * degradada solo en algunos calendarios y sin tocar en otros — rompía el
 * contrato de "quitar Admin en TODOS los calendarios". Con `$transaction`,
 * o se aplican todos los cambios o no se aplica ninguno; y al ir todo por
 * la misma conexión, se hace secuencial en vez de en paralelo (no hace
 * falta paralelismo aquí, el volumen de calendarios por persona es bajo).
 */
export async function removeAdminEverywhere(userId: string): Promise<void> {
  const adminMemberships = await prisma.calendarMembership.findMany({
    where: { userId, role: "ADMIN" },
    include: { user: { select: { email: true } } },
  });

  await prisma.$transaction(async (tx) => {
    for (const membership of adminMemberships) {
      const invitation = await tx.invitation.findFirst({
        where: { calendarId: membership.calendarId, email: membership.user.email },
      });
      if (invitation) {
        await tx.calendarMembership.update({
          where: { id: membership.id },
          data: { role: "GUEST" },
        });
      } else {
        await tx.calendarMembership.delete({ where: { id: membership.id } });
      }
    }
  });
}
