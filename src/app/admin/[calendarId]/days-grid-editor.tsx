"use client";

import { useEffect, useRef, useState } from "react";
import { deleteDayAction, saveDayAction } from "@/app/admin/[calendarId]/days-actions";
import { SubmitButton } from "@/components/submit-button";
import { groupIntoMonths, isWeekendUTC, parseDateOnlyUTC, todayDateStrInTimeZone } from "@/lib/calendar-grid";
import { coverBackgroundStyle } from "@/lib/skin-appearance";
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
 * Además de eso, la casilla cuyo diálogo de edición está abierto (concepto
 * propio de este editor, sin equivalente en la vista del Invitado — TAL-34:
 * ya no es una selección persistente que abre un panel debajo del grid,
 * sino solo mientras el diálogo está abierto) se marca con un anillo sólido
 * en gold para distinguirla del borde punteado de "hoy".
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
 * Rejilla de días + diálogo de edición del día seleccionado (TAL-34 —
 * antes, un panel inline debajo del grid; design/design-system.md §
 * "Editor de calendario"/"Grid de días", design/propuesta-editor-
 * calendario.html). Solo un formulario montado a la vez (el del día abierto
 * en el diálogo), no uno por cada día del rango — de paso reduce el
 * DOM/trabajo por render frente a un formulario por casilla.
 *
 * Patrón de diálogo (foco inicial en el botón de cerrar, Escape para
 * cerrar, clic en el fondo cierra, foco devuelto a la casilla que lo abrió)
 * — mismo ya establecido en `door-grid.tsx` (modal de vídeo del Invitado) y
 * reutilizado en `cover-icon-picker.tsx` (TAL-33), no un mecanismo nuevo.
 * A diferencia de `cover-icon-picker.tsx` (que es su propio disparador), el
 * disparador aquí es una de muchas casillas del grid — mismo motivo por el
 * que `door-grid.tsx` guarda el botón concreto que abrió el modal
 * (`lastTriggerRef`) en vez de asumir un único disparador fijo.
 *
 * TAL-24 — `background` (el `background` real del skin del calendario) se
 * aplica solo a la cabecera sticky de cada mes, mismo criterio que
 * `door-grid.tsx` (ver el comentario completo ahí): no se toca el fondo de
 * las casillas individuales, que codifican los estados de este editor
 * (sin vídeo/con vídeo/hoy/diálogo abierto) ya auditados en TAL-21.
 *
 * TAL-39 — `backgroundImageUrl`, si el calendario tiene uno, sustituye ese
 * mismo `background` del skin en la cabecera de mes (`coverBackgroundStyle`,
 * `skin-appearance.ts`) — el resto de la cabecera (texto blanco + sombra)
 * no cambia, sigue siendo legible con la misma capa de oscurecimiento.
 */
