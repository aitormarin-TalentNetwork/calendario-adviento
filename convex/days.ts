import { internal } from "./_generated/api";
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { CALENDAR_NO_LONGER_EXISTS_ERROR_MESSAGE, DAY_OUTSIDE_CALENDAR_RANGE_ERROR_MESSAGE } from "./calendarErrorMessages";
import { assertValidCalendarDate } from "./dates";
import { requireServerSecret } from "./serverAuth";
import { isCalendarAdminActor } from "./calendarPeople";
import { deleteDayFilesForDay, obtainThumbnail, type ThumbnailOutcome } from "./dayFiles";
import { thumbnailSourceForVideo } from "./dayFileGuards";

// Mismo criterio que `coverImageUrl`/`parseVideoUrl` en la versión Next.js
// (`src/app/admin/[calendarId]/days-actions.ts`, TAL-6 ronda 1): solo
// `https:`, para no aceptar `javascript:`/`data:`/etc. Duplicado aquí a
// propósito (defensa en profundidad, TAL-13) en vez de confiar en que
// Next.js siempre valida antes de llamar — el secreto compartido
// (TAL-11) prueba "esta llamada viene de nuestro servidor", no "nuestro
// servidor validó todo correctamente", son cosas distintas (ver
// docs/convex-auth-investigacion-tal11.md § "Recomendación cerrada").
// Mismos límites (2000 caracteres) que `MAX_VIDEO_URL_LENGTH`/
// `MAX_MESSAGE_LENGTH` en Next.js — límite defensivo, no de producto.
const MAX_VIDEO_URL_LENGTH = 2000;
const MAX_MESSAGE_LENGTH = 2000;

