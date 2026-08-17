import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { DAY_OUTSIDE_RANGE_ERROR_MESSAGE } from "./calendarErrorMessages";
import { MAX_CALENDAR_NAME_LENGTH } from "./calendarNameConstants";
import { MAX_COVER_ICON_LENGTH } from "./coverIconConstants";
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
 * Solo `https:` — mismo límite que ya validaba `updateCalendarAction`
 * (Next.js, hallazgo de auditoría TAL-5 ronda 1: `javascript:`/`data:`/
 * `file:` son URLs sintácticamente válidas que podrían ejecutar contenido
 * activo si se renderizan tal cual). Corrección de auditoría, TAL-12
 * ronda 1: esa validación solo vivía en la Server Action — un futuro
 * llamador directo de `createCalendarPublic`/`updateCalendarPublic`
 * (saltándose la UI) podía guardar un esquema peligroso. Se repite aquí
 * como invariante de escritura real, no solo de UI — mismo criterio que
 * el resto de invariantes de este fichero (rango de fechas, integridad
 * referencial).
 */
function assertSafeCoverImageUrl(url: string | undefined): void {
  if (url === undefined) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("La foto de portada debe ser una URL válida.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("La foto de portada debe ser una URL https:// — no se aceptan otros esquemas por seguridad.");
  }
}

/**
 * Deliberadamente NO valida contra el catálogo de `src/lib/cover-icons.ts`
 * (brief de TAL-23: "catálogo sin límite fijo en la lógica", mismo
 * criterio que ya se aplicó a la validación de email en `inviteGuest`,
 * TAL-16 — aquí ni siquiera existe un catálogo fijo del lado de Convex).
 * Solo la cota de longitud defensiva, igual que `videoUrl`/`message`
 * (TAL-13).
 */
