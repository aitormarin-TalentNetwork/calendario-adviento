/**
 * TAL-62 — estilo "Estilo 2026" de un skin para la pantalla del invitado,
 * la vista previa y el selector. Funciones PURAS (cliente y servidor); el
 * catálogo lo carga `src/lib/skin-catalog.ts` desde Convex
 * (`skins.listCatalogPublic`).
 *
 * El estilo viaja a la UI como variables CSS `--skin-*` en el contenedor
 * (la portada del invitado, la vista previa, el grid del editor), y los
 * componentes las consumen. `--skin-seen-bg` es el contrato con TAL-67
 * (imagen de la casilla "visto"): TAL-62 la define; TAL-67 solo la usa
 * como capa inferior.
 */
import type { CSSProperties } from "react";
import { SKIN_CATALOG_2026, type SkinPalette, type SkinTreatment } from "../../convex/skinCatalog2026";

export type { SkinPalette, SkinTreatment };

/** Una fila de `skins.listCatalogPublic`. */
export type CatalogSkin = {
  _id: string;
  key: string;
  name: string;
  description?: string;
  sortOrder: number;
  palette: SkinPalette;
  treatment?: SkinTreatment;
  swatches: string[];
};

export type SkinStyle = {
  /** key del skin, o "fallback" si se pinta con el respaldo. Va en `data-skin-style` (marcador del runbook, fase b). */
  key: string;
  palette: SkinPalette;
  treatment: SkinTreatment | null;
};

const ALEGRE = SKIN_CATALOG_2026.find((entry) => entry.key === "alegre")!;

/**
 * Respaldo cuando el skin del calendario no está en el catálogo nuevo (skin
 * antiguo sin migrar, retirado, inexistente) o el catálogo no se puede
 * cargar (modo degradado): los valores de Alegre, el destino de migración
 * de cualquier skin antiguo — así un calendario sin migrar ya se ve como
 * se verá después. Mismo papel que `DEFAULT_SKIN_APPEARANCE`.
 */
export const ALEGRE_FALLBACK_STYLE: SkinStyle = { key: "fallback", palette: ALEGRE.palette, treatment: null };

export function resolveSkinStyle(skinId: string, catalog: readonly CatalogSkin[]): SkinStyle {
  const skin = catalog.find((candidate) => candidate._id === skinId);
  if (!skin) return ALEGRE_FALLBACK_STYLE;
  return { key: skin.key, palette: skin.palette, treatment: skin.treatment ?? null };
}

/** Clase de tratamiento (CSS en `globals.css`, bloque "TAL-62 — skins"). */
export function skinTreatmentClass(style: SkinStyle): string | undefined {
  if (style.treatment === "comic") return "skin-comic";
  if (style.treatment === "stripes-pill") return "skin-stripes-pill";
  return undefined;
}

/**
 * Variables CSS del skin para el contenedor. Además de las `--skin-*`,
 * sobrescribe `--icon-tile-bg`/`--icon-tile-fg` (recuadro del icono de
 * TAL-60: el par `tile`/`tileInk` está diseñado — y verificado — por skin)
 * y `--accent` (lo que todavía lo use dentro del calendario).
 */
export function skinStyleVars(style: SkinStyle): CSSProperties {
  const p = style.palette;
  return {
    "--skin-bg": p.bg,
    "--skin-ink": p.ink,
    "--skin-dim": p.dim,
    "--skin-line": p.line,
    "--skin-card": p.card,
    "--skin-cell": p.cell,
    "--skin-tile": p.tile,
    "--skin-tile-ink": p.tileInk,
    "--skin-hero": p.hero,
    "--skin-hero-ink": p.heroInk,
    "--skin-hero-num": p.heroNum,
    "--skin-glow": p.glow,
    "--skin-today": p.today,
    "--skin-today-ink": p.todayInk,
    "--skin-today-shadow": p.todayShadow,
    "--skin-seen-a": p.seenA,
    "--skin-seen-b": p.seenB,
    "--skin-seen-bg": `linear-gradient(140deg, ${p.seenA}, ${p.seenB})`,
    "--skin-weekend": p.weekend,
    "--icon-tile-bg": p.tile,
    "--icon-tile-fg": p.tileInk,
    "--accent": p.tileInk,
  } as CSSProperties;
}