function assertValidVideoUrl(raw: string): void {
  if (raw.length > MAX_VIDEO_URL_LENGTH) {
    throw new Error(`La URL del vídeo no puede superar los ${MAX_VIDEO_URL_LENGTH} caracteres.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("El vídeo debe ser una URL válida.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("El vídeo debe ser una URL https:// — no se aceptan otros esquemas por seguridad.");
  }
}

function assertValidMessage(message: string | undefined): void {
  if (message !== undefined && message.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`El mensaje no puede superar los ${MAX_MESSAGE_LENGTH} caracteres.`);
  }
}

/**
 * Upsert por (calendarId, date) — equivalente a `saveDayAction` (TAL-6).
 * También valida que la fecha está dentro del rango del Calendar en este
 * mismo momento: la otra mitad de la invariante de rango (la mitad que en
 * la versión Prisma vivía en el `SELECT ... FOR UPDATE` de la transacción
 * de aplicación, no en el trigger — ver `updateCalendarRange` en
 * calendars.ts y docs/convex-modelo-de-datos.md). Ya verificada como
 * carrera real contra `updateCalendarRange` por la propia auditoría de
 * TAL-9 (25 repeticiones simultáneas, 0 violaciones) — TAL-13 no reabre
 * esa pregunta, solo confirma (ver "Evidencia" en docs/dias.md) que sigue
 * intacta tras las extensiones de esta tarea.
 *
 * TAL-13 — extendida con la validación de `videoUrl`/`message` que
 * faltaba (hallazgo del propio diseño, `docs/convex-diseno-tal13-gestion-dias.md`):
 * mismo patrón que la validación de email añadida a `inviteGuest`
 * (TAL-16) — no hay dos semánticas en conflicto, solo una comprobación
 * que faltaba.
 *
 * La lógica vive en `upsertDayHandler`, una función plana normal,
 * invocada directamente tanto por `upsertDay` (internal) como por
 * `upsertDayPublic` (frontera pública, TAL-11) — mismo motivo que
 * `createUserHandler`/`resolveMemberAccessHandler` (ver convex/users.ts,
 * convex/access.ts): delegar vía `ctx.runMutation(internal.days.upsertDay,
 * ...)` desde la pública crearía una referencia circular de tipos dentro
 * del propio fichero.
 */
async function upsertDayHandler(
  ctx: MutationCtx,
  args: { calendarId: Id<"calendars">; date: string; videoUrl: string; message?: string }
): Promise<Id<"days">> {
  assertValidCalendarDate(args.date);
  assertValidVideoUrl(args.videoUrl);
  assertValidMessage(args.message);

  const calendar = await ctx.db.get(args.calendarId);
  if (!calendar) throw new Error(CALENDAR_NO_LONGER_EXISTS_ERROR_MESSAGE);
  if (args.date < calendar.startDate || args.date > calendar.endDate) {
    throw new Error(DAY_OUTSIDE_CALENDAR_RANGE_ERROR_MESSAGE);
  }

  const existing = await ctx.db
    .query("days")
    .withIndex("by_calendar_and_date", (q) => q.eq("calendarId", args.calendarId).eq("date", args.date))
    .unique();
  if (existing) {
    // TAL-67 — si cambia la URL del vídeo, la copia de la miniatura de la URL
    // anterior se borra aquí mismo (sin huérfanos). Vive en el handler
    // compartido, así que también aplica al guardar con el Next anterior
    // (`upsertDayPublic`) durante la ventana del despliegue.
    if (existing.videoUrl !== args.videoUrl) {
      const previousThumbnail = existing.thumbnailStorageId;
      await ctx.db.patch(existing._id, {
        videoUrl: args.videoUrl,
        message: args.message,
        thumbnailStorageId: undefined,
        thumbnailVideoUrl: undefined,
      });
      if (previousThumbnail && (await ctx.db.system.get(previousThumbnail))) await ctx.storage.delete(previousThumbnail);
    } else {
      await ctx.db.patch(existing._id, { videoUrl: args.videoUrl, message: args.message });
    }
    return existing._id;
  }
  return await ctx.db.insert("days", args);
}

export const upsertDay = internalMutation({
  args: {
    calendarId: v.id("calendars"),
    date: v.string(),
    videoUrl: v.string(),
    message: v.optional(v.string()),
  },
  handler: upsertDayHandler,
});

/**
 * Borra el `Day` de esa fecha — equivalente a `deleteDayAction` (TAL-6).
 * Idempotente: si no existe (reenvío, doble clic), no es error, mismo
 * criterio que el `P2025` de la versión Prisma.
 *
 * **Cascade de `dayViews`** (decisión de producto ya cerrada con Aitor,
 * ver brief de TAL-13 — no queda como pregunta abierta): `onDelete:
 * Cascade` en Prisma se llevaba las `DayView` de ese día por delante sin
 * que `deleteDayAction` tuviera que saberlo; Convex no tiene cascade
 * automático (mismo hallazgo que TAL-9 ya dejó anotado para
 * `deleteCalendar`, TAL-12).
 *
 * **Por lotes, no en la misma transacción** (hallazgo de auditoría, ronda
 * 1: la primera versión de esta función cargaba TODAS las `dayViews` de
 * un día con `.collect()` y las borraba una a una en la misma mutation
 * que el propio `Day` — sin ninguna cota, un día con suficientes vistas
 * podía exceder los límites de tamaño de una transacción de Convex
 * (32.000 documentos escaneados/16.000 escritos/16 MiB/1s) y quedar sin
 * poder borrarse nunca, con la mutation entera revertida). El `Day` se
 * borra aquí, de inmediato; la limpieza de sus `dayViews` se reprograma
 * en segundo plano, por lotes (`dayViews.ts::cleanupDayViewsBatch`) — ver
 * el razonamiento completo (incluida la decisión de NO inventar un
 * límite de producto nuevo para esquivar esto) en ese fichero.
 */
async function deleteDayHandler(
  ctx: MutationCtx,
  args: { calendarId: Id<"calendars">; date: string }
): Promise<void> {
  const existing = await ctx.db
    .query("days")
    .withIndex("by_calendar_and_date", (q) => q.eq("calendarId", args.calendarId).eq("date", args.date))
    .unique();
  if (!existing) return;

  // TAL-67 — sus ficheros y sus intenciones registradas (las sin registrar
  // quedan como tombstone, ver `dayFiles.ts::deleteDayFilesForDay`).
  await deleteDayFilesForDay(ctx, existing);
  await ctx.db.delete(existing._id);
  await ctx.scheduler.runAfter(0, internal.dayViews.cleanupDayViewsBatch, { dayId: existing._id });
}

export const deleteDay = internalMutation({
  args: { calendarId: v.id("calendars"), date: v.string() },
  handler: deleteDayHandler,
});

/**
 * Rango del calendario + sus días ya guardados, en una sola llamada —
 * equivalente a `prisma.calendar.findUniqueOrThrow` + `prisma.day.findMany`
 * combinados (`DaysSection`, TAL-6): la sección no tiene una rejilla
 * parcial honesta que mostrar si cualquiera de los dos falta, así que se
 * resuelven juntos, mismo criterio que `getCalendarForAdminPage`
 * (TAL-10). Vive en `days.ts` (no en `calendars.ts`, dominio de TAL-12 en
 * paralelo) — lee el `Calendar` vía `ctx.db.get` igual que ya hacía
 * `upsertDayHandler` arriba, no hace falta tocar el fichero de T1 para
 * esto.
 */
async function getCalendarDaysHandler(
  ctx: QueryCtx,
  args: { calendarId: Id<"calendars"> }
): Promise<{
  startDate: string;
  endDate: string;
  days: { date: string; videoUrl: string; message?: string; imageUrl: string | null; uploadedImageUrl: string | null }[];
}> {
  const calendar = await ctx.db.get(args.calendarId);
  if (!calendar) throw new Error("El calendario ya no existe.");

  const days = await ctx.db
    .query("days")
    .withIndex("by_calendar_and_date", (q) => q.eq("calendarId", args.calendarId))
    .collect();

  // TAL-67 — `imageUrl`: lo que pinta la casilla (subida > copia propia);
  // `uploadedImageUrl`: la vista previa del diálogo (solo la subida).
  const withImages = await Promise.all(
    days.map(async (day) => {
      const uploadedImageUrl = day.imageStorageId ? await ctx.storage.getUrl(day.imageStorageId) : null;
      const thumbnailUrl = day.thumbnailStorageId ? await ctx.storage.getUrl(day.thumbnailStorageId) : null;
      return {
        date: day.date,
        videoUrl: day.videoUrl,
        message: day.message,
        imageUrl: uploadedImageUrl ?? thumbnailUrl,
        uploadedImageUrl,
      };
    })
  );
  return { startDate: calendar.startDate, endDate: calendar.endDate, days: withImages };
}

export const getCalendarDays = internalQuery({
  args: { calendarId: v.id("calendars") },
  handler: getCalendarDaysHandler,
});

// --- Frontera pública (TAL-11) — ver convex/serverAuth.ts ---
// Función delgada por operación: comprueba el secreto y delega en la
// función plana real (mismo motivo que en convex/users.ts/access.ts).

export const upsertDayPublic = mutation({
  args: {
    serverSecret: v.string(),
    calendarId: v.id("calendars"),
    date: v.string(),
    videoUrl: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await upsertDayHandler(ctx, {
      calendarId: args.calendarId,
      date: args.date,
      videoUrl: args.videoUrl,
      message: args.message,
    });
  },
});

export const deleteDayPublic = mutation({
  args: { serverSecret: v.string(), calendarId: v.id("calendars"), date: v.string() },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    await deleteDayHandler(ctx, { calendarId: args.calendarId, date: args.date });
  },
});

export const getCalendarDaysPublic = query({
  args: { serverSecret: v.string(), calendarId: v.id("calendars") },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await getCalendarDaysHandler(ctx, { calendarId: args.calendarId });
  },
});

// --- TAL-67 — guardar el día con la copia propia de la miniatura ---

export type UpsertAsActorResult =
  | {
      ok: true;
      dayId: Id<"days">;
      videoUrl: string;
      observedThumbnailStorageId: Id<"_storage"> | undefined;
      needsThumbnail: boolean;
      hasUploadedImage: boolean;
    }
  | { ok: false; error: "not-authorized" };

/**
 * Upsert de siempre, con el rol del actor releído en la MISMA transacción
 * (Super Admin o membership ADMIN, `calendarPeople.ts`). Devuelve lo que
 * necesita `saveDayPublic` para el compare-and-set de la copia: el
 * `thumbnailStorageId` observado ahora mismo y si hace falta una copia (hay
 * proveedor reconocido y no hay copia válida para esta URL; un intento
 * fallido para la misma URL se reintenta, porque guardar es una acción
 * explícita del Admin).
 */
export const upsertDayAsActor = internalMutation({
  args: {
    actorUserId: v.id("users"),
    calendarId: v.id("calendars"),
    date: v.string(),
    videoUrl: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<UpsertAsActorResult> => {
    if (!(await isCalendarAdminActor(ctx, args.actorUserId, args.calendarId))) return { ok: false, error: "not-authorized" };
    const dayId = await upsertDayHandler(ctx, {
      calendarId: args.calendarId,
      date: args.date,
      videoUrl: args.videoUrl,
      message: args.message,
    });
    const day = (await ctx.db.get(dayId))!;
    const hasValidCopy = day.thumbnailStorageId !== undefined && day.thumbnailVideoUrl === day.videoUrl;
    return {
      ok: true,
      dayId,
      videoUrl: day.videoUrl,
      observedThumbnailStorageId: day.thumbnailStorageId,
      needsThumbnail: thumbnailSourceForVideo(day.videoUrl) !== null && !hasValidCopy,
      hasUploadedImage: day.imageStorageId !== undefined,
    };
  },
});

export type SaveDayResult =
  | { ok: true; thumbnail: ThumbnailOutcome | "unchanged"; hasUploadedImage: boolean }
  | { ok: false; error: "not-authorized" };

/**
 * Frontera pública (action) del guardado del día desde el Next de TAL-67:
 * secreto → upsert con el actor releído → copia propia de la miniatura si
 * hace falta. Las reglas de negocio del upsert (rango, calendario borrado)
 * siguen lanzando su mensaje exacto (`calendarErrorMessages.ts`), igual que
 * `upsertDayPublic`, que se conserva para el Next anterior.
 */
export const saveDayPublic = action({
  args: {
    serverSecret: v.string(),
    actorUserId: v.id("users"),
    calendarId: v.id("calendars"),
    date: v.string(),
    videoUrl: v.string(),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SaveDayResult> => {
    await requireServerSecret(args.serverSecret);
    const upserted: UpsertAsActorResult = await ctx.runMutation(internal.days.upsertDayAsActor, {
      actorUserId: args.actorUserId,
      calendarId: args.calendarId,
      date: args.date,
      videoUrl: args.videoUrl,
      message: args.message,
    });
    if (!upserted.ok) return upserted;
    if (!upserted.needsThumbnail) {
      const applicable = thumbnailSourceForVideo(upserted.videoUrl) !== null;
      return { ok: true, thumbnail: applicable ? "unchanged" : "not-applicable", hasUploadedImage: upserted.hasUploadedImage };
    }
    const thumbnail = await obtainThumbnail(ctx, {
      calendarId: args.calendarId,
      dayId: upserted.dayId,
      videoUrl: upserted.videoUrl,
      expectedThumbnailStorageId: upserted.observedThumbnailStorageId,
      actorUserId: args.actorUserId,
    });
    return { ok: true, thumbnail, hasUploadedImage: upserted.hasUploadedImage };
  },
});
