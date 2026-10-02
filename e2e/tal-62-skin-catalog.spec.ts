import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { KEPT_SKIN_KEYS, PALETTE_KEYS, SKIN_CATALOG_2026 } from "../convex/skinCatalog2026";
import { seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-62 (parte de Convex) — catálogo de 8 skins.
 * - Tests puros: los datos de sembrado coinciden EXACTAMENTE con el mockup
 *   (`design/propuesta-skins-modernos.html`), parseando su CSS y su array
 *   de muestras — no copiados a mano en el test.
 * - Contra Convex dev (tras `skins:seedSkinCatalog2026`): integridad del
 *   catálogo y barrera de escritura con las funciones públicas.
 */

const MOCKUP = readFileSync(path.resolve(__dirname, "..", "design", "propuesta-skins-modernos.html"), "utf8");
const CLASS_BY_KEY: Record<string, string> = {
  alegre: "s-alegre",
  "navidad-pop": "s-navidad",
  caramelo: "s-caramelo",
  noche: "s-noche",
  nieve: "s-nieve",
  minimal: "s-minimal",
  "tira-comica": "s-comic",
  rojiblanco: "s-rojiblanco",
};
const CSS_VAR_BY_PALETTE_KEY: Record<string, string> = {
  bg: "bg", ink: "ink", dim: "dim", line: "line", card: "card", cell: "cell", tile: "tile", tileInk: "accent",
  hero: "hero", heroInk: "hero-ink", heroNum: "hero-num", glow: "glow", today: "today", todayInk: "today-ink",
  todayShadow: "today-shadow", seenA: "seen-a", seenB: "seen-b", weekend: "weekend",
};

function mockupVars(cls: string): Record<string, string> {
  const block = MOCKUP.match(new RegExp(`\\.${cls} \\{([^}]*)\\}`))?.[1];
  if (!block) throw new Error(`No encuentro .${cls} en el mockup`);
  const vars: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
  return vars;
}

function mockupSwatches(name: string): string[] {
  const line = MOCKUP.split("\n").find((l) => l.includes(`name: '${name}'`));
  const sw = line?.match(/sw: \[([^\]]*)\]/)?.[1];
  if (!sw) throw new Error(`No encuentro las muestras de ${name}`);
  return [...sw.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

const norm = (v: string) => v.replace(/\s+/g, "").toLowerCase();

test.describe("datos de sembrado frente al mockup", () => {
  test("8 skins, en el orden del Design System, sortOrder 1..8 sin repetidos", () => {
    expect(SKIN_CATALOG_2026.map((s) => s.key)).toEqual(["alegre", "navidad-pop", "caramelo", "noche", "nieve", "minimal", "tira-comica", "rojiblanco"]);
    expect(SKIN_CATALOG_2026.map((s) => s.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(SKIN_CATALOG_2026.map((s) => s.key)).size).toBe(8);
  });

  for (const entry of SKIN_CATALOG_2026) {
    test(`${entry.name}: las 18 claves de la paleta son exactamente las del mockup`, () => {
      expect(Object.keys(entry.palette).sort()).toEqual([...PALETTE_KEYS].sort());
      const vars = mockupVars(CLASS_BY_KEY[entry.key]);
      for (const key of PALETTE_KEYS) {
        expect(norm(entry.palette[key]), `${entry.key}.${key}`).toBe(norm(vars[CSS_VAR_BY_PALETTE_KEY[key]]));
      }
    });

    test(`${entry.name}: muestras del selector = array 'sw' del mockup`, () => {
      expect(entry.swatches).toEqual(mockupSwatches(entry.name));
    });
  }

  test("Alegre incluye la menta #3ddc97 en sus muestras, aunque no esté en su paleta (por eso se guardan)", () => {
    const alegre = SKIN_CATALOG_2026.find((s) => s.key === "alegre")!;
    expect(alegre.swatches).toContain("#3ddc97");
    expect(Object.values(alegre.palette)).not.toContain("#3ddc97");
  });

  test("tratamientos solo en Tira Cómica (comic) y Rojiblanco (stripes-pill)", () => {
    const withTreatment = SKIN_CATALOG_2026.filter((s) => s.treatment).map((s) => [s.key, s.treatment]);
    expect(withTreatment).toEqual([
      ["tira-comica", "comic"],
      ["rojiblanco", "stripes-pill"],
    ]);
  });

  test("conservados = exactamente nieve, tira-comica y rojiblanco (decisión del PM)", () => {
    expect(SKIN_CATALOG_2026.filter((s) => s.keepsExistingRow).map((s) => s.key).sort()).toEqual([...KEPT_SKIN_KEYS].sort());
  });

  test("ninguna key ni nombre usa marcas, clubes ni ciudades", () => {
    const forbidden = /barcelona|madrid|atleti|athletic|sevilla|marvel|dc\b|disney|coca|real\b/i;
    for (const s of SKIN_CATALOG_2026) expect(`${s.key} ${s.name} ${s.description}`).not.toMatch(forbidden);
  });
});

test.describe("contra Convex dev (catálogo sembrado)", () => {
  test.describe.configure({ mode: "serial" });

  const runId = uniqueRunId();
  let actorId: Id<"users">;
  let calendarId: Id<"calendars">;

  test.beforeAll(async () => {
    actorId = await seedUser({ email: `e2e-tal62-actor-${runId}@example.com`, superAdmin: true });
  });

  test.afterAll(async () => {
    if (calendarId) {
      await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId, userId: actorId });
    }
  });

  test("listCatalogPublic: 8, en orden, un estilo por skin, swatches persistidos", async () => {
    const catalog = await convex.query(api.skins.listCatalogPublic, { serverSecret: serverSecret() });
    expect(catalog.map((c) => c.key)).toEqual(SKIN_CATALOG_2026.map((s) => s.key));
    expect(catalog.map((c) => c.sortOrder)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(catalog.map((c) => c._id)).size).toBe(8); // una fila de skinStyles por skinId
    for (const row of catalog) {
      const entry = SKIN_CATALOG_2026.find((s) => s.key === row.key)!;
      expect(row.palette).toEqual(entry.palette);
      expect(row.swatches).toEqual(entry.swatches);
      expect(row.treatment).toEqual(entry.treatment);
    }
  });

  test("una sola Nieve (key 'nieve'), ninguna 'nieve-2026'", async () => {
    const all = await convex.query(api.skins.listAllPublic, { serverSecret: serverSecret() });
    expect(all.filter((s) => s.key === "nieve")).toHaveLength(1);
    expect(all.filter((s) => s.name === "Nieve")).toHaveLength(1);
    expect(all.some((s) => s.key === "nieve-2026")).toBe(false);
  });

  test("un calendario nuevo nace con Alegre", async () => {
    calendarId = await convex.mutation(api.calendars.createCalendarPublic, {
      serverSecret: serverSecret(),
      userId: actorId,
      name: `TAL-62 e2e ${runId}`,
      coverTitle: `TAL-62 e2e ${runId}`,
      startDate: "2026-12-01",
      endDate: "2026-12-24",
      creationKey: `tal62-e2e-${runId}`,
    });
    const catalog = await convex.query(api.skins.listCatalogPublic, { serverSecret: serverSecret() });
    const cal = await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId });
    expect(cal!.skinId).toBe(catalog.find((c) => c.key === "alegre")!._id);
  });

  test("barrera: guardar un skin retirado deja Alegre; los conservados se guardan tal cual", async () => {
    const all = await convex.query(api.skins.listAllPublic, { serverSecret: serverSecret() });
    const catalog = await convex.query(api.skins.listCatalogPublic, { serverSecret: serverSecret() });
    const alegre = catalog.find((c) => c.key === "alegre")!._id;
    const retired = all.find((s) => !catalog.some((c) => c._id === s._id));
    const cal = (await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId }))!;
    const base = { serverSecret: serverSecret(), calendarId, name: cal.name, coverTitle: cal.coverTitle, startDate: cal.startDate, endDate: cal.endDate };
    if (retired) {
      await convex.mutation(api.calendars.updateCalendarPublic, { ...base, skinId: retired._id });
      expect((await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId }))!.skinId).toBe(alegre);
    } else {
      test.info().annotations.push({ type: "nota", description: "No quedan skins retirados en este deployment (ya borrados): la barrera se cubre en scripts/verify-tal62-skin-migration.mjs." });
    }
    for (const key of KEPT_SKIN_KEYS) {
      const kept = catalog.find((c) => c.key === key)!._id;
      await convex.mutation(api.calendars.updateCalendarPublic, { ...base, skinId: kept });
      expect((await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId }))!.skinId).toBe(kept);
    }
  });
});
