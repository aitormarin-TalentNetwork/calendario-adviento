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
   * cambian en esta tarea). `variant` por defecto (`undefined`) mantiene
   * el estilo nativo sin tocar, para no afectar a otros botones que ya
   * usan este mismo componente.
   *
   * TAL-61 — clases opt-in de `globals.css`: `.btn` siempre; `danger`
   * añade `.btn-danger` (texto `--coral-ink`, AA).
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
