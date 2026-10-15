"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  getNavigationSeq,
  getServerNavigationSeq,
  shouldReopenWelcome,
  subscribeNavigation,
  type WelcomeEntryMark,
} from "@/lib/navigation-entry";
import { useImageStatus } from "@/lib/use-image-status";

/** Si la foto no ha cargado en este tiempo, no hay bienvenida (nunca una pantalla rota). */
const PHOTO_TIMEOUT_MS = 6000;

type WelcomeProps = {
  photoUrl: string;
  firstName: string | null;
  title: string;
  countdownText: string | null;
};

/**
 * TAL-70 — bienvenida con la foto de portada a pantalla completa
 * (design-system.md § "Bienvenida con foto (después de entrar)",
 * `design/propuesta-bienvenida.html` pantalla 2).
 *
 * TAL-85 — sale en CADA entrada al calendario, no una vez al día: ya no
 * hay marca en Convex (`welcomeViews`). `page.tsx` la monta siempre que el
 * calendario tiene foto. Una entrada es montar la página (carga completa,
 * venir de otra pantalla) o una navegación de cliente que acaba en este
 * mismo `/c/<id>` sin remontarla (p. ej. `/c` → redirect al mismo
 * calendario): ahí se detecta con `navSeq` + `renderId`
 * (`src/lib/navigation-entry.ts`) y se reabre montando de nuevo
 * `WelcomeDialog` (`key`). Cerrar el diálogo de un vídeo, el
 * `router.refresh()` de `TimezoneSync` o una server action no la reabren.
 */
export function WelcomeOverlay({ renderId, ...props }: WelcomeProps & { renderId: string }) {
  const navSeq = useSyncExternalStore(subscribeNavigation, getNavigationSeq, getServerNavigationSeq);
  const navSeqRef = useRef(navSeq);
  const markRef = useRef<WelcomeEntryMark | null>(null);
  const [entry, setEntry] = useState(0);

  useEffect(() => {
    navSeqRef.current = navSeq;
  }, [navSeq]);

  // Solo con un render nuevo del servidor: una navegación hacia fuera suma
  // `navSeq` pero no pinta esta página otra vez, así que no la reabre.
  useEffect(() => {
    const current: WelcomeEntryMark = { navSeq: navSeqRef.current, renderId };
    const last = markRef.current;
    markRef.current = current;
    if (last && shouldReopenWelcome(last, current)) setEntry((value) => value + 1);
  }, [renderId]);

  return <WelcomeDialog key={entry} {...props} />;
}

/**
 * - La foto se carga con la capa oculta (`.welcome-pending`); al cargar
 *   (`useImageStatus`, también si cargó antes de hidratar) se muestra. Si
 *   falla o tarda más de `PHOTO_TIMEOUT_MS`, se quita: queda el calendario
 *   debajo.
 * - "Abrir mi calendario" (o Escape) la cierra y devuelve el foco al
 *   calendario. El menú de la cuenta queda por encima (z-index en globals.css).
 */
function WelcomeDialog({ photoUrl, firstName, title, countdownText }: WelcomeProps) {
  const { imgRef, status: imageStatus, onLoad, onError } = useImageStatus({ timeoutMs: PHOTO_TIMEOUT_MS });
  const [closed, setClosed] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const phase = closed || imageStatus === "error" ? "closed" : imageStatus === "loaded" ? "shown" : "loading";

  function close() {
    setClosed(true);
    const main = document.getElementById("calendar-main");
    main?.focus();
  }

  useEffect(() => {
    if (phase !== "shown") return;
    buttonRef.current?.focus();
    // Solo con el foco dentro de la bienvenida: el Escape que cierra el menú
    // de la cuenta (que queda por encima) no debe cerrarla también.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && overlayRef.current?.contains(document.activeElement)) close();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase]);

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
      <img ref={imgRef} className="welcome-photo" src={photoUrl} alt="" onLoad={onLoad} onError={onError} />
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
