import { internalAction, internalMutation, internalQuery, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { assertTestHelpersAllowed } from "./lib/testHelpers";
import { requireServerSecret } from "./serverAuth";
import { DEFAULT_SKIN_KEY_2026, SKIN_CATALOG_2026 } from "./skinCatalog2026";

type SkinSeed = {
  key: string;
  name: string;
  description?: string;
  background: string;
  accent: string;
  // TAL-47 — color del texto (título/número/marcador) para este skin. Con
  // `textPill: true` es el color del texto QUE VA ENCIMA de la píldora de
  // fondo — ver `convex/schema.ts`.
  textColor: string;
  // Solo `true` en los skins antiguos cuyo rango de degradado/rayas era
  // demasiado amplio para un `textColor` plano.
  textPill?: boolean;
};

// Upsert por `key` de una fila de `skins` con el shape antiguo (TAL-22:
// inserta si no existe, o actualiza `name`/`description`/colores si ya
// existe). internalMutation, solo por CLI: ningún código de aplicación la
// invoca.
//
// TAL-72 — el catálogo viejo de 24 skins (`SKIN_CATALOG`/`seedSkinCatalog`)
// y la migración de un solo uso de TAL-43 (`migrateLegacySkinKeysToSpanish`)
// se retiraron: el catálogo vigente es el de TAL-62 (`seedSkinCatalog2026`).
// `createSkin` se queda porque `scripts/verify-tal62-skin-migration.mjs`
// la usa para crear un skin antiguo temporal (fuera del catálogo nuevo) en
// dev, y los campos antiguos siguen en el schema hasta la fase e de TAL-62.
async function upsertSkinHandler(ctx: MutationCtx, args: SkinSeed) {
  const existing = await ctx.db
    .query("skins")
    .withIndex("by_key", (q) => q.eq("key", args.key))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, {
      name: args.name,
      description: args.description,
      background: args.background,
      accent: args.accent,
      // TAL-47 — mismo criterio que el resto de campos de color: patchear
      // `textPill` con `undefined` borra el campo si la fila lo tenía,
      // igual que `description`.
      textColor: args.textColor,
      textPill: args.textPill,
    });
    return existing._id;
  }
  return await ctx.db.insert("skins", args);
}

export const createSkin = internalMutation({
  args: {
    key: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    background: v.string(),
    accent: v.string(),
    textColor: v.string(),
    textPill: v.optional(v.boolean()),
  },
  handler: upsertSkinHandler,
});

export const getByKey = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) =>
    ctx.db
      .query("skins")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique(),
});

/**
 * TAL-12 — todas las filas de `skins`, con el shape antiguo. Desde TAL-62 el
 * selector usa `listCatalogPublic`; esta se conserva (TAL-72) porque la usan
 * el Next anterior a TAL-62 durante la ventana de despliegue y el modo
 * degradado del Next actual (`src/lib/skin-catalog.ts`, rollback de
 * TAL-62) — retirarla tras la fase e de TAL-62. Catálogo
 * fijo y pequeño (unas pocas filas) — `.collect()` sin índice es
 * suficiente, mismo criterio que `resolveDefaultSkinId` en
 * `convex/calendars.ts`. Frontera pública con secreto compartido, mismo
 * patrón que el resto de TAL-11/TAL-12 (`convex/serverAuth.ts`).
 */
export const listAllPublic = query({
  args: { serverSecret: v.string() },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await ctx.db.query("skins").collect();
  },
});

// ---------------------------------------------------------------------------
// TAL-62 — catálogo "Estilo 2026" (8 skins). Datos en `skinCatalog2026.ts`;
// estilo en la tabla `skinStyles` (ver el porqué en `convex/schema.ts`).
// ---------------------------------------------------------------------------

/** Estilo de un skin, o `null` si no está en el catálogo nuevo (antiguo/retirado). Lanza si hay más de una fila (catálogo incoherente). */
export async function getSkinStyle(ctx: QueryCtx, skinId: Id<"skins">): Promise<Doc<"skinStyles"> | null> {
  const rows = await ctx.db
    .query("skinStyles")
    .withIndex("by_skin", (q) => q.eq("skinId", skinId))
    .take(2);
  if (rows.length > 1) throw new Error(`Catálogo incoherente: más de un estilo para el skin ${skinId}.`);
  return rows[0] ?? null;
}

