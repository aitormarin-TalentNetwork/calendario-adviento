/**
 * TAL-60 — color del icono de portada dentro de su recuadro pastel.
 *
 * El Design System pide "el icono en el color del skin" (§ "Estilo 2026 →
 * Iconos"), pero WCAG 1.4.11 exige contraste ≥ 3:1 para elementos gráficos,
 * y no todos los accents de skin lo dan contra el fondo pastel del recuadro.
 * Regla: se usa el accent del skin en cada tema SOLO si da ≥ 3:1 contra el
 * fondo de ese tema; si no (o si el accent no es un hex, p. ej. el respaldo
 * `var(--primary)` de `DEFAULT_SKIN_APPEARANCE`), `null` → el CSS cae al token
 * `--icon-tile-fg` (`globals.css`, bloque "TAL-60 — iconos").
 *
 * `ICON_TILE_BG` replica los valores de `--icon-tile-bg` (= `--primary-soft`
 * del Design System, definitivos desde TAL-61). Contrato con TAL-61 (T1): si ese
 * token cambia de valor, se actualiza aquí y se vuelve a pasar
 * `scripts/verify-tal60-icon-contrast.mjs`.
 */

export const ICON_TILE_BG = { light: "#e6e0ff", dark: "#2a2645" } as const;
export const MIN_ICON_CONTRAST = 3;

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function hexToRgb(hex: string): [number, number, number] | null {
  if (!HEX_RE.test(hex)) return null;
  let body = hex.slice(1);
  if (body.length === 3) body = body.split("").map((c) => c + c).join("");
  return [0, 2, 4].map((i) => parseInt(body.slice(i, i + 2), 16)) as [number, number, number];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Ratio de contraste WCAG 2.x entre dos colores hex; `null` si alguno no es hex. */
export function contrastRatio(a: string, b: string): number | null {
  const rgbA = hexToRgb(a);
  const rgbB = hexToRgb(b);
  if (!rgbA || !rgbB) return null;
  const [l1, l2] = [relativeLuminance(rgbA), relativeLuminance(rgbB)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

export type CoverIconColors = { light: string | null; dark: string | null };

export function resolveCoverIconColors(accent: string | null | undefined): CoverIconColors {
  const pick = (bg: string) => {
    if (!accent) return null;
    const ratio = contrastRatio(accent, bg);
    return ratio !== null && ratio >= MIN_ICON_CONTRAST ? accent : null;
  };
  return { light: pick(ICON_TILE_BG.light), dark: pick(ICON_TILE_BG.dark) };
}
