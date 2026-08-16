import { formatCalendarDate } from "@/lib/calendars";
import { prisma } from "@/lib/prisma";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Mismo límite y mismo motivo que MAX_MANAGEABLE_DAYS en
// src/app/admin/[calendarId]/days-section.tsx (TAL-6, hallazgo de
// auditoría): sin tope, un calendario con un rango de fechas absurdo
// generaría una puerta por cada fecha del rango en cada visita del
// Invitado — memoria/CPU sin cota con una sola petición autenticada. No se
// exporta un valor compartido entre los dos ficheros a propósito (mismo
// razonamiento que requireCalendarAdmin duplicado en TAL-6: ficheros
// independientes tocados por terminales distintas, evitar un acoplamiento
// que obligue a coordinarse para cambiar un número).
const MAX_MANAGEABLE_DAYS = 366;

function daySpan(startDate: Date, endDate: Date): number {
  return Math.round((endDate.getTime() - startDate.getTime()) / ONE_DAY_MS) + 1;
}

function datesInRange(startDate: Date, endDate: Date): Date[] {
  const dates: Date[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    dates.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

export type DoorState = "locked" | "unseen" | "watched";

export type DoorInfo = {
  dateStr: string;
  label: string;
  isToday: boolean;
  state: DoorState;
  // Solo se rellenan para puertas desbloqueadas — una puerta bloqueada no
  // debe filtrar en el HTML el vídeo/mensaje de un día futuro aunque el
  // Admin ya lo tenga asignado (defensa en profundidad: no depender solo
  // de que la UI no la deje pinchar).
  dayId: string | null;
  videoUrl: string | null;
  message: string | null;
};

export type DoorGridResult =
  | { ok: true; doors: DoorInfo[] }
  | { ok: false; reason: "range-too-long"; span: number };

/**
 * Resuelve el estado de cada puerta del calendario para un Invitado
 * concreto. "Bloqueado" se decide comparando la fecha con hoy — un día
 * queda desbloqueado desde que llega su fecha, para siempre (brief de
 * TAL-8). Dentro de lo desbloqueado: "visto" si existe DayView para
 * (day, user); si no, "abierto sin ver" — incluso si el Admin no llegó a
 * asignar vídeo ese día (el día sigue "abierto", solo que el modal no
 * tendrá nada que reproducir; ver `door-grid.tsx`).
 */
export async function resolveDoors(calendarId: string, userId: string, today: Date): Promise<DoorGridResult> {
  const calendar = await prisma.calendar.findUniqueOrThrow({
    where: { id: calendarId },
    select: { startDate: true, endDate: true },
  });

  const span = daySpan(calendar.startDate, calendar.endDate);
  if (span > MAX_MANAGEABLE_DAYS) {
    return { ok: false, reason: "range-too-long", span };
  }

  const days = await prisma.day.findMany({
    where: { calendarId, date: { lte: today } },
    include: { views: { where: { userId } } },
  });
  const dayByDate = new Map(days.map((day) => [toDateInputValue(day.date), day]));

  const doors = datesInRange(calendar.startDate, calendar.endDate).map((date) => {
    const dateStr = toDateInputValue(date);
    const isToday = toDateInputValue(today) === dateStr;
    const locked = date > today;

    if (locked) {
      return { dateStr, label: formatCalendarDate(date), isToday, state: "locked" as const, dayId: null, videoUrl: null, message: null };
    }

    const day = dayByDate.get(dateStr);
    const watched = (day?.views.length ?? 0) > 0;
    return {
      dateStr,
      label: formatCalendarDate(date),
      isToday,
      state: (watched ? "watched" : "unseen") as DoorState,
      dayId: day?.id ?? null,
      videoUrl: day?.videoUrl ?? null,
      message: day?.message ?? null,
    };
  });

  return { ok: true, doors };
}

export type MarkViewedResult = { ok: true } | { ok: false; error: "not-found" | "locked" };

/**
 * Marca un día como visto por un usuario — idempotente (upsert por
 * (dayId, userId), único en el schema). Revalida en servidor que el día
 * pertenece al calendario indicado y que su fecha ya está desbloqueada —
 * nunca confiar en que el cliente solo pudo llegar aquí desde una puerta
 * ya desbloqueada en la UI (las server actions son invocables
 * directamente).
 */
export async function markDayViewed(
  calendarId: string,
  dayId: string,
  userId: string,
  today: Date
): Promise<MarkViewedResult> {
  const day = await prisma.day.findUnique({ where: { id: dayId } });
  if (!day || day.calendarId !== calendarId) return { ok: false, error: "not-found" };
  if (day.date > today) return { ok: false, error: "locked" };

  await prisma.dayView.upsert({
    where: { dayId_userId: { dayId, userId } },
    update: {},
    create: { dayId, userId },
  });

  return { ok: true };
}
