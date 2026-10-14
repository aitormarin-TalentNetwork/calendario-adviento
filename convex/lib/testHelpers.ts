// TAL-82 — barrera de las ayudas de test de Convex (TAL-67 y TAL-82).
//
// Módulo NEUTRAL a propósito: solo funciones puras, ninguna query, mutation
// ni action registrada (no despliega ningún endpoint). Lo importan las
// funciones de Convex que solo deben existir en dev y el test puro
// `e2e/tal82-test-helpers-guard.spec.ts`.
//
// Dos condiciones independientes, las dos obligatorias:
// 1. `ALLOW_TEST_HELPERS=1` en el entorno del deployment;
// 2. `CONVEX_CLOUD_URL` (variable de sistema que Convex expone a las
//    funciones) existe y su host NO es un deployment de producción.
// Si una variable de entorno se colara por error en producción, la segunda
// condición sigue cerrando. Falla cerrado: sin URL, o con una URL inválida,
// no se permite.

/**
 * Deployments de PRODUCCIÓN conocidos (slug de Convex). La misma lista que
 * `DENIED_PROD_SLUGS` de `scripts/e2e-regresion.mjs` (TAL-71); el test
 * `e2e/tal82-test-helpers-guard.spec.ts` comprueba que coinciden. Para añadir
 * uno: aquí y allí, con de qué proyecto es.
 */
export const PROD_DEPLOYMENT_SLUGS: readonly string[] = [
  "abundant-badger-144", // calendario-adviento (producción real, docs/stack.md)
  "standing-jellyfish-468", // calendario-adviento-t2
];

export type TestHelpersEnv = { ALLOW_TEST_HELPERS?: string; CONVEX_CLOUD_URL?: string };

/** `true` solo con `ALLOW_TEST_HELPERS=1` Y una URL de deployment válida que no sea de producción. */
export function testHelpersAllowedFor(env: TestHelpersEnv): boolean {
  if (env.ALLOW_TEST_HELPERS !== "1") return false;
  let host: string;
  try {
    host = new URL(env.CONVEX_CLOUD_URL ?? "").hostname;
  } catch {
    return false;
  }
  if (host === "") return false;
  return !PROD_DEPLOYMENT_SLUGS.some((slug) => host === slug || host.startsWith(`${slug}.`));
}

/** Primera instrucción de toda ayuda de test: lanza si no se cumplen las dos condiciones. */
export function assertTestHelpersAllowed(): void {
  if (!testHelpersAllowedFor({ ALLOW_TEST_HELPERS: process.env.ALLOW_TEST_HELPERS, CONVEX_CLOUD_URL: process.env.CONVEX_CLOUD_URL })) {
    throw new Error("Solo para tests en dev (ALLOW_TEST_HELPERS=1 y un deployment que no sea de producción).");
  }
}
