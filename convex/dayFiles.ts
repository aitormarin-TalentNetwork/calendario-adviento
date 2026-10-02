import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { isCalendarAdminActor } from "./calendarPeople";
import { requireServerSecret } from "./serverAuth";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  fetchProviderThumbnail,
  thumbnailSourceForVideo,
  type FetchImpl,
  type ImageType,
} from "./dayFileGuards";

/**
 * TAL-67 — ficheros de la casilla "Visto" (imagen subida por el Admin y
 * copia propia de la miniatura del vídeo). Diseño completo y razones en
 * docs/dias.md § "Imagen de la casilla Visto (TAL-67)". Resumen:
 *
 * - **Procedencia por `storageId`.** Todo fichero de TAL-67 se crea DENTRO
 *   de Convex (el `httpAction` de subida en `http.ts`, o la copia en
 *   `obtainThumbnail`) con esta secuencia: intención (`beginDayFileIntent`)
 *   → `ctx.storage.store` → `registerDayFile` (escribe el `storageId` en la
 *   intención) → enlace (`attachDayImage` / `setThumbnail`, que consume la
 *   intención). El limpiador solo borra `storageId` registrados aquí: nunca
 *   deduce la propiedad por contenido, hash o fecha.
 * - **Una intención solo desaparece cuando no queda fichero suyo por
 *   cerrar.** La borran solo tres sitios (consumo, limpiador, borrar el
 *   día/calendario si ya está registrada) y siempre borran ANTES su
 *   fichero. Borrar un día con una intención sin registrar la deja como
 *   tombstone (`dayGone`).
 * - **Expiradas sin `storageId`** (la operación murió antes de registrar):
 *   no se borran; pasan al registro duradero `dayFileUnresolvedWindows`,
 *   que la auditoría lista siempre y que se cierra a mano SIN borrar nada
 *   de `_storage` (`closeUnresolvedWindow`).
 * - **Drenaje**: el cron (`crons.ts`) arranca `startReconcile`; los lotes se
 *   re-programan con el cursor hasta `isDone`, bajo un lease con token; un
 *   watchdog toma el relevo en el acto si la cadena muere. Objetivo MEDIDO
 *   (no cota): ≤ 90 min desde la intención hasta el borrado.
 */

// --- Configuración (las variables de entorno solo se cambian en dev para los tests) ---

const DEFAULT_INTENT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_LEASE_MS = 2 * 60 * 1000;
const DEFAULT_BATCH = 100;
const MAX_BATCH = 100;
const WATCHDOG_SLACK_MS = 30 * 1000;

function envNumber(name: string, fallback: number, max = Number.MAX_SAFE_INTEGER): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

const intentTtlMs = () => envNumber("DAY_FILE_INTENT_TTL_MS", DEFAULT_INTENT_TTL_MS);
const leaseMs = () => envNumber("DAY_FILE_RECONCILE_LEASE_MS", DEFAULT_LEASE_MS);
const batchSize = () => envNumber("DAY_FILE_RECONCILE_BATCH", DEFAULT_BATCH, MAX_BATCH);

/** Runbook de rollback: con `DAY_IMAGES_FROZEN=1` no se crean ficheros nuevos de TAL-67. */
export function dayImagesFrozen(): boolean {
  return process.env.DAY_IMAGES_FROZEN === "1";
}

function testHelpersAllowed(): void {
  if (process.env.ALLOW_TEST_HELPERS !== "1") throw new Error("Solo para tests en dev (ALLOW_TEST_HELPERS=1).");
}

/**
 * Ganchos de fallo y pausa SOLO para los tests de dev
 * (`DAY_FILES_FAULT=<punto>`, `DAY_FILES_PAUSE_AT=<punto>:<ms>`). En
 * producción esas variables no existen y esto no hace nada.
 */
export async function faultPoint(point: "before-store" | "after-store" | "after-register"): Promise<void> {
  const pause = process.env.DAY_FILES_PAUSE_AT;
  if (pause) {
    const [name, ms] = pause.split(":");
    if (name === point) await new Promise((resolve) => setTimeout(resolve, Number(ms) || 0));
  }
  if (process.env.DAY_FILES_FAULT === point) throw new Error(`Fallo inyectado (dev): ${point}`);
}

// --- Utilidades de storage ---

