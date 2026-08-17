"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { markDayViewedAction } from "@/app/c/[calendarId]/actions";
import { groupIntoMonths, isWeekendUTC, parseDateOnlyUTC } from "@/lib/calendar-grid";
import { parseEmbeddableVideo } from "@/lib/video-embed";
import type { DoorInfo } from "@/lib/guest-calendar";
import { coverBackgroundStyle } from "@/lib/skin-appearance";

const WEEKDAY_INITIALS = ["L", "M", "X", "J", "V", "S", "D"];

/**
 * TAL-39 — el fondo del modal ahora es `coverBackgroundStyle` (color/
 * degradado del skin, u opcionalmente `backgroundImageUrl`), siempre con
 * la misma capa de oscurecimiento que ya usa la cabecera de portada
 * (`page.tsx::coverTextStyle`) — así que su texto necesita el mismo
 * tratamiento (blanco + sombra), no el `color: inherit`/`var(--accent)`
 * de antes, pensado para el fondo fijo (`var(--background)`) que tenía el
 * modal antes de esta tarea. Mismo motivo/contraste ya verificado
 * matemáticamente en `skin-appearance.ts` para la cabecera de portada.
 */
const modalTextStyle: React.CSSProperties = { color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,0.5)" };

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
    // Ajuste 2026-08-17 (design-system.md § "Grid de días"): "hoy" tiene
    // que notarse claramente de un vistazo, no solo al fijarse — borde
    // más grueso (2px, antes 1.5px) + fondo sutil en --gold al 10% de
    // opacidad (token fijo, no --accent: "hoy" es una marca universal,
    // no depende del skin elegido). `boxShadow` inset con spread grande
    // en vez de `background`/`backgroundImage`: esta celda puede
    // combinar "hoy" con cualquier otro estado (abierto, bloqueado,
    // visto-con-miniatura) que ya ocupa esas dos propiedades más abajo —
    // el box-shadow se pinta como una capa aparte encima, sin pisarlas.
    base.border = "2px dashed var(--accent)";
    base.boxShadow = "inset 0 0 0 999px color-mix(in srgb, var(--gold) 10%, transparent)";
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

/**
 * TAL-31 — día real del mes pero fuera de [startDate, endDate] del
 * calendario (p. ej. el calendario empieza el 12 de un mes que arranca en
 * lunes 1: los días 1-11 existen en el mes pero no en el calendario).
 * Antes esta celda quedaba en blanco, indistinguible del relleno de
 * alineación de semana (fuera del propio mes) — Aitor pidió que el mes se
 * vea siempre completo: número grande estilo "marca de agua" (opacity
 * baja), sin candado, sin fondo de estado, sin click — no es un día
 * "bloqueado" (ese sí es interactivo, dentro del rango pero en el
 * futuro), es un día que no pertenece a este calendario en absoluto.
 */
const outOfRangeCellStyle: React.CSSProperties = {
  aspectRatio: "1",
  background: "var(--bg)",
  position: "relative",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const outOfRangeNumStyle: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontWeight: 800,
  color: "var(--text)",
  // Ajustado a 0.15 para encajar con el borrador en vivo de
  // design-system.md § "Responsive / Mobile" (opacity baja, ejemplo
  // explícito 0.15) confirmado por la Directora — no venía de ningún
  // documento commiteado en el momento en que se escribió este valor,
  // así que se corrige aquí en cuanto se conoció el número exacto.
  opacity: 0.15,
};

/**
 * `fontSize` deliberadamente FUERA de estos objetos (antes vivía aquí) —
 * un `style` inline gana siempre a cualquier regla de una hoja de
 * estilos, con o sin `@media`, así que si el tamaño de fuente se fija
 * aquí no hay forma de que la regla `@media (max-width: ...)` del
 * `<style jsx>` de más abajo la reduzca en mobile. El tamaño ahora lo
 * pone `className` (`.dg-num`/`.dg-num-locked`/`.dg-num-pill`) — este
 * objeto solo controla lo que SÍ varía por estado/día (posición, color,
 * fondo), no el tamaño.
 */
