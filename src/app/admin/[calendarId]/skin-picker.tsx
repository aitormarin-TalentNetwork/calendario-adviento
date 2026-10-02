"use client";

import { DEFAULT_SKIN_APPEARANCE } from "@/lib/skin-appearance";
import type { SkinStyle } from "@/lib/skin-style";

export type SkinOption = {
  id: string;
  name: string;
  // `v.optional` en convex/schema.ts (TAL-22, hallazgo de auditoría ronda
  // 1) — un skin sembrado antes de esa tarea puede no tenerlos todavía.
  // Mismo respaldo que `resolveSkinAppearance` (`skin-appearance.ts`), ver
  // más abajo.
  background?: string;
  accent?: string;
  // TAL-47 — no lo usa `SkinPicker` (las muestras solo pintan `background`),
  // pero viaja en el mismo `SkinOption` porque `edit-calendar-form.tsx`
  // reutiliza este array para resolver el skin SELECCIONADO EN VIVO y
  // pasárselo a `CalendarPreview` (ver el comentario completo ahí).
  textColor?: string;
  textPill?: boolean;
  /** TAL-62 — muestras del catálogo 2026 (`skinStyles.swatches`); si faltan (modo degradado), se usa `background`. */
  swatches?: string[];
  /** TAL-62 — estilo del skin para la vista previa (catálogo 2026). */
  skinStyle?: SkinStyle;
};

/**
 * TAL-62 — el cuadrado del selector se pinta con las muestras persistidas
 * del skin (franjas iguales, en el orden del mockup), no con un color
 * derivado: así coincide con lo que se ve en el catálogo (p. ej. la menta
 * de Alegre). Sigue siendo un cuadrado con el nombre solo en `title`
 * (Design System § "Selector de skin en el editor", TAL-37).
 */
export function swatchBackground(skin: SkinOption): string {
  if (skin.swatches && skin.swatches.length > 0) {
    const step = 100 / skin.swatches.length;
    const stops = skin.swatches.map((color, i) => `${color} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`);
    return `linear-gradient(90deg, ${stops.join(", ")})`;
  }
  return skin.background ?? DEFAULT_SKIN_APPEARANCE.background;
}

type SkinPickerProps = {
  value: string;
  onChange: (skinId: string) => void;
  skins: SkinOption[];
  disabled?: boolean;
};

/**
 * TAL-37 (design/design-system.md § "Skins", design/propuesta-editor-
 * calendario.html — fila "Skin" con las píldoras de color) — sustituye el
 * `<select>` de texto por una galería de muestras: una píldora por skin
 * con su `background` real (color sólido o degradado, tal cual lo guarda
 * Convex — mismo criterio que `door-grid.tsx`/`days-grid-editor.tsx`, que
 * ya aplican este mismo string de skin directo en CSS sin parsearlo) +
 * el nombre visible junto al swatch (no solo en `title`, que además se
 * añade como redundancia accesible) + anillo `--primary` en el seleccionado (TAL-61).
 *
 * Sigue siendo dinámico — `skins` viene tal cual de `skins.listAllPublic()`
 * (vía `page.tsx`/`edit-calendar-form.tsx`), cero catálogo fijo aquí; con
 * 22+ filas la galería envuelve en varias líneas (`flex-wrap`) y limita su
 * alto con scroll propio en vez de forzar una sola fila o alargar sin
 * límite el resto del formulario.
 *
 * No es un diálogo (a diferencia de `cover-icon-picker.tsx`, TAL-33): el
 * brief de esta tarea no lo pide, y la galería entera cabe razonablemente
 * inline dentro del propio campo.
 */
export function SkinPicker({ value, onChange, skins, disabled }: SkinPickerProps) {
  return (
    <div className="skin-picker-gallery">
      {skins.map((skin) => {
        const selected = skin.id === value;
        const background = swatchBackground(skin);
        return (
          <button
            key={skin.id}
            type="button"
            className="skin-swatch"
            aria-pressed={selected}
            title={skin.name}
            aria-label={skin.name}
            data-skin-option={skin.id}
            disabled={disabled}
            onClick={() => onChange(skin.id)}
            style={
              selected
                ? { borderColor: "var(--primary)", boxShadow: "0 0 0 2px var(--primary-soft)" }
                : undefined
            }
          >
            <span className="skin-swatch-color" style={{ background }} />
          </button>
        );
      })}
    </div>
  );
}