async function storageExists(ctx: QueryCtx | MutationCtx, storageId: Id<"_storage">): Promise<boolean> {
  return (await ctx.db.system.get(storageId)) !== null;
}

async function deleteStorageIfExists(ctx: MutationCtx, storageId: Id<"_storage">): Promise<void> {
  if (await storageExists(ctx, storageId)) await ctx.storage.delete(storageId);
}

export async function isReferencedByDays(ctx: QueryCtx | MutationCtx, storageId: Id<"_storage">): Promise<boolean> {
  const asImage = await ctx.db
    .query("days")
    .withIndex("by_image_storage", (q) => q.eq("imageStorageId", storageId))
    .first();
  if (asImage) return true;
  const asThumbnail = await ctx.db
    .query("days")
    .withIndex("by_thumbnail_storage", (q) => q.eq("thumbnailStorageId", storageId))
    .first();
  return asThumbnail !== null;
}

/**
 * Al borrar un día (o cada día de un calendario): borra sus ficheros
 * enlazados y sus intenciones REGISTRADAS (primero el fichero, después la
 * fila). Las intenciones SIN registrar se quedan como tombstone: puede haber
 * una operación a punto de hacer `store`, y esta evidencia no puede
 * perderse (la cierra esa operación o, al expirar, el limpiador).
 */
export async function deleteDayFilesForDay(ctx: MutationCtx, day: Doc<"days">): Promise<void> {
  if (day.imageStorageId) await deleteStorageIfExists(ctx, day.imageStorageId);
  if (day.thumbnailStorageId) await deleteStorageIfExists(ctx, day.thumbnailStorageId);
  const intents = await ctx.db
    .query("dayFileIntents")
    .withIndex("by_day", (q) => q.eq("dayId", day._id))
    .collect();
  for (const intent of intents) {
    if (intent.storageId) {
      await deleteStorageIfExists(ctx, intent.storageId);
      await ctx.db.delete(intent._id);
    } else if (!intent.dayGone) {
      await ctx.db.patch(intent._id, { dayGone: true });
    }
  }
}

// --- Ciclo de vida de una intención ---

export type BeginIntentResult =
  | { ok: true; intentId: Id<"dayFileIntents">; dayId: Id<"days"> }
  | { ok: false; error: "not-authorized" | "no-day" | "frozen" };

export const beginDayFileIntent = internalMutation({
  args: {
    kind: v.union(v.literal("upload"), v.literal("thumbnail")),
    calendarId: v.id("calendars"),
    // Subida: el día se busca por fecha. Copia: ya se conoce el `dayId`.
    date: v.optional(v.string()),
    dayId: v.optional(v.id("days")),
    // Obligatorio en la subida (se relee su rol aquí). La copia lo trae ya
    // autorizado por `upsertDayAsActor`, o no lo trae (migración).
    actorUserId: v.optional(v.id("users")),
    requireActor: v.boolean(),
  },
  handler: async (ctx, args): Promise<BeginIntentResult> => {
    if (args.requireActor) {
      if (!args.actorUserId || !(await isCalendarAdminActor(ctx, args.actorUserId, args.calendarId))) {
        return { ok: false, error: "not-authorized" };
      }
    }
    if (dayImagesFrozen()) return { ok: false, error: "frozen" };
    let day: Doc<"days"> | null = null;
    if (args.dayId) {
      day = await ctx.db.get(args.dayId);
    } else if (args.date) {
      day = await ctx.db
        .query("days")
        .withIndex("by_calendar_and_date", (q) => q.eq("calendarId", args.calendarId).eq("date", args.date!))
        .unique();
    }
    if (!day || day.calendarId !== args.calendarId) return { ok: false, error: "no-day" };
    const intentId = await ctx.db.insert("dayFileIntents", {
      owner: "TAL-67",
      kind: args.kind,
      calendarId: args.calendarId,
      dayId: day._id,
      actorUserId: args.actorUserId,
      expiresAt: Date.now() + intentTtlMs(),
    });
    return { ok: true, intentId, dayId: day._id };
  },
});

/** Escribe el `storageId` en la intención. No depende del día (puede estar borrado: tombstone). */
export const registerDayFile = internalMutation({
  args: { intentId: v.id("dayFileIntents"), storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const intent = await ctx.db.get(args.intentId);
    if (!intent) return { ok: false };
    await ctx.db.patch(args.intentId, { storageId: args.storageId });
    return { ok: true };
  },
});

