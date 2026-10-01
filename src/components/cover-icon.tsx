import type { CSSProperties } from "react";
import { resolveCoverIconColors } from "@/lib/cover-icon-colors";
import { COVER_ICON_COMPONENTS, normalizeCoverIcon } from "@/lib/cover-icons";

type CoverIconProps = {
  /** Valor crudo de `coverIcon`: nombre Lucide, emoji antiguo sin migrar o nada — siempre se normaliza. */
  value: string | null | undefined;
  /** Tamaño del icono en px. */
  size: number;
  /** Lado del recuadro redondeado en px; sin él, solo el icono (p. ej. casillas de la galería). */
  box?: number;
  /** Accent del skin (hex) para colorear el icono si da contraste ≥ 3:1 (`resolveCoverIconColors`). */
  accent?: string | null;
  className?: string;
};

/**
 * TAL-60 — icono de portada Lucide (trazo 2px, sin relleno, `currentColor`),
 * opcionalmente dentro del recuadro pastel del Design System
 * (`.cover-icon-box`, `globals.css` bloque "TAL-60 — iconos").
 *
 * Es la capa de compatibilidad de lectura: `normalizeCoverIcon` acepta
 * nombres nuevos, emojis antiguos sin migrar y valores ausentes/raros, así
 * que cualquier mezcla de datos se pinta bien (docs/iconos.md § "Rollback",
 * estrategia B). Sin `"use client"`: sirve en Server Components (login,
 * portada, `/c`) y dentro de componentes de cliente (selector, vista previa,
 * menú de la cuenta).
 *
 * `data-cover-icon` es el marcador que el runbook de producción usa para
 * comprobar que sirve el Next nuevo (fase b) — no quitarlo.
 */
export function CoverIcon({ value, size, box, accent, className }: CoverIconProps) {
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

  const colors = resolveCoverIconColors(accent);
  const style = {
    width: box,
    height: box,
    ...(colors.light ? { "--icon-tile-fg-light": colors.light } : {}),
    ...(colors.dark ? { "--icon-tile-fg-dark": colors.dark } : {}),
  } as CSSProperties;

  return (
    <span data-cover-icon={name} className={["cover-icon-box", className].filter(Boolean).join(" ")} style={style}>
      {icon}
    </span>
  );
}
