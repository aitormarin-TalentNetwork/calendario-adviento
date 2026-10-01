// TAL-60 — migración de `calendars.coverIcon` (emoji del catálogo antiguo →
// nombre Lucide; "gift" si no hay equivalente). Runbook completo de
// producción (fases, backup, rollback): docs/iconos.md. Todas son funciones
// INTERNAS: solo se invocan por la CLI de administrador
// (`npx convex run [--prod] coverIconMigration:<función> '<args>'`), nunca
// desde la app.
//
// Garantías:
// - Por lotes acotados (`paginate`), cada lote en su propia transacción.
// - Log duradero (`coverIconMigrationLog`) escrito en la MISMA transacción
//   que cada `patch`: nunca hay un cambio sin su `from → to` guardado.
// - Resultados acotados: cada lote devuelve solo contadores; las actions de
//   conveniencia solo totales; la auditoría como mucho 20 ids de muestra.
// - Idempotente y reanudable: relanzar desde el principio salta lo ya
//   migrado (ya son nombres válidos) y no lo vuelve a registrar.
// - Restauración desde el log que nunca pisa una edición posterior del
//   Admin (`skippedEdited`).
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { isCoverIconName, normalizeCoverIcon } from "./coverIconCatalog";

const MAX_BATCH_SIZE = 100;
const MAX_AUDIT_PAGE_SIZE = 200;
const MAX_AUDIT_SAMPLES_PER_PAGE = 10;
const MAX_AUDIT_SAMPLES_TOTAL = 20;

function clampBatchSize(requested: number | undefined, max: number): number {
  if (requested === undefined) return max;
  if (!Number.isInteger(requested) || requested < 1) throw new Error("batchSize debe ser un entero ≥ 1.");
  return Math.min(requested, max);
}

type BatchResult = { scanned: number; migrated: number; continueCursor: string; isDone: boolean };

/**
 * Un lote: para cada calendario con `coverIcon` definido que NO es un nombre
 * del catálogo, registra `{ from, to }` y hace el `patch` en esta misma
 * transacción. No toca `updatedAt` (limpieza de datos, no una edición del
 * Admin) ni los calendarios sin `coverIcon` (se pintan con el respaldo
 * `tree-pine`, no están rotos).
 *
 * Si ya existe una fila de log para (migrationId, calendario) y el
 * calendario vuelve a tener un valor inválido, es que se restauró: se
 * rechaza reutilizar ese `migrationId` (hay que lanzar la migración con uno
 * nuevo), para que el log de cada migración sea inequívoco.
 */
