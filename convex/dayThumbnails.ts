import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { faultPoint, obtainThumbnailLinked } from "./dayFiles";
import { thumbnailSourceForVideo } from "./dayFileGuards";

/**
 * TAL-67 — migración ÚNICA en producción: rellena la copia propia de la
 * miniatura de los días existentes (la ejecutan la Directora y el CEO; runbook
 * en docs/dias.md § "Migración de miniaturas (TAL-67)"). Mismo rigor que
 * TAL-60 (`coverIconMigration.ts`):
 * - por lotes (`paginate`), con las descargas en serie y pausa entre lotes
 *   para no castigar a los proveedores;
 * - log por día (`dayThumbnailMigrationLog`) e idempotente: reejecutar con el
 *   mismo `migrationId` continúa donde se quedó; otro `migrationId` reintenta
 *   los `failed`;
 * - cada copia pasa por la MISMA secuencia que un guardado normal
 *   (`obtainThumbnail`: intención → store → registro → compare-and-set), así
 *   que coincidir con un guardado del Admin nunca deja dos ficheros, y si la
 *   migración muere a mitad, el limpiador recoge lo registrado;
 * - auditoría acotada y reversión que solo deshace lo que hizo ESTA
 *   migración y solo si el día sigue apuntando a esa misma copia.
 */

const MAX_BATCH = 25;

type DaysPage = {
  days: {
    _id: Id<"days">;
    calendarId: Id<"calendars">;
    videoUrl: string;
    thumbnailStorageId: Id<"_storage"> | undefined;
    thumbnailVideoUrl: string | undefined;
  }[];
  isDone: boolean;
  continueCursor: string;
};

type BackfillResult = {
  processed: number;
  stored: number;
  failed: number;
  skipped: number;
  alreadyLogged: number;
  isDone: boolean;
  continueCursor: string | null;
};
const PAUSE_BETWEEN_BATCHES_MS = 1000;

