import { expect, test } from "@playwright/test";
import {
  ALL_COVER_ICON_NAMES,
  COVER_ICON_CATEGORIES,
  DEFAULT_COVER_ICON,
  FALLBACK_COVER_ICON,
  LEGACY_EMOJI_TO_COVER_ICON,
  coverIconForWrite,
  isCoverIconName,
  normalizeCoverIcon,
} from "../convex/coverIconCatalog";
import { ICON_TILE_BG, contrastRatio, resolveCoverIconColors } from "../src/lib/cover-icon-colors";
import { COVER_ICON_COMPONENTS } from "../src/lib/cover-icons";

/**
 * TAL-60 — tests puros (sin navegador) del catálogo Lucide, la tabla de
 * emojis antiguos, la normalización de lectura/escritura y el color del
 * icono (contraste ≥ 3:1).
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

test.describe("tabla de emojis antiguos", () => {
  test("los 45 emojis del catálogo de TAL-23 dan un nombre válido", () => {
    const entries = Object.entries(LEGACY_EMOJI_TO_COVER_ICON);
    expect(entries).toHaveLength(45);
    for (const [emoji, name] of entries) expect(isCoverIconName(name), `${emoji} → ${name}`).toBe(true);
  });

  test("ajustes del PM: 🦊🐻🦌 → paw-print, 🦄 → sparkles, 🦋 → flower-2, 🧑‍🎄 → gift (+ 🐼 → paw-print)", () => {
    expect(normalizeCoverIcon("🦊")).toBe("paw-print");
    expect(normalizeCoverIcon("🐻")).toBe("paw-print");
    expect(normalizeCoverIcon("🦌")).toBe("paw-print");
    expect(normalizeCoverIcon("🦄")).toBe("sparkles");
    expect(normalizeCoverIcon("🦋")).toBe("flower-2");
    expect(normalizeCoverIcon("🧑‍🎄")).toBe("gift");
    expect(normalizeCoverIcon("🐼")).toBe("paw-print");
  });
});

test.describe("normalizeCoverIcon (lectura, nunca falla)", () => {
  test("nombre del catálogo → el mismo", () => {
    expect(normalizeCoverIcon("dog")).toBe("dog");
  });
  test("emoji con y sin U+FE0F → su equivalente", () => {
    expect(normalizeCoverIcon("❄️")).toBe("snowflake");
    expect(normalizeCoverIcon("❄")).toBe("snowflake");
    expect(normalizeCoverIcon("☀️")).toBe("sun");
    expect(normalizeCoverIcon("🎄")).toBe("tree-pine");
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
  test("emoji antiguo → el MISMO emoji, sin convertir (compatibilidad con el Next antiguo)", () => {
    expect(coverIconForWrite("🎁")).toBe("🎁");
    expect(coverIconForWrite("❄️")).toBe("❄️");
  });
  test("cualquier otra cosa → null (se rechaza)", () => {
    expect(coverIconForWrite("🚀")).toBeNull();
    expect(coverIconForWrite("")).toBeNull();
    expect(coverIconForWrite("<script>")).toBeNull();
  });
});

test.describe("resolveCoverIconColors (contraste ≥ 3:1 contra el recuadro)", () => {
  test("accent con contraste suficiente en un tema → se usa en ese tema", () => {
    // #8c2f39 sobre #e6e0ff ≈ 6,4:1 (sí en claro); sobre #2a2645 ≈ 1,7:1 (no en oscuro).
    expect(resolveCoverIconColors("#8c2f39")).toEqual({ light: "#8c2f39", dark: null });
  });
  test("accent sin contraste en un tema → null (cae al token --icon-tile-fg)", () => {
    // #ffd23f: claro ≈ 1,3:1 (no) · oscuro ≈ 10:1 (sí).
    expect(resolveCoverIconColors("#ffd23f")).toEqual({ light: null, dark: "#ffd23f" });
  });
  test("accent no hex (respaldo var(--gold)) o ausente → null en los dos temas", () => {
    expect(resolveCoverIconColors("var(--gold)")).toEqual({ light: null, dark: null });
    expect(resolveCoverIconColors(null)).toEqual({ light: null, dark: null });
  });
  test("el token definitivo de TAL-61 (--primary) cumple 3:1 contra --icon-tile-bg", () => {
    expect(contrastRatio("#7b61ff", ICON_TILE_BG.light)!).toBeGreaterThanOrEqual(3);
    expect(contrastRatio("#8f7bff", ICON_TILE_BG.dark)!).toBeGreaterThanOrEqual(3);
  });
});
