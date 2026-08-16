import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { assertValidCalendarDate } from "./dates";
import { requireServerSecret } from "./serverAuth";

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
 * Equivalente Convex al trigger `BEFORE UPDATE ON "Calendar"` de Postgres
 * (TAL-6 ronda 3, docs/dias.md) que impedía reducir el rango del
 * calendario dejando algún `Day` existente fuera de él. Convex no tiene
 * triggers de base de datos — ver docs/convex-modelo-de-datos.md §
 * "Invariante de rango Calendar/Day" para la decisión completa de dónde
 * vive esta comprobación ahora y qué garantía se pierde al no ser un
 * trigger (depende de que TODO código que cambie startDate/endDate pase
 * por esta función, no lo impone la plataforma). Factorizada (TAL-12) para
 * que `updateCalendar` y `updateCalendarRange` compartan el mismo cuerpo
 * en vez de arriesgar que dos copias diverjan con el tiempo.
 */
async function assertNoDayOutsideRange(
  ctx: MutationCtx,
  calendarId: Id<"calendars">,
  startDate: string,
  endDate: string
): Promise<void> {
  // Dos consultas acotadas por índice (días antes del nuevo startDate,
  // días después del nuevo endDate) en vez de `collect()` sobre todos los
  // días del calendario (sugerencia no bloqueante de auditoría, TAL-9
  // ronda 1) — cada una para en cuanto encuentra un solo día fuera de
  // rango (`.first()`), sin cargar el resto.
  const beforeNewRange = await ctx.db
    .query("days")
    .withIndex("by_calendar_and_date", (q) => q.eq("calendarId", calendarId).lt("date", startDate))
    .first();
  const afterNewRange = await ctx.db
    .query("days")
    .withIndex("by_calendar_and_date", (q) => q.eq("calendarId", calendarId).gt("date", endDate))
    .first();
  if (beforeNewRange || afterNewRange) {
    throw new Error(
      "No se puede cambiar el rango: hay al menos un día con vídeo asignado que quedaría fuera del rango nuevo."
    );
  }
}

/**
 * "pine" es el skin por defecto (histórico `prisma/seed.ts`, "Verde pino
 * con acentos dorados — skin por defecto") — si no existe en este
 * deployment (seed distinto, entorno sin sembrar del todo), cae al primer
 * skin por `key` en vez de bloquear la creación del calendario, mismo
 * criterio que `defaultSkin()` en la versión Prisma (TAL-5).
 */
async function resolveDefaultSkinId(ctx: MutationCtx): Promise<Id<"skins">> {
  const pine = await ctx.db
    .query("skins")
    .withIndex("by_key", (q) => q.eq("key", "pine"))
    .unique();
  if (pine) return pine._id;

  const all = await ctx.db.query("skins").collect();
  if (all.length === 0) {
    throw new Error("No hay ningún skin sembrado todavía en este deployment.");
  }
  all.sort((a, b) => a.key.localeCompare(b.key));
  return all[0]._id;
}

/**
 * Crea un calendario con valores de partida razonables y, en la MISMA
 * mutation, la `calendarMembership` ADMIN del creador — así es como
 * alguien se convierte en Admin de su primer calendario (brief de TAL-5).
 * Nunca dos mutations separadas desde Next.js: reabriría el tipo de
 * ventana de carrera que TAL-7 tardó 2 rondas en cerrar (un calendario sin
 * ningún Admin todavía, aunque sea brevísimamente) — decisión ya cerrada
 * por la Directora al diseñar esta tarea
 * (docs/convex-diseno-tal12-crud-calendario.md).
 *
 * Idempotente por `creationKey` — mismo motivo que TAL-5 ronda 1 en Prisma
 * (doble clic/reenvío del formulario "+ Nuevo calendario" no debe crear
 * dos filas ni dos memberships).
 *
 * `skinId` es opcional a propósito (TAL-12): la Server Action de creación
 * no tiene selector de skin (un único botón "+ Nuevo calendario", ver
 * `src/app/admin/page.tsx`) — si no llega, se resuelve el skin por defecto
 * DENTRO de Convex (`resolveDefaultSkinId`), mismo criterio que el resto
 * del dominio de fechas/validación ya vive aquí y no en la Server Action.
 */
