import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { formatCalendarDate, parseUtcDateOnly } from "@/lib/calendars";
import { convexAppServerSecret } from "@/lib/convex-server";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Mismo límite y mismo motivo que MAX_MANAGEABLE_DAYS en
// src/app/admin/[calendarId]/days-section.tsx (TAL-6, hallazgo de
// auditoría): sin tope, un calendario con un rango de fechas absurdo
// generaría una puerta por cada fecha del rango en cada visita del
// Invitado — memoria/CPU sin cota con una sola petición autenticada. No se
// exporta un valor compartido entre los dos ficheros a propósito (mismo
// razonamiento que requireCalendarAdmin duplicado en TAL-6: ficheros
// independientes tocados por terminales distintas, evitar un acoplamiento
// que obligue a coordinarse para cambiar un número). Puramente de
// presentación (cuántas puertas es razonable construir/mandar) — vive
// aquí, no en Convex, mismo criterio que `formatCalendarDate`
// (docs/convex-diseno-tal12-crud-calendario.md § "parseUtcDateOnly...").
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
 * concreto. "Bloqueado" se decide comparando la fecha con `today` — un día
 * queda desbloqueado desde que llega su fecha, para siempre (brief de
 * TAL-8). Dentro de lo desbloqueado: "visto" si existe `dayView` para
 * (day, user); si no, "abierto sin ver" — incluso si el Admin no llegó a
 * asignar vídeo ese día (el día sigue "abierto", solo que el modal no
 * tendrá nada que reproducir; ver `door-grid.tsx`).
 *
 * `today` tiene que venir ya resuelto con `todayInTimeZone` (`src/lib/
 * calendars.ts`) en la zona horaria de quien mira el calendario, no un
 * `new Date()` a secas — de lo contrario el desbloqueo se desplaza horas
 * según el huso de quien lo mire (hallazgo de auditoría, TAL-8 ronda 1;
 * ver también TAL-8 ronda 2 sobre por qué no resolver esto en el servidor
 * ANTES de conocer la zona horaria real — `door-grid-loader.tsx`).
 *
 * TAL-14 — reconectada contra Convex (`guestCalendar.resolveCalendarDaysForGuestPublic`).
 * La autorización (¿tiene `userId` acceso real a este calendario?) la
 * resuelve quien llama (`getDoorsAction`/`page.tsx`, vía
 * `resolveCalendarAccess`) antes de invocar esta función — es una
 * lectura, no tiene la ventana de carrera que sí tendría una escritura
 * (ver el comentario de autorización en `convex/guestCalendar.ts`). Si el
 * calendario ya no existe (referencia obsoleta, calendario borrado tras
 * concederse el acceso) se lanza — no hay ningún estado parcial honesto
 * que devolver aquí, mismo criterio que el resto de lecturas reconectadas
 * de TAL-12 (un fallo genuino se deja propagar, no se finge un resultado).
 */
export async function resolveDoors(calendarId: string, userId: string, today: Date): Promise<DoorGridResult> {
  const result = await fetchQuery(api.guestCalendar.resolveCalendarDaysForGuestPublic, {
    serverSecret: convexAppServerSecret(),
    calendarId: calendarId as Id<"calendars">,
    userId: userId as Id<"users">,
  });
  if (!result) throw new Error("El calendario ya no existe.");

  const startDate = parseUtcDateOnly(result.startDate)!;
  const endDate = parseUtcDateOnly(result.endDate)!;

  const span = daySpan(startDate, endDate);
  if (span > MAX_MANAGEABLE_DAYS) {
    return { ok: false, reason: "range-too-long", span };
  }

  const dayByDate = new Map(result.days.map((day) => [day.date, day]));

  const doors = datesInRange(startDate, endDate).map((date) => {
    const dateStr = toDateInputValue(date);
    const isToday = toDateInputValue(today) === dateStr;
    const locked = date > today;

    if (locked) {
      return { dateStr, label: formatCalendarDate(date), isToday, state: "locked" as const, dayId: null, videoUrl: null, message: null };
    }

    const day = dayByDate.get(dateStr);
    return {
      dateStr,
      label: formatCalendarDate(date),
      isToday,
      state: (day?.watched ? "watched" : "unseen") as DoorState,
      dayId: day?.dayId ?? null,
      videoUrl: day?.videoUrl ?? null,
      message: day?.message ?? null,
    };
  });

  return { ok: true, doors };
}

export type MarkViewedResult = { ok: true } | { ok: false; error: "not-found" | "locked" };

/**
 * Marca un día como visto por un usuario — ver `docs/dias.md` para el
 * resto de reglas (idempotencia, revalidación de rango en servidor).
 *
 * TAL-14 — reconectada contra Convex
 * (`dayViews.markDayViewedAsUserPublic`). Autorización + validez del día +
 * marcar-como-visto se resuelven TODOS dentro de esa única mutation (ver
 * el comentario completo en `convex/dayViews.ts::markDayViewedAsUserHandler`)
 * — nunca en pasos separados desde aquí (hallazgo que ya costó varias
 * rondas en TAL-12/TAL-16: comprobar acceso y actuar en llamadas Convex
 * independientes abre una ventana de carrera real). `"not-found"` cubre
 * tanto "ese día no existe/no pertenece a este calendario" como "sin
 * acceso a este calendario" — mismo criterio ya establecido en la versión
 * Prisma (nunca distinguir los dos casos hacia el cliente, para no
 * confirmar ni negar la existencia de un calendario ajeno).
 */
export async function markDayViewed(
  calendarId: string,
  dayId: string,
  userId: string,
  today: Date
): Promise<MarkViewedResult> {
  const result = await fetchMutation(api.dayViews.markDayViewedAsUserPublic, {
    serverSecret: convexAppServerSecret(),
    calendarId: calendarId as Id<"calendars">,
    dayId: dayId as Id<"days">,
    userId: userId as Id<"users">,
    todayDate: toDateInputValue(today),
  });

  if (result === "marked") return { ok: true };
  if (result === "locked") return { ok: false, error: "locked" };
  return { ok: false, error: "not-found" };
}