export type AttachResult = { ok: true } | { ok: false; error: "too-large" | "bad-type" | "no-day" | "no-intent" };

/**
 * Enlaza la imagen subida al día y consume la intención. Vuelve a comprobar
 * tamaño y tipo con los metadatos REALES del fichero almacenado (defensa en
 * profundidad: el `httpAction` ya lo comprobó por bytes). Si no cuadra, o el
 * día ya no existe, borra el fichero y la intención.
 */
export const attachDayImage = internalMutation({
  args: { intentId: v.id("dayFileIntents"), storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<AttachResult> => {
    const intent = await ctx.db.get(args.intentId);
    if (!intent || intent.storageId !== args.storageId) {
      // Sin intención no hay prueba de procedencia: el `httpAction` borra el
      // fichero que tiene en la mano (es suyo, lo acaba de crear).
      return { ok: false, error: "no-intent" };
    }
    const meta = await ctx.db.system.get(args.storageId);
    const day = await ctx.db.get(intent.dayId);
    let error: Exclude<AttachResult, { ok: true }>["error"] | null = null;
    if (!day) error = "no-day";
    else if (!meta || meta.size > MAX_UPLOAD_BYTES) error = "too-large";
    else if (!meta.contentType || !ALLOWED_IMAGE_TYPES.includes(meta.contentType as ImageType)) error = "bad-type";
    if (error || !day) {
      await deleteStorageIfExists(ctx, args.storageId);
      await ctx.db.delete(intent._id);
      return { ok: false, error: error ?? "no-day" };
    }
    const previous = day.imageStorageId;
    await ctx.db.patch(day._id, { imageStorageId: args.storageId });
    if (previous && previous !== args.storageId) await deleteStorageIfExists(ctx, previous);
    await ctx.db.delete(intent._id);
    return { ok: true };
  },
});

export type SetThumbnailResult = "stored" | "lost" | "failed-recorded" | "failed-lost";

/**
 * Compare-and-set de la copia de la miniatura con precondición de versión:
 * solo enlaza si el día sigue existiendo, su `videoUrl` sigue siendo
 * `forVideoUrl` Y su `thumbnailStorageId` sigue siendo el observado al
 * empezar. El ganador borra la copia reemplazada; el perdedor borra su
 * candidato. N guardados simultáneos de la misma URL → un solo fichero.
 * Con `candidateStorageId: null` (descarga fallida) solo marca el intento si
 * nadie enlazó nada entretanto.
 */
export const setThumbnail = internalMutation({
  args: {
    intentId: v.optional(v.id("dayFileIntents")),
    dayId: v.id("days"),
    forVideoUrl: v.string(),
    expectedThumbnailStorageId: v.optional(v.id("_storage")),
    candidateStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args): Promise<SetThumbnailResult> => {
    const intent = args.intentId ? await ctx.db.get(args.intentId) : null;
    const day = await ctx.db.get(args.dayId);
    const wins =
      day !== null &&
      day.videoUrl === args.forVideoUrl &&
      day.thumbnailStorageId === args.expectedThumbnailStorageId;

    if (!args.candidateStorageId) {
      if (intent) await ctx.db.delete(intent._id);
      if (!wins || !day) return "failed-lost";
      await ctx.db.patch(day._id, { thumbnailVideoUrl: args.forVideoUrl });
      return "failed-recorded";
    }

    if (!wins || !day) {
      await deleteStorageIfExists(ctx, args.candidateStorageId);
      if (intent) await ctx.db.delete(intent._id);
      return "lost";
    }
    const replaced = day.thumbnailStorageId;
    await ctx.db.patch(day._id, { thumbnailStorageId: args.candidateStorageId, thumbnailVideoUrl: args.forVideoUrl });
    if (replaced && replaced !== args.candidateStorageId) await deleteStorageIfExists(ctx, replaced);
    if (intent) await ctx.db.delete(intent._id);
    return "stored";
  },
});

export type ThumbnailOutcome = "stored" | "failed" | "lost" | "not-applicable" | "frozen";

/**
 * Obtiene la copia propia de la miniatura de un día (al guardar o en la
 * migración): descarga con guardas → intención → store → registro → CAS.
 * `fetchImpl` es inyectable solo para no depender de la red en tests.
 */
export async function obtainThumbnail(
  ctx: ActionCtx,
  args: {
    calendarId: Id<"calendars">;
    dayId: Id<"days">;
    videoUrl: string;
    expectedThumbnailStorageId: Id<"_storage"> | undefined;
    actorUserId?: Id<"users">;
  },
  fetchImpl: FetchImpl = fetch
): Promise<ThumbnailOutcome> {
  const source = thumbnailSourceForVideo(args.videoUrl);
  if (!source) return "not-applicable";
  if (dayImagesFrozen()) return "frozen";

  const download = await fetchProviderThumbnail(fetchImpl, source);
  if (!download.ok) {
    const recorded: SetThumbnailResult = await ctx.runMutation(internal.dayFiles.setThumbnail, {
      dayId: args.dayId,
      forVideoUrl: args.videoUrl,
      expectedThumbnailStorageId: args.expectedThumbnailStorageId,
    });
    return recorded === "failed-recorded" ? "failed" : "lost";
  }

  const begun: BeginIntentResult = await ctx.runMutation(internal.dayFiles.beginDayFileIntent, {
    kind: "thumbnail",
    calendarId: args.calendarId,
    dayId: args.dayId,
    actorUserId: args.actorUserId,
    requireActor: false,
  });
  if (!begun.ok) return begun.error === "frozen" ? "frozen" : "lost";

  await faultPoint("before-store");
  const storageId = await ctx.storage.store(new Blob([download.bytes], { type: download.contentType }));
  await faultPoint("after-store");
  const registered: { ok: boolean } = await ctx.runMutation(internal.dayFiles.registerDayFile, {
    intentId: begun.intentId,
    storageId,
  });
  if (!registered.ok) {
    // Solo por un error de programación (ver docs): el fichero es nuestro,
    // lo acabamos de crear, y no queda registrado → se borra en el acto.
    await ctx.storage.delete(storageId);
    console.error("TAL-67: registerDayFile no encontró la intención", begun.intentId);
    return "lost";
  }
  await faultPoint("after-register");
  const result: SetThumbnailResult = await ctx.runMutation(internal.dayFiles.setThumbnail, {
    intentId: begun.intentId,
    dayId: args.dayId,
    forVideoUrl: args.videoUrl,
    expectedThumbnailStorageId: args.expectedThumbnailStorageId,
    candidateStorageId: storageId,
  });
  return result === "stored" ? "stored" : "lost";
}

// --- Quitar la imagen subida (frontera pública) ---

export const removeDayImagePublic = mutation({
  args: { serverSecret: v.string(), actorUserId: v.id("users"), calendarId: v.id("calendars"), date: v.string() },
  handler: async (ctx, args): Promise<{ ok: true } | { ok: false; error: "not-authorized" | "no-day" }> => {
    await requireServerSecret(args.serverSecret);
    if (!(await isCalendarAdminActor(ctx, args.actorUserId, args.calendarId))) return { ok: false, error: "not-authorized" };
    const day = await ctx.db
      .query("days")
      .withIndex("by_calendar_and_date", (q) => q.eq("calendarId", args.calendarId).eq("date", args.date))
      .unique();
    if (!day) return { ok: false, error: "no-day" };
    if (day.imageStorageId) {
      const previous = day.imageStorageId;
      await ctx.db.patch(day._id, { imageStorageId: undefined });
      await deleteStorageIfExists(ctx, previous);
    }
    return { ok: true };
  },
});

// --- Limpiador: drenaje continuo con lease y watchdog ---

async function currentLease(ctx: MutationCtx): Promise<Doc<"dayFileReconcileLease"> | null> {
  return await ctx.db.query("dayFileReconcileLease").first();
}

/**
 * Programa el siguiente lote (y su watchdog). Sin cursor a propósito: cada
 * lote BORRA todas las filas que procesa, así que el siguiente vuelve a
 * tomar las primeras B expiradas antes de `cutoff` (fijo durante todo el
 * drenaje; lo que expire después lo recoge el siguiente drenaje). Un cursor
 * de paginación no vale aquí: la consulta cambiaría entre lotes.
 */
async function scheduleBatch(ctx: MutationCtx, token: string, cutoff: number, first: boolean): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.dayFiles.reconcileBatch, { token, cutoff, first });
  await ctx.scheduler.runAfter(leaseMs() + WATCHDOG_SLACK_MS, internal.dayFiles.reconcileWatchdog, { token });
}

