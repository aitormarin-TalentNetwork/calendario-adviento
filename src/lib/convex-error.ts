/**
 * TAL-20 (origen: `src/app/admin/actions.ts::updateCalendarAction`) —
 * `fetchMutation` envuelve el `Error` lanzado por un handler de Convex en
 * un mensaje con formato fijo (comprobado contra un throw real):
 *   "[Request ID: …] Server Error\nUncaught Error: <mensaje>\n    at …\n    at …"
 * — la primera línea es un identificador de petición y el resto, tras el
 * mensaje real, es la traza de pila del lado de Convex. Esta función
 * extrae la primera línea que no sea ninguna de esas dos cosas y le quita
 * el prefijo "Uncaught Error:"/"Error:" que antepone Convex.
 *
 * El resultado NO se le debe enseñar al usuario tal cual — quien llama
 * tiene que compararlo contra mensajes de validación de negocio ya
 * conocidos (p. ej. `convex/calendarErrorMessages.ts`) y solo mostrar los
 * que coincidan EXACTAMENTE; cualquier otro texto es un fallo no
 * reconocido y debe tratarse con un mensaje genérico (ver
 * `updateCalendarAction`/`saveDayAction` para el patrón completo).
 *
 * Extraída a un helper compartido (TAL-45) al aparecer un segundo llamador
 * real (`days-actions.ts::saveDayAction`) con exactamente la misma
 * necesidad — antes de eso vivía solo, inline, en `updateCalendarAction`.
 */
export function extractConvexErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const messageLine = raw
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("[Request ID") && !line.startsWith("at "));
  return (messageLine ?? "").replace(/^Uncaught Error:\s*/, "").replace(/^Error:\s*/, "");
}
