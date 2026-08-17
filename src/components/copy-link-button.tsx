"use client";

import { useState } from "react";

/**
 * TAL-35 (design/design-system.md § "Invitados — link de invitación
 * único") — antes, botón de solo texto ("Copiar link" / "¡Copiado!" en el
 * propio botón, sin `alert()` desde el origen de este componente). Pasa a
 * icono de línea minimalista sin texto (mismo criterio que el resto de
 * botones solo-icono del sistema, `design/propuesta-editor-calendario.html`
 * `.btn-icon` — icono "copy": dos rectángulos superpuestos) + confirmación
 * tipo toast en vez de cambiar el propio texto del botón.
 *
 * El toast vive dentro de este componente (no un provider global): solo
 * hay un link de invitación por calendario, así que solo hay un
 * `CopyLinkButton` montado a la vez en cualquier pantalla — no hace falta
 * coordinar varios toasts a la vez.
 */
export function CopyLinkButton({ link }: { link: string }) {
  // `toastMessage: null` esconde el toast — mismo criterio que
  // `showToast` antes, pero guardando también qué texto mostrar: éxito y
  // fallo comparten el mismo mecanismo de aparecer/desaparecer, solo
  // cambia el mensaje.
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Hallazgo del auditor (TAL-35, no bloqueante en su momento): esta
  // promesa se quedaba sin `catch` — `navigator.clipboard.writeText` puede
  // rechazar (permiso de portapapeles denegado, contexto no seguro,
  // navegador sin soporte) y, sin manejarlo, el clic no hacía NADA visible
  // — ni el toast de éxito (correcto, no llegó a copiarse) ni ningún aviso
  // de que había fallado. Ahora un fallo muestra su propio mensaje en el
  // mismo toast, en vez de quedarse en silencio.
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link);
      setToastMessage("Link copiado");
    } catch {
      setToastMessage("No se ha podido copiar el link");
    }
    setTimeout(() => setToastMessage(null), 1400);
  }

  return (
    <>
      <button type="button" className="copy-icon-button" title="Copiar link" aria-label="Copiar link" onClick={handleCopy}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="11" height="11" rx="2"></rect>
          <path d="M5 15V5a2 2 0 0 1 2-2h10"></path>
        </svg>
      </button>
      <div className={`toast${toastMessage ? " show" : ""}`} role="status" aria-live="polite">
        {toastMessage}
      </div>
    </>
  );
}