/** ¿Existe ya el catálogo nuevo (al menos un estilo sembrado)? Antes de sembrar, el comportamiento es el de siempre. */
export async function isCatalog2026Seeded(ctx: QueryCtx): Promise<boolean> {
  return (await ctx.db.query("skinStyles").first()) !== null;
}

async function getSkinByKey(ctx: QueryCtx, key: string): Promise<Doc<"skins"> | null> {
  return await ctx.db
    .query("skins")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}

/** `_id` de Alegre si está en el catálogo nuevo (con estilo); `null` si todavía no se ha sembrado. */
export async function getCatalogDefaultSkinId(ctx: QueryCtx): Promise<Id<"skins"> | null> {
  const alegre = await getSkinByKey(ctx, DEFAULT_SKIN_KEY_2026);
  if (!alegre) return null;
  return (await getSkinStyle(ctx, alegre._id)) ? alegre._id : null;
}

/**
 * Sembrado idempotente de los 8 (upsert por `key` en `skins` y por `skinId`
 * en `skinStyles`). En las 3 filas conservadas (`nieve`, `tira-comica`,
 * `rojiblanco`) solo se actualizan nombre y descripción. Si una conservada
 * no existe en este deployment (seed distinto), se inserta como nueva.
 * TAL-82 — ya no escribe los campos antiguos (`background`/`accent`/
 * `textColor`/`textPill`, fase e de TAL-62); tampoco los quita si una fila
 * los tiene: eso lo hace `runClearLegacySkinFields`.
 * Al terminar comprueba que `sortOrder` es exactamente {1..8} sin repetidos.
 */
export const seedSkinCatalog2026 = internalMutation({
  args: {},
  handler: async (ctx) => {
    const result: { key: string; skinId: Id<"skins">; skin: "inserted" | "updated" | "kept"; style: "inserted" | "updated" }[] = [];
    for (const entry of SKIN_CATALOG_2026) {
      const existing = await getSkinByKey(ctx, entry.key);
      let skinId: Id<"skins">;
      let skinAction: "inserted" | "updated" | "kept";
      if (existing && entry.keepsExistingRow) {
        await ctx.db.patch(existing._id, { name: entry.name, description: entry.description });
        skinId = existing._id;
        skinAction = "kept";
      } else if (existing) {
        await ctx.db.patch(existing._id, { name: entry.name, description: entry.description });
        skinId = existing._id;
        skinAction = "updated";
      } else {
        skinId = await ctx.db.insert("skins", { key: entry.key, name: entry.name, description: entry.description });
        skinAction = "inserted";
      }

      const style = await getSkinStyle(ctx, skinId);
      const styleDoc = { skinId, sortOrder: entry.sortOrder, palette: entry.palette, treatment: entry.treatment, swatches: entry.swatches };
      if (style) {
        await ctx.db.replace(style._id, styleDoc);
      } else {
        await ctx.db.insert("skinStyles", styleDoc);
      }
      result.push({ key: entry.key, skinId, skin: skinAction, style: style ? "updated" : "inserted" });
    }

    const orders = (await ctx.db.query("skinStyles").collect()).map((s) => s.sortOrder).sort((a, b) => a - b);
    const expected = SKIN_CATALOG_2026.map((e) => e.sortOrder).sort((a, b) => a - b);
    if (JSON.stringify(orders) !== JSON.stringify(expected)) {
      throw new Error(`sortOrder incoherente tras sembrar: ${JSON.stringify(orders)}`);
    }
    return result;
  },
});

/**
 * Catálogo activo (los 8 con estilo), ordenado por `sortOrder`, para el
 * selector y la pantalla del invitado del Next de TAL-62. `listAllPublic`
 * NO cambia de contrato: la sigue usando el Next anterior durante el
 * despliegue, y el Next nuevo cae a ella si esta función no existe
 * (rollback de Convex — docs/skins.md § "Catálogo 2026").
 */