async function createCalendarHandler(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    name: string;
    coverTitle: string;
    coverImageUrl?: string;
    startDate: string;
    endDate: string;
    skinId?: Id<"skins">;
    creationKey: string;
  }
): Promise<Id<"calendars">> {
  const existing = await ctx.db
    .query("calendars")
    .withIndex("by_creation_key", (q) => q.eq("creationKey", args.creationKey))
    .unique();
  if (existing) return existing._id;

  // Integridad referencial (hallazgo de auditoría, TAL-9 ronda 1) —
  // `v.id("users")` en `args` solo valida que el string TIENE FORMA de id
  // de esa tabla, no que el documento existe de verdad.
  const user = await ctx.db.get(args.userId);
  if (!user) throw new Error("El usuario indicado no existe.");

  const skinId = args.skinId ?? (await resolveDefaultSkinId(ctx));
  const skin = await ctx.db.get(skinId);
  if (!skin) throw new Error("El skin indicado no existe.");

  assertValidCalendarDate(args.startDate);
  assertValidCalendarDate(args.endDate);
  assertRangeNotInverted(args.startDate, args.endDate);

  const calendarId = await ctx.db.insert("calendars", {
    name: args.name,
    coverTitle: args.coverTitle,
    coverImageUrl: args.coverImageUrl,
    startDate: args.startDate,
    endDate: args.endDate,
    skinId,
    creationKey: args.creationKey,
    updatedAt: Date.now(),
  });
  await ctx.db.insert("calendarMemberships", { calendarId, userId: args.userId, role: "ADMIN" });
  return calendarId;
}

export const createCalendar = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    coverTitle: v.string(),
    coverImageUrl: v.optional(v.string()),
    startDate: v.string(),
    endDate: v.string(),
    skinId: v.optional(v.id("skins")),
    creationKey: v.string(),
  },
  handler: createCalendarHandler,
});

/**
 * Actualiza TODOS los campos editables de una vez, en una sola mutation —
 * igual que `updateCalendarAction` (Prisma) hace en un único `update`.
 * Decisión ya cerrada por la Directora: no dos mutations separadas
 * (detalles + rango), que dejarían una superficie de inconsistencia nueva
 * si la segunda fallara tras la primera (docs/convex-diseno-tal12-crud-calendario.md).
 * Reutiliza `assertNoDayOutsideRange`, la misma comprobación que ya
 * escribió TAL-9 para `updateCalendarRange`.
 */
async function updateCalendarHandler(
  ctx: MutationCtx,
  args: {
    calendarId: Id<"calendars">;
    name: string;
    coverTitle: string;
    coverImageUrl?: string;
    startDate: string;
    endDate: string;
    skinId: Id<"skins">;
  }
): Promise<void> {
  const calendar = await ctx.db.get(args.calendarId);
  if (!calendar) throw new Error("El calendario ya no existe.");

  const skin = await ctx.db.get(args.skinId);
  if (!skin) throw new Error("El skin indicado no existe.");

  assertValidCalendarDate(args.startDate);
  assertValidCalendarDate(args.endDate);
  assertRangeNotInverted(args.startDate, args.endDate);
  await assertNoDayOutsideRange(ctx, args.calendarId, args.startDate, args.endDate);

  await ctx.db.patch(args.calendarId, {
    name: args.name,
    coverTitle: args.coverTitle,
    coverImageUrl: args.coverImageUrl,
    startDate: args.startDate,
    endDate: args.endDate,
    skinId: args.skinId,
    updatedAt: Date.now(),
  });
}

