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
  const [showToast, setShowToast] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(link);
    setShowToast(true);
    setTimeout(() => setShowToast(false), 1400);
  }

  return (
    <>
      <button type="button" className="copy-icon-button" title="Copiar link" aria-label="Copiar link" onClick={handleCopy}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="11" height="11" rx="2"></rect>
          <path d="M5 15V5a2 2 0 0 1 2-2h10"></path>
        </svg>
      </button>
      <div className={`toast${showToast ? " show" : ""}`} role="status" aria-live="polite">
        Link copiado
      </div>
    </>
  );
}