/** Lo dispara el cron cada 15 min. Si hay un drenaje vivo, no hace nada. */
export const startReconcile = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ started: boolean; token?: string }> => {
    const now = Date.now();
    const lease = await currentLease(ctx);
    if (lease && lease.expiresAt > now) return { started: false };
    const token = crypto.randomUUID();
    if (lease) {
      await ctx.db.patch(lease._id, { token, expiresAt: now + leaseMs(), takeovers: (lease.takeovers ?? 0) + 1 });
    } else {
      await ctx.db.insert("dayFileReconcileLease", { token, expiresAt: now + leaseMs(), takeovers: 0 });
    }
    await scheduleBatch(ctx, token, now, true);
    return { started: true, token };
  },
});

/**
 * Si al despertar el lease sigue con su token y ha caducado (la cadena murió
 * sin cerrar el drenaje), toma el relevo EN EL ACTO con otro token, sin
 * esperar al siguiente cron.
 */
export const reconcileWatchdog = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<"idle" | "takeover"> => {
    const lease = await currentLease(ctx);
    if (!lease || lease.token !== args.token || lease.expiresAt > Date.now()) return "idle";
    const token = crypto.randomUUID();
    await ctx.db.patch(lease._id, { token, expiresAt: Date.now() + leaseMs(), takeovers: (lease.takeovers ?? 0) + 1 });
    await scheduleBatch(ctx, token, Date.now(), true);
    return "takeover";
  },
});

