"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { markDayViewedAction } from "@/app/c/[calendarId]/actions";
import { parseEmbeddableVideo } from "@/lib/video-embed";
import type { DoorInfo } from "@/lib/guest-calendar";

function doorStyle(door: DoorInfo, thumbnailUrl: string | null): React.CSSProperties {
  const base: React.CSSProperties = {
    aspectRatio: "0.85",
    borderRadius: "0.6rem",
    border: "1px solid var(--accent)",
    padding: "0.5rem",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    alignItems: "flex-start",
    color: "inherit",
    fontFamily: "inherit",
    position: "relative",
  };

  if (door.state === "locked") {
    return { ...base, opacity: 0.5, cursor: "default", background: "transparent" };
  }
  if (door.state === "watched") {
    return {
      ...base,
      cursor: "pointer",
      color: thumbnailUrl ? "#fff" : "inherit",
      background: thumbnailUrl
        ? `linear-gradient(to top, rgba(0,0,0,0.65), rgba(0,0,0,0.1)), url("${thumbnailUrl}") center / cover`
        : "color-mix(in srgb, var(--accent) 30%, transparent)",
    };
  }
  // unseen
  return {
    ...base,
    cursor: "pointer",
    background: "color-mix(in srgb, var(--accent) 12%, transparent)",
    boxShadow: "0 0 0 1px var(--accent)",
  };
}

/**
 * Rejilla de puertas + modal — mismo patrón que
 * `days-grid-editor.tsx` (TAL-6): componente cliente porque necesita
 * estado (qué puerta está abierta), pero el contenido (vídeo/mensaje de
 * cada puerta desbloqueada) ya viene resuelto en `doors` desde el
 * servidor, sin una segunda petición al abrir el modal.
 */
export function DoorGrid({ calendarId, doors: initialDoors }: { calendarId: string; doors: DoorInfo[] }) {
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
    // a asignarlo) no cuenta como "visto".
    if (door.dayId && door.state === "unseen") {
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

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: "0.5rem" }}>
        {doors.map((door) => {
          const thumbnailUrl = door.state === "watched" && door.videoUrl ? parseEmbeddableVideo(door.videoUrl)?.thumbnailUrl ?? null : null;
          return (
            <button
              key={door.dateStr}
              type="button"
              disabled={door.state === "locked"}
              onClick={(event) => handleOpen(door, event.currentTarget)}
              style={doorStyle(door, thumbnailUrl)}
            >
              <span style={{ fontSize: "0.7rem", fontWeight: 600 }}>{door.label}</span>
              {door.state === "locked" && <span aria-hidden="true">🔒</span>}
              {door.isToday && <span style={{ fontSize: "0.6rem", color: "var(--accent)" }}>hoy</span>}
            </button>
          );
        })}
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
