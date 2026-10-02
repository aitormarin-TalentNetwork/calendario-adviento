import { expect, test } from "@playwright/test";
import { swatchBackground } from "../src/app/admin/[calendarId]/skin-picker";
import { countdownParts, formatCountdownMessage } from "../src/lib/countdown";
import { isMissingCatalogFunctionError } from "../src/lib/skin-catalog";
import { ALEGRE_FALLBACK_STYLE, resolveSkinStyle, skinStyleVars, skinTreatmentClass, type CatalogSkin } from "../src/lib/skin-style";
import { SKIN_CATALOG_2026 } from "../convex/skinCatalog2026";

/**
 * TAL-62 (parte visual) — tests puros del estilo del skin, la tolerancia a
 * un Convex antiguo (modo degradado) y las piezas de la cuenta atrás.
 */

const CATALOG: CatalogSkin[] = SKIN_CATALOG_2026.map((entry, i) => ({
  _id: `id-${i}`,
  key: entry.key,
  name: entry.name,
  sortOrder: entry.sortOrder,
  palette: entry.palette,
  treatment: entry.treatment,
  swatches: entry.swatches,
}));

test.describe("resolveSkinStyle", () => {
  test("skin del catálogo → su paleta y tratamiento", () => {
    const comic = CATALOG.find((c) => c.key === "tira-comica")!;
    expect(resolveSkinStyle(comic._id, CATALOG)).toEqual({ key: "tira-comica", palette: comic.palette, treatment: "comic" });
  });
  test("skin antiguo, retirado o inexistente → respaldo Alegre ('fallback')", () => {
    expect(resolveSkinStyle("skin-antiguo-pino", CATALOG)).toBe(ALEGRE_FALLBACK_STYLE);
    expect(ALEGRE_FALLBACK_STYLE.key).toBe("fallback");
    expect(ALEGRE_FALLBACK_STYLE.palette).toEqual(SKIN_CATALOG_2026.find((s) => s.key === "alegre")!.palette);
  });
  test("catálogo vacío (modo degradado) → respaldo Alegre", () => {
    expect(resolveSkinStyle(CATALOG[3]._id, [])).toBe(ALEGRE_FALLBACK_STYLE);
  });
});

test.describe("skinStyleVars / skinTreatmentClass", () => {
  test("variables --skin-* completas, --skin-seen-bg (contrato TAL-67) y recuadro del icono", () => {
    const style = resolveSkinStyle(CATALOG[0]._id, CATALOG);
    const vars = skinStyleVars(style) as Record<string, string>;
    const p = style.palette;
    expect(vars["--skin-seen-bg"]).toBe(`linear-gradient(140deg, ${p.seenA}, ${p.seenB})`);
    expect(vars["--icon-tile-bg"]).toBe(p.tile);
    expect(vars["--icon-tile-fg"]).toBe(p.tileInk);
    for (const key of ["bg", "ink", "dim", "line", "card", "cell", "hero", "today", "weekend"]) {
      expect(vars[`--skin-${key}`], key).toBe(p[key as keyof typeof p]);
    }
    expect(Object.keys(vars).some((k) => /font/i.test(k))).toBe(false); // un skin nunca cambia la fuente
  });
  test("clase de tratamiento solo en Tira Cómica y Rojiblanco", () => {
    expect(CATALOG.map((c) => skinTreatmentClass(resolveSkinStyle(c._id, CATALOG)) ?? null)).toEqual([
      null, null, null, null, null, null, "skin-comic", "skin-stripes-pill",
    ]);
  });
});

test.describe("loadSkinCatalog: detección de Convex antiguo", () => {
  test("el mensaje real de Convex para una función inexistente activa el modo degradado", () => {
    const real = new Error("[Request ID: 4980092d597c1658] Server Error\nCould not find public function for 'skins:listCatalogPublic'.\n");
    expect(isMissingCatalogFunctionError(real)).toBe(true);
  });
  test("cualquier otro error NO se trata como degradado (se propaga)", () => {
    expect(isMissingCatalogFunctionError(new Error("[Request ID: x] Server Error\nUncaught Error: No autorizado."))).toBe(false);
    expect(isMissingCatalogFunctionError(new Error("Could not find public function for 'skins:otraFuncion'."))).toBe(false);
    expect(isMissingCatalogFunctionError(new Error("fetch failed"))).toBe(false);
    expect(isMissingCatalogFunctionError("Could not find public function for 'skins:listCatalogPublic'")).toBe(false);
  });
});

test.describe("countdownParts", () => {
  for (const days of [0, -2, 1, 5, 24]) {
    test(`${days} días: las piezas dicen lo mismo que formatCountdownMessage`, () => {
      const parts = countdownParts(days, "la Navidad");
      const text = parts.kind === "today" ? parts.text : `${parts.prefix} ${parts.number} ${parts.unit} ${parts.forLabel}`;
      expect(text).toBe(formatCountdownMessage(days, "la Navidad"));
    });
  }
});

test("swatchBackground: franjas iguales con las muestras persistidas (Alegre incluye la menta)", () => {
  const alegre = SKIN_CATALOG_2026.find((s) => s.key === "alegre")!;
  expect(swatchBackground({ id: "x", name: "Alegre", swatches: alegre.swatches })).toBe(
    "linear-gradient(90deg, #7b61ff 0.00% 25.00%, #ffd23f 25.00% 50.00%, #ff5a5f 50.00% 75.00%, #3ddc97 75.00% 100.00%)"
  );
  expect(swatchBackground({ id: "y", name: "Antiguo", background: "#123456" })).toBe("#123456");
});
