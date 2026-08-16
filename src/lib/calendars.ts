import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Exige el formato exacto "YYYY-MM-DD" (el contrato del `<input
 * type="date">` del formulario) y construye la fecha explícitamente a
 * medianoche UTC — nunca `new Date(cadenaCualquiera)`, que acepta
 * timestamps completos con zona horaria y puede desplazar el día
 * (hallazgo de auditoría, ronda 1). También rechaza fechas que no existen
 * (p. ej. "2026-02-30": `Date.UTC` las "arrastra" al mes siguiente en vez
 * de fallar, así que se comprueba que el resultado coincide con lo que se
 * pidió).
 */
export function parseUtcDateOnly(value: string): Date | null {
  if (!DATE_ONLY_RE.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const roundTrips =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return roundTrips ? date : null;
}

/**
 * Rango de fechas por defecto para un calendario recién creado: 1–24 de
 * diciembre del próximo diciembre que llegue (si ya estamos a 25 de
 * diciembre o después, salta al año siguiente). Solo un punto de partida —
 * el Admin lo cambia libremente después.
 */
export function defaultCalendarDateRange(now = new Date()) {
  const isPastThisDecember = now.getUTCMonth() === 11 && now.getUTCDate() > 24;
  const year = isPastThisDecember ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  return {
    startDate: new Date(Date.UTC(year, 11, 1)),
    endDate: new Date(Date.UTC(year, 11, 24)),
  };
}

/**
 * `startDate`/`endDate` se guardan a medianoche UTC (ver
 * `defaultCalendarDateRange` y el formulario de edición, que manda
 * "YYYY-MM-DD" y se parsea como UTC). Formatear con `toLocaleDateString`
 * a secas convierte primero a la hora local del servidor — en cualquier
 * huso por detrás de UTC eso enseña el día anterior. Fijar `timeZone:
 * "UTC"` evita el desfase.
 */
export function formatCalendarDate(date: Date) {
  return date.toLocaleDateString("es-ES", { timeZone: "UTC" });
}

const FALLBACK_TIME_ZONE = "UTC";

/**
 * Valida un identificador de zona horaria IANA llegado del cliente (cookie
 * `tz` o argumento de una server action — nunca dato de confianza).
 * `Intl.DateTimeFormat` lanza `RangeError` con cualquier cadena que no sea
 * una zona reconocida; ante eso (o valor ausente) cae a UTC en vez de
 * romper el render — mismo criterio defensivo que el resto de entradas de
 * cliente en este proyecto (URLs de vídeo/portada, TAL-5/6/8).
 */
export function safeTimeZone(raw: string | undefined | null): string {
  if (!raw) return FALLBACK_TIME_ZONE;
  try {
    // Solo para forzar la validación de `raw` — el formateador en sí no se usa.
    new Intl.DateTimeFormat("en-CA", { timeZone: raw });
    return raw;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

/**
 * "Hoy" como día natural en la zona horaria indicada, anclado a
 * medianoche UTC — mismo formato que `Day.date`/`Calendar.startDate`/
 * `endDate` (ver arriba), para que sea comparable directamente con esas
 * columnas.
 *
 * Sin esto (hallazgo de auditoría, TAL-8 ronda 1): comparar `Day.date`
 * contra el instante crudo `new Date()` desbloquea el día siguiente HORAS
 * ANTES de tiempo en husos por detrás de UTC (p. ej. São Paulo) y HORAS
 * TARDE en husos por delante — la puerta debe abrirse en el "hoy" real de
 * quien mira el calendario, no en el de UTC a secas. La zona horaria la
 * manda el cliente (no hay ninguna guardada en BD por persona/calendario);
 * ver `TimezoneSync` (cookie `tz`, página del Invitado) y `door-grid.tsx`
 * (`Intl.DateTimeFormat().resolvedOptions().timeZone` al marcar como
 * visto, sin depender de que la cookie ya haya llegado).
 */
export function todayInTimeZone(now: Date, timeZone: string | undefined | null): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  const day = Number(parts.find((p) => p.type === "day")!.value);
  return new Date(Date.UTC(year, month - 1, day));
}

export function listAdminCalendars(userId: string) {
  return prisma.calendar.findMany({
    where: { memberships: { some: { userId, role: "ADMIN" } } },
    orderBy: { createdAt: "desc" },
    include: { skin: true },
  });
}

async function defaultSkin() {
  // "pine" es el skin por defecto según prisma/seed.ts ("Verde pino con
  // acentos dorados — skin por defecto"); si algún día no existe (seed
  // distinto, entorno sin sembrar del todo), cae al primero que haya en vez
  // de bloquear la creación del calendario.
  return (
    (await prisma.skin.findUnique({ where: { key: "pine" } })) ??
    (await prisma.skin.findFirst({ orderBy: { key: "asc" } }))
  );
}

/**
 * Crea un calendario con valores de partida razonables y, en la misma
 * transacción, la CalendarMembership del creador como ADMIN — así es como
 * alguien se convierte en Admin de su primer calendario (brief de TAL-5).
 *
 * Idempotente por `creationKey` (hallazgo de auditoría, ronda 1: un doble
 * clic o un reenvío de formulario duplicaba calendario+membership). El
 * formulario de creación manda siempre la misma clave mientras no se
 * recargue la página — si ya existe un Calendar con esa clave, se devuelve
 * tal cual en vez de crear otro. Comprobar-y-crear tiene ventana de carrera
 * (visto ya en TAL-2 con la aceptación de invitaciones): se intenta crear
 * directamente y, si el índice único choca (P2002), se relee la fila que
 * ganó la carrera en vez de fallar.
 */
export async function createCalendarForAdmin(user: { id: string }, creationKey: string) {
  const existing = await prisma.calendar.findUnique({ where: { creationKey } });
  if (existing) return existing;

  const skin = await defaultSkin();
  if (!skin) {
    throw new Error(
      "No hay ningún Skin sembrado todavía — corre `npx prisma db seed` antes de crear calendarios."
    );
  }

  const { startDate, endDate } = defaultCalendarDateRange();

  try {
    return await prisma.$transaction(async (tx) => {
      const calendar = await tx.calendar.create({
        data: {
          name: "Nuevo calendario",
          coverTitle: "¡Feliz cuenta atrás, equipo! 🎄",
          startDate,
          endDate,
          skinId: skin.id,
          creationKey,
        },
      });
      await tx.calendarMembership.create({
        data: { calendarId: calendar.id, userId: user.id, role: "ADMIN" },
      });
      return calendar;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return prisma.calendar.findUniqueOrThrow({ where: { creationKey } });
    }
    throw err;
  }
}
