import { normalizeCoverIcon, type CoverIconName } from "../../convex/coverIconCatalog";
import { DEFAULT_SKIN_APPEARANCE, resolveSkinAppearance, type SkinAppearance, type SkinLike } from "@/lib/skin-appearance";

/**
 * TAL-58 — normalización de las tarjetas de "Tus calendarios" (modo
 * Usuario, design/design-system.md § "Tus calendarios"). Funciones puras,
 * sin imports de servidor (ni `convex/nextjs` ni secretos), para poder
 * probarlas directamente (`e2e/tal-58-user-mode-cards.spec.ts`). Las llama
 * `listUserModeCalendars` (`src/lib/calendars.ts`) sobre cada fila de
 * `calendars.listUserModeCalendarsPublic`, así que la página nunca ve un
 * campo opcional.
 */

/**
 * Skin inexistente/roto (`null`) → `DEFAULT_SKIN_APPEARANCE`. Si existe,
 * `resolveSkinAppearance` ya cae al mismo respaldo cuando falta
 * `background`/`accent`/`textColor` (`v.optional` en `convex/schema.ts`,
 * TAL-22/TAL-47) y aplica `textPill ?? false`.
 */
export function normalizeCardAppearance(skin: SkinLike | null): SkinAppearance {
  if (!skin) return DEFAULT_SKIN_APPEARANCE;
  return resolveSkinAppearance(skin._id, [skin]);
}

/**
 * Decisión del PM (2026-10-01): `coverTitle` (lo que ve el invitado), con
 * `name` de respaldo — nunca una tarjeta sin título. El literal final es
 * pura defensa: Convex ya valida `name` no vacío (TAL-26).
 */
export function cardTitle(coverTitle: string, name: string): string {
  return coverTitle.trim() || name.trim() || "Calendario";
}

// Array fijo en vez de `Intl`/`toLocaleDateString("es-ES", { month: "short" })`:
// ese formato da "dic." con punto y "sept" para septiembre, y además varía
// según la versión de ICU del runtime — el Design System pide "1 dic – 24
// dic 2026" literal.
const SHORT_MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function dayMonth(date: Date): string {
  return `${date.getUTCDate()} ${SHORT_MONTHS_ES[date.getUTCMonth()]}`;
}

/**
 * Rango corto de fechas del design-system (§ "Tus calendarios"). Fechas a
 * medianoche UTC (mismo contrato que `formatCalendarDate`), así que se leen
 * los componentes UTC.
 * - Mismo año: "1 dic – 24 dic 2026" / "28 nov – 24 dic 2026".
 * - Años distintos: "28 dic 2026 – 6 ene 2027".
 */
export function formatDateRangeShort(start: Date, end: Date): string {
  const startYear = start.getUTCFullYear();
  const endYear = end.getUTCFullYear();
  if (startYear === endYear) return `${dayMonth(start)} – ${dayMonth(end)} ${endYear}`;
  return `${dayMonth(start)} ${startYear} – ${dayMonth(end)} ${endYear}`;
}

/** Decisión del PM: "Lo administras tú" en los que administra; rango de fechas en los demás. */
export function cardSubtitle(isAdmin: boolean, start: Date, end: Date): string {
  return isAdmin ? "Lo administras tú" : formatDateRangeShort(start, end);
}

export type UserModeCardInput = {
  id: string;
  name: string;
  coverTitle: string;
  coverIcon?: string;
  backgroundImageUrl?: string;
  startDate: Date;
  endDate: Date;
  isAdmin: boolean;
  skin: SkinLike | null;
};

export type UserModeCard = {
  id: string;
  title: string;
  icon: CoverIconName;
  appearance: SkinAppearance;
  backgroundImageUrl: string | null;
  subtitle: string;
  isAdmin: boolean;
};

export function toUserModeCard(row: UserModeCardInput): UserModeCard {
  return {
    id: row.id,
    title: cardTitle(row.coverTitle, row.name),
    // TAL-60 — nombre Lucide normalizado (emoji antiguo sin migrar → su
    // equivalente; ausente → árbol por defecto).
    icon: normalizeCoverIcon(row.coverIcon),
    appearance: normalizeCardAppearance(row.skin),
    backgroundImageUrl: row.backgroundImageUrl ?? null,
    subtitle: cardSubtitle(row.isAdmin, row.startDate, row.endDate),
    isAdmin: row.isAdmin,
  };
}