export const reconcileBatch = internalMutation({
  args: { token: v.string(), cutoff: v.number(), first: v.boolean() },
  handler: async (ctx, args): Promise<{ stopped?: "stale-token"; processed?: number; done?: boolean }> => {
    const now = Date.now();
    const lease = await currentLease(ctx);
    // Lo primero en cada lote: una continuación obsoleta (lease perdido o
    // relevado por el watchdog) para sin tocar nada.
    if (!lease || lease.token !== args.token || lease.expiresAt <= now) return { stopped: "stale-token" };

    const size = batchSize();
    const batch = await ctx.db
      .query("dayFileIntents")
      .withIndex("by_expires", (q) => q.lt("expiresAt", args.cutoff))
      .take(size);

    for (const intent of batch) {
      if (intent.storageId) {
        // Registrado por TAL-67: primero el fichero (si ningún día lo usa), después la fila.
        if (!(await isReferencedByDays(ctx, intent.storageId))) await deleteStorageIfExists(ctx, intent.storageId);
        await ctx.db.delete(intent._id);
      } else {
        // Sin registrar: nunca se borra a secas. Pasa al registro duradero.
        const dayGone = intent.dayGone ?? (await ctx.db.get(intent.dayId)) === null;
        await ctx.db.insert("dayFileUnresolvedWindows", {
          status: "unresolved-window",
          kind: intent.kind,
          calendarId: intent.calendarId,
          dayId: intent.dayId,
          dayGone,
          actorUserId: intent.actorUserId,
          windowStart: intent._creationTime,
          windowEnd: intent.expiresAt,
          intentId: intent._id,
        });
        await ctx.db.delete(intent._id);
      }
    }

    // Todas las filas del lote se han borrado: si salió incompleto, no quedan más.
    if (batch.length < size) {
      await ctx.db.delete(lease._id);
      return { processed: batch.length, done: true };
    }
    await ctx.db.patch(lease._id, { expiresAt: Date.now() + leaseMs() });
    // Gancho de dev: simula que la cadena muere tras el primer lote (solo en
    // el primer drenaje; tras el relevo del watchdog ya no aplica).
    if (process.env.DAY_FILES_FAULT === "drain-after-first-batch" && args.first && (lease.takeovers ?? 0) === 0) {
      return { processed: batch.length, done: false };
    }
    await scheduleBatch(ctx, args.token, args.cutoff, false);
    return { processed: batch.length, done: false };
  },
});

// --- Auditoría ---

/**
 * Estado del limpiador y del registro duradero. Lista SIEMPRE las ventanas
 * sin resolver y, como ayuda (nunca como decisión), los ficheros de
 * `_storage` creados dentro de cada ventana que no referencia ningún día ni
 * registra ninguna intención. `oldestPendingAgeMs` es la antigüedad del
 * pendiente registrado más viejo (objetivo medido: ≤ 90 min).
 */