export const listCatalogPublic = query({
  args: { serverSecret: v.string() },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    const styles = await ctx.db.query("skinStyles").withIndex("by_sort").collect();
    const rows = [];
    for (const style of styles) {
      const skin = await ctx.db.get(style.skinId);
      if (!skin) continue;
      rows.push({
        _id: skin._id,
        key: skin.key,
        name: skin.name,
        description: skin.description,
        sortOrder: style.sortOrder,
        palette: style.palette,
        treatment: style.treatment,
        swatches: style.swatches,
      });
    }
    return rows;
  },
});

// ---------------------------------------------------------------------------
// TAL-82 — fase (e) de TAL-62: retirar los campos antiguos de `skins`
// (`background`/`accent`/`textColor`/`textPill`). Plan y runbook: export
// «codigo para auditar/T1_TAL-82_…» y docs/skins.md § "Fase e (TAL-82)".
// Todas INTERNAS (solo CLI de administrador). Mismo patrón que
// `skinMigration.ts`: lotes acotados (`paginate`, una transacción por lote),
// coordinadora `internalAction`, resultados acotados (solo recuentos), y
// precondiciones `expect*` que abortan SIN ESCRIBIR si no cuadran.
//
// `testScope` (solo en dev, `assertTestHelpersAllowed()` como primera
// instrucción): las mismas funciones recorren la tabla ENTERA con el mismo
// `paginate`, pero solo cuentan y escriben lo del prefijo de los fixtures
// del spec (`e2e/tal82-fase-e.spec.ts`). Sin `testScope` (prod y ensayo)
// actúan sobre todo.
// ---------------------------------------------------------------------------

export const LEGACY_SKIN_FIELDS = ["background", "accent", "textColor", "textPill"] as const;
const MAX_PHASE_E_BATCH = 50;

export const testScopeValidator = v.optional(v.object({ keyPrefix: v.string() }));
export type TestScope = { keyPrefix: string } | undefined;

/** Valida el alcance: con `testScope` exige la barrera de dev y un prefijo no vacío. */
export function checkTestScope(scope: TestScope): void {
  if (scope === undefined) return;
  assertTestHelpersAllowed();
  if (scope.keyPrefix.trim().length < 4) throw new Error("testScope.keyPrefix demasiado corto.");
}

export function skinInScope(skin: Doc<"skins">, scope: TestScope): boolean {
  return scope === undefined || skin.key.startsWith(scope.keyPrefix);
}

export function calendarInScope(calendar: Doc<"calendars">, scope: TestScope): boolean {
  return scope === undefined || calendar.name.startsWith(scope.keyPrefix);
}

export function hasLegacySkinFields(skin: Doc<"skins">): boolean {
  return LEGACY_SKIN_FIELDS.some((field) => skin[field] !== undefined);
}

export function clampPhaseEBatch(requested: number | undefined): number {
  if (requested === undefined) return MAX_PHASE_E_BATCH;
  if (!Number.isInteger(requested) || requested < 1) throw new Error("batchSize debe ser un entero ≥ 1.");
  return Math.min(requested, MAX_PHASE_E_BATCH);
}

/** Skins del alcance que NO tienen fila en `skinStyles` (retirados). `skins` y `skinStyles` son tablas pequeñas (< 50 filas). */
export async function countRetiredInScope(ctx: QueryCtx, scope: TestScope): Promise<number> {
  const styled = new Set((await ctx.db.query("skinStyles").collect()).map((style) => style.skinId));
  return (await ctx.db.query("skins").collect()).filter((skin) => skinInScope(skin, scope) && !styled.has(skin._id)).length;
}

type SkinsTablesStatus = {
  skins: number;
  inCatalog: number;
  retired: number;
  withLegacyFields: number;
  withField: Record<(typeof LEGACY_SKIN_FIELDS)[number], number>;
  skinStylesOrphans: number;
  skinMigrationLog: number;
  coverIconMigrationLog: number;
};

