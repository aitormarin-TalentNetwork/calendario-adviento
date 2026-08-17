// TAL-20 — mensajes de error de validación de Convex que Next.js necesita
// reconocer por su texto exacto para mostrarlos como error normal de
// formulario (en vez de un fallo genérico) sin capturar a ciegas cualquier
// excepción. Fichero sin dependencias de runtime de Convex a propósito
// (nada de `./_generated/server`) para poder importarse tal cual desde
// `src/app/admin/actions.ts` sin arrastrar el grafo de módulos de las
// mutations al bundle de servidor de Next.js — ver
// `convex/calendars.ts::assertNoDayOutsideRange` (dueño real de la regla)
// y `src/app/admin/actions.ts::updateCalendarAction` (quien la reconoce).
export const DAY_OUTSIDE_RANGE_ERROR_MESSAGE =
  "No se puede cambiar el rango: hay al menos un día con vídeo asignado que quedaría fuera del rango nuevo.";

// TAL-45 — mismo motivo/patrón que `DAY_OUTSIDE_RANGE_ERROR_MESSAGE` arriba,
// para las dos reglas de negocio que `days.ts::upsertDayHandler` puede
// lanzar (dueño real) y que `days-actions.ts::saveDayAction` necesita
// reconocer para mostrarlas como error normal del diálogo de día en vez de
// un fallo genérico.
export const DAY_OUTSIDE_CALENDAR_RANGE_ERROR_MESSAGE = "Esa fecha no está dentro del rango del calendario.";
export const CALENDAR_NO_LONGER_EXISTS_ERROR_MESSAGE = "El calendario ya no existe.";
