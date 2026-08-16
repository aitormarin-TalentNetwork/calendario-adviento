import { DaysGridEditor } from "@/app/admin/[calendarId]/days-grid-editor";
import { formatCalendarDate } from "@/lib/calendars";
import { DataLayerUnavailableError, tryDataLayer } from "@/lib/not-migrated";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Límite defensivo (hallazgo de auditoría, ronda 1): sin él, un rango de
// fechas absurdamente largo (años/siglos — nada en el CRUD de calendario
// de TAL-5 lo impide) generaría un día por cada fecha del rango en cada
// render de esta sección, agotando memoria/CPU del servidor con una sola
// petición autenticada. 366 cubre cualquier calendario real (incluido uno
// que abarque un año entero) con margen; por encima, se pide acortar el
// rango antes de poder gestionar días.
const MAX_MANAGEABLE_DAYS = 366;

function daySpan(startDate: Date, endDate: Date): number {
  return Math.round((endDate.getTime() - startDate.getTime()) / ONE_DAY_MS) + 1;
}

/**
 * Todas las fechas de `startDate` a `endDate` (ambas incluidas, un día
 * natural cada una) — no una numeración "Día 1..N" arbitraria, para que
 * coincida exactamente con lo que `Day.date` puede guardar. Solo se llama
 * ya sabiendo que el rango está dentro de MAX_MANAGEABLE_DAYS.
 */
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

type DayRow = { date: Date; videoUrl: string; message: string | null };

/**
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: antes
 * `prisma.calendar.findUniqueOrThrow` (rango) + `prisma.day.findMany`
 * (días ya guardados). Se resuelven juntos, mismo motivo que
 * `getCalendarForAdminPage` en la página que monta esta sección — no hay
 * rejilla parcial honesta que mostrar si cualquiera de los dos falla.
 */
async function getDaysSectionData(
  calendarId: string
): Promise<{ startDate: Date; endDate: Date; days: DayRow[] }> {
  void calendarId;
  throw new DataLayerUnavailableError("DaysSection:calendar+days");
}

export async function DaysSection({ calendarId }: { calendarId: string }) {
  const result = await tryDataLayer(() => getDaysSectionData(calendarId));
  if (!result.ok) {
    return (
      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>Días del calendario</h2>
        <p style={{ color: "var(--accent)" }}>Esta sección no está disponible ahora mismo.</p>
      </section>
    );
  }
  const { startDate, endDate, days } = result.data;

  const span = daySpan(startDate, endDate);

  if (span > MAX_MANAGEABLE_DAYS) {
    return (
      <section style={{ marginTop: "2rem" }}>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>Días del calendario</h2>
        <p style={{ color: "var(--accent)" }}>
          Este calendario dura {span} días — más de los {MAX_MANAGEABLE_DAYS} que se pueden gestionar aquí día a
          día. Acorta el rango de fechas arriba antes de asignar vídeos.
        </p>
      </section>
    );
  }

  const dayByDate = new Map(days.map((day) => [toDateInputValue(day.date), day]));
  const dayInfos = datesInRange(startDate, endDate).map((date) => {
    const dateStr = toDateInputValue(date);
    const day = dayByDate.get(dateStr);
    return {
      dateStr,
      label: formatCalendarDate(date),
      videoUrl: day?.videoUrl ?? null,
      message: day?.message ?? null,
    };
  });

  return (
    <section style={{ marginTop: "2rem" }}>
      <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>Días del calendario</h2>
      <DaysGridEditor calendarId={calendarId} days={dayInfos} />
    </section>
  );
}
