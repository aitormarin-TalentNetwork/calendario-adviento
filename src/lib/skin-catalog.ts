import { fetchQuery } from "convex/nextjs";
import { api } from "../../convex/_generated/api";
import { convexAppServerSecret } from "@/lib/convex-server";
import type { CatalogSkin } from "@/lib/skin-style";

/** Fila de `skins.listAllPublic` (contrato antiguo, existe en todas las versiones de Convex). */
export type LegacySkin = { _id: string; key: string; name: string; background?: string; accent?: string };

export type SkinCatalogResult =
  | { mode: "full"; catalog: CatalogSkin[] }
  /**
   * Sin catálogo utilizable. Todo se pinta con el respaldo Alegre y el
   * selector usa las filas antiguas (`allSkins`) para que se pueda seguir
   * guardando:
   * - "old-convex": Convex anterior a TAL-62 (rollback de Convex con el Next
   *   de TAL-62 todavía sirviendo — en Railway el redeploy de Convex llega
   *   ANTES de sustituir el Next);
   * - "not-seeded": Convex de TAL-62 sin sembrar todavía (runbook, entre las
   *   fases b y c) — `listCatalogPublic` devuelve [].
   */
  | { mode: "degraded"; reason: "old-convex" | "not-seeded"; catalog: []; allSkins: LegacySkin[] };

/** Mensaje exacto de Convex cuando la función pública no existe en el deployment. */
const MISSING_FUNCTION_RE = /Could not find public function for 'skins:listCatalogPublic'/;

export function isMissingCatalogFunctionError(error: unknown): boolean {
  return error instanceof Error && MISSING_FUNCTION_RE.test(error.message);
}

/**
 * TAL-62 — única vía del front para obtener el catálogo de skins (docs/skins.md
 * § "Catálogo 2026"). Si Convex responde que `listCatalogPublic` NO existe, o
 * el catálogo todavía no está sembrado, cae a `listAllPublic` en modo
 * degradado; cualquier otro error se propaga (igual que el resto de lecturas
 * reconectadas).
 */
export async function loadSkinCatalog(): Promise<SkinCatalogResult> {
  const serverSecret = convexAppServerSecret();
  let reason: "old-convex" | "not-seeded";
  try {
    const catalog = await fetchQuery(api.skins.listCatalogPublic, { serverSecret });
    if (catalog.length > 0) return { mode: "full", catalog: catalog as CatalogSkin[] };
    reason = "not-seeded";
  } catch (error) {
    if (!isMissingCatalogFunctionError(error)) throw error;
    reason = "old-convex";
  }
  console.warn(`loadSkinCatalog: sin catálogo 2026 (${reason}) — modo degradado.`);
  const allSkins = await fetchQuery(api.skins.listAllPublic, { serverSecret });
  return {
    mode: "degraded",
    reason,
    catalog: [],
    allSkins: allSkins.map((skin) => ({ _id: skin._id, key: skin.key, name: skin.name, background: skin.background, accent: skin.accent })),
  };
}
