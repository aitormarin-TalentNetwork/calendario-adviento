"use client";

import { useEffect, useState } from "react";
import { deleteDayAction, saveDayAction } from "@/app/admin/[calendarId]/days-actions";
import { SubmitButton } from "@/components/submit-button";
import { groupIntoMonths, isWeekendUTC, parseDateOnlyUTC, todayDateStrInTimeZone } from "@/lib/calendar-grid";
import { coverBackgroundCss } from "@/lib/skin-appearance";
import { parseEmbeddableVideo } from "@/lib/video-embed";

export type DayInfo = {
  dateStr: string;
  label: string;
  videoUrl: string | null;
  message: string | null;
};

const WEEKDAY_INITIALS = ["L", "M", "X", "J", "V", "S", "D"];

/**
 * TAL-21 — mismo grid "calendario de pared" que `door-grid.tsx` (design/
 * design-system.md § "Grid de días"), con el mapeo de estados confirmado
 * por el PM para el editor de Admin (no el mismo que el Invitado): el
 * Admin puede editar cualquier día del rango en cualquier momento, pasado
 * o futuro, así que aquí NUNCA hay estado "bloqueado" (con candado) — solo
 * "sin vídeo asignado" (estilo abierto-sin-ver) y "con vídeo asignado"
 * (estilo visto, con fotograma si hay miniatura real). El borde punteado
 * de "hoy" se combina con cualquiera de los dos, igual que en el Invitado.
 * Además de eso, la casilla seleccionada para editar (concepto propio de
 * este editor, sin equivalente en la vista del Invitado) se marca con un
 * anillo sólido en gold para distinguirla del borde punteado de "hoy".
 */
function cellStyle(day: DayInfo, isToday: boolean, isSelected: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    aspectRatio: "1",
    background: "var(--bg)",
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    border: "none",
    padding: 0,
    fontFamily: "inherit",
    color: "inherit",
    cursor: "pointer",
  };
  if (isToday) {
    base.border = "1.5px dashed var(--accent)";
  }
  if (isSelected) {
    base.boxShadow = "inset 0 0 0 2px var(--accent)";
  }
  if (!day.videoUrl) {
    return { ...base, background: "var(--day-open-bg)" };
  }
  return base;
}

function numStyle(day: DayInfo, isToday: boolean, isWeekend: boolean): React.CSSProperties {
  if (day.videoUrl) {
    return {
      position: "absolute",
      bottom: "5px",
      right: "8px",
      fontSize: "0.82rem",
      fontWeight: 600,
      background: "rgba(15,24,18,0.6)",
      // Hallazgo de auditoría, ronda 1: el color de "hoy" (--accent) tiene
      // que aplicarse SIEMPRE, se combine con el estado que se combine —
      // antes esta rama ignoraba "hoy" por completo.
      color: isToday ? "var(--accent)" : "var(--paper)",
      padding: "1px 6px",
      borderRadius: "999px",
      fontFamily: "var(--font-mono)",
    };
  }
  return {
    fontFamily: "var(--font-body)",
    fontSize: "1.9rem",
    fontWeight: 800,
    color: isToday ? "var(--accent)" : isWeekend ? "var(--weekend-text)" : "var(--text)",
  };
}

/**
 * Rejilla de días + panel de edición del día seleccionado — más cerca del
 * mockup (`design/mockup-mvp.html`, `#dayGridEditor`/`#dayEditorPanel`) que
 * la lista de un formulario por día de la ronda 1, a petición del PM. Solo
 * un formulario montado a la vez (el del día seleccionado), no uno por
 * cada día del rango — de paso reduce el DOM/trabajo por render frente a
 * la versión anterior.
 *
 * TAL-24 — `background` (el `background` real del skin del calendario) se
 * aplica solo a la cabecera sticky de cada mes, mismo criterio que
 * `door-grid.tsx` (ver el comentario completo ahí): no se toca el fondo de
 * las casillas individuales, que codifican los estados de este editor
 * (sin vídeo/con vídeo/hoy/seleccionada) ya auditados en TAL-21.
 */
