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
