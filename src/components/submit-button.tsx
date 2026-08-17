"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Se deshabilita mientras el formulario padre está enviándose — defensa en
 * profundidad en la UI contra doble clic (la garantía real de que no se
 * duplique nada vive en el servidor, ver createCalendarForAdmin).
 *
 * `disabled` (TAL-34) — deshabilitación adicional pedida por el propio
 * formulario, independiente de `pending` (p. ej. `days-grid-editor.tsx`
 * mientras la pestaña "Subir archivo", sin campo funcional que enviar,
 * está activa). Se combina con `pending`, nunca lo sustituye.
 */
export function SubmitButton({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled}>
      {pending ? "…" : children}
    </button>
  );
}
