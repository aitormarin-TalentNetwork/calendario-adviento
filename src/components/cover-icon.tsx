import { COVER_ICON_COMPONENTS, normalizeCoverIcon } from "@/lib/cover-icons";

type CoverIconProps = {
  /** Valor crudo de `coverIcon`: nombre Lucide, valor raro o nada — siempre se normaliza. */
  value: string | null | undefined;
  /** Tamaño del icono en px. */
  size: number;
  /** Lado del recuadro redondeado en px; sin él, solo el icono (p. ej. casillas de la galería). */
  box?: number;
  className?: string;
};

/**
 * TAL-60 — icono de portada Lucide (trazo 2px, sin relleno, `currentColor`),
 * opcionalmente dentro del recuadro pastel del Design System
 * (`.cover-icon-box`, `globals.css` bloque "TAL-60 — iconos").
 *
 * Es la capa de lectura tolerante: `normalizeCoverIcon` acepta nombres del
 * catálogo y valores ausentes/raros (estos últimos → icono de respaldo), así
 * que nunca falla al pintar. Sin `"use client"`: sirve en Server Components (login,
 * portada, `/c`) y dentro de componentes de cliente (selector, vista previa,
 * menú de la cuenta).
 *
 * `data-cover-icon` es el marcador que el runbook de producción usa para
 * comprobar que sirve el Next nuevo (fase b) — no quitarlo.
 */
export function CoverIcon({ value, size, box, className }: CoverIconProps) {
  const name = normalizeCoverIcon(value);
  const Icon = COVER_ICON_COMPONENTS[name];
  const icon = <Icon size={size} strokeWidth={2} aria-hidden="true" focusable="false" />;

  if (!box) {
    return (
      <span data-cover-icon={name} className={className} style={{ display: "inline-flex" }}>
        {icon}
      </span>
    );
  }

  return (
    <span
      data-cover-icon={name}
      className={["cover-icon-box", className].filter(Boolean).join(" ")}
      style={{ width: box, height: box }}
    >
      {icon}
    </span>
  );
}
