import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PROD_DEPLOYMENT_SLUGS, testHelpersAllowedFor } from "../convex/lib/testHelpers";

/**
 * TAL-82 — barrera de las ayudas de test de Convex (`convex/lib/testHelpers.ts`),
 * sin navegador:
 * 1. tabla de casos: solo `ALLOW_TEST_HELPERS=1` + URL válida que NO sea de
 *    producción abre; todo lo demás cierra (también la variable activa con la
 *    URL de producción);
 * 2. la denylist coincide con la de `scripts/e2e-regresion.mjs` (TAL-71);
 * 3. estático: toda ayuda `*ForTests` y todo handler que acepte `testScope`
 *    pasa por la barrera antes de tocar `ctx`, y no queda ninguna barrera
 *    local suelta.
 */
const ROOT = path.resolve(__dirname, "..");
const DEV = "https://beloved-barracuda-617.convex.cloud";

test("tabla de casos de testHelpersAllowedFor", () => {
  const cases: [string, { ALLOW_TEST_HELPERS?: string; CONVEX_CLOUD_URL?: string }, boolean][] = [
    ["dev con la variable", { ALLOW_TEST_HELPERS: "1", CONVEX_CLOUD_URL: DEV }, true],
    ["variable ausente", { CONVEX_CLOUD_URL: DEV }, false],
    ["variable distinta de «1»", { ALLOW_TEST_HELPERS: "true", CONVEX_CLOUD_URL: DEV }, false],
    ["variable activa + URL de PRODUCCIÓN", { ALLOW_TEST_HELPERS: "1", CONVEX_CLOUD_URL: "https://abundant-badger-144.convex.cloud" }, false],
    ["variable activa + segundo host de la denylist", { ALLOW_TEST_HELPERS: "1", CONVEX_CLOUD_URL: "https://standing-jellyfish-468.convex.cloud" }, false],
    ["URL ausente", { ALLOW_TEST_HELPERS: "1" }, false],
    ["URL inválida", { ALLOW_TEST_HELPERS: "1", CONVEX_CLOUD_URL: "no-es-url" }, false],
  ];
  for (const [name, env, expected] of cases) expect(testHelpersAllowedFor(env), name).toBe(expected);
});

test("la denylist de producción coincide con la de scripts/e2e-regresion.mjs", () => {
  const source = readFileSync(path.join(ROOT, "scripts", "e2e-regresion.mjs"), "utf8");
  const block = /const DENIED_PROD_SLUGS = \[([\s\S]*?)\];/.exec(source)![1];
  const slugs = [...block.matchAll(/^\s*"([^"]+)"/gm)].map((m) => m[1]);
  expect(slugs).toEqual([...PROD_DEPLOYMENT_SLUGS]);
});

test("estático: barrera antes de cualquier ctx en ayudas *ForTests y handlers con testScope; sin barreras locales", () => {
  const files = ["convex/skins.ts", "convex/skinMigration.ts", "convex/calendars.ts", "convex/dayFiles.ts", "convex/testHelpers.ts"];
  for (const file of files) {
    const source = readFileSync(path.join(ROOT, file), "utf8");
    expect(source, `${file}: ninguna barrera local`).not.toMatch(/function testHelpersAllowed\b/);
    for (const m of source.matchAll(/export const (\w+) = internal(?:Query|Mutation|Action)\(\{([\s\S]*?)\n\}\);/g)) {
      const [, name, body] = m;
      const needs = name.endsWith("ForTests") || /testScope/.test(body.split("handler:")[0]);
      if (!needs) continue;
      const handler = body.slice(body.indexOf("handler:"));
      const guard = handler.search(/assertTestHelpersAllowed\(\)|checkTestScope\(/);
      const firstCtx = handler.search(/ctx\.(db|run\w*|storage)/);
      expect(guard, `${file}:${name} pasa por la barrera`).toBeGreaterThanOrEqual(0);
      if (firstCtx >= 0) expect(guard, `${file}:${name}: barrera antes del primer ctx`).toBeLessThan(firstCtx);
    }
  }
  // `checkTestScope` delega en la barrera para cualquier alcance.
  const skins = readFileSync(path.join(ROOT, "convex/skins.ts"), "utf8");
  expect(skins).toMatch(/export function checkTestScope\(scope: TestScope\): void \{\n  if \(scope === undefined\) return;\n  assertTestHelpersAllowed\(\);/);
});
