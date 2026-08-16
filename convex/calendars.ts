import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { assertValidCalendarDate } from "./dates";

/**
 * `startDate` no puede ser posterior a `endDate` — la versión Prisma lo
 * garantizaba implícitamente vía `defaultCalendarDateRange` (siempre
 * genera un rango válido) y el formulario de edición; aquí nada lo
 * impedía (hallazgo de auditoría, ronda 1): `createCalendar("2026-12-25",
 * "2026-12-01")` se insertaba tal cual. Se comprueba después de validar
 * que ambas son fechas reales (`assertValidCalendarDate`) — comparar un
 * string mal formado contra otro no dice nada.
 */
function assertRangeNotInverted(startDate: string, endDate: string): void {
  if (startDate > endDate) {
    throw new Error(`Rango de fechas inválido: startDate (${startDate}) es posterior a endDate (${endDate}).`);
  }
}

/**
 * Idempotente por `creationKey` — mismo motivo que TAL-5 ronda 1 en Prisma
 * (doble clic/reenvío del formulario "+ Nuevo calendario" no debe crear
 * dos filas).
 *
 * `internalMutation`, no `mutation` — ver docs/convex-modelo-de-datos.md §
 * "Sin autenticación/autorización todavía" (hallazgo de auditoría, ronda
 * 1): sin esto, cualquiera con la URL del deployment podía crear
 * calendarios arbitrarios sin ningún control de acceso.
 */
export const createCalendar = internalMutation({
  args: {
    name: v.string(),
    coverTitle: v.string(),
    coverImageUrl: v.optional(v.string()),
    startDate: v.string(),
    endDate: v.string(),
    skinId: v.id("skins"),
    creationKey: v.string(),
  },
  handler: async (ctx, args) => {
    assertValidCalendarDate(args.startDate);
    assertValidCalendarDate(args.endDate);
    assertRangeNotInverted(args.startDate, args.endDate);

    // Integridad referencial (hallazgo de auditoría, ronda 1): `v.id("skins")`
    // en `args` solo valida que el string TIENE FORMA de id de esa tabla,
    // no que el documento existe de verdad — ver
    // docs/convex-modelo-de-datos.md § "Integridad referencial". Sin este
    // `ctx.db.get`, un `skinId` de un documento ya borrado (o de otra
    // tabla, si alguien construye el id a mano) se insertaba igual,
    // dejando el Calendar con una referencia rota.
    const skin = await ctx.db.get(args.skinId);
    if (!skin) throw new Error("El skin indicado no existe.");

    const existing = await ctx.db
      .query("calendars")
      .withIndex("by_creation_key", (q) => q.eq("creationKey", args.creationKey))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("calendars", { ...args, updatedAt: Date.now() });
  },
});

/**
 * Equivalente Convex al trigger `BEFORE UPDATE ON "Calendar"` de Postgres
 * (TAL-6 ronda 3, docs/dias.md) que impedía reducir el rango del
 * calendario dejando algún `Day` existente fuera de él. Convex no tiene
 * triggers de base de datos — ver docs/convex-modelo-de-datos.md §
 * "Invariante de rango Calendar/Day" para la decisión completa de dónde
 * vive esta comprobación ahora y qué garantía se pierde al no ser un
 * trigger (depende de que TODO código que cambie startDate/endDate pase
 * por esta mutation, no lo impone la plataforma).
 */
export const updateCalendarRange = internalMutation({
  args: { calendarId: v.id("calendars"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, args) => {
    assertValidCalendarDate(args.startDate);
    assertValidCalendarDate(args.endDate);
    assertRangeNotInverted(args.startDate, args.endDate);

    const calendar = await ctx.db.get(args.calendarId);
    if (!calendar) throw new Error("El calendario ya no existe.");

    // Dos consultas acotadas por índice (días antes del nuevo startDate,
    // días después del nuevo endDate) en vez de `collect()` sobre todos
    // los días del calendario (sugerencia no bloqueante de auditoría,
    // ronda 1) — cada una para en cuanto encuentra un solo día fuera de
    // rango (`.first()`), sin cargar el resto. Sigue leyendo exactamente
    // el rango de índice donde puede estar el día "problemático" — mismo
    // razonamiento que ya se verificó como seguro bajo la carrera real
    // contra `upsertDay` (ver docs/convex-modelo-de-datos.md §
    // "Concurrencia"): el día que `upsertDay` inserta/mueve fuera del
    // rango nuevo cae, por definición, en una de estas dos franjas.
    const beforeNewRange = await ctx.db
      .query("days")
      .withIndex("by_calendar_and_date", (q) => q.eq("calendarId", args.calendarId).lt("date", args.startDate))
      .first();
    const afterNewRange = await ctx.db
      .query("days")
      .withIndex("by_calendar_and_date", (q) => q.eq("calendarId", args.calendarId).gt("date", args.endDate))
      .first();
    if (beforeNewRange || afterNewRange) {
      throw new Error(
        "No se puede cambiar el rango: hay al menos un día con vídeo asignado que quedaría fuera del rango nuevo."
      );
    }

    await ctx.db.patch(args.calendarId, {
      startDate: args.startDate,
      endDate: args.endDate,
      updatedAt: Date.now(),
    });
  },
});

export const get = internalQuery({
  args: { calendarId: v.id("calendars") },
  handler: async (ctx, args) => ctx.db.get(args.calendarId),
});
