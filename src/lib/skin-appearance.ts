import type { CSSProperties } from "react";

/**
 * Apariencia de skin compartida por la portada, el grid y la vista previa:
 * respaldo por defecto (`DEFAULT_SKIN_APPEARANCE`), estilo de fondo con o sin
 * imagen (`skinBackgroundStyle`), tratamiento del texto
 * (`resolveCoverTextTreatment`) y capa tenue de imagen de fondo
 * (`faintBackgroundLayer`). Desde TAL-62 los colores salen del catálogo
 * "Estilo 2026" (`src/lib/skin-style.ts`); aquí no se lee ninguna fila de
 * `skins`.
 *
 * TAL-72 — se retiraron `resolveSkinAppearance`, `coverBackgroundCss`,
 * `coverBackgroundStyle` y `SkinLike` (lectura de los campos antiguos
 * `background`/`accent`/`textColor`/`textPill` y capa de oscurecimiento de
 * TAL-24), sin llamadores desde TAL-62.
 */

export type SkinAppearance = {
  background: string;
  accent: string;
  // TAL-47 — color de texto propio del skin. `textPill` pide una píldora
  // de fondo semitransparente detrás del texto en vez de aplicarlo directo
  // (ver `resolveCoverTextTreatment` más abajo).
  textColor: string;
  textPill: boolean;
};

/**
 * Respaldo cuando el skin no tiene colores propios (p. ej. la muestra de
 * una fila antigua sin `background` en el modo degradado del selector,
 * `skin-picker.tsx::swatchBackground`). Los tokens del
 * Design System en vez de un hex fijo: si algún día cambian de valor, este
 * respaldo los sigue automáticamente sin tocar código. TAL-61 — el
 * respaldo es el skin "Alegre" (nº 1 del DS "Estilo 2026"): fondo `--bg`
 * (crema), acento `--primary` y texto `--ink`, contraste de sobra sin
 * píldora (`textPill: false`). El catálogo de skins es de TAL-62.
 */
export const DEFAULT_SKIN_APPEARANCE: SkinAppearance = {
  background: "var(--bg)",
  accent: "var(--primary)",
  textColor: "var(--ink)",
  textPill: false,
};

export type CoverBackgroundStyle =
  | { background: string; backgroundImage?: never; backgroundSize?: never; backgroundPosition?: never }
  | { background?: never; backgroundImage: string; backgroundSize: string; backgroundPosition: string };

/**
 * TAL-47 — fondo del skin en la portada del Invitado, la cabecera de mes del
 * grid (Invitado y editor), el modal de vídeo y el fondo a pantalla completa.
 * Sin `backgroundImageUrl`, el fondo del skin tal cual (el contraste lo
 * garantiza el color de texto del skin). Con `backgroundImageUrl` (foto
 * arbitraria, sin color de texto verificado), la foto con una capa de
 * oscurecimiento al 60 % para que el texto blanco sea legible. `backgroundImage`
 * (longhand) y no el shorthand `background`, para poder acompañarla de
 * `backgroundSize`/`backgroundPosition` sin el aviso de React por mezclar
 * shorthand y longhand (TAL-29).
 */
export function skinBackgroundStyle(background: string, backgroundImageUrl?: string | null): CoverBackgroundStyle {
  if (backgroundImageUrl) {
    return {
      backgroundImage: `linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.6)), url("${backgroundImageUrl}")`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  return { background };
}

export type CoverTextTreatment =
  | { kind: "photo"; color: string; textShadow: string }
  | { kind: "flat"; color: string }
  | { kind: "pill"; color: string; pillBackground: string };

// 0.7, NO 0.6 (la píldora de "visto" del grid) — con 0.6 el skin antiguo
// "rojiblanco" fallaba WCAG AA en su parada blanca (4.20:1); con 0.7 pasaba
// con margen (5.96:1). Medido en TAL-47 con un script retirado en TAL-72;
// ver `docs/skins.md` § "textColor" (histórico).
const TEXT_PILL_BACKGROUND = "rgba(15,24,18,0.7)";

/**
 * TAL-47 — decide CÓMO mostrar el texto (título/número/marcador) sobre el
 * fondo resuelto por `skinBackgroundStyle`: tres casos.
 *
 * - `backgroundImageUrl` puesto ("photo"): mismo tratamiento de siempre
 *   (blanco + `text-shadow`) — una foto arbitraria no tiene `textColor`
 *   verificado, así que se mantiene el mecanismo que SÍ garantiza
 *   contraste sin conocer los colores de antemano.
 * - Sin foto, `textPill: true` ("pill"): el color de texto del skin
 *   sobre una píldora de fondo semitransparente (`TEXT_PILL_BACKGROUND`)
 *   en vez de directo sobre el degradado. Hoy ningún llamador la pide (el
 *   catálogo 2026 pasa siempre `false`), pero es parte del contrato.
 * - Sin foto, `textPill: false` ("flat"): el color de texto del skin
 *   directo, sin capa ni sombra ni píldora — el caso normal.
 */
export function resolveCoverTextTreatment(
  appearance: Pick<SkinAppearance, "textColor" | "textPill">,
  hasBackgroundImage: boolean
): CoverTextTreatment {
  if (hasBackgroundImage) {
    return { kind: "photo", color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,0.5)" };
  }
  if (appearance.textPill) {
    return { kind: "pill", color: appearance.textColor, pillBackground: TEXT_PILL_BACKGROUND };
  }
  return { kind: "flat", color: appearance.textColor };
}

/**
 * TAL-70 — la imagen de fondo del calendario deja de ser la base visual
 * (TAL-39, con capa oscura) y pasa a ser casi transparente encima del fondo
 * del skin (design-system.md § "Bienvenida con foto… + imagen de fondo
 * tenue"; valores del mockup `design/propuesta-bienvenida.html`: opacidad
 * 0.1 y `saturate(0.7)`, en `.faint-bg-layer` de `globals.css`). Devuelve el
 * estilo de esa capa (un `<div className="faint-bg-layer" aria-hidden>`
 * dentro de un contenedor `.faint-bg-host`), o `null` sin imagen. El fondo
 * del skin se pinta igual que sin imagen (`skinBackgroundStyle(bg)`) y el
 * texto usa el tratamiento normal del skin, no el «photo».
 */
export function faintBackgroundLayer(backgroundImageUrl: string | null | undefined): CSSProperties | null {
  if (!backgroundImageUrl) return null;
  return { backgroundImage: `url(${JSON.stringify(backgroundImageUrl)})` };
}

/**
 * TAL-85 — qué imagen va en la capa tenue de dentro del calendario
 * (design-system.md § "Foto de portada visible en todas partes"): la imagen
 * de fondo si existe; si está vacía, la foto de portada, con el mismo
 * tratamiento (`faintBackgroundLayer`). Ninguna de las dos → `null`.
 */
export function faintBackgroundUrl(
  backgroundImageUrl: string | null | undefined,
  coverImageUrl: string | null | undefined
): string | null {
  return backgroundImageUrl || coverImageUrl || null;
}