export const auditDayFiles = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const intents = await ctx.db.query("dayFileIntents").collect();
    const expired = intents.filter((i) => i.expiresAt < now);
    const expiredRegistered = expired.filter((i) => i.storageId);
    const registered = intents.filter((i) => i.storageId);
    const unresolved = await ctx.db
      .query("dayFileUnresolvedWindows")
      .withIndex("by_status", (q) => q.eq("status", "unresolved-window"))
      .collect();
    const registeredIds = new Set(registered.map((i) => i.storageId as string));

    const unresolvedReport = [];
    for (const row of unresolved) {
      const inWindow = await ctx.db.system
        .query("_storage")
        .withIndex("by_creation_time", (q) => q.gte("_creationTime", row.windowStart).lte("_creationTime", row.windowEnd))
        .collect();
      const candidates = [];
      for (const file of inWindow) {
        if (registeredIds.has(file._id)) continue;
        if (await isReferencedByDays(ctx, file._id)) continue;
        candidates.push({ storageId: file._id, size: file.size, contentType: file.contentType, createdAt: file._creationTime });
      }
      unresolvedReport.push({ ...row, filesInWindowForReview: candidates });
    }

    const oldestPending = registered.reduce<number | null>(
      (oldest, i) => (oldest === null || i._creationTime < oldest ? i._creationTime : oldest),
      null
    );
    const oldestUnresolved = unresolved.reduce<number | null>(
      (oldest, r) => (oldest === null || r._creationTime < oldest ? r._creationTime : oldest),
      null
    );

    // Referencias rotas: un día que apunta a un fichero que ya no existe.
    const days = await ctx.db.query("days").collect();
    let danglingDayReferences = 0;
    for (const day of days) {
      for (const id of [day.imageStorageId, day.thumbnailStorageId]) {
        if (id && !(await storageExists(ctx, id))) danglingDayReferences += 1;
      }
    }

    return {
      liveIntents: intents.length - expired.length,
      expiredRegistered: expiredRegistered.length,
      expiredUnregistered: expired.length - expiredRegistered.length,
      registeredPending: registered.length,
      oldestPendingAgeMs: oldestPending === null ? null : now - oldestPending,
      unresolvedWindows: unresolvedReport,
      oldestUnresolvedWindowAgeMs: oldestUnresolved === null ? null : now - oldestUnresolved,
      danglingDayReferences,
    };
  },
});

/**
 * Cierre manual de una ventana sin resolver: SOLO cierra el registro
 * (`resolved` con quién, cuándo y nota). No borra NADA de `_storage`: estar
 * en la ventana, sin referencias en `days` y sin registrar no prueba que un
 * fichero sea de TAL-67. Si una persona identifica un huérfano concreto, lo
 * borra a mano desde el dashboard de Convex (docs/dias.md, runbook).
 */
export const closeUnresolvedWindow = internalMutation({
  args: { id: v.id("dayFileUnresolvedWindows"), resolvedBy: v.string(), resolution: v.string() },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const row = await ctx.db.get(args.id);
    if (!row || row.status !== "unresolved-window") return { ok: false };
    await ctx.db.patch(args.id, {
      status: "resolved",
      resolvedAt: Date.now(),
      resolvedBy: args.resolvedBy,
      resolution: args.resolution,
    });
    return { ok: true };
  },
});

// --- Rollback (runbook de docs/dias.md) ---