export const daysPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), numItems: v.number() },
  handler: async (ctx, args): Promise<DaysPage> => {
    const page = await ctx.db.query("days").paginate({ cursor: args.cursor, numItems: args.numItems });
    return {
      days: page.page.map((d) => ({
        _id: d._id,
        calendarId: d.calendarId,
        videoUrl: d.videoUrl,
        thumbnailStorageId: d.thumbnailStorageId,
        thumbnailVideoUrl: d.thumbnailVideoUrl,
      })),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const logEntry = internalQuery({
  args: { migrationId: v.string(), dayId: v.id("days") },
  handler: async (ctx, args) =>
    await ctx.db
      .query("dayThumbnailMigrationLog")
      .withIndex("by_migration_and_day", (q) => q.eq("migrationId", args.migrationId).eq("dayId", args.dayId))
      .first(),
});

export const writeLog = internalMutation({
  args: {
    migrationId: v.string(),
    dayId: v.id("days"),
    videoUrl: v.string(),
    result: v.union(v.literal("stored"), v.literal("failed"), v.literal("skipped")),
    reason: v.optional(v.string()),
    // El `storageId` EXACTO que enlazó esta migración al ganar el CAS
    // (`obtainThumbnailLinked`). Nunca se relee del día: entre el enlace y
    // este log un Admin puede haber enlazado otra copia (NO-GO M1, loop 1).
    storageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("dayThumbnailMigrationLog", args);
  },
});

export const runThumbnailBackfill = internalAction({
  args: {
    migrationId: v.string(),
    batchSize: v.optional(v.number()),
    maxBatches: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args): Promise<BackfillResult> => {
    const numItems = Math.min(Math.max(args.batchSize ?? MAX_BATCH, 1), MAX_BATCH);
    let cursor = args.cursor ?? null;
    const totals = { processed: 0, stored: 0, failed: 0, skipped: 0, alreadyLogged: 0 };
    for (let batch = 0; args.maxBatches === undefined || batch < args.maxBatches; batch++) {
      const page: DaysPage = await ctx.runQuery(internal.dayThumbnails.daysPage, { cursor, numItems });
      for (const day of page.days) {
        totals.processed += 1;
        if (await ctx.runQuery(internal.dayThumbnails.logEntry, { migrationId: args.migrationId, dayId: day._id })) {
          totals.alreadyLogged += 1;
          continue;
        }
        const log = (result: "stored" | "failed" | "skipped", reason?: string, storageId?: Id<"_storage">) =>
          ctx.runMutation(internal.dayThumbnails.writeLog, {
            migrationId: args.migrationId,
            dayId: day._id,
            videoUrl: day.videoUrl,
            result,
            reason,
            storageId,
          });
        if (!thumbnailSourceForVideo(day.videoUrl)) {
          totals.skipped += 1;
          await log("skipped", "no-provider");
          continue;
        }
        if (day.thumbnailStorageId && day.thumbnailVideoUrl === day.videoUrl) {
          totals.skipped += 1;
          await log("skipped", "has-copy");
          continue;
        }
        const { outcome, linkedStorageId } = await obtainThumbnailLinked(ctx, {
          calendarId: day.calendarId,
          dayId: day._id,
          videoUrl: day.videoUrl,
          expectedThumbnailStorageId: day.thumbnailStorageId,
        });
        // Gancho de dev para el test de frontera (Admin enlaza otra copia entre el enlace y el log).
        await faultPoint("migration-before-log");
        if (outcome === "stored") {
          totals.stored += 1;
          await log("stored", undefined, linkedStorageId);
        } else if (outcome === "lost") {
          // Otro guardado enlazó entretanto (o borraron el día): no es fallo.
          totals.skipped += 1;
          await log("skipped", "superseded");
        } else {
          totals.failed += 1;
          await log("failed", outcome);
        }
      }
      cursor = page.continueCursor;
      if (page.isDone) return { ...totals, isDone: true, continueCursor: cursor };
      await new Promise((resolve) => setTimeout(resolve, PAUSE_BETWEEN_BATCHES_MS));
    }
    return { ...totals, isDone: false, continueCursor: cursor };
  },
});

/** Auditoría acotada (una página): días por estado de la copia. */
export const auditThumbnails = internalQuery({
  args: { cursor: v.optional(v.union(v.string(), v.null())), numItems: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("days").paginate({ cursor: args.cursor ?? null, numItems: Math.min(args.numItems ?? 500, 1000) });
    const counts = { withCopy: 0, failedForCurrentUrl: 0, pending: 0, noProvider: 0 };
    const pendingSamples: Id<"days">[] = [];
    for (const day of page.page) {
      if (!thumbnailSourceForVideo(day.videoUrl)) counts.noProvider += 1;
      else if (day.thumbnailStorageId && day.thumbnailVideoUrl === day.videoUrl) counts.withCopy += 1;
      else if (!day.thumbnailStorageId && day.thumbnailVideoUrl === day.videoUrl) counts.failedForCurrentUrl += 1;
      else {
        counts.pending += 1;
        if (pendingSamples.length < 10) pendingSamples.push(day._id);
      }
    }
    return { ...counts, pendingSamples, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

export const listMigrationLogPage = internalQuery({
  args: { migrationId: v.string(), cursor: v.optional(v.union(v.string(), v.null())), numItems: v.optional(v.number()) },
  handler: async (ctx, args) =>
    await ctx.db
      .query("dayThumbnailMigrationLog")
      .withIndex("by_migration", (q) => q.eq("migrationId", args.migrationId))
      .paginate({ cursor: args.cursor ?? null, numItems: Math.min(args.numItems ?? 100, 500) }),
});

/**
 * Reversión de una migración, por lotes: borra las copias que creó ESA
 * migración solo si el día sigue apuntando a esa misma copia (no pisa una
 * copia posterior de un guardado nuevo).
 */
export const revertThumbnailBackfill = internalMutation({
  args: { migrationId: v.string(), cursor: v.optional(v.union(v.string(), v.null())), numItems: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("dayThumbnailMigrationLog")
      .withIndex("by_migration", (q) => q.eq("migrationId", args.migrationId))
      .paginate({ cursor: args.cursor ?? null, numItems: Math.min(args.numItems ?? 100, 100) });
    let reverted = 0;
    for (const entry of page.page) {
      if (entry.result !== "stored" || !entry.storageId) continue;
      const day = await ctx.db.get(entry.dayId);
      if (!day || day.thumbnailStorageId !== entry.storageId) continue;
      await ctx.db.patch(day._id, { thumbnailStorageId: undefined, thumbnailVideoUrl: undefined });
      if (await ctx.db.system.get(entry.storageId)) await ctx.storage.delete(entry.storageId);
      reverted += 1;
    }
    return { processed: page.page.length, reverted, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});
