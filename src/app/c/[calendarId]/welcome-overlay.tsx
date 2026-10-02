"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { markWelcomeSeenAction } from "@/app/c/[calendarId]/welcome-actions";

/** Si la foto no ha cargado en este tiempo, no hay bienvenida (nunca una pantalla rota). */
const PHOTO_TIMEOUT_MS = 6000;

type Phase = "loading" | "shown" | "closed";

/**
 * TAL-70 — bienvenida con la foto de portada a pantalla completa
 * (design-system.md § "Bienvenida con foto (después de entrar)",
 * `design/propuesta-bienvenida.html` pantalla 2). `page.tsx` solo la monta
 * si el calendario tiene foto, hay cookie `tz` y la persona aún no la ha
 * visto hoy en este calendario.
 *
 * - La foto se carga con la capa oculta (`.welcome-pending`); al cargar
 *   (`onLoad`, o ya completa si cargó antes de hidratar) se muestra y se
 *   marca como vista (`markWelcomeSeenAction`). Si falla (`onError`) o tarda
 *   más de `PHOTO_TIMEOUT_MS`, se quita sin marcar: queda el calendario
 *   debajo y en la siguiente visita se reintenta.
 * - "Abrir mi calendario" (o Escape) la cierra y devuelve el foco al
 *   calendario. El menú de la cuenta queda por encima (z-index en globals.css).
 */
export function WelcomeOverlay({
  calendarId,
  photoUrl,
  firstName,
  title,
  countdownText,
}: {
  calendarId: string;
  photoUrl: string;
  firstName: string | null;
  title: string;
  countdownText: string | null;
}) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [, startTransition] = useTransition();
  const imgRef = useRef<HTMLImageElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const markedRef = useRef(false);

  function onPhotoLoaded() {
    setPhase((current) => (current === "loading" ? "shown" : current));
  }

  function close() {
    setPhase("closed");
    const main = document.getElementById("calendar-main");
    main?.focus();
  }

  // La foto puede haber terminado (bien o mal) antes de que React hidrate,
  // y entonces `onLoad`/`onError` ya no llegan: se mira su estado al montar.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete) {
      if (img.naturalWidth > 0) onPhotoLoaded();
      else setPhase("closed");
    }
    const timer = window.setTimeout(() => {
      setPhase((current) => (current === "loading" ? "closed" : current));
    }, PHOTO_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (phase !== "shown") return;
    if (!markedRef.current) {
      markedRef.current = true;
      startTransition(async () => {
        await markWelcomeSeenAction(calendarId);
      });
    }
    buttonRef.current?.focus();
    // Solo con el foco dentro de la bienvenida: el Escape que cierra el menú
    // de la cuenta (que queda por encima) no debe cerrarla también.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && overlayRef.current?.contains(document.activeElement)) close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, calendarId]);

  if (phase === "closed") return null;

  return (
    <div
      ref={overlayRef}
      className={phase === "loading" ? "welcome-overlay welcome-pending" : "welcome-overlay"}
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      data-welcome-phase={phase}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- URL externa arbitraria (https, validada al guardarla), no vale next/image sin dominios configurados. */}
      <img
        ref={imgRef}
        className="welcome-photo"
        src={photoUrl}
        alt=""
        onLoad={onPhotoLoaded}
        onError={() => setPhase("closed")}
      />
      <div className="welcome-shade" aria-hidden="true" />
      <div className="welcome-content">
        <span className="welcome-hello">{firstName ? `Hola, ${firstName}` : "Hola"}</span>
        <h2 id="welcome-title" className="welcome-title">
          {title}
        </h2>
        {countdownText && <p className="welcome-countdown">{countdownText}</p>}
        <button ref={buttonRef} type="button" className="welcome-open" onClick={close}>
          Abrir mi calendario
        </button>
      </div>
    </div>
  );
}