export const stripDayImagesForRollback = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("days")
      .paginate({ cursor: args.cursor ?? null, numItems: Math.min(args.batchSize ?? 100, MAX_BATCH) });
    let stripped = 0;
    for (const day of page.page) {
      if (day.imageStorageId === undefined && day.thumbnailStorageId === undefined && day.thumbnailVideoUrl === undefined) continue;
      if (day.imageStorageId) await deleteStorageIfExists(ctx, day.imageStorageId);
      if (day.thumbnailStorageId) await deleteStorageIfExists(ctx, day.thumbnailStorageId);
      await ctx.db.patch(day._id, { imageStorageId: undefined, thumbnailStorageId: undefined, thumbnailVideoUrl: undefined });
      stripped += 1;
    }
    return { processed: page.page.length, stripped, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

export const countDaysWithImageFields = internalQuery({
  args: { cursor: v.optional(v.union(v.string(), v.null())), batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("days").paginate({ cursor: args.cursor ?? null, numItems: args.batchSize ?? 1000 });
    const withFields = page.page.filter(
      (d) => d.imageStorageId !== undefined || d.thumbnailStorageId !== undefined || d.thumbnailVideoUrl !== undefined
    ).length;
    return { processed: page.page.length, withFields, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

// --- Ayudas SOLO para tests en dev (ALLOW_TEST_HELPERS=1; nunca en producción) ---

/** Fichero "ajeno" (sin intención de TAL-67), para los controles del limpiador y del cierre. */
export const storeUntrackedFileForTests = internalAction({
  args: { base64: v.string(), contentType: v.string() },
  handler: async (ctx, args): Promise<Id<"_storage">> => {
    testHelpersAllowed();
    const bytes = Uint8Array.from(atob(args.base64), (c) => c.charCodeAt(0));
    return await ctx.storage.store(new Blob([bytes], { type: args.contentType }));
  },
});

/** Referencia un fichero desde OTRA tabla (no `days`): el log de la migración. */
export const referenceFromOtherTableForTests = internalMutation({
  args: { storageId: v.id("_storage"), dayId: v.id("days") },
  handler: async (ctx, args) => {
    testHelpersAllowed();
    return await ctx.db.insert("dayThumbnailMigrationLog", {
      migrationId: "test-foreign-reference",
      dayId: args.dayId,
      videoUrl: "https://example.com/test",
      result: "skipped",
      storageId: args.storageId,
      reason: "control de tests: referencia desde otra tabla",
    });
  },
});

export const storageInfoForTests = internalQuery({
  args: { storageIds: v.array(v.id("_storage")) },
  handler: async (ctx, args) => {
    testHelpersAllowed();
    const total = (await ctx.db.system.query("_storage").collect()).length;
    const exists: Record<string, boolean> = {};
    for (const id of args.storageIds) exists[id] = await storageExists(ctx, id);
    return { total, exists };
  },
});

/** Siembra N intenciones ya expiradas (registradas con fichero, o sin registrar) para el drenaje. */
export const seedExpiredIntentsForTests = internalAction({
  args: {
    calendarId: v.id("calendars"),
    dayId: v.id("days"),
    count: v.number(),
    registered: v.boolean(),
    ageMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"_storage">[]> => {
    testHelpersAllowed();
    const storageIds: Id<"_storage">[] = [];
    for (let i = 0; i < args.count; i++) {
      const storageId = args.registered
        ? await ctx.storage.store(new Blob([new Uint8Array([0xff, 0xd8, 0xff, i % 256, (i >> 8) % 256])], { type: "image/jpeg" }))
        : undefined;
      if (storageId) storageIds.push(storageId);
      await ctx.runMutation(internal.dayFiles.insertIntentForTests, {
        calendarId: args.calendarId,
        dayId: args.dayId,
        storageId,
        expiresAt: Date.now() - (args.ageMs ?? 1000),
      });
    }
    return storageIds;
  },
});

export const insertIntentForTests = internalMutation({
  args: {
    calendarId: v.id("calendars"),
    dayId: v.id("days"),
    storageId: v.optional(v.id("_storage")),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    testHelpersAllowed();
    return await ctx.db.insert("dayFileIntents", {
      owner: "TAL-67",
      kind: "thumbnail",
      calendarId: args.calendarId,
      dayId: args.dayId,
      storageId: args.storageId,
      expiresAt: args.expiresAt,
    });
  },
});

export const leaseForTests = internalQuery({
  args: {},
  handler: async (ctx) => {
    testHelpersAllowed();
    return await ctx.db.query("dayFileReconcileLease").first();
  },
});

/** Fuerza el lease caducado (simula una cadena muerta) para probar el relevo y la continuación obsoleta. */
export const expireLeaseForTests = internalMutation({
  args: {},
  handler: async (ctx) => {
    testHelpersAllowed();
    const lease = await ctx.db.query("dayFileReconcileLease").first();
    if (lease) await ctx.db.patch(lease._id, { expiresAt: Date.now() - 1 });
    return lease?.token ?? null;
  },
});