export function DaysGridEditor({
  calendarId,
  days,
  background,
  backgroundImageUrl,
}: {
  calendarId: string;
  days: DayInfo[];
  background: string;
  backgroundImageUrl: string | null;
}) {
  // TAL-34 — ya no arranca con el primer día "seleccionado" por defecto (la
  // ronda anterior abría el panel del día 1 nada más cargar la página, sin
  // que nadie hubiera hecho clic); el diálogo solo se abre tras un clic real
  // en una casilla.
  const [openDate, setOpenDate] = useState<string | null>(null);
  const openDay = days.find((day) => day.dateStr === openDate);
  const months = groupIntoMonths(days);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);

  function closeDialog() {
    setOpenDate(null);
    // Devuelve el foco a la casilla que abrió el diálogo — mismo motivo que
    // `door-grid.tsx::closeModal`.
    lastTriggerRef.current?.focus();
  }

  function openDialogFor(day: DayInfo, trigger: HTMLButtonElement) {
    lastTriggerRef.current = trigger;
    setOpenDate(day.dateStr);
  }

  useEffect(() => {
    if (!openDay) return;
    closeButtonRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeDialog();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openDay]);

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
                  // TAL-39: `coverBackgroundStyle` sustituye el color/
                  // degradado del skin por `backgroundImageUrl` cuando el
                  // calendario tiene uno puesto.
                  ...coverBackgroundStyle(background, backgroundImageUrl),
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
                  {week.map((cell, dayIdx) => {
                    // TAL-31 — el mes completo (sin huecos, numerado desde
                    // el 1) es un cambio pedido solo para la vista de
                    // Invitado (ver `door-grid.tsx`) — aquí, fuera de
                    // alcance, un día "out-of-range" se sigue tratando
                    // igual que el relleno de alineación de semana
                    // (`padding`), en blanco, mismo comportamiento que
                    // antes de TAL-31.
                    if (cell.kind !== "item") {
                      return <div key={dayIdx} style={{ aspectRatio: "1", background: "var(--bg-raised)" }} />;
                    }
                    const day = cell.item;
                    const date = parseDateOnlyUTC(day.dateStr);
                    const isWeekend = isWeekendUTC(date);
                    const dayNum = date.getUTCDate();
                    const isToday = day.dateStr === todayStr;
                    const thumbnailUrl = day.videoUrl ? parseEmbeddableVideo(day.videoUrl)?.thumbnailUrl ?? null : null;
                    const isOpen = day.dateStr === openDate;
                    const style = cellStyle(day, isToday, isOpen);
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
                        aria-pressed={isOpen}
                        aria-label={`${day.label}${day.videoUrl ? " — vídeo asignado" : " — sin vídeo"}`}
                        onClick={(event) => openDialogFor(day, event.currentTarget)}
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

      {openDay && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Editar día — ${openDay.label}`}
          onClick={closeDialog}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1.5rem",
            zIndex: 50,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              background: "var(--bg-raised)",
              border: "1px solid var(--border)",
              borderRadius: "16px",
              maxWidth: "420px",
              width: "100%",
              maxHeight: "82vh",
              overflowY: "auto",
              padding: "22px 24px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
              <h4 style={{ fontFamily: "var(--font-display)", fontSize: "1.05rem" }}>{openDay.label}</h4>
              <button ref={closeButtonRef} type="button" onClick={closeDialog} aria-label="Cerrar" style={{ background: "none", border: "none", color: "var(--text-dim)", fontSize: "1.1rem", cursor: "pointer" }}>
                ✕
              </button>
            </div>
            {/* key: al cambiar de día, se desmonta y vuelve a montar en vez de
                reutilizar — si no, los `defaultValue` (inputs no
                controlados) y la pestaña del segmentado se quedarían con lo
                del día anterior. */}
            <DayDialogForm key={openDay.dateStr} calendarId={calendarId} day={openDay} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * TAL-34 — segmentado "Link externo"/"Subir archivo" (design/propuesta-
 * editor-calendario.html `.segmented`). El brief es explícito en que esta
 * tarea es solo de presentación, no toca lógica de guardado — y no existe
 * (todavía) ninguna mutation/almacenamiento de Convex para subir un archivo
 * de vídeo real (`days-actions.ts::saveDayAction` solo acepta una URL
 * https:// externa). En vez de fingir un campo de subida que no manda nada
 * a ningún sitio, la pestaña "Subir archivo" muestra un aviso y desactiva
 * "Guardar día" mientras está activa — la única fuente de vídeo que
 * funciona de verdad hoy sigue siendo "Link externo".
 */
function DayDialogForm({ calendarId, day }: { calendarId: string; day: DayInfo }) {
  const [videoSource, setVideoSource] = useState<"link" | "upload">("link");

  return (
    <form
      action={saveDayAction.bind(null, calendarId, day.dateStr)}
      style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}
    >
      <div
        style={{
          display: "flex",
          border: "1px solid var(--border)",
          borderRadius: "999px",
          overflow: "hidden",
          width: "fit-content",
          margin: "10px 0 4px",
        }}
      >
        {(
          [
            ["link", "Link externo"],
            ["upload", "Subir archivo"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={videoSource === value}
            onClick={() => setVideoSource(value)}
            style={{
              border: "none",
              padding: "6px 16px",
              fontSize: "0.82rem",
              fontFamily: "var(--font-body)",
              cursor: "pointer",
              background: videoSource === value ? "var(--gold)" : "transparent",
              color: videoSource === value ? "#241a06" : "var(--text-dim)",
              fontWeight: videoSource === value ? 600 : 400,
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {videoSource === "link" ? (
        <>
          <label htmlFor={`day-videoUrl-${day.dateStr}`} style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim)" }}>
            URL del vídeo
          </label>
          <input
            id={`day-videoUrl-${day.dateStr}`}
            name="videoUrl"
            type="url"
            placeholder="https://…"
            defaultValue={day.videoUrl ?? ""}
            maxLength={2000}
            required
          />
        </>
      ) : (
        <p style={{ color: "var(--text-dim)", fontSize: "0.85rem", margin: "4px 0" }}>
          Subida de archivos: todavía no disponible. Usa un link externo por ahora.
        </p>
      )}

      <label htmlFor={`day-message-${day.dateStr}`} style={{ fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim)", marginTop: "6px" }}>
        Mensaje del día (opcional)
      </label>
      <textarea
        id={`day-message-${day.dateStr}`}
        name="message"
        placeholder="Mensaje del día (opcional)"
        defaultValue={day.message ?? ""}
        maxLength={2000}
        rows={3}
      />
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
        <SubmitButton disabled={videoSource === "upload"}>Guardar día</SubmitButton>
        {day.videoUrl && (
          // formNoValidate: el botón "Quitar vídeo" no debe bloquearse por el
          // `required`/`type="url"` del campo de vídeo del MISMO formulario
          // — borrar no depende de que ese campo tenga un valor válido en
          // ese momento (hallazgo de auditoría, ronda 1, TAL-21).
          <button type="submit" formNoValidate formAction={deleteDayAction.bind(null, calendarId, day.dateStr)}>
            Quitar vídeo
          </button>
        )}
      </div>
    </form>
  );
}
