// No es un módulo de funciones públicas (sin `query`/`mutation`/`action`
// exportados) — un helper compartido normal, mismo patrón que
// src/lib/calendars.ts en la versión Prisma.
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Toda la garantía de "orden lexicográfico == orden cronológico" que
 * justifica usar `v.string()` en vez de un timestamp para
 * `days.date`/`calendars.startDate`/`endDate` (ver
 * docs/convex-modelo-de-datos.md § "Fechas como día natural") depende de
 * que el string sea SIEMPRE "YYYY-MM-DD" exacto — nada en el tipo
 * `v.string()` del schema lo impone. Sin esta comprobación, un valor mal
 * formado (o una fecha que no existe, tipo "2026-02-30") rompía la
 * comparación en silencio en cualquier mutation que lo usara (hallazgo de
 * segunda opinión, T2, antes de exportar la ronda 1). Mismo criterio que
 * `parseUtcDateOnly` en `src/lib/calendars.ts` (versión Prisma): exige el
 * formato exacto y rechaza fechas que `Date.UTC` "arrastraría" al mes
 * siguiente en vez de fallar.
 */
export function assertValidCalendarDate(value: string): void {
  if (!DATE_ONLY_RE.test(value)) {
    throw new Error(`Fecha inválida: "${value}" no tiene el formato YYYY-MM-DD.`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  const valid =
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day;
  if (!valid) {
    throw new Error(`Fecha inválida: "${value}" no es un día real.`);
  }
}
