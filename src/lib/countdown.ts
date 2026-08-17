// TAL-27 — marcador "Faltan X días para Y". Deliberadamente sin ningún
// import de servidor (nada de `convex/nextjs`) — lo usan tanto código de
// servidor (Guest page, TAL-27 parte 2) como un componente cliente (la
// vista previa en vivo del formulario de edición del Admin), mismo criterio
// que `src/lib/calendar-grid.ts`.
export { MAX_COUNTDOWN_LABEL_LENGTH } from "../../convex/countdownLabelConstants";

export const DEFAULT_COUNTDOWN_LABEL = "la Navidad";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Días naturales entre `today` y `endDate` — ambos medianoche UTC (mismo
 * formato que `todayInTimeZone`/`parseDateOnlyUTC`, ver
 * `src/lib/calendars.ts`/`src/lib/calendar-grid.ts`), así que la resta es
 * exacta sin líos de horario de verano. Puede salir negativo si `today` ya
 * pasó `endDate` (calendario terminado) — `formatCountdownMessage` no
 * distingue ese caso de "hoy es el último día" (el brief de TAL-27 no
 * define ningún mensaje propio para una cuenta atrás ya caducada).
 */
export function daysUntil(today: Date, endDate: Date): number {
  return Math.round((endDate.getTime() - today.getTime()) / ONE_DAY_MS);
}

/**
 * "Faltan X días para Y" / "Falta 1 día para Y" / "¡Hoy es Y!" (X≤0) — brief
 * de TAL-27: singular cuando falta exactamente 1 día, y el propio brief
 * propone "¡Hoy es Y!" para cuando hoy es la fecha de fin.
 */
export function formatCountdownMessage(daysRemaining: number, label: string): string {
  const resolvedLabel = label.trim() || DEFAULT_COUNTDOWN_LABEL;
  if (daysRemaining <= 0) return `¡Hoy es ${resolvedLabel}!`;
  if (daysRemaining === 1) return `Falta 1 día para ${resolvedLabel}`;
  return `Faltan ${daysRemaining} días para ${resolvedLabel}`;
}
