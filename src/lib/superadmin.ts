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
  // Siempre 0 por ahora: todavía no existe ningún mecanismo que marque un
  // día como visto (eso es de TAL-8, "Experiencia del Invitado", en
  // Backlog) — mostrarlo en 0 es el dato real, no un placeholder falso.
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
    viewedCount: 0,
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

/**
 * Da de alta a alguien como ADMIN de un calendario concreto (el rol es por
 * calendario, no global — ver docs/modelo-de-datos.md). Si la persona no
 * tiene todavía User, se crea (mismo patrón que el alta por Invitation en
 * src/lib/roles.ts); si ya tenía membership GUEST en ese calendario, se
 * asciende a ADMIN.
 */
export async function addAdmin(calendarId: string, rawEmail: string): Promise<AddAdminResult> {
  const email = rawEmail.trim().toLowerCase();
  if (!email || !email.includes("@")) return { ok: false, error: "invalid-email" };

  const calendar = await prisma.calendar.findUnique({ where: { id: calendarId } });
  if (!calendar) return { ok: false, error: "calendar-not-found" };

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email },
  });

  await prisma.calendarMembership.upsert({
    where: { calendarId_userId: { calendarId, userId: user.id } },
    update: { role: "ADMIN" },
    create: { calendarId, userId: user.id, role: "ADMIN" },
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
 */
export async function removeAdminEverywhere(userId: string): Promise<void> {
  const adminMemberships = await prisma.calendarMembership.findMany({
    where: { userId, role: "ADMIN" },
    include: { user: { select: { email: true } } },
  });

  await Promise.all(
    adminMemberships.map(async (membership) => {
      const invitation = await prisma.invitation.findFirst({
        where: { calendarId: membership.calendarId, email: membership.user.email },
      });
      if (invitation) {
        await prisma.calendarMembership.update({
          where: { id: membership.id },
          data: { role: "GUEST" },
        });
      } else {
        await prisma.calendarMembership.delete({ where: { id: membership.id } });
      }
    })
  );
}
