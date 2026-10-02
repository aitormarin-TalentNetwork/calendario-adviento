"use client";

export function ConfirmSubmitButton({
  label,
  confirmText,
  variant,
}: {
  label: string;
  confirmText: string;
  /**
   * TAL-33 — "Borrar calendario" pasa de botón fantasma de solo texto a
   * botón rojo RELLENO (design/design-system.md § "Editor de calendario"
   * — excepción explícita al estilo "solo texto" que describe § "Botones"
   * → "Peligro" para el resto de acciones de borrar de la app, que no
   * cambian en esta tarea).
   *
   * TAL-61 — ya no hay estilo nativo: clases opt-in de `globals.css`.
   * Sin `variant` → `.btn` (secundario); `variant="danger"` →
   * `.btn .btn-danger` (texto `--coral-ink`, AA).
   */
  variant?: "danger";
}) {
  return (
    <button
      type="submit"
      className={variant === "danger" ? "btn btn-danger" : "btn"}
      onClick={(event) => {
        if (!confirm(confirmText)) {
          event.preventDefault();
        }
      }}
    >
      {label}
    </button>
  );
}
