// TAL-62 — migración de los calendarios al catálogo de skins "Estilo 2026"
// y retirada física de los 21 skins antiguos. Runbook completo (fases,
// backup, rollback): docs/skins.md § "Catálogo 2026". Todas son funciones
// INTERNAS: solo se invocan por la CLI de administrador
// (`npx convex run [--prod] skinMigration:<función> '<args>'`).
//
// Mismo diseño y garantías que `coverIconMigration.ts` (TAL-60, retirado en
// TAL-72 tras su fase d):
// - lotes acotados (`paginate`), cada uno en su propia transacción;
// - log duradero (`skinMigrationLog`) escrito en la MISMA transacción que
//   cada `patch`;
// - resultados acotados (solo contadores por lote; auditoría con muestras
//   limitadas);
// - idempotente y reanudable (relanzar desde el principio salta lo ya
//   migrado, que ya está en el catálogo);
// - restauración desde el log que no pisa ediciones posteriores
//   (`skippedEdited`), y borrado protegido por referencias.
//
// Regla (Design System + PM): calendarios con un skin del catálogo nuevo
// (incluidos los conservados nieve / tira-comica / rojiblanco) no se tocan;
// cualquier otro — skin antiguo sin estilo o `skinId` roto — pasa a Alegre.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { assertTestHelpersAllowed } from "./lib/testHelpers";
import {
  calendarInScope,
  checkTestScope,
  clampPhaseEBatch,
  countRetiredInScope,
  getCatalogDefaultSkinId,
  getSkinStyle,
  skinInScope,
  testScopeValidator,
  type TestScope,
} from "./skins";

const MAX_BATCH_SIZE = 100;
const MAX_AUDIT_PAGE_SIZE = 200;
const MAX_AUDIT_SAMPLES_PER_PAGE = 10;
const MAX_AUDIT_SAMPLES_TOTAL = 20;
const MAX_LEGACY_KEYS = 30;

function clampBatchSize(requested: number | undefined, max: number): number {
  if (requested === undefined) return max;
  if (!Number.isInteger(requested) || requested < 1) throw new Error("batchSize debe ser un entero ≥ 1.");
  return Math.min(requested, max);
}

async function requireAlegre(ctx: MutationCtx): Promise<Id<"skins">> {
  const alegre = await getCatalogDefaultSkinId(ctx);
  if (!alegre) throw new Error("Falta el catálogo nuevo: ejecuta antes skins:seedSkinCatalog2026.");
  return alegre;
}

type BatchResult = { scanned: number; migrated: number; continueCursor: string; isDone: boolean };

/**
 * Un lote: para cada calendario cuyo skin NO está en el catálogo nuevo
 * (antiguo sin estilo, o `skinId` roto), registra `{ from, to }` y hace el
 * `patch` a Alegre en esta misma transacción. No toca `updatedAt`.
 * Reutilizar el `migrationId` de una migración restaurada se rechaza.
 */
