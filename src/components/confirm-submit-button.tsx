"use client";

const DANGER_STYLE: React.CSSProperties = {
  background: "var(--berry)",
  borderColor: "var(--berry)",
  border: "1px solid var(--berry)",
  color: "#fff5f0",
  borderRadius: "999px",
  padding: "0.6rem 1.25rem",
  fontWeight: 600,
  cursor: "pointer",
};

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
   */
  variant?: "danger";
}) {
  return (
    <button
      type="submit"
      style={variant === "danger" ? DANGER_STYLE : undefined}
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
