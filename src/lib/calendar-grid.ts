// Agrupación en meses/semanas para el grid "calendario de pared" (TAL-21,
// design/design-system.md § "Grid de días"). Deliberadamente sin ningún
// import de src/lib/calendars.ts (que trae `convex/nextjs`, solo válido en
// servidor) — este módulo lo usan componentes cliente
// (door-grid.tsx/days-grid-editor.tsx), así que se mantiene puro, sin
// dependencias de servidor.

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** `dateStr` siempre llega ya validado como "YYYY-MM-DD" desde el servidor. */
export function parseDateOnlyUTC(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function isWeekendUTC(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/**
 * "Hoy" como "YYYY-MM-DD" en la zona horaria indicada — pensado para
 * llamarse con `Intl.DateTimeFormat().resolvedOptions().timeZone` (la del
 * propio navegador), nunca con una zona horaria de una fuente que no sea
 * de confianza. TAL-21, hallazgo de auditoría ronda 2: el editor de Admin
 * marcaba "hoy" con `todayInTimeZone` del SERVIDOR (`src/lib/calendars.ts`),
 * que sin la cookie `tz` todavía (primerísima visita) cae a UTC — esa
 * primera respuesta ya salía mal, aunque se corrigiera después de que
 * `TimezoneSync` la trajera. Aquí no hace falta ningún fallback a UTC: a
 * diferencia de la cookie (que puede no existir todavía), la zona horaria
 * que devuelve el propio `Intl` del navegador siempre es un valor real, así
 * que esta función solo tiene sentido llamada desde cliente, tras montar
 * (nunca durante SSR — mismo motivo que `NewCalendarSubmit`, TAL-19: un
 * valor no determinista calculado durante el render puede no coincidir
 * entre servidor y cliente).
 */
export function todayDateStrInTimeZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")!.value;
  const month = parts.find((p) => p.type === "month")!.value;
  const day = parts.find((p) => p.type === "day")!.value;
  return `${year}-${month}-${day}`;
}

/**
 * TAL-31 — antes, cualquier día del mes sin `item` real (ya fuera relleno
 * de alineación de semana fuera del propio mes, ya fuera un día DENTRO del
 * mes pero fuera del rango configurado del calendario — p. ej. el
 * calendario empieza el 12 de un mes que arrancó en lunes 1) colapsaba al
 * mismo `null`, indistinguible. Aitor pidió que el mes se vea siempre
 * completo, numerado desde el 1, sin huecos — así que ahora se
 * distinguen tres casos explícitos:
 * - `item`: día real, dentro del rango configurado, con datos reales.
 * - `out-of-range`: día real del mes (1..fin de mes) pero fuera de
 *   [startDate, endDate] del calendario — se numera igual, estilo "marca
 *   de agua" en quien lo consuma (ver `door-grid.tsx`), sin estado
 *   interactivo.
 * - `padding`: celda de relleno para completar la semana, fuera del
 *   propio mes (antes del día 1 o después del último) — sigue en blanco,
 *   sin numerar, como antes.
 */
export type MonthCell<T> =
  | { kind: "item"; item: T }
  | { kind: "out-of-range"; dateStr: string; dayNum: number }
  | { kind: "padding" };

export type MonthGroup<T> = {
  key: string;
  label: string;
  // 7 columnas, lunes a domingo.
  weeks: MonthCell<T>[][];
};

/**
 * Agrupa una lista de items consecutivos (un item por fecha, ya ordenados)
 * en meses completos tipo "calendario de pared": semanas de lunes a
 * domingo, con celdas de relleno tanto antes del primer día real como
 * después del último, para que cada mes se vea como un calendario de pared
 * de verdad — igual que `buildMonth()` en
 * design/propuesta-grid-calendario.html, generalizado para operar sobre
 * datos reales (`items`) en vez de un rango de demostración.
 */
export function groupIntoMonths<T extends { dateStr: string }>(items: T[]): MonthGroup<T>[] {
  if (items.length === 0) return [];

  const byDate = new Map(items.map((item) => [item.dateStr, item]));
  const first = parseDateOnlyUTC(items[0].dateStr);
  const last = parseDateOnlyUTC(items[items.length - 1].dateStr);

  const groups: MonthGroup<T>[] = [];
  let year = first.getUTCFullYear();
  let month = first.getUTCMonth();
  const lastYear = last.getUTCFullYear();
  const lastMonth = last.getUTCMonth();

  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const firstOfMonth = new Date(Date.UTC(year, month, 1));
    // Lunes = 0 ... domingo = 6 (getUTCDay() da domingo = 0 ... sábado = 6).
    const startOffset = (firstOfMonth.getUTCDay() + 6) % 7;
    const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;

    const cells: MonthCell<T>[] = [];
    for (let cellIdx = 0; cellIdx < totalCells; cellIdx++) {
      const dayNum = cellIdx - startOffset + 1;
      if (dayNum < 1 || dayNum > daysInMonth) {
        cells.push({ kind: "padding" });
        continue;
      }
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
      const item = byDate.get(dateStr);
      cells.push(item ? { kind: "item", item } : { kind: "out-of-range", dateStr, dayNum });
    }

    const weeks: MonthCell<T>[][] = [];
    for (let w = 0; w < cells.length / 7; w++) {
      weeks.push(cells.slice(w * 7, w * 7 + 7));
    }

    groups.push({
      key: `${year}-${String(month + 1).padStart(2, "0")}`,
      label: `${MONTH_NAMES[month].toUpperCase()} ${year}`,
      weeks,
    });

    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }

  return groups;
}
