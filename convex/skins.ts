import { internalMutation, internalQuery, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
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
 * `rojiblanco`) solo se actualiza la descripción: los campos antiguos
 * (`background`/`accent`/`textColor`/`textPill`) NO se tocan, para que el
 * Next anterior a TAL-62 las siga pintando igual. Si una conservada no
 * existe en este deployment (seed distinto), se inserta como nueva.
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
        await ctx.db.patch(existing._id, { name: entry.name, description: entry.description, ...entry.legacy });
        skinId = existing._id;
        skinAction = "updated";
      } else {
        skinId = await ctx.db.insert("skins", { key: entry.key, name: entry.name, description: entry.description, ...entry.legacy });
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