/** Parte del estado que cabe en una query: `skins`/`skinStyles` y los dos logs (tablas pequeñas). */
export const legacyPhaseESkinsStatus = internalQuery({
  args: { testScope: testScopeValidator },
  handler: async (ctx, args): Promise<SkinsTablesStatus> => {
    checkTestScope(args.testScope);
    const styles = await ctx.db.query("skinStyles").collect();
    const styled = new Set(styles.map((style) => style.skinId));
    const skins = (await ctx.db.query("skins").collect()).filter((skin) => skinInScope(skin, args.testScope));
    const withField = { background: 0, accent: 0, textColor: 0, textPill: 0 };
    for (const skin of skins) for (const field of LEGACY_SKIN_FIELDS) if (skin[field] !== undefined) withField[field]++;
    const allSkinIds = new Set((await ctx.db.query("skins").collect()).map((skin) => skin._id));
    const prefix = args.testScope?.keyPrefix;
    const logs = (await ctx.db.query("skinMigrationLog").collect()).filter((row) => prefix === undefined || row.migrationId.startsWith(prefix));
    const coverLogs = (await ctx.db.query("coverIconMigrationLog").collect()).filter((row) => prefix === undefined || row.migrationId.startsWith(prefix));
    return {
      skins: skins.length,
      inCatalog: skins.filter((skin) => styled.has(skin._id)).length,
      retired: skins.filter((skin) => !styled.has(skin._id)).length,
      withLegacyFields: skins.filter(hasLegacySkinFields).length,
      withField,
      skinStylesOrphans: prefix === undefined ? styles.filter((style) => !allSkinIds.has(style.skinId)).length : 0,
      skinMigrationLog: logs.length,
      coverIconMigrationLog: coverLogs.length,
    };
  },
});

type CalendarsStatusPage = { calendars: number; calendarsOnRetired: number; calendarsMissingSkin: number; continueCursor: string; isDone: boolean };

/** Una página de `calendars` para el estado (el alcance filtra por prefijo del nombre). */
export const legacyPhaseECalendarsPage = internalQuery({
  args: { cursor: v.optional(v.union(v.string(), v.null())), numItems: v.optional(v.number()), testScope: testScopeValidator },
  handler: async (ctx, args): Promise<CalendarsStatusPage> => {
    checkTestScope(args.testScope);
    const page = await ctx.db.query("calendars").paginate({ cursor: args.cursor ?? null, numItems: clampPhaseEBatch(args.numItems) });
    const result: CalendarsStatusPage = { calendars: 0, calendarsOnRetired: 0, calendarsMissingSkin: 0, continueCursor: page.continueCursor, isDone: page.isDone };
    for (const calendar of page.page) {
      if (!calendarInScope(calendar, args.testScope)) continue;
      result.calendars++;
      const skin = await ctx.db.get(calendar.skinId);
      if (!skin) result.calendarsMissingSkin++;
      else if (!(await getSkinStyle(ctx, skin._id))) result.calendarsOnRetired++;
    }
    return result;
  },
});

export type LegacyPhaseEStatus = SkinsTablesStatus & { calendars: number; calendarsOnRetired: number; calendarsMissingSkin: number };

/** Estado de la fase e (solo lectura): lo que el runbook compara con la tabla de cifras esperadas. */
export const legacyPhaseEStatus = internalAction({
  args: { testScope: testScopeValidator },
  handler: async (ctx, args): Promise<LegacyPhaseEStatus> => {
    checkTestScope(args.testScope);
    const tables: SkinsTablesStatus = await ctx.runQuery(internal.skins.legacyPhaseESkinsStatus, { testScope: args.testScope });
    const totals = { calendars: 0, calendarsOnRetired: 0, calendarsMissingSkin: 0 };
    let cursor: string | null = null;
    for (;;) {
      const page: CalendarsStatusPage = await ctx.runQuery(internal.skins.legacyPhaseECalendarsPage, { cursor, testScope: args.testScope });
      totals.calendars += page.calendars;
      totals.calendarsOnRetired += page.calendarsOnRetired;
      totals.calendarsMissingSkin += page.calendarsMissingSkin;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return { ...tables, ...totals };
  },
});

type ClearBatchResult = { scanned: number; cleared: number; alreadyClean: number; continueCursor: string; isDone: boolean };

/**
 * Un lote: quita los 4 campos antiguos (patch a `undefined`) de las filas de
 * la página que los tengan. NUNCA borra filas ni toca `key`/`name`/
 * `description`. Precondición comprobada en CADA lote, dentro de su
 * transacción: no queda ningún skin retirado (del alcance); si queda, lanza
 * sin escribir.
 */
export const clearLegacySkinFieldsBatch = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), batchSize: v.optional(v.number()), testScope: testScopeValidator },
  handler: async (ctx, args): Promise<ClearBatchResult> => {
    checkTestScope(args.testScope);
    const retired = await countRetiredInScope(ctx, args.testScope);
    if (retired !== 0) throw new Error(`Quedan ${retired} skins retirados: bórralos antes (skinMigration:runDeleteRetiredSkins).`);
    const page = await ctx.db.query("skins").paginate({ cursor: args.cursor ?? null, numItems: clampPhaseEBatch(args.batchSize) });
    const result: ClearBatchResult = { scanned: page.page.length, cleared: 0, alreadyClean: 0, continueCursor: page.continueCursor, isDone: page.isDone };
    for (const skin of page.page) {
      if (!skinInScope(skin, args.testScope)) continue;
      if (!hasLegacySkinFields(skin)) {
        result.alreadyClean++;
        continue;
      }
      await ctx.db.patch(skin._id, { background: undefined, accent: undefined, textColor: undefined, textPill: undefined });
      result.cleared++;
    }
    return result;
  },
});

