import { expect } from "@playwright/test";
import type { Id } from "../../convex/_generated/dataModel";
import { api, convex, serverSecret } from "./convex";

/**
 * TAL-80 — limpieza de calendarios de prueba en `afterAll` sin cortar al
 * primer fallo: se intentan TODOS (uno que falla no impide borrar los
 * demás), se saltan los que no llegaron a crearse (`undefined`) y al final
 * se informa de los fallos con un `expect` (no se tragan en silencio). Los
 * IDs se registran en cuanto se crean, en el propio spec.
 */
export async function deleteCalendarsBestEffort(entries: Iterable<{ id: Id<"calendars"> | undefined; userId: Id<"users"> }>): Promise<void> {
  const failures: string[] = [];
  for (const { id, userId } of entries) {
    if (!id) continue;
    try {
      await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId: id, userId });
    } catch (err) {
      failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  expect(failures, "calendarios de prueba sin limpiar").toEqual([]);
}

/** Atajo: todos los IDs, borrados como el mismo usuario. */
export function deleteCalendarsAs(userId: Id<"users">, ids: Iterable<Id<"calendars"> | undefined>): Promise<void> {
  return deleteCalendarsBestEffort([...ids].map((id) => ({ id, userId })));
}
