import { expect, test } from "@playwright/test";
import {
  ALL_COVER_ICON_NAMES,
  COVER_ICON_CATEGORIES,
  DEFAULT_COVER_ICON,
  FALLBACK_COVER_ICON,
  coverIconForWrite,
  isCoverIconName,
  normalizeCoverIcon,
} from "../convex/coverIconCatalog";
import { COVER_ICON_COMPONENTS } from "../src/lib/cover-icons";

/**
 * TAL-60 — tests puros (sin navegador) del catálogo Lucide y la
 * normalización de lectura/escritura. TAL-72 retiró la tabla de emojis
 * antiguos y el color del icono según el accent del skin: un emoji ya se
 * trata como cualquier valor fuera del catálogo. El contraste del icono
 * contra su recuadro lo cubre `tal61-estilo-base.spec.ts` (caso 4).
 */

test.describe("catálogo", () => {
  test("cada nombre tiene su componente Lucide y no hay duplicados", () => {
    expect(new Set(ALL_COVER_ICON_NAMES).size).toBe(ALL_COVER_ICON_NAMES.length);
    for (const name of ALL_COVER_ICON_NAMES) expect(COVER_ICON_COMPONENTS[name], name).toBeTruthy();
    expect(Object.keys(COVER_ICON_COMPONENTS).sort()).toEqual([...ALL_COVER_ICON_NAMES].sort());
  });

  test("todo nombre cabe en 16 caracteres (el backend anterior a TAL-60 lo acepta en un rollback)", () => {
    const tooLong = ALL_COVER_ICON_NAMES.filter((name) => name.length > 16);
    expect(tooLong).toEqual([]);
  });

  test("mismas 5 categorías, con 'Animales' tal como la definió el PM", () => {
    expect(COVER_ICON_CATEGORIES.map((c) => c.label)).toEqual(["Navidad", "Fiesta", "Cariño", "Naturaleza y cielo", "Animales"]);
    expect(COVER_ICON_CATEGORIES[4].icons.map((i) => i.name)).toEqual([
      "rabbit",
      "cat",
      "dog",
      "bird",
      "fish",
      "turtle",
      "squirrel",
      "paw-print",
    ]);
  });

  test("incluye los iconos que cita el Design System", () => {
    for (const name of ["tree-pine", "gift", "snowflake", "bell", "candy-cane", "star", "sparkles", "party-popper", "cake", "heart", "sun", "moon", "flower-2", "music", "camera", "plane", "baby", "dog"]) {
      expect(isCoverIconName(name), name).toBe(true);
    }
  });

  test("buscador en español: 'regalo', 'árbol' y 'perro'", () => {
    const search = (q: string) =>
      COVER_ICON_CATEGORIES.flatMap((c): readonly { name: string; searchTerms: string }[] => c.icons)
        .filter((i) => i.searchTerms.toLowerCase().includes(q))
        .map((i) => i.name);
    expect(search("regalo")).toEqual(["gift"]);
    expect(search("árbol")).toEqual(["tree-pine"]);
    expect(search("perro")).toEqual(["dog"]);
  });
});

test.describe("normalizeCoverIcon (lectura, nunca falla)", () => {
  test("nombre del catálogo → el mismo", () => {
    expect(normalizeCoverIcon("dog")).toBe("dog");
  });
  test("emoji del catálogo antiguo (con o sin U+FE0F) → regalo, como cualquier desconocido (TAL-72)", () => {
    expect(normalizeCoverIcon("❄️")).toBe(FALLBACK_COVER_ICON);
    expect(normalizeCoverIcon("❄")).toBe(FALLBACK_COVER_ICON);
    expect(normalizeCoverIcon("🎄")).toBe(FALLBACK_COVER_ICON);
  });
  test("ausente o vacío → árbol por defecto", () => {
    expect(normalizeCoverIcon(undefined)).toBe(DEFAULT_COVER_ICON);
    expect(normalizeCoverIcon(null)).toBe(DEFAULT_COVER_ICON);
    expect(normalizeCoverIcon("  ")).toBe(DEFAULT_COVER_ICON);
    expect(DEFAULT_COVER_ICON).toBe("tree-pine");
  });
  test("desconocido → regalo", () => {
    expect(normalizeCoverIcon("🚀")).toBe(FALLBACK_COVER_ICON);
    expect(normalizeCoverIcon("message-circle-heart")).toBe("gift");
    expect(FALLBACK_COVER_ICON).toBe("gift");
  });
});

test.describe("coverIconForWrite (escritura)", () => {
  test("nombre del catálogo → el mismo", () => {
    expect(coverIconForWrite("heart-handshake")).toBe("heart-handshake");
  });
  test("emoji del catálogo antiguo → null (se rechaza desde TAL-72)", () => {
    expect(coverIconForWrite("🎁")).toBeNull();
    expect(coverIconForWrite("❄️")).toBeNull();
    expect(coverIconForWrite("🎄")).toBeNull();
  });
  test("cualquier otra cosa → null (se rechaza)", () => {
    expect(coverIconForWrite("🚀")).toBeNull();
    expect(coverIconForWrite("")).toBeNull();
    expect(coverIconForWrite("<script>")).toBeNull();
  });
});
