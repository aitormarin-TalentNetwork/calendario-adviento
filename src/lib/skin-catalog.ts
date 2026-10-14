import { fetchQuery } from "convex/nextjs";
import { api } from "../../convex/_generated/api";
import { convexAppServerSecret } from "@/lib/convex-server";
import type { CatalogSkin } from "@/lib/skin-style";

/**
 * TAL-62 — única vía del front para obtener el catálogo de skins (docs/skins.md
 * § "Catálogo 2026"): los 8 con estilo, en su orden.
 *
 * TAL-82 (fase e de TAL-62) — sin modo degradado: ya no cae a
 * `skins.listAllPublic` (las filas antiguas y sus campos se retiran). Si el
 * catálogo no está sembrado, es un error de despliegue y se dice claramente;
 * cualquier error de Convex se propaga, igual que el resto de lecturas.
 */
export async function loadSkinCatalog(): Promise<{ catalog: CatalogSkin[] }> {
  const catalog = await fetchQuery(api.skins.listCatalogPublic, { serverSecret: convexAppServerSecret() });
  if (catalog.length === 0) {
    throw new Error("El catálogo de skins no está sembrado en este deployment (npx convex run skins:seedSkinCatalog2026).");
  }
  return { catalog: catalog as CatalogSkin[] };
}
