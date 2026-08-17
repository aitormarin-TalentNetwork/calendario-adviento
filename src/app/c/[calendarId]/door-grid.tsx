"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { markDayViewedAction } from "@/app/c/[calendarId]/actions";
import { groupIntoMonths, isWeekendUTC, parseDateOnlyUTC } from "@/lib/calendar-grid";
import { parseEmbeddableVideo } from "@/lib/video-embed";
import type { DoorInfo } from "@/lib/guest-calendar";
import { coverBackgroundCss } from "@/lib/skin-appearance";

const WEEKDAY_INITIALS = ["L", "M", "X", "J", "V", "S", "D"];

function cellStyle(door: DoorInfo): React.CSSProperties {
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
  };
  if (door.isToday) {
    base.border = "1.5px dashed var(--accent)";
  }
  if (door.state === "locked") {
    return { ...base, opacity: 0.4, cursor: "default" };
  }
  if (door.state === "watched") {
    return { ...base, cursor: "pointer" };
  }
  // unseen ("abierto, sin ver")
  return { ...base, cursor: "pointer", background: "var(--day-open-bg)" };
}

function numStyle(door: DoorInfo, isWeekend: boolean): React.CSSProperties {
  if (door.state === "watched") {
    return {
      position: "absolute",
      bottom: "5px",
      right: "8px",
      fontSize: "0.82rem",
      fontWeight: 600,
      background: "rgba(15,24,18,0.6)",
      // Hallazgo de auditoría, ronda 1: el color de "hoy" (--accent) tiene
      // que aplicarse SIEMPRE, se combine con el estado que se combine —
      // antes esta rama ignoraba `isToday` por completo, así que abrir el
      // vídeo de hoy mismo (unseen → watched, cambio optimista) apagaba el
      // número dorado a --paper en el propio clic.
      color: door.isToday ? "var(--accent)" : "var(--paper)",
      padding: "1px 6px",
      borderRadius: "999px",
      fontFamily: "var(--font-mono)",
    };
  }
  return {
    fontFamily: "var(--font-body)",
    fontSize: door.state === "locked" ? "1.45rem" : "1.9rem",
    fontWeight: 800,
    color: door.isToday ? "var(--accent)" : isWeekend ? "var(--weekend-text)" : "var(--text)",
  };
}

/**
 * Rejilla de puertas + modal — mismo patrón que
 * `days-grid-editor.tsx` (TAL-6): componente cliente porque necesita
 * estado (qué puerta está abierta), pero el contenido (vídeo/mensaje de
 * cada puerta desbloqueada) ya viene resuelto en `doors` desde el
 * servidor, sin una segunda petición al abrir el modal.
 *
 * TAL-21 — grid rediseñado como "calendario de pared" real (design/
 * design-system.md § "Grid de días"): filas de 7 (lunes a domingo)
 * agrupadas por mes, cabecera de mes sticky, número grande sans-serif
 * (`--font-body`, nunca `--font-display` — decisión explícita del Design
 * System), fin de semana en `--berry`.
 *
 * TAL-24 — `background` (el `background` real del skin del calendario,
 * `src/lib/skin-appearance.ts`) se aplica SOLO a la cabecera sticky de
 * cada mes (antes un `--pine` fijo) — decisión deliberada de NO tocar el
 * fondo de las casillas individuales (`cellStyle`, más abajo): esas ya
 * codifican los 4 estados (bloqueado/abierto/visto/hoy) que TAL-21 acaba
 * de auditar, y aplicar un degradado arbitrario del skin ahí arriesgaba
 * romper ese contraste ya validado. El acento (`--accent`, heredado desde
 * `page.tsx` — las custom properties CSS heredan por el árbol del DOM sin
 * importar límites de componente) ya tiñe el borde de "hoy" sin tocar
 * nada aquí. El modal SÍ gana un borde de acento (más abajo) — el iframe
 * en sí no se toca, como pide el brief.
 */
