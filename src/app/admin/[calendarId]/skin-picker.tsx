"use client";

import { DEFAULT_SKIN_APPEARANCE } from "@/lib/skin-appearance";

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
};

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
 * añade como redundancia accesible) + anillo `--gold` en el seleccionado.
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
        const background = skin.background ?? DEFAULT_SKIN_APPEARANCE.background;
        return (
          <button
            key={skin.id}
            type="button"
            className="skin-swatch"
            aria-pressed={selected}
            title={skin.name}
            disabled={disabled}
            onClick={() => onChange(skin.id)}
            style={
              selected
                ? { borderColor: "var(--gold)", boxShadow: "0 0 0 2px rgba(201,154,61,0.25)" }
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
