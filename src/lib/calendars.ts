import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { convexAppServerSecret } from "@/lib/convex-server";
import { DEFAULT_COVER_ICON } from "@/lib/cover-icons";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Exige el formato exacto "YYYY-MM-DD" (el contrato del `<input
 * type="date">` del formulario) y construye la fecha explícitamente a
 * medianoche UTC — nunca `new Date(cadenaCualquiera)`, que acepta
 * timestamps completos con zona horaria y puede desplazar el día
 * (hallazgo de auditoría, ronda 1). También rechaza fechas que no existen
 * (p. ej. "2026-02-30": `Date.UTC` las "arrastra" al mes siguiente en vez
 * de fallar, así que se comprueba que el resultado coincide con lo que se
 * pidió).
 */
export function parseUtcDateOnly(value: string): Date | null {
  if (!DATE_ONLY_RE.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const roundTrips =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return roundTrips ? date : null;
}

/**
 * Rango de fechas por defecto para un calendario recién creado: 1–24 de
 * diciembre del próximo diciembre que llegue (si ya estamos a 25 de
 * diciembre o después, salta al año siguiente). Solo un punto de partida —
 * el Admin lo cambia libremente después.
 */
export function defaultCalendarDateRange(now = new Date()) {
  const isPastThisDecember = now.getUTCMonth() === 11 && now.getUTCDate() > 24;
  const year = isPastThisDecember ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  return {
    startDate: new Date(Date.UTC(year, 11, 1)),
    endDate: new Date(Date.UTC(year, 11, 24)),
  };
}

/**
 * `startDate`/`endDate` se guardan a medianoche UTC (ver
 * `defaultCalendarDateRange` y el formulario de edición, que manda
 * "YYYY-MM-DD" y se parsea como UTC). Formatear con `toLocaleDateString`
 * a secas convierte primero a la hora local del servidor — en cualquier
 * huso por detrás de UTC eso enseña el día anterior. Fijar `timeZone:
 * "UTC"` evita el desfase.
 */
export function formatCalendarDate(date: Date) {
  return date.toLocaleDateString("es-ES", { timeZone: "UTC" });
}

const FALLBACK_TIME_ZONE = "UTC";

/**
 * Valida un identificador de zona horaria IANA llegado del cliente (cookie
 * `tz` o argumento de una server action — nunca dato de confianza).
 * `Intl.DateTimeFormat` lanza `RangeError` con cualquier cadena que no sea
 * una zona reconocida; ante eso (o valor ausente) cae a UTC en vez de
 * romper el render — mismo criterio defensivo que el resto de entradas de
 * cliente en este proyecto (URLs de vídeo/portada, TAL-5/6/8).
 */
export function safeTimeZone(raw: string | undefined | null): string {
  if (!raw) return FALLBACK_TIME_ZONE;
  try {
    // Solo para forzar la validación de `raw` — el formateador en sí no se usa.
    new Intl.DateTimeFormat("en-CA", { timeZone: raw });
    return raw;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

/**
 * "Hoy" como día natural en la zona horaria indicada, anclado a
 * medianoche UTC — mismo formato que `Day.date`/`Calendar.startDate`/
 * `endDate` (ver arriba), para que sea comparable directamente con esas
 * columnas.
 *
 * Sin esto (hallazgo de auditoría, TAL-8 ronda 1): comparar `Day.date`
 * contra el instante crudo `new Date()` desbloquea el día siguiente HORAS
 * ANTES de tiempo en husos por detrás de UTC (p. ej. São Paulo) y HORAS
 * TARDE en husos por delante — la puerta debe abrirse en el "hoy" real de
 * quien mira el calendario, no en el de UTC a secas. La zona horaria la
 * manda el cliente (no hay ninguna guardada en BD por persona/calendario);
 * ver `TimezoneSync` (cookie `tz`, página del Invitado) y `door-grid.tsx`
 * (`Intl.DateTimeFormat().resolvedOptions().timeZone` al marcar como
 * visto, sin depender de que la cookie ya haya llegado).
 */
export function todayInTimeZone(now: Date, timeZone: string | undefined | null): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  const day = Number(parts.find((p) => p.type === "day")!.value);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Calendarios donde `userId` es ADMIN — ver `docs/modelo-de-datos.md`.
 *
 * TAL-12 — reconectada contra Convex (`calendars.listCalendarsForUserPublic`,
 * `convex/calendars.ts`). Ya no lanza `DataLayerUnavailableError` ni hace
 * falta envolverla en `tryDataLayer` (hallazgo de TAL-10 ronda 1, ya no
 * aplica aquí): esa maquinaria existía para distinguir "no disponible" de
 * una lista vacía real mientras la función estaba GARANTIZADA a fallar
 * siempre; ahora que está reconectada de verdad, un fallo de Convex es un
 * fallo real (red caída, mal configurado) y se deja propagar tal cual —
 * mismo criterio que la versión Prisma original, que nunca tuvo un estado
 * especial para "la base de datos está caída". `[]` aquí es siempre la
 * lista vacía real.
 */
export async function listAdminCalendars(
  userId: string
): Promise<{ id: string; name: string; startDate: Date; endDate: Date; skin: { name: string } }[]> {
  const calendars = await fetchQuery(api.calendars.listCalendarsForUserPublic, {
    serverSecret: convexAppServerSecret(),
    userId: userId as Id<"users">,
  });
  return calendars.map((calendar) => ({
    id: calendar._id,
    name: calendar.name,
    startDate: parseUtcDateOnly(calendar.startDate)!,
    endDate: parseUtcDateOnly(calendar.endDate)!,
    // `skin` puede ser `null` si la referencia está rota (defensivo, ver
    // `convex/calendars.ts::listCalendarsForUserHandler`) — no debería
    // pasar en la práctica; se etiqueta en vez de reventar el render.
    skin: { name: calendar.skin?.name ?? "—" },
  }));
}

/**
 * Crea un calendario con valores de partida razonables y, en la MISMA
 * mutation, la `calendarMembership` del creador como ADMIN — así es como
 * alguien se convierte en Admin de su primer calendario (brief de TAL-5).
 * Ver `docs/modelo-de-datos.md`/`docs/calendarios.md` para el resto de
 * reglas (idempotencia por `creationKey`, resolución del skin por defecto
 * dentro de Convex, etc.).
 *
 * TAL-12 — reconectada contra Convex (`calendars.createCalendarPublic`).
 * `name`/`coverTitle`/`startDate`/`endDate` siguen siendo los mismos
 * valores de partida hardcodeados que la versión Prisma (el botón "+
 * Nuevo calendario" no tiene formulario, solo `creationKey`) — el Admin
 * los cambia después desde el formulario de edición
 * (`updateCalendarAction`).
 *
 * TAL-23 — el 🎄 ya no va incrustado dentro del texto de `coverTitle`
 * (hallazgo del brief: estaba hardcodeado ahí, en vez de vivir como campo
 * propio) — se manda por separado como `coverIcon`, con el mismo valor
 * `DEFAULT_COVER_ICON` que antes estaba fijo en el texto, para no cambiar
 * el resultado visual de "+ Nuevo calendario" (el Admin lo cambia después
 * desde el selector del formulario de edición, igual que el resto de
 * campos de partida).
 *
 * TAL-26 — `name` ya no va fijo a "Nuevo calendario": el Admin lo escribe
 * al crear (brief: identificar cuál es cuál desde el primer momento, con
 * varios calendarios a la vez). Validación real (no vacío, cota de
 * longitud) vive en Convex (`createCalendarHandler::assertValidCalendarName`)
 * — mismo criterio que el resto de invariantes de este dominio, nunca
 * solo en la Server Action.
 */
export async function createCalendarForAdmin(
  user: { id: string },
  creationKey: string,
  name: string
): Promise<{ id: string }> {
  const { startDate, endDate } = defaultCalendarDateRange();
  const calendarId = await fetchMutation(api.calendars.createCalendarPublic, {
    serverSecret: convexAppServerSecret(),
    userId: user.id as Id<"users">,
    name,
    coverTitle: "¡Feliz cuenta atrás, equipo!",
    coverIcon: DEFAULT_COVER_ICON,
    startDate: startDate.toISOString().slice(0, 10),
    endDate: endDate.toISOString().slice(0, 10),
    creationKey,
  });
  return { id: calendarId };
}