export function DoorGrid({
  calendarId,
  doors: initialDoors,
  background,
}: {
  calendarId: string;
  doors: DoorInfo[];
  background: string;
}) {
  const [doors, setDoors] = useState(initialDoors);
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [markError, setMarkError] = useState(false);
  const [, startTransition] = useTransition();
  const openDoor = doors.find((door) => door.dateStr === openDate);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);

  function closeModal() {
    setOpenDate(null);
    // Devuelve el foco a la puerta que abrió el modal — sin esto, tras
    // cerrar con Escape o con el botón "✕" el foco del teclado se queda
    // "colgado" en un elemento que ya no está en pantalla.
    lastTriggerRef.current?.focus();
  }

  // Cierre con Escape (además del click en el fondo y el botón "✕") y foco
  // inicial en el botón de cerrar al abrir — comportamiento estándar de
  // diálogo modal, hallazgo de auditoría (no bloqueante, ronda 1).
  useEffect(() => {
    if (!openDoor) return;
    closeButtonRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeModal();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openDoor]);

  function handleOpen(door: DoorInfo, trigger: HTMLButtonElement) {
    if (door.state === "locked") return;
    lastTriggerRef.current = trigger;
    setMarkError(false);
    setOpenDate(door.dateStr);

    // Solo hay algo que marcar como visto si el día tiene vídeo asignado
    // y todavía no se había visto — abrir un día sin vídeo (Admin no llegó
    // a asignarlo) no cuenta como "visto". `door.dayId` implica
    // `door.videoUrl` en la práctica (Day.videoUrl no es nullable en el
    // schema), pero se comprueba explícito para que la condición diga
    // literalmente lo mismo que este comentario, sin depender de esa
    // invariante externa.
    if (door.dayId && door.videoUrl && door.state === "unseen") {
      startTransition(async () => {
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const result = await markDayViewedAction(calendarId, door.dayId!, timeZone);
        if (result.ok) {
          setDoors((prev) =>
            prev.map((d) => (d.dateStr === door.dateStr ? { ...d, state: "watched" as const } : d))
          );
        } else {
          setMarkError(true);
        }
      });
    }
  }

  const months = groupIntoMonths(doors);

  return (
    <>
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
                  // Corrección de auditoría, ronda 1 (TAL-24):
                  // `coverBackgroundCss` antepone una capa de
                  // oscurecimiento uniforme al `background` del skin —
                  // sin ella, un skin claro (p. ej. "Nieve", que llega a
                  // `#ffffff`) dejaba el texto blanco ilegible. Cálculo
                  // completo de por qué garantiza contraste en
                  // `src/lib/skin-appearance.ts`.
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
                  {week.map((door, dayIdx) => {
                    if (!door) {
                      return <div key={dayIdx} style={{ aspectRatio: "1", background: "var(--bg-raised)" }} />;
                    }
                    const date = parseDateOnlyUTC(door.dateStr);
                    const isWeekend = isWeekendUTC(date);
                    const dayNum = date.getUTCDate();
                    const thumbnailUrl =
                      door.state === "watched" && door.videoUrl
                        ? parseEmbeddableVideo(door.videoUrl)?.thumbnailUrl ?? null
                        : null;
                    const style = cellStyle(door);
                    if (door.state === "watched") {
                      style.backgroundImage = thumbnailUrl
                        ? `linear-gradient(to top, rgba(10,16,12,0.55), transparent 60%), url("${thumbnailUrl}")`
                        : "linear-gradient(to top, rgba(10,16,12,0.55), transparent 60%), var(--pine)";
                      style.backgroundSize = "cover";
                      style.backgroundPosition = "center";
                    }
                    return (
                      <button
                        key={door.dateStr}
                        type="button"
                        disabled={door.state === "locked"}
                        aria-label={`${door.label}${door.state === "locked" ? " — bloqueado" : door.state === "watched" ? " — ya visto" : ""}`}
                        onClick={(event) => handleOpen(door, event.currentTarget)}
                        style={style}
                      >
                        <span style={numStyle(door, isWeekend)}>{dayNum}</span>
                        {door.state === "locked" && (
                          <span
                            aria-hidden="true"
                            style={{ position: "absolute", bottom: "6px", right: "8px", fontSize: "0.7rem" }}
                          >
                            🔒
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {openDoor && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={openDoor.label}
          onClick={closeModal}
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
              background: "var(--background)",
              // TAL-24 — brief: "aplica el acento del skin de forma
              // consistente (borde, o algún detalle visual — el iframe en
              // sí no se toca)". `--accent` ya está heredado desde
              // `page.tsx`, así que no hace falta pasar el skin explícito
              // aquí también.
              border: "2px solid var(--accent)",
              borderRadius: "1rem",
              maxWidth: "480px",
              width: "100%",
              padding: "1.25rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h3>{openDoor.label}</h3>
              <button ref={closeButtonRef} type="button" onClick={closeModal} aria-label="Cerrar">
                ✕
              </button>
            </div>
            {openDoor.videoUrl ? (
              <VideoPlayer url={openDoor.videoUrl} label={openDoor.label} />
            ) : (
              <p style={{ color: "var(--accent)", marginTop: "0.75rem" }}>Todavía no hay vídeo para este día.</p>
            )}
            {openDoor.message && <p style={{ marginTop: "0.75rem" }}>{openDoor.message}</p>}
            {markError && (
              <p role="alert" style={{ color: "#e35b5b", marginTop: "0.75rem", fontSize: "0.85rem" }}>
                No se ha podido guardar que has visto este día. Ciérralo y vuelve a intentarlo.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function VideoPlayer({ url, label }: { url: string; label: string }) {
  const embed = parseEmbeddableVideo(url);
  if (embed) {
    return (
      <div style={{ aspectRatio: "16/9", marginTop: "0.75rem" }}>
        <iframe
          title={`Vídeo del ${label}`}
          src={embed.embedUrl}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ width: "100%", height: "100%", border: "none", borderRadius: "0.5rem" }}
        />
      </div>
    );
  }
  return (
    <p style={{ marginTop: "0.75rem" }}>
      <a href={url} target="_blank" rel="noopener noreferrer">
        Ver vídeo ↗
      </a>
    </p>
  );
}