function assertValidCoverIcon(icon: string | undefined): void {
  if (icon === undefined) return;
  if (icon.length === 0) throw new Error("El icono de portada no puede estar vacío.");
  if (icon.length > MAX_COVER_ICON_LENGTH) {
    throw new Error(`El icono de portada no puede superar los ${MAX_COVER_ICON_LENGTH} caracteres.`);
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
    throw new Error(DAY_OUTSIDE_RANGE_ERROR_MESSAGE);
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
/**
 * TAL-26 — "Pedir nombre al crear": antes `name` no tenía NINGUNA
 * validación en Convex (ni "no vacío"), porque siempre llegaba fijo
 * ("Nuevo calendario", puesto por `createCalendarForAdmin`) — nunca
 * hacía falta. Ahora lo escribe el propio Admin, así que la invariante
 * deja de ser hipotética. Cota de longitud defensiva, no de producto —
 * mismo criterio que `assertValidCoverIcon`/`MAX_VIDEO_URL_LENGTH`
 * (TAL-6/13/23): nada en la UI necesita un nombre más largo que esto.
 * Normaliza con `trim()` antes de validar Y de guardar — nunca se fía de
 * que el llamador (Next.js) ya lo haya recortado, mismo criterio
 * defensivo que el resto de este fichero.
 *
 * Deliberadamente NO se aplica a `updateCalendarHandler` en esta tarea —
 * el brief de TAL-26 acota el trabajo a la creación ("pedir nombre AL
 * CREAR"); el formulario de edición ya exige "no vacío" del lado de
 * Next.js (`updateCalendarAction`, TAL-5) pero no re-verifica nada de
 * esto en Convex. Inconsistencia real y menor, documentada aquí a
 * propósito en vez de ampliar el alcance de esta tarea sin que nadie lo
 * pidiera — seguimiento natural si el equipo quiere cerrarla del todo.
 */
function assertValidCalendarName(name: string): void {
  if (name.length === 0) throw new Error("El nombre del calendario no puede estar vacío.");
  if (name.length > MAX_CALENDAR_NAME_LENGTH) {
    throw new Error(`El nombre del calendario no puede superar los ${MAX_CALENDAR_NAME_LENGTH} caracteres.`);
  }
}

async function createCalendarHandler(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    name: string;
    coverTitle: string;
    coverIcon?: string;
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

  const name = args.name.trim();
  assertValidCalendarName(name);
  assertValidCalendarDate(args.startDate);
  assertValidCalendarDate(args.endDate);
  assertRangeNotInverted(args.startDate, args.endDate);
  assertSafeCoverImageUrl(args.coverImageUrl);
  assertValidCoverIcon(args.coverIcon);

  const calendarId = await ctx.db.insert("calendars", {
    name,
    coverTitle: args.coverTitle,
    coverIcon: args.coverIcon,
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
    coverIcon: v.optional(v.string()),
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
    coverIcon?: string;
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
  assertSafeCoverImageUrl(args.coverImageUrl);
  assertValidCoverIcon(args.coverIcon);

  await ctx.db.patch(args.calendarId, {
    name: args.name,
    coverTitle: args.coverTitle,
    coverIcon: args.coverIcon,
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
    coverIcon: v.optional(v.string()),
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

/**
 * Resuelve existencia + autorización + borrado en UNA sola mutation —
 * hallazgo de auditoría, TAL-12 ronda 2: la versión anterior (Next.js
 * llamando existencia, autorización y borrado como tres operaciones
 * Convex independientes) tenía una ventana de carrera real bajo
 * concurrencia genuina (dos peticiones solapadas, no solo un reenvío
 * secuencial): las dos podían ver el calendario existir antes de que la
 * primera lo borrara, así que la segunda SÍ llegaba a comprobar
 * membership, ya no la encontraba (la primera ya la borró) y caía en "no
 * autorizado" en vez de "ya está borrado". Mismo patrón que ya resolvió
 * TAL-11 para `resolveMemberAccess` (docs/convex-auth-investigacion-tal11.md
 * § "Gotcha 3") — toda la lógica que depende de un estado que otra
 * operación puede cambiar mientras tanto tiene que vivir en una única
 * mutation serializable, nunca repartida en varias llamadas desde
 * Next.js.
 *
 * Solo recibe `userId`, NUNCA `isSuperAdmin` como argumento (hallazgo de
 * auditoría, ronda 3: la versión anterior aceptaba `isSuperAdmin` como
 * booleano afirmado por quien llama, resuelto en una query Convex APARTE
 * en Next.js — la mutation se lo creía sin comprobar nada, así que un
 * privilegio revocado entre esa lectura y esta llamada seguía surtiendo
 * efecto aquí, y de raíz: el contrato público permitía que cualquier
 * código con el secreto compartido afirmara `isSuperAdmin: true`
 * directamente, sin que esta mutation lo verificase por su cuenta — nunca
 * aceptar un resultado de autorización como argumento afirmado desde
 * fuera, ni siquiera del propio Next.js). Corrección: el documento
 * `users` se relee aquí DENTRO de la misma transacción — `isSuperAdmin`
 * es tan "estado que puede cambiar mientras tanto" como la membership, y
 * cierra exactamente el mismo tipo de ventana.
 */
async function deleteCalendarAsUserHandler(
  ctx: MutationCtx,
  args: { calendarId: Id<"calendars">; userId: Id<"users"> }
): Promise<"deleted" | "already-gone" | "unauthorized"> {
  const calendar = await ctx.db.get(args.calendarId);
  if (!calendar) return "already-gone";

  const user = await ctx.db.get(args.userId);
  if (!user) return "unauthorized";

  if (!user.isSuperAdmin) {
    const membership = await ctx.db
      .query("calendarMemberships")
      .withIndex("by_calendar_and_user", (q) => q.eq("calendarId", args.calendarId).eq("userId", args.userId))
      .unique();
    if (!membership || membership.role !== "ADMIN") return "unauthorized";
  }

  await deleteCalendarHandler(ctx, { calendarId: args.calendarId });
  return "deleted";
}

export const deleteCalendarAsUser = internalMutation({
  args: { calendarId: v.id("calendars"), userId: v.id("users") },
  handler: deleteCalendarAsUserHandler,
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

// TAL-23, hallazgo de auditoría ronda 1: los calendarios creados ANTES de
// esta tarea ya llevan el 🎄 incrustado a mano al final de `coverTitle`
// (el único mecanismo que existía para tener un icono — ver el histórico
// `createCalendarForAdmin`, `src/lib/calendars.ts`, que siempre generaba
// `"... 🎄"`). Sin este backfill, el respaldo de lectura `coverIcon ??
// DEFAULT_COVER_ICON` (aplicado en cada sitio que muestra la portada,
// `src/app/admin/[calendarId]/page.tsx`/`src/app/c/[calendarId]/page.tsx`)
// duplica el emoji ("🎄 ¡Feliz cuenta atrás, equipo! 🎄") — y si alguien
// edita y guarda ese calendario después, `coverIcon` se persiste pero el
// 🎄 sigue dentro de `coverTitle` sin limpiar: deja de ser un problema
// transitorio del respaldo de lectura y se queda así para siempre, porque
// el formulario de edición nunca reescribe `coverTitle` por su cuenta.
//
// Hallazgo de auditoría, ronda 2: NO basta con detectar "termina en
// ' 🎄'" — desde TAL-5, `updateCalendarAction` siempre permitió editar
// `coverTitle` como texto completamente libre, así que un Admin pudo
// haber escrito de verdad un título propio que termine en ese mismo
// emoji ("Navidad en familia 🎄"), sin ninguna relación con el mecanismo
// viejo. Migrar ese título automáticamente le habría quitado al Admin un
// texto elegido por él, de forma efectivamente irreversible (si luego
// cambia el icono, el 🎄 desaparece del título sin que lo pidiera). Solo
// se puede tener CERTEZA del origen para el literal exacto que generaba
// el mecanismo viejo — cualquier otra cosa que termine igual "por
// casualidad" no se toca. Riesgo residual documentado y aceptado (ver
// docs/calendarios.md): un calendario legado cuyo título fue editado
// DESPUÉS de creado (p. ej. le cambiaron el nombre pero dejaron el 🎄 al
// final) ya no coincide con el literal exacto y se queda fuera de este
// backfill — se resuelve bien igualmente por el respaldo de lectura
// (`DEFAULT_COVER_ICON`, sin duplicar nada porque el título en sí ya no
// es el literal conocido), aunque conserve el emoji suelto dentro del
// texto hasta que alguien lo edite a mano.
const LEGACY_DEFAULT_COVER_TITLE = "¡Feliz cuenta atrás, equipo! 🎄";
const LEGACY_EMBEDDED_ICON_SUFFIX = " 🎄";
const LEGACY_EMBEDDED_ICON = "🎄";

/**
 * Backfill real, no un simple respaldo de lectura — Convex no tiene un
 * mecanismo de migración de datos declarativo (mismo tema ya documentado
 * en `docs/convex-modelo-de-datos.md`/`convex/schema.ts` § `coverIcon`
 * para el resto de calendarios sin `coverIcon`, donde SÍ basta un
 * respaldo de lectura porque no hay ningún texto duplicado que limpiar).
 * Idempotente: una vez migrado un calendario, `coverIcon` deja de ser
 * `undefined` y la siguiente pasada lo salta — reejecutar tras un primer
 * paso exitoso es un no-op seguro. Se invoca a mano, una sola vez por
 * deployment, vía el canal de administrador de la CLI (`npx convex run
 * calendars:backfillEmbeddedCoverIcon '{}'`, mismo canal que TAL-9/12/16
 * — ver docs/convex-modelo-de-datos.md § "Bajo nivel"), nunca desde
 * código de aplicación: es un arreglo de datos históricos de un momento
 * concreto, no un paso del flujo normal de creación/edición.
 */
async function backfillEmbeddedCoverIconHandler(
  ctx: MutationCtx
): Promise<{ migrated: number; skippedAlreadySet: number; skippedNoMatch: number }> {
  const calendars = await ctx.db.query("calendars").collect();
  let migrated = 0;
  let skippedAlreadySet = 0;
  let skippedNoMatch = 0;

  for (const calendar of calendars) {
    if (calendar.coverIcon !== undefined) {
      skippedAlreadySet++;
      continue;
    }
    if (calendar.coverTitle !== LEGACY_DEFAULT_COVER_TITLE) {
      skippedNoMatch++;
      continue;
    }
    await ctx.db.patch(calendar._id, {
      coverTitle: calendar.coverTitle.slice(0, -LEGACY_EMBEDDED_ICON_SUFFIX.length).trimEnd(),
      coverIcon: LEGACY_EMBEDDED_ICON,
      updatedAt: Date.now(),
    });
    migrated++;
  }

  return { migrated, skippedAlreadySet, skippedNoMatch };
}

export const backfillEmbeddedCoverIcon = internalMutation({
  args: {},
  handler: backfillEmbeddedCoverIconHandler,
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
    coverIcon: v.optional(v.string()),
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
      coverIcon: args.coverIcon,
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
    coverIcon: v.optional(v.string()),
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
      coverIcon: args.coverIcon,
      coverImageUrl: args.coverImageUrl,
      startDate: args.startDate,
      endDate: args.endDate,
      skinId: args.skinId,
    });
  },
});

/**
 * Frontera pública de `deleteCalendarAsUserHandler` — ver el comentario
 * completo ahí para el porqué (hallazgos de auditoría, TAL-12 rondas 2 y
 * 3). Deliberadamente NO existe una versión pública del `deleteCalendar`
 * "desnudo" (sin `userId`, que confiaría ciegamente en que quien llama ya
 * comprobó autorización aparte): esa forma es exactamente la que permitió
 * la ventana de carrera de la ronda 2. Y deliberadamente `args` NO incluye
 * `isSuperAdmin` ni ningún otro resultado de autorización afirmado desde
 * fuera (ronda 3) — solo `userId`, una referencia de identidad; el
 * privilegio se relee dentro de la propia mutation. La única puerta
 * pública para borrar un calendario resuelve identidad, autorización y
 * borrado juntos, atómicamente, sin confiar en nada que Next.js afirme
 * sobre el resultado de esa autorización.
 */
export const deleteCalendarAsUserPublic = mutation({
  args: { serverSecret: v.string(), calendarId: v.id("calendars"), userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await deleteCalendarAsUserHandler(ctx, {
      calendarId: args.calendarId,
      userId: args.userId,
    });
  },
});

export const getPublic = query({
  args: { serverSecret: v.string(), calendarId: v.id("calendars") },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await ctx.db.get(args.calendarId);
  },
});

/**
 * TAL-25 — frontera pública DELIBERADAMENTE distinta de `getPublic`
 * (arriba): esta es la única consulta a `calendars` alcanzable desde una
 * página SIN AUTENTICAR (`/login`, portada personalizada por
 * `callbackUrl`). `getPublic` devuelve el documento entero (`skinId`,
 * `startDate`/`endDate`, `creationKey`, `updatedAt`...) porque sus dos
 * únicos llamadores (`admin/[calendarId]/page.tsx`, `c/[calendarId]/page.tsx`)
 * ya exigen que quien mira esté autenticado Y tenga acceso a ese
 * calendario concreto — devolver el documento completo ahí es seguro
 * porque la autorización ya se resolvió antes de llegar aquí. Para
 * `/login` no hay ninguna autorización previa que resolver (es el propio
 * punto de entrada, alcanzable por cualquiera con el link de invitación
 * antes de loguearse) — así que esta consulta expone una lista blanca
 * explícita y mínima (solo lo que ya decidimos, TAL-25, que es aceptable
 * enseñar a alguien no autenticado: el nombre bonito, la foto y el icono
 * de portada — nada de fechas, skin, ni ningún otro campo interno), en
 * vez de reutilizar `getPublic` y confiar en que Next.js recuerde no
 * reenviar el resto del documento al cliente.
 */
export const getPublicCoverInfoForLogin = query({
  args: { serverSecret: v.string(), calendarId: v.id("calendars") },
  handler: async (
    ctx,
    args
  ): Promise<{ coverTitle: string; coverIcon?: string; coverImageUrl?: string } | null> => {
    await requireServerSecret(args.serverSecret);
    const calendar = await ctx.db.get(args.calendarId);
    if (!calendar) return null;
    return {
      coverTitle: calendar.coverTitle,
      coverIcon: calendar.coverIcon,
      coverImageUrl: calendar.coverImageUrl,
    };
  },
});

export const listCalendarsForUserPublic = query({
  args: { serverSecret: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await listCalendarsForUserHandler(ctx, { userId: args.userId });
  },
});
