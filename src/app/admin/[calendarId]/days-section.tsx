import { deleteDayAction, saveDayAction } from "@/app/admin/[calendarId]/days-actions";
import { formatCalendarDate } from "@/lib/calendars";
import { prisma } from "@/lib/prisma";

/**
 * Todas las fechas de `startDate` a `endDate` (ambas incluidas, un día
 * calendario cada una) — no una numeración "Día 1..N" arbitraria, para que
 * coincida exactamente con lo que `Day.date` puede guardar.
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

export async function DaysSection({ calendarId }: { calendarId: string }) {
  const calendar = await prisma.calendar.findUniqueOrThrow({
    where: { id: calendarId },
    select: { startDate: true, endDate: true },
  });
  const days = await prisma.day.findMany({ where: { calendarId } });
  const dayByDate = new Map(days.map((day) => [toDateInputValue(day.date), day]));

  const dates = datesInRange(calendar.startDate, calendar.endDate);

  return (
    <section style={{ marginTop: "2rem" }}>
      <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>Días del calendario</h2>
      {/* La UX del mockup (rejilla de días que abre un panel lateral al
          pinchar) requiere estado en cliente para saber qué día está
          seleccionado. Se simplifica aquí a una lista de formularios
          siempre visibles, uno por fecha — mismo patrón que el resto de la
          app (server-rendered, sin JS de cliente más allá de los botones
          ya existentes de pending/confirm) — decisión documentada en
          docs/dias.md. */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {dates.map((date) => {
          const dateStr = toDateInputValue(date);
          const day = dayByDate.get(dateStr);
          return (
            <div
              key={dateStr}
              style={{ border: "1px solid var(--accent)", borderRadius: "0.5rem", padding: "0.75rem" }}
            >
              <strong>{formatCalendarDate(date)}</strong>
              {!day && (
                <span style={{ marginLeft: "0.5rem", fontSize: "0.85rem", color: "var(--accent)" }}>
                  sin vídeo todavía
                </span>
              )}
              <form
                action={saveDayAction.bind(null, calendarId, dateStr)}
                style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.5rem" }}
              >
                <input
                  name="videoUrl"
                  type="url"
                  placeholder="https://…"
                  defaultValue={day?.videoUrl ?? ""}
                  required
                />
                <textarea
                  name="message"
                  placeholder="Mensaje del día (opcional)"
                  defaultValue={day?.message ?? ""}
                  rows={2}
                />
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="submit">Guardar día</button>
                  {day && (
                    <button type="submit" formAction={deleteDayAction.bind(null, calendarId, dateStr)}>
                      Quitar vídeo
                    </button>
                  )}
                </div>
              </form>
            </div>
          );
        })}
      </div>
    </section>
  );
}
