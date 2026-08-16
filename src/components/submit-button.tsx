"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

/**
 * Se deshabilita mientras el formulario padre está enviándose — defensa en
 * profundidad en la UI contra doble clic (la garantía real de que no se
 * duplique nada vive en el servidor, ver createCalendarForAdmin).
 */
export function SubmitButton({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "…" : children}
    </button>
  );
}