/**
 * Coordinadora (runbook, paso 2.3). Antes de escribir exige el estado
 * esperado: 0 retirados, `inCatalog = expectCatalog` y
 * `withLegacyFields = expectWithLegacyFields`; si no, aborta sin escribir y
 * devuelve el estado. Recorre los lotes y al final exige
 * `withLegacyFields = 0`. Idempotente y reanudable: relanzar con
 * `expectWithLegacyFields` = lo que quede (0 → no-op verificable).
 */
export const runClearLegacySkinFields = internalAction({
  args: { expectCatalog: v.number(), expectWithLegacyFields: v.number(), batchSize: v.optional(v.number()), testScope: testScopeValidator },
  handler: async (
    ctx,
    args
  ): Promise<
    | { aborted: true; reason: string; status: LegacyPhaseEStatus }
    | { aborted: false; ok: boolean; batches: number; cleared: number; alreadyClean: number; finalStatus: LegacyPhaseEStatus }
  > => {
    checkTestScope(args.testScope);
    const status: LegacyPhaseEStatus = await ctx.runAction(internal.skins.legacyPhaseEStatus, { testScope: args.testScope });
    if (status.retired !== 0) return { aborted: true, reason: `Quedan ${status.retired} retirados: bórralos antes.`, status };
    if (status.inCatalog !== args.expectCatalog) return { aborted: true, reason: `inCatalog es ${status.inCatalog}, se esperaba ${args.expectCatalog}.`, status };
    if (status.withLegacyFields !== args.expectWithLegacyFields) {
      return { aborted: true, reason: `withLegacyFields es ${status.withLegacyFields}, se esperaba ${args.expectWithLegacyFields}.`, status };
    }
    let cursor: string | null = null;
    const totals = { batches: 0, cleared: 0, alreadyClean: 0 };
    for (;;) {
      const result: ClearBatchResult = await ctx.runMutation(internal.skins.clearLegacySkinFieldsBatch, {
        cursor,
        batchSize: args.batchSize,
        testScope: args.testScope,
      });
      totals.batches++;
      totals.cleared += result.cleared;
      totals.alreadyClean += result.alreadyClean;
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    const finalStatus: LegacyPhaseEStatus = await ctx.runAction(internal.skins.legacyPhaseEStatus, { testScope: args.testScope });
    return { aborted: false, ok: finalStatus.withLegacyFields === 0, ...totals, finalStatus };
  },
});

// --- Ayudas SOLO para tests en dev (TAL-82; `assertTestHelpersAllowed()` primero; se retiran en el paso 3) ---

/** Skin RETIRADO de fixture (sin fila en `skinStyles`) con los 4 campos antiguos. */
export const insertRetiredSkinForTests = internalMutation({
  args: { key: v.string() },
  handler: async (ctx, args): Promise<Id<"skins">> => {
    assertTestHelpersAllowed();
    return await ctx.db.insert("skins", {
      key: args.key,
      name: `Retirado ${args.key}`,
      background: "#000000",
      accent: "#ffffff",
      textColor: "#ffffff",
      textPill: true,
    });
  },
});

/** Skin VIGENTE de fixture: fila en `skins` con los 4 campos + su `skinStyles` (copia el estilo de Alegre, `sortOrder` alto). */
export const insertCatalogSkinForTests = internalMutation({
  args: { key: v.string(), sortOrder: v.number() },
  handler: async (ctx, args): Promise<Id<"skins">> => {
    assertTestHelpersAllowed();
    const alegreId = await getCatalogDefaultSkinId(ctx);
    const alegreStyle = alegreId ? await getSkinStyle(ctx, alegreId) : null;
    if (!alegreStyle) throw new Error("Falta el catálogo nuevo en dev (skins:seedSkinCatalog2026).");
    const skinId = await ctx.db.insert("skins", {
      key: args.key,
      name: `Vigente ${args.key}`,
      description: "fixture TAL-82",
      background: "#fff8ee",
      accent: "#7b61ff",
      textColor: "#1d2320",
    });
    await ctx.db.insert("skinStyles", {
      skinId,
      sortOrder: args.sortOrder,
      palette: alegreStyle.palette,
      treatment: alegreStyle.treatment,
      swatches: alegreStyle.swatches,
    });
    return skinId;
  },
});

/** Pone los 4 campos antiguos en un skin del alcance (para probar la limpieza). */
export const setLegacyFieldsForTests = internalMutation({
  args: { skinId: v.id("skins"), keyPrefix: v.string() },
  handler: async (ctx, args) => {
    assertTestHelpersAllowed();
    const skin = await ctx.db.get(args.skinId);
    if (!skin || !skin.key.startsWith(args.keyPrefix)) throw new Error("Solo skins de fixture (prefijo).");
    await ctx.db.patch(args.skinId, { background: "#fff8ee", accent: "#7b61ff", textColor: "#1d2320", textPill: false });
  },
});

/**
 * Borra SOLO los documentos de fixture del prefijo: calendarios (con sus
 * memberships, invitaciones, días y vistas), filas de los dos logs, estilos y
 * skins. Un lote acotado por llamada; repetir hasta `isDone`.
 */
export const deleteTestFixtures = internalMutation({
  args: { keyPrefix: v.string() },
  handler: async (ctx, args): Promise<{ deleted: number; isDone: boolean }> => {
    checkTestScope({ keyPrefix: args.keyPrefix });
    const LIMIT = 100;
    let deleted = 0;
    const del = async (id: Parameters<typeof ctx.db.delete>[0]) => {
      await ctx.db.delete(id);
      deleted++;
    };
    for (const calendar of await ctx.db.query("calendars").collect()) {
      if (deleted >= LIMIT) break;
      if (!calendar.name.startsWith(args.keyPrefix)) continue;
      for (const m of await ctx.db.query("calendarMemberships").withIndex("by_calendar_and_user", (q) => q.eq("calendarId", calendar._id)).collect()) await del(m._id);
      for (const i of await ctx.db.query("invitations").withIndex("by_calendar_and_email", (q) => q.eq("calendarId", calendar._id)).collect()) await del(i._id);
      for (const d of await ctx.db.query("days").withIndex("by_calendar_and_date", (q) => q.eq("calendarId", calendar._id)).collect()) await del(d._id);
      await del(calendar._id);
    }
    for (const row of await ctx.db.query("skinMigrationLog").collect()) if (deleted < LIMIT && row.migrationId.startsWith(args.keyPrefix)) await del(row._id);
    for (const row of await ctx.db.query("coverIconMigrationLog").collect()) if (deleted < LIMIT && row.migrationId.startsWith(args.keyPrefix)) await del(row._id);
    for (const skin of await ctx.db.query("skins").collect()) {
      if (deleted >= LIMIT) break;
      if (!skin.key.startsWith(args.keyPrefix)) continue;
      const style = await getSkinStyle(ctx, skin._id);
      if (style) await del(style._id);
      await del(skin._id);
    }
    return { deleted, isDone: deleted < LIMIT };
  },
});
