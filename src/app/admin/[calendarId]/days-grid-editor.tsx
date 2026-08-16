"use client";

import { useState } from "react";
import { deleteDayAction, saveDayAction } from "@/app/admin/[calendarId]/days-actions";
import { SubmitButton } from "@/components/submit-button";

export type DayInfo = {
  dateStr: string;
  label: string;
  videoUrl: string | null;
  message: string | null;
};

/**
 * Rejilla de días + panel de edición del día seleccionado — más cerca del
 * mockup (`design/mockup-mvp.html`, `#dayGridEditor`/`#dayEditorPanel`) que
 * la lista de un formulario por día de la ronda 1, a petición del PM. Solo
 * un formulario montado a la vez (el del día seleccionado), no uno por
 * cada día del rango — de paso reduce el DOM/trabajo por render frente a
 * la versión anterior.
 */
export function DaysGridEditor({ calendarId, days }: { calendarId: string; days: DayInfo[] }) {
  const [selectedDate, setSelectedDate] = useState(days[0]?.dateStr ?? null);
  const selectedDay = days.find((day) => day.dateStr === selectedDate);

  return (
    <div>
      <div
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: "0.4rem" }}
      >
        {days.map((day) => (
          <button
            key={day.dateStr}
            type="button"
            onClick={() => setSelectedDate(day.dateStr)}
            style={{
              padding: "0.5rem 0.25rem",
              fontSize: "0.8rem",
              border: day.dateStr === selectedDate ? "2px solid var(--accent)" : "1px solid var(--accent)",
              borderRadius: "0.35rem",
              background: day.videoUrl ? "color-mix(in srgb, var(--accent) 25%, transparent)" : "transparent",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            {day.label}
          </button>
        ))}
      </div>

      {selectedDay && (
        <div
          style={{
            marginTop: "1rem",
            border: "1px solid var(--accent)",
            borderRadius: "0.5rem",
            padding: "0.75rem",
            maxWidth: "420px",
          }}
        >
          <h4 style={{ marginBottom: "0.5rem" }}>{selectedDay.label}</h4>
          {/* key: al cambiar de día seleccionado, React desmonta y vuelve a
              montar el formulario en vez de reutilizarlo — si no, los
              `defaultValue` (inputs no controlados) se quedarían con lo que
              hubiera escrito en el día anterior. */}
          <form
            key={selectedDay.dateStr}
            action={saveDayAction.bind(null, calendarId, selectedDay.dateStr)}
            style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}
          >
            <input
              name="videoUrl"
              type="url"
              placeholder="https://…"
              defaultValue={selectedDay.videoUrl ?? ""}
              maxLength={2000}
              required
            />
            <textarea
              name="message"
              placeholder="Mensaje del día (opcional)"
              defaultValue={selectedDay.message ?? ""}
              maxLength={2000}
              rows={3}
            />
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <SubmitButton>Guardar día</SubmitButton>
              {selectedDay.videoUrl && (
                // formNoValidate: el botón "Quitar vídeo" no debe bloquearse
                // por el `required`/`type="url"` del campo de vídeo del
                // MISMO formulario — borrar no depende de que ese campo
                // tenga un valor válido en ese momento (hallazgo de
                // auditoría, ronda 1).
                <button
                  type="submit"
                  formNoValidate
                  formAction={deleteDayAction.bind(null, calendarId, selectedDay.dateStr)}
                >
                  Quitar vídeo
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