export function DaysGridEditor({
  calendarId,
  days,
  background,
}: {
  calendarId: string;
  days: DayInfo[];
  background: string;
}) {
  const [selectedDate, setSelectedDate] = useState(days[0]?.dateStr ?? null);
  const selectedDay = days.find((day) => day.dateStr === selectedDate);
  const months = groupIntoMonths(days);

  // TAL-21, hallazgo de auditoría ronda 2: "hoy" NUNCA se calcula en
  // servidor aquí (a diferencia de la ronda anterior, que usaba la cookie
  // `tz` con fallback a UTC si todavía no existía — esa primera respuesta
  // ya salía mal en la primerísima visita de alguien, aunque se corrigiera
  // después). En vez de eso: `null` hasta que el efecto corra tras montar
  // (nunca durante SSR/hidratación, mismo motivo que `NewCalendarSubmit`,
  // TAL-19), momento en el que SIEMPRE hay una zona horaria real
  // disponible (`Intl.DateTimeFormat().resolvedOptions().timeZone` es del
  // propio navegador, no depende de ninguna cookie que pueda no haber
  // llegado todavía) — ningún día se marca "hoy" hasta entonces, en vez de
  // asumir un valor que puede estar mal.
  const [todayStr, setTodayStr] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- excepción deliberada: el valor depende de la zona horaria real del navegador, exclusivamente de cliente — ver el comentario completo arriba.
    setTodayStr(todayDateStrInTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone));
  }, []);

  return (
    <div>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "16px",
          boxShadow: "var(--shadow)",
          background: "var(--bg-raised)",
          overflow: "hidden",
        }}
      >
        <div style={{ maxHeight: "70vh", overflowY: "auto", overflowX: "auto" }}>
          {months.map((month) => (
            <div key={month.key}>
              <div
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 2,
                  // Corrección de auditoría, ronda 1 (TAL-24) — ver el
                  // comentario completo en `door-grid.tsx`, mismo motivo.
                  background: coverBackgroundCss(background),
                  color: "#fff",
                  textShadow: "0 1px 4px rgba(0,0,0,0.5)",
                  fontFamily: "var(--font-display)",
                  fontSize: "1.15rem",
                  padding: "10px 20px",
                }}
              >
                {month.label}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7, minmax(64px, 1fr))",
                  gap: "1px",
                  background: "var(--border)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.68rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--text-dim)",
                }}
              >
                {WEEKDAY_INITIALS.map((initial, i) => (
                  <span
                    key={initial}
                    style={{
                      background: "var(--bg-raised)",
                      textAlign: "center",
                      padding: "6px 0",
                      color: i >= 5 ? "var(--weekend-text)" : undefined,
                      fontWeight: i >= 5 ? 700 : undefined,
                    }}
                  >
                    {initial}
                  </span>
                ))}
              </div>
              {month.weeks.map((week, weekIdx) => (
                <div
                  key={weekIdx}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(7, minmax(64px, 1fr))",
                    gap: "1px",
                    background: "var(--border)",
                  }}
                >
                  {week.map((day, dayIdx) => {
                    if (!day) {
                      return <div key={dayIdx} style={{ aspectRatio: "1", background: "var(--bg-raised)" }} />;
                    }
                    const date = parseDateOnlyUTC(day.dateStr);
                    const isWeekend = isWeekendUTC(date);
                    const dayNum = date.getUTCDate();
                    const isToday = day.dateStr === todayStr;
                    const thumbnailUrl = day.videoUrl ? parseEmbeddableVideo(day.videoUrl)?.thumbnailUrl ?? null : null;
                    const isSelected = day.dateStr === selectedDate;
                    const style = cellStyle(day, isToday, isSelected);
                    if (day.videoUrl) {
                      style.backgroundImage = thumbnailUrl
                        ? `linear-gradient(to top, rgba(10,16,12,0.55), transparent 60%), url("${thumbnailUrl}")`
                        : "linear-gradient(to top, rgba(10,16,12,0.55), transparent 60%), var(--pine)";
                      style.backgroundSize = "cover";
                      style.backgroundPosition = "center";
                    }
                    return (
                      <button
                        key={day.dateStr}
                        type="button"
                        aria-pressed={isSelected}
                        aria-label={`${day.label}${day.videoUrl ? " — vídeo asignado" : " — sin vídeo"}`}
                        onClick={() => setSelectedDate(day.dateStr)}
                        style={style}
                      >
                        <span style={numStyle(day, isToday, isWeekend)}>{dayNum}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
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