export const migrateCoverIconsBatch = internalMutation({
  args: { migrationId: v.string(), cursor: v.optional(v.union(v.string(), v.null())), batchSize: v.optional(v.number()) },
  handler: async (ctx, args): Promise<BatchResult> => {
    if (args.migrationId.trim() === "") throw new Error("migrationId obligatorio.");
    const numItems = clampBatchSize(args.batchSize, MAX_BATCH_SIZE);
    const page = await ctx.db.query("calendars").paginate({ cursor: args.cursor ?? null, numItems });

    let migrated = 0;
    for (const calendar of page.page) {
      const from = calendar.coverIcon;
      if (from === undefined || isCoverIconName(from)) continue;

      const existing = await ctx.db
        .query("coverIconMigrationLog")
        .withIndex("by_migration_and_calendar", (q) => q.eq("migrationId", args.migrationId).eq("calendarId", calendar._id))
        .first();
      if (existing) {
        throw new Error(
          `El migrationId "${args.migrationId}" ya se usó para el calendario ${calendar._id} (restaurado después). Usa un migrationId nuevo.`
        );
      }

      const to = normalizeCoverIcon(from);
      await ctx.db.insert("coverIconMigrationLog", {
        migrationId: args.migrationId,
        calendarId: calendar._id,
        from,
        to,
        restored: false,
      });
      await ctx.db.patch(calendar._id, { coverIcon: to });
      migrated++;
    }

    return { scanned: page.page.length, migrated, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

/** Conveniencia: itera los lotes hasta el final. Devuelve solo totales. Si falla a mitad, lo escrito ya está en el log y basta con relanzarla. */
export const runCoverIconMigration = internalAction({
  args: { migrationId: v.string(), batchSize: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ batches: number; scanned: number; migrated: number }> => {
    let cursor: string | null = null;
    let batches = 0;
    let scanned = 0;
    let migrated = 0;
    for (;;) {
      const result: BatchResult = await ctx.runMutation(internal.coverIconMigration.migrateCoverIconsBatch, {
        migrationId: args.migrationId,
        cursor,
        batchSize: args.batchSize,
      });
      batches++;
      scanned += result.scanned;
      migrated += result.migrated;
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    return { batches, scanned, migrated };
  },
});

type AuditPage = {
  total: number;
  valid: number;
  missing: number;
  invalid: number;
  invalidSamples: { id: Id<"calendars">; coverIcon: string }[];
  continueCursor: string;
  isDone: boolean;
};

/** Auditoría de una página: contadores + como mucho 10 ids inválidos de muestra. */
export const auditCoverIconsPage = internalQuery({
  args: { cursor: v.optional(v.union(v.string(), v.null())), numItems: v.optional(v.number()) },
  handler: async (ctx, args): Promise<AuditPage> => {
    const numItems = clampBatchSize(args.numItems, MAX_AUDIT_PAGE_SIZE);
    const page = await ctx.db.query("calendars").paginate({ cursor: args.cursor ?? null, numItems });
    let valid = 0;
    let missing = 0;
    let invalid = 0;
    const invalidSamples: AuditPage["invalidSamples"] = [];
    for (const calendar of page.page) {
      if (calendar.coverIcon === undefined) missing++;
      else if (isCoverIconName(calendar.coverIcon)) valid++;
      else {
        invalid++;
        if (invalidSamples.length < MAX_AUDIT_SAMPLES_PER_PAGE) invalidSamples.push({ id: calendar._id, coverIcon: calendar.coverIcon });
      }
    }
    return { total: page.page.length, valid, missing, invalid, invalidSamples, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

/** Auditoría completa: suma solo contadores, con como mucho 20 ids inválidos de muestra. */
export const auditCoverIcons = internalAction({
  args: {},
  handler: async (
    ctx
  ): Promise<{ total: number; valid: number; missing: number; invalid: number; invalidSamples: AuditPage["invalidSamples"] }> => {
    const totals = { total: 0, valid: 0, missing: 0, invalid: 0 };
    const invalidSamples: AuditPage["invalidSamples"] = [];
    let cursor: string | null = null;
    for (;;) {
      const page: AuditPage = await ctx.runQuery(internal.coverIconMigration.auditCoverIconsPage, { cursor });
      totals.total += page.total;
      totals.valid += page.valid;
      totals.missing += page.missing;
      totals.invalid += page.invalid;
      for (const sample of page.invalidSamples) {
        if (invalidSamples.length < MAX_AUDIT_SAMPLES_TOTAL) invalidSamples.push(sample);
      }
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return { ...totals, invalidSamples };
  },
});

/**
 * Log paginado de una migración, con el valor ACTUAL de cada calendario
 * (para revisar `skippedEdited` tras una restauración). `onlyUnrestored`
 * filtra las filas que no se restauraron.
 */
export const listMigrationLogPage = internalQuery({
  args: {
    migrationId: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    numItems: v.optional(v.number()),
    onlyUnrestored: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const numItems = clampBatchSize(args.numItems, MAX_AUDIT_PAGE_SIZE);
    const page = await ctx.db
      .query("coverIconMigrationLog")
      .withIndex("by_migration", (q) => q.eq("migrationId", args.migrationId))
      .paginate({ cursor: args.cursor ?? null, numItems });
    const entries = [];
    for (const entry of page.page) {
      if (args.onlyUnrestored && entry.restored) continue;
      const calendar = await ctx.db.get(entry.calendarId);
      entries.push({
        calendarId: entry.calendarId,
        from: entry.from,
        to: entry.to,
        restored: entry.restored,
        current: calendar ? (calendar.coverIcon ?? null) : "(calendario borrado)",
      });
    }
    return { entries, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

type RestoreResult = {
  scanned: number;
  restored: number;
  skippedEdited: number;
  skippedMissing: number;
  continueCursor: string;
  isDone: boolean;
};

/**
 * Restauración de un lote del log: solo si el calendario sigue teniendo
 * exactamente el `to` que escribió la migración (nadie lo ha editado
 * después) vuelve a `from` y marca la fila `restored`. Si lo editaron →
 * `skippedEdited` (nunca se pisa una elección del Admin). Sirve para
 * corregir datos (p. ej. tabla de equivalencias equivocada); NO es un
 * requisito para ningún rollback de Next (docs/iconos.md § "Rollback").
 */
export const restoreCoverIconsBatch = internalMutation({
  args: { migrationId: v.string(), cursor: v.optional(v.union(v.string(), v.null())), batchSize: v.optional(v.number()) },
  handler: async (ctx, args): Promise<RestoreResult> => {
    const numItems = clampBatchSize(args.batchSize, MAX_BATCH_SIZE);
    const page = await ctx.db
      .query("coverIconMigrationLog")
      .withIndex("by_migration", (q) => q.eq("migrationId", args.migrationId))
      .paginate({ cursor: args.cursor ?? null, numItems });
    let restored = 0;
    let skippedEdited = 0;
    let skippedMissing = 0;
    for (const entry of page.page) {
      if (entry.restored) continue;
      const calendar = await ctx.db.get(entry.calendarId);
      if (!calendar) {
        skippedMissing++;
        continue;
      }
      if (calendar.coverIcon !== entry.to) {
        skippedEdited++;
        continue;
      }
      await ctx.db.patch(calendar._id, { coverIcon: entry.from });
      await ctx.db.patch(entry._id, { restored: true });
      restored++;
    }
    return { scanned: page.page.length, restored, skippedEdited, skippedMissing, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

/** Conveniencia: restaura todos los lotes de una migración. Devuelve solo totales. */
export const runCoverIconRestore = internalAction({
  args: { migrationId: v.string(), batchSize: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ batches: number; restored: number; skippedEdited: number; skippedMissing: number }> => {
    let cursor: string | null = null;
    const totals = { batches: 0, restored: 0, skippedEdited: 0, skippedMissing: 0 };
    for (;;) {
      const result: RestoreResult = await ctx.runMutation(internal.coverIconMigration.restoreCoverIconsBatch, {
        migrationId: args.migrationId,
        cursor,
        batchSize: args.batchSize,
      });
      totals.batches++;
      totals.restored += result.restored;
      totals.skippedEdited += result.skippedEdited;
      totals.skippedMissing += result.skippedMissing;
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    return totals;
  },
});