export const migrateCalendarSkinsBatch = internalMutation({
  args: { migrationId: v.string(), cursor: v.optional(v.union(v.string(), v.null())), batchSize: v.optional(v.number()) },
  handler: async (ctx, args): Promise<BatchResult> => {
    if (args.migrationId.trim() === "") throw new Error("migrationId obligatorio.");
    const alegre = await requireAlegre(ctx);
    const numItems = clampBatchSize(args.batchSize, MAX_BATCH_SIZE);
    const page = await ctx.db.query("calendars").paginate({ cursor: args.cursor ?? null, numItems });

    let migrated = 0;
    for (const calendar of page.page) {
      const skin = await ctx.db.get(calendar.skinId);
      if (skin && (await getSkinStyle(ctx, skin._id))) continue;

      const existing = await ctx.db
        .query("skinMigrationLog")
        .withIndex("by_migration_and_calendar", (q) => q.eq("migrationId", args.migrationId).eq("calendarId", calendar._id))
        .first();
      if (existing) {
        throw new Error(
          `El migrationId "${args.migrationId}" ya se usó para el calendario ${calendar._id} (restaurado después). Usa un migrationId nuevo.`
        );
      }

      await ctx.db.insert("skinMigrationLog", {
        migrationId: args.migrationId,
        calendarId: calendar._id,
        fromSkinId: calendar.skinId,
        fromKey: skin ? skin.key : "(skin inexistente)",
        toSkinId: alegre,
        restored: false,
      });
      await ctx.db.patch(calendar._id, { skinId: alegre });
      migrated++;
    }
    return { scanned: page.page.length, migrated, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

/** Conveniencia: itera los lotes hasta el final. Solo totales. Si falla a mitad, basta con relanzarla. */
export const runCalendarSkinMigration = internalAction({
  args: { migrationId: v.string(), batchSize: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ batches: number; scanned: number; migrated: number }> => {
    let cursor: string | null = null;
    const totals = { batches: 0, scanned: 0, migrated: 0 };
    for (;;) {
      const result: BatchResult = await ctx.runMutation(internal.skinMigration.migrateCalendarSkinsBatch, {
        migrationId: args.migrationId,
        cursor,
        batchSize: args.batchSize,
      });
      totals.batches++;
      totals.scanned += result.scanned;
      totals.migrated += result.migrated;
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    return totals;
  },
});

type AuditPage = {
  total: number;
  inCatalog: number;
  legacy: number;
  missingSkin: number;
  legacyByKey: Record<string, number>;
  samples: { id: Id<"calendars">; problem: string }[];
  continueCursor: string;
  isDone: boolean;
};

/** Auditoría de una página: contadores + como mucho 10 calendarios problemáticos de muestra. */
export const auditCalendarSkinsPage = internalQuery({
  args: { cursor: v.optional(v.union(v.string(), v.null())), numItems: v.optional(v.number()), testScope: testScopeValidator },
  handler: async (ctx, args): Promise<AuditPage> => {
    checkTestScope(args.testScope);
    const numItems = clampBatchSize(args.numItems, MAX_AUDIT_PAGE_SIZE);
    const page = await ctx.db.query("calendars").paginate({ cursor: args.cursor ?? null, numItems });
    const inScope = page.page.filter((calendar) => calendarInScope(calendar, args.testScope));
    const result: AuditPage = {
      total: inScope.length,
      inCatalog: 0,
      legacy: 0,
      missingSkin: 0,
      legacyByKey: {},
      samples: [],
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
    for (const calendar of inScope) {
      const skin = await ctx.db.get(calendar.skinId);
      if (!skin) {
        result.missingSkin++;
        if (result.samples.length < MAX_AUDIT_SAMPLES_PER_PAGE) result.samples.push({ id: calendar._id, problem: "skin inexistente" });
      } else if (await getSkinStyle(ctx, skin._id)) {
        result.inCatalog++;
      } else {
        result.legacy++;
        result.legacyByKey[skin.key] = (result.legacyByKey[skin.key] ?? 0) + 1;
        if (result.samples.length < MAX_AUDIT_SAMPLES_PER_PAGE) result.samples.push({ id: calendar._id, problem: `skin antiguo "${skin.key}"` });
      }
    }
    return result;
  },
});

type AuditTotals = Omit<AuditPage, "continueCursor" | "isDone">;

/** Auditoría completa: suma contadores; como mucho 30 keys antiguas y 20 muestras. TAL-82: `testScope` (solo dev) limita a los calendarios del prefijo. */
export const auditCalendarSkins = internalAction({
  args: { testScope: testScopeValidator },
  handler: async (ctx, args): Promise<AuditTotals> => {
    checkTestScope(args.testScope);
    const totals: AuditTotals = { total: 0, inCatalog: 0, legacy: 0, missingSkin: 0, legacyByKey: {}, samples: [] };
    let cursor: string | null = null;
    for (;;) {
      const page: AuditPage = await ctx.runQuery(internal.skinMigration.auditCalendarSkinsPage, { cursor, testScope: args.testScope });
      totals.total += page.total;
      totals.inCatalog += page.inCatalog;
      totals.legacy += page.legacy;
      totals.missingSkin += page.missingSkin;
      for (const [key, count] of Object.entries(page.legacyByKey)) {
        if (key in totals.legacyByKey || Object.keys(totals.legacyByKey).length < MAX_LEGACY_KEYS) {
          totals.legacyByKey[key] = (totals.legacyByKey[key] ?? 0) + count;
        }
      }
      for (const sample of page.samples) if (totals.samples.length < MAX_AUDIT_SAMPLES_TOTAL) totals.samples.push(sample);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return totals;
  },
});

/** Log paginado de una migración, con el skin ACTUAL de cada calendario (para revisar `skippedEdited`). */
export const listSkinMigrationLogPage = internalQuery({
  args: {
    migrationId: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    numItems: v.optional(v.number()),
    onlyUnrestored: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const numItems = clampBatchSize(args.numItems, MAX_AUDIT_PAGE_SIZE);
    const page = await ctx.db
      .query("skinMigrationLog")
      .withIndex("by_migration", (q) => q.eq("migrationId", args.migrationId))
      .paginate({ cursor: args.cursor ?? null, numItems });
    const entries = [];
    for (const entry of page.page) {
      if (args.onlyUnrestored && entry.restored) continue;
      const calendar = await ctx.db.get(entry.calendarId);
      const currentSkin = calendar ? await ctx.db.get(calendar.skinId) : null;
      entries.push({
        calendarId: entry.calendarId,
        fromKey: entry.fromKey,
        fromSkinId: entry.fromSkinId,
        toSkinId: entry.toSkinId,
        restored: entry.restored,
        current: calendar ? (currentSkin?.key ?? "(skin inexistente)") : "(calendario borrado)",
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
 * Restaura un lote del log: solo si el calendario sigue en el `toSkinId`
 * que escribió la migración y el skin de origen todavía existe (antes del
 * borrado físico) vuelve a `fromSkinId`. Si lo editaron → `skippedEdited`
 * (no se pisa; límite conocido: una re-edición que eligió justo Alegre no
 * se distingue de "no editado"). Si el calendario o el skin de origen ya no
 * existen → `skippedMissing` (tras el borrado físico, la vuelta atrás es
 * desde el backup). Sirve para corregir datos, no para ningún rollback de
 * Next. Importante: tras restaurar, la barrera de escritura sigue activa
 * mientras exista el catálogo nuevo (ver docs/skins.md).
 */
export const restoreCalendarSkinsBatch = internalMutation({
  args: { migrationId: v.string(), cursor: v.optional(v.union(v.string(), v.null())), batchSize: v.optional(v.number()) },
  handler: async (ctx, args): Promise<RestoreResult> => {
    const numItems = clampBatchSize(args.batchSize, MAX_BATCH_SIZE);
    const page = await ctx.db
      .query("skinMigrationLog")
      .withIndex("by_migration", (q) => q.eq("migrationId", args.migrationId))
      .paginate({ cursor: args.cursor ?? null, numItems });
    const result: RestoreResult = {
      scanned: page.page.length,
      restored: 0,
      skippedEdited: 0,
      skippedMissing: 0,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
    for (const entry of page.page) {
      if (entry.restored) continue;
      const calendar = await ctx.db.get(entry.calendarId);
      const fromSkin = await ctx.db.get(entry.fromSkinId);
      if (!calendar || !fromSkin) {
        result.skippedMissing++;
        continue;
      }
      // Distinto de `toSkinId` → lo editó el Admin después de migrar: no se toca.
      if (calendar.skinId !== entry.toSkinId) {
        result.skippedEdited++;
        continue;
      }
      await ctx.db.patch(calendar._id, { skinId: entry.fromSkinId });
      await ctx.db.patch(entry._id, { restored: true });
      result.restored++;
    }
    return result;
  },
});

/** Conveniencia: restaura todos los lotes de una migración. Solo totales. */
export const runCalendarSkinRestore = internalAction({
  args: { migrationId: v.string(), batchSize: v.optional(v.number()) },
  handler: async (ctx, args): Promise<{ batches: number; restored: number; skippedEdited: number; skippedMissing: number }> => {
    let cursor: string | null = null;
    const totals = { batches: 0, restored: 0, skippedEdited: 0, skippedMissing: 0 };
    for (;;) {
      const result: RestoreResult = await ctx.runMutation(internal.skinMigration.restoreCalendarSkinsBatch, {
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

type DeleteResult = { scanned: number; deleted: number; skippedReferenced: number; deletedKeys: string[]; continueCursor: string; isDone: boolean };

/**
 * Borrado físico protegido de un lote de skins: borra un skin SIN estilo
 * (retirado) solo si ningún calendario lo referencia — comprobado en esta
 * misma transacción con el índice `calendars.by_skin`. Si hay referencias,
 * lo salta y lo cuenta (`skippedReferenced`). Nunca toca un skin con
 * estilo. Exige que el catálogo nuevo exista (si no, borraría todo el
 * catálogo antiguo con calendarios aún apuntando a él — por eso, además,
 * el chequeo de referencias).
 */
export const deleteRetiredSkinsBatch = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), batchSize: v.optional(v.number()), testScope: testScopeValidator },
  handler: async (ctx, args): Promise<DeleteResult> => {
    checkTestScope(args.testScope);
    await requireAlegre(ctx);
    const numItems = clampBatchSize(args.batchSize, MAX_BATCH_SIZE);
    const page = await ctx.db.query("skins").paginate({ cursor: args.cursor ?? null, numItems });
    const result: DeleteResult = {
      scanned: page.page.length,
      deleted: 0,
      skippedReferenced: 0,
      deletedKeys: [],
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
    for (const skin of page.page) {
      if (!skinInScope(skin, args.testScope)) continue;
      if (await getSkinStyle(ctx, skin._id)) continue;
      const referenced = await ctx.db
        .query("calendars")
        .withIndex("by_skin", (q) => q.eq("skinId", skin._id))
        .first();
      if (referenced) {
        result.skippedReferenced++;
        continue;
      }
      await ctx.db.delete(skin._id);
      result.deleted++;
      result.deletedKeys.push(skin.key);
    }
    return result;
  },
});

/**
 * Conveniencia del runbook: EXIGE antes `legacy: 0` y `missingSkin: 0` en la
 * auditoría (si no, aborta sin borrar nada: hay que relanzar la migración),
 * borra por lotes y devuelve totales + la auditoría final.
 * TAL-82: `expectRetired` OBLIGATORIO — si el número real de retirados no
 * coincide, aborta antes de borrar (precondición del runbook de la fase e).
 */
export const runDeleteRetiredSkins = internalAction({
  args: { expectRetired: v.number(), batchSize: v.optional(v.number()), testScope: testScopeValidator },
  handler: async (
    ctx,
    args
  ): Promise<
    | { aborted: true; reason: string; audit: AuditTotals; retired?: number }
    | { aborted: false; batches: number; deleted: number; skippedReferenced: number; deletedKeys: string[]; finalAudit: AuditTotals }
  > => {
    checkTestScope(args.testScope);
    const audit: AuditTotals = await ctx.runAction(internal.skinMigration.auditCalendarSkins, { testScope: args.testScope });
    if (audit.legacy !== 0 || audit.missingSkin !== 0) {
      return { aborted: true, reason: "La auditoría no da legacy: 0 y missingSkin: 0 — relanza la migración antes de borrar.", audit };
    }
    const retired: number = await ctx.runQuery(internal.skinMigration.countRetiredSkins, { testScope: args.testScope });
    if (retired !== args.expectRetired) {
      return { aborted: true, reason: `Hay ${retired} skins retirados, se esperaban ${args.expectRetired}: no se borra nada.`, audit, retired };
    }
    let cursor: string | null = null;
    const totals = { batches: 0, deleted: 0, skippedReferenced: 0, deletedKeys: [] as string[] };
    for (;;) {
      const result: DeleteResult = await ctx.runMutation(internal.skinMigration.deleteRetiredSkinsBatch, {
        cursor,
        batchSize: args.batchSize,
        testScope: args.testScope,
      });
      totals.batches++;
      totals.deleted += result.deleted;
      totals.skippedReferenced += result.skippedReferenced;
      totals.deletedKeys.push(...result.deletedKeys);
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    const finalAudit: AuditTotals = await ctx.runAction(internal.skinMigration.auditCalendarSkins, { testScope: args.testScope });
    return { aborted: false, ...totals, finalAudit };
  },
});

/** TAL-82 — número de skins retirados (sin estilo) del alcance. */
export const countRetiredSkins = internalQuery({
  args: { testScope: testScopeValidator },
  handler: async (ctx, args): Promise<number> => {
    checkTestScope(args.testScope);
    return await countRetiredInScope(ctx, args.testScope);
  },
});

// ---------------------------------------------------------------------------
// TAL-82 — vaciado de `skinMigrationLog` (fase e). Solo tiene sentido cuando
// ya no queda ningún skin retirado: con ellos borrados, la restauración desde
// el log es imposible (apuntaría a skins inexistentes). Se comprueba ANTES
// (coordinadora) y en CADA lote (dentro de su transacción).
// ---------------------------------------------------------------------------

function logInScope(migrationId: string, scope: TestScope): boolean {
  return scope === undefined || migrationId.startsWith(scope.keyPrefix);
}

type ClearLogResult = { scanned: number; deleted: number; continueCursor: string; isDone: boolean };

export const clearSkinMigrationLogBatch = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), batchSize: v.optional(v.number()), testScope: testScopeValidator },
  handler: async (ctx, args): Promise<ClearLogResult> => {
    checkTestScope(args.testScope);
    const retired = await countRetiredInScope(ctx, args.testScope);
    if (retired !== 0) throw new Error(`Quedan ${retired} skins retirados: el log todavía sirve para restaurar. No se borra.`);
    const page = await ctx.db.query("skinMigrationLog").paginate({ cursor: args.cursor ?? null, numItems: clampPhaseEBatch(args.batchSize) });
    let deleted = 0;
    for (const row of page.page) {
      if (!logInScope(row.migrationId, args.testScope)) continue;
      await ctx.db.delete(row._id);
      deleted++;
    }
    return { scanned: page.page.length, deleted, continueCursor: page.continueCursor, isDone: page.isDone };
  },
});

/** Filas del log del alcance (solo lectura). */
export const countSkinMigrationLog = internalQuery({
  args: { testScope: testScopeValidator },
  handler: async (ctx, args): Promise<number> => {
    checkTestScope(args.testScope);
    return (await ctx.db.query("skinMigrationLog").collect()).filter((row) => logInScope(row.migrationId, args.testScope)).length;
  },
});

/**
 * Coordinadora (runbook, paso 2.4): aborta sin borrar si queda algún retirado
 * o si las filas no son `expectRows`; recorre los lotes y exige 0 al final.
 * Idempotente: con 0 filas, `expectRows: 0` es un no-op verificable.
 */
export const runClearSkinMigrationLog = internalAction({
  args: { expectRows: v.number(), batchSize: v.optional(v.number()), testScope: testScopeValidator },
  handler: async (
    ctx,
    args
  ): Promise<{ aborted: true; reason: string; rows: number; retired: number } | { aborted: false; ok: boolean; batches: number; deleted: number; remaining: number }> => {
    checkTestScope(args.testScope);
    const retired: number = await ctx.runQuery(internal.skinMigration.countRetiredSkins, { testScope: args.testScope });
    const rows: number = await ctx.runQuery(internal.skinMigration.countSkinMigrationLog, { testScope: args.testScope });
    if (retired !== 0) return { aborted: true, reason: `Quedan ${retired} skins retirados.`, rows, retired };
    if (rows !== args.expectRows) return { aborted: true, reason: `El log tiene ${rows} filas, se esperaban ${args.expectRows}.`, rows, retired };
    let cursor: string | null = null;
    const totals = { batches: 0, deleted: 0 };
    for (;;) {
      const result: ClearLogResult = await ctx.runMutation(internal.skinMigration.clearSkinMigrationLogBatch, {
        cursor,
        batchSize: args.batchSize,
        testScope: args.testScope,
      });
      totals.batches++;
      totals.deleted += result.deleted;
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    const remaining: number = await ctx.runQuery(internal.skinMigration.countSkinMigrationLog, { testScope: args.testScope });
    return { aborted: false, ok: remaining === 0, ...totals, remaining };
  },
});

/** Ayuda SOLO de tests en dev: fila de log de fixture (su `migrationId` lleva el prefijo). */
export const insertSkinMigrationLogForTests = internalMutation({
  args: { migrationId: v.string(), calendarId: v.id("calendars"), fromSkinId: v.id("skins"), toSkinId: v.id("skins") },
  handler: async (ctx, args) => {
    assertTestHelpersAllowed();
    return await ctx.db.insert("skinMigrationLog", { ...args, fromKey: "fixture", restored: false });
  },
});
