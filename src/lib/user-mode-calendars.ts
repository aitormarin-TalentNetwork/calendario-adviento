import { normalizeCoverIcon, type CoverIconName } from "../../convex/coverIconCatalog";

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

/**
 * TAL-73 — estado según las fechas, mismo criterio que
 * `convex/superadmin.ts::calendarStatus`: antes del inicio → "upcoming";
 * después del fin → "finished"; si no, "live". Fechas a medianoche UTC.
 */
export type CalendarStatus = "live" | "upcoming" | "finished";

export function calendarStatusFor(start: Date, end: Date, today: Date): CalendarStatus {
  if (today.getTime() < start.getTime()) return "upcoming";
  if (today.getTime() > end.getTime()) return "finished";
  return "live";
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** "Empieza mañana" / "Empieza en N días" (solo para calendarios próximos, N ≥ 1). */
export function startsInText(days: number): string {
  return days === 1 ? "Empieza mañana" : `Empieza en ${days} días`;
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
  /** TAL-72 — solo el `_id`: el estilo lo resuelve la página con el catálogo 2026. */
  skin: { _id: string } | null;
  /** TAL-73 — opcionales: faltan a partir del calendario 51 y con un Convex anterior. */
  totalDays?: number;
  viewedDays?: number;
};

export type UserModeCard = {
  id: string;
  title: string;
  icon: CoverIconName;
  /**
   * TAL-62 — el estilo de la portada lo resuelve la página con el catálogo
   * 2026 (`resolveSkinStyle`), igual que la del invitado: un skin
   * inexistente/roto (`null`) o fuera del catálogo cae al respaldo Alegre.
   */
  skinId: string | null;
  backgroundImageUrl: string | null;
  subtitle: string;
  isAdmin: boolean;
  status: CalendarStatus;
  /** Barra "vistos/total": solo si no es próximo, hay días y Convex trae los campos. */
  progress: { viewed: number; total: number } | null;
  /** Días hasta el inicio (solo próximos). */
  startsInDays: number | null;
};

export function toUserModeCard(row: UserModeCardInput, today: Date): UserModeCard {
  const status = calendarStatusFor(row.startDate, row.endDate, today);
  const hasProgress =
    status !== "upcoming" && typeof row.totalDays === "number" && typeof row.viewedDays === "number" && row.totalDays > 0;
  return {
    id: row.id,
    title: cardTitle(row.coverTitle, row.name),
    // TAL-60 — nombre Lucide normalizado (ausente → árbol por defecto;
    // fuera del catálogo → respaldo).
    icon: normalizeCoverIcon(row.coverIcon),
    skinId: row.skin?._id ?? null,
    backgroundImageUrl: row.backgroundImageUrl ?? null,
    subtitle: cardSubtitle(row.isAdmin, row.startDate, row.endDate),
    isAdmin: row.isAdmin,
    status,
    progress: hasProgress ? { viewed: Math.min(row.viewedDays!, row.totalDays!), total: row.totalDays! } : null,
    startsInDays: status === "upcoming" ? Math.round((row.startDate.getTime() - today.getTime()) / ONE_DAY_MS) : null,
  };
}