function numStyle(door: DoorInfo, isWeekend: boolean): React.CSSProperties {
  if (door.state === "watched") {
    return {
      position: "absolute",
      bottom: "5px",
      right: "8px",
      fontWeight: 600,
      background: "rgba(15,24,18,0.6)",
      // Hallazgo de auditoría, ronda 1: el color de "hoy" (--accent) tiene
      // que aplicarse SIEMPRE, se combine con el estado que se combine —
      // antes esta rama ignoraba `isToday` por completo, así que abrir el
      // vídeo de hoy mismo (unseen → watched, cambio optimista) apagaba el
      // número dorado a --paper en el propio clic.
      color: door.isToday ? "var(--accent)" : "var(--paper)",
      borderRadius: "999px",
      fontFamily: "var(--font-mono)",
    };
  }
  return {
    fontFamily: "var(--font-body)",
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
 * nada aquí. El modal SÍ gana un borde de acento (más abajo, TAL-24) y
 * ahora también un fondo (TAL-39, ver el comentario siguiente) — el
 * iframe en sí no se toca en ningún caso, como pide el brief.
 *
 * TAL-39 — `backgroundImageUrl`, si el calendario tiene uno, sustituye el
 * `background` del skin en los dos sitios que ya usaban
 * `coverBackgroundCss(background)`: la cabecera de mes de aquí abajo Y el
 * modal de vídeo (antes con un fondo fijo `var(--background)`, sin
 * relación con el skin) — ver `coverBackgroundStyle`, `skin-appearance.ts`.
 */
export function DoorGrid({
  calendarId,
  doors: initialDoors,
  background,
  backgroundImageUrl,
}: {
  calendarId: string;
  doors: DoorInfo[];
  background: string;
  backgroundImageUrl: string | null;
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
      {/*
        Responsive del grid de días (design-system.md § "Responsive /
        Mobile", ajuste 2026-08-17, pedido explícito de Aitor): "mantiene
        siempre 7 columnas en cualquier ancho — nunca colapsa a menos
        columnas. Lo que se reduce es tipografía/padding de cada
        casilla, no la estructura" — antes el grid usaba
        `minmax(64px, 1fr)` + scroll horizontal como salida de emergencia
        en estrecho; con eso, el mes deja de leerse "de un vistazo" (hay
        que desplazar para ver la semana completa), justo lo que el PM no
        quiere. Ahora las columnas son `1fr` sin suelo mínimo (se
        reparten el ancho disponible siempre, nunca desbordan) y en su
        lugar se reduce tipografía/padding vía las clases de abajo — el
        único breakpoint que pide el documento normativo es 640px; se
        añade uno más estrecho (380px) porque a 640px, en un móvil
        realmente angosto (~320-375px de viewport), la reducción de un
        solo escalón no basta para que el número de día quepa cómodo en
        una casilla de ~45-50px — sugerencia de implementación del PM
        (dos escalones), no una desviación silenciosa.
      */}
      <style jsx>{`
        .dg-month-header {
          font-size: 1.15rem;
          padding: 10px 20px;
        }
        .dg-weekday-row {
          font-size: 0.68rem;
        }
        .dg-num {
          font-size: 1.9rem;
        }
        .dg-num-locked {
          font-size: 1.45rem;
        }
        .dg-num-pill {
          font-size: 0.82rem;
          padding: 1px 6px;
        }
        .dg-lock-icon {
          font-size: 0.7rem;
        }
        @media (max-width: 640px) {
          .dg-month-header {
            font-size: 0.95rem;
            padding: 8px 12px;
          }
          .dg-weekday-row {
            font-size: 0.62rem;
          }
          .dg-num {
            font-size: 1.5rem;
          }
          .dg-num-locked {
            font-size: 1.15rem;
          }
          .dg-num-pill {
            font-size: 0.7rem;
            padding: 1px 4px;
          }
        }
        @media (max-width: 380px) {
          .dg-month-header {
            font-size: 0.85rem;
            padding: 6px 10px;
          }
          .dg-weekday-row {
            font-size: 0.56rem;
          }
          .dg-num {
            font-size: 1.15rem;
          }
          .dg-num-locked {
            font-size: 0.9rem;
          }
          .dg-num-pill {
            font-size: 0.6rem;
            padding: 1px 3px;
          }
          .dg-lock-icon {
            font-size: 0.6rem;
          }
        }
      `}</style>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: "16px",
          boxShadow: "var(--shadow)",
          background: "var(--bg-raised)",
          overflow: "hidden",
        }}
      >
        <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
          {months.map((month) => (
            <div key={month.key}>
              <div
                className="dg-month-header"
                style={{
                  position: "sticky",
                  top: 0,
                  zIndex: 2,
                  // Corrección de auditoría, ronda 1 (TAL-24):
                  // `coverBackgroundStyle` antepone una capa de
                  // oscurecimiento uniforme al `background` del skin (o a
                  // `backgroundImageUrl`, TAL-39, si el calendario tiene
                  // uno) — sin ella, un skin claro (p. ej. "Nieve", que
                  // llega a `#ffffff`) dejaba el texto blanco ilegible.
                  // Cálculo completo de por qué garantiza contraste en
                  // `src/lib/skin-appearance.ts`.
                  ...coverBackgroundStyle(background, backgroundImageUrl),
                  color: "#fff",
                  textShadow: "0 1px 4px rgba(0,0,0,0.5)",
                  fontFamily: "var(--font-display)",
                }}
              >
                {month.label}
              </div>
              <div
                className="dg-weekday-row"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7, 1fr)",
                  gap: "1px",
                  background: "var(--border)",
                  fontFamily: "var(--font-mono)",
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
                    gridTemplateColumns: "repeat(7, 1fr)",
                    gap: "1px",
                    background: "var(--border)",
                  }}
                >
                  {week.map((cell, dayIdx) => {
                    if (cell.kind === "padding") {
                      return <div key={dayIdx} style={{ aspectRatio: "1", background: "var(--bg-raised)" }} />;
                    }
                    if (cell.kind === "out-of-range") {
                      return (
                        <div key={cell.dateStr} aria-hidden="true" style={outOfRangeCellStyle}>
                          <span className="dg-num" style={outOfRangeNumStyle}>
                            {cell.dayNum}
                          </span>
                        </div>
                      );
                    }
                    const door = cell.item;
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
                    const numClassName =
                      door.state === "watched" ? "dg-num-pill" : door.state === "locked" ? "dg-num-locked" : "dg-num";
                    return (
                      <button
                        key={door.dateStr}
                        type="button"
                        disabled={door.state === "locked"}
                        aria-label={`${door.label}${door.state === "locked" ? " — bloqueado" : door.state === "watched" ? " — ya visto" : ""}`}
                        onClick={(event) => handleOpen(door, event.currentTarget)}
                        style={style}
                      >
                        <span className={numClassName} style={numStyle(door, isWeekend)}>
                          {dayNum}
                        </span>
                        {door.state === "locked" && (
                          <span
                            aria-hidden="true"
                            className="dg-lock-icon"
                            style={{ position: "absolute", bottom: "6px", right: "8px" }}
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
              // TAL-24 — brief: "aplica el acento del skin de forma
              // consistente (borde, o algún detalle visual — el iframe en
              // sí no se toca)". `--accent` ya está heredado desde
              // `page.tsx`, así que no hace falta pasar el skin explícito
              // aquí también.
              border: "2px solid var(--accent)",
              // TAL-39 — antes un fondo fijo (`var(--background)`, sin
              // relación con el skin); el brief pide el modal como una de
              // las 3 pantallas con el mismo alcance que un skin
              // (`coverBackgroundStyle`, sustituye por `backgroundImageUrl`
              // si el calendario tiene uno) — mismo mecanismo que la
              // cabecera de mes de arriba y la cabecera de portada
              // (`page.tsx`).
              ...coverBackgroundStyle(background, backgroundImageUrl),
              borderRadius: "1rem",
              maxWidth: "480px",
              width: "100%",
              padding: "1.25rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <h3 style={modalTextStyle}>{openDoor.label}</h3>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeModal}
                aria-label="Cerrar"
                style={modalTextStyle}
              >
                ✕
              </button>
            </div>
            {openDoor.videoUrl ? (
              <VideoPlayer url={openDoor.videoUrl} label={openDoor.label} />
            ) : (
              <p style={{ ...modalTextStyle, marginTop: "0.75rem" }}>Todavía no hay vídeo para este día.</p>
            )}
            {openDoor.message && <p style={{ ...modalTextStyle, marginTop: "0.75rem" }}>{openDoor.message}</p>}
            {markError && (
              // TAL-39, ronda 2 (NO-GO de auditoría, ronda 1): este texto se
              // quedó con su color rojo original (`#e35b5b`) cuando el resto
              // del modal pasó a `modalTextStyle` — válido contra el fondo
              // FIJO que tenía el modal antes de esta tarea, pero no contra
              // la nueva capa de oscurecimiento (`coverBackgroundStyle`), que
              // puede dejar el contraste tan bajo como ~1.37:1 (auditor,
              // verificado matemáticamente) — muy por debajo del 4.5:1 de
              // WCAG AA. Mismo cálculo que ya hizo TAL-24 (ronda 1): el peor
              // caso posible de fondo compuesto con la capa al 60% es
              // `rgb(102,102,102)` (skin blanco), así que CUALQUIER color
              // salvo uno muy próximo al blanco no puede garantizar 4.5:1
              // ahí — un rojo más claro (p. ej. `--berry-2`) seguiría sin
              // bastar. `modalTextStyle` (blanco + sombra) es la única
              // opción de esta paleta con margen de sobra en el peor caso
              // (mismo 5.74:1 ya verificado en `skin-appearance.ts`);
              // `fontWeight` en vez de color distingue visualmente que es un
              // aviso urgente sin depender de un rojo que no puede
              // garantizar su propio contraste aquí.
              <p role="alert" style={{ ...modalTextStyle, fontWeight: 700, marginTop: "0.75rem", fontSize: "0.85rem" }}>
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
    <p style={{ ...modalTextStyle, marginTop: "0.75rem" }}>
      <a href={url} target="_blank" rel="noopener noreferrer" style={modalTextStyle}>
        Ver vídeo ↗
      </a>
    </p>
  );
}