export const updateCalendar = internalMutation({
  args: {
    calendarId: v.id("calendars"),
    name: v.string(),
    coverTitle: v.string(),
    coverImageUrl: v.optional(v.string()),
    startDate: v.string(),
    endDate: v.string(),
    skinId: v.id("skins"),
  },
  handler: updateCalendarHandler,
});

/**
 * Caso particular de `updateCalendar` (solo fechas) — TAL-9 la escribió
 * antes de que existiera la mutation completa; se deja como función
 * interna de soporte (no la llama ninguna Server Action hoy, `updateCalendar`
 * la sustituye para el formulario de edición) por si algún flujo futuro
 * necesita cambiar solo el rango sin tocar el resto de campos.
 */
export const updateCalendarRange = internalMutation({
  args: { calendarId: v.id("calendars"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, args) => {
    assertValidCalendarDate(args.startDate);
    assertValidCalendarDate(args.endDate);
    assertRangeNotInverted(args.startDate, args.endDate);

    const calendar = await ctx.db.get(args.calendarId);
    if (!calendar) throw new Error("El calendario ya no existe.");

    await assertNoDayOutsideRange(ctx, args.calendarId, args.startDate, args.endDate);

    await ctx.db.patch(args.calendarId, {
      startDate: args.startDate,
      endDate: args.endDate,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Borrado en cascada manual completo — Convex no tiene `onDelete: Cascade`
 * declarativo (TAL-9 ya lo dejó anotado como pendiente). Todo dentro de
 * UNA mutation transaccional para que un borrado a medias no pueda quedar
 * a mitad camino: días→dayViews de esos días→memberships→invitations→el
 * propio calendario. Idempotente — reenviar un borrado ya hecho es un
 * no-op, mismo criterio que el P2025 ("registro no encontrado") de
 * Prisma: no es un error real, solo confirma que ya no está.
 *
 * Índice `by_day_and_user` (`dayViews`) usado como prefijo por `dayId`
 * solo (sin fijar `userId`) — verificado contra el deployment real (ver
 * evidencias del export), la nota de TAL-2 en el diseño quedó confirmada.
 */
async function deleteCalendarHandler(ctx: MutationCtx, args: { calendarId: Id<"calendars"> }): Promise<void> {
  const calendar = await ctx.db.get(args.calendarId);
  if (!calendar) return;

  const days = await ctx.db
    .query("days")
    .withIndex("by_calendar_and_date", (q) => q.eq("calendarId", args.calendarId))
    .collect();
  for (const day of days) {
    const views = await ctx.db
      .query("dayViews")
      .withIndex("by_day_and_user", (q) => q.eq("dayId", day._id))
      .collect();
    for (const view of views) await ctx.db.delete(view._id);
    await ctx.db.delete(day._id);
  }

  const memberships = await ctx.db
    .query("calendarMemberships")
    .withIndex("by_calendar_and_user", (q) => q.eq("calendarId", args.calendarId))
    .collect();
  for (const membership of memberships) await ctx.db.delete(membership._id);

  const invitations = await ctx.db
    .query("invitations")
    .withIndex("by_calendar_and_email", (q) => q.eq("calendarId", args.calendarId))
    .collect();
  for (const invitation of invitations) await ctx.db.delete(invitation._id);

  await ctx.db.delete(args.calendarId);
}

export const deleteCalendar = internalMutation({
  args: { calendarId: v.id("calendars") },
  handler: deleteCalendarHandler,
});

export const get = internalQuery({
  args: { calendarId: v.id("calendars") },
  handler: async (ctx, args) => ctx.db.get(args.calendarId),
});

/**
 * Calendarios donde `userId` es ADMIN, con su skin — equivalente a
 * `listAdminCalendars` (Prisma, `include: { skin: true }`). Convex no
 * tiene joins: se resuelve consultando primero las membresías ADMIN del
 * usuario, luego cada calendario+skin por separado (patrón N+1 explícito,
 * el patrón idiomático de Convex, no un rodeo — ver
 * docs/convex-diseno-tal12-crud-calendario.md).
 */
async function listCalendarsForUserHandler(
  ctx: QueryCtx,
  args: { userId: Id<"users"> }
): Promise<(Doc<"calendars"> & { skin: Doc<"skins"> | null })[]> {
  const memberships = await ctx.db
    .query("calendarMemberships")
    .withIndex("by_user", (q) => q.eq("userId", args.userId))
    .filter((q) => q.eq(q.field("role"), "ADMIN"))
    .collect();

  const calendars = await Promise.all(
    memberships.map(async (membership) => {
      const calendar = await ctx.db.get(membership.calendarId);
      // Referencia rota (calendario borrado sin limpiar esta membership) —
      // no debería pasar con `deleteCalendarHandler` arriba, defensivo.
      if (!calendar) return null;
      const skin = await ctx.db.get(calendar.skinId);
      return { ...calendar, skin };
    })
  );

  // orderBy createdAt "desc" en Prisma → `_creationTime` aquí (`calendars`
  // no tiene `createdAt` propio, ver docs/convex-modelo-de-datos.md),
  // ordenado en código de aplicación — no hay índice de Convex por
  // `_creationTime` fuera de caja para esto.
  return calendars.filter((c) => c !== null).sort((a, b) => b._creationTime - a._creationTime);
}

export const listCalendarsForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: listCalendarsForUserHandler,
});

// --- Frontera pública (TAL-12) — mismo patrón que convex/access.ts (TAL-11):
// función delgada por operación, comprueba el secreto y delega
// directamente en la función plana (no via ctx.runQuery/ctx.runMutation al
// internal del mismo fichero, para evitar la referencia circular de tipos
// ya documentada en convex/users.ts/access.ts). La identidad/autorización
// (¿es este userId de verdad Admin de este calendario?) se resuelve
// enteramente en Next.js antes de llamar — src/app/admin/actions.ts,
// mismo modelo de confianza que TAL-11.

export const createCalendarPublic = mutation({
  args: {
    serverSecret: v.string(),
    userId: v.id("users"),
    name: v.string(),
    coverTitle: v.string(),
    coverImageUrl: v.optional(v.string()),
    startDate: v.string(),
    endDate: v.string(),
    skinId: v.optional(v.id("skins")),
    creationKey: v.string(),
  },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await createCalendarHandler(ctx, {
      userId: args.userId,
      name: args.name,
      coverTitle: args.coverTitle,
      coverImageUrl: args.coverImageUrl,
      startDate: args.startDate,
      endDate: args.endDate,
      skinId: args.skinId,
      creationKey: args.creationKey,
    });
  },
});

export const updateCalendarPublic = mutation({
  args: {
    serverSecret: v.string(),
    calendarId: v.id("calendars"),
    name: v.string(),
    coverTitle: v.string(),
    coverImageUrl: v.optional(v.string()),
    startDate: v.string(),
    endDate: v.string(),
    skinId: v.id("skins"),
  },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    await updateCalendarHandler(ctx, {
      calendarId: args.calendarId,
      name: args.name,
      coverTitle: args.coverTitle,
      coverImageUrl: args.coverImageUrl,
      startDate: args.startDate,
      endDate: args.endDate,
      skinId: args.skinId,
    });
  },
});

export const deleteCalendarPublic = mutation({
  args: { serverSecret: v.string(), calendarId: v.id("calendars") },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    await deleteCalendarHandler(ctx, { calendarId: args.calendarId });
  },
});

export const getPublic = query({
  args: { serverSecret: v.string(), calendarId: v.id("calendars") },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await ctx.db.get(args.calendarId);
  },
});

export const listCalendarsForUserPublic = query({
  args: { serverSecret: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await listCalendarsForUserHandler(ctx, { userId: args.userId });
  },
});
