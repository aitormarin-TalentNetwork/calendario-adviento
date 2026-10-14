/**
 * TAL-85 — ¿se monta el harness de navegación de los E2E
 * (`src/components/e2e-router-harness.tsx`)? Solo si `E2E_ROUTER_HARNESS=1`
 * (la define ÚNICAMENTE el `webServer` de `playwright.config.ts`) y fuera de
 * producción: producción lo ignora aunque la variable esté definida. Mismo
 * patrón y misma doble guarda que `E2E_IMAGE_CHECK_STUB`
 * (`src/lib/image-checker.ts`, TAL-69). Lo decide el servidor en cada
 * petición (no es `NEXT_PUBLIC_*`, que se incrustaría en el bundle).
 */
export function shouldMountRouterHarness(env: Partial<Record<string, string | undefined>> = process.env): boolean {
  return env.E2E_ROUTER_HARNESS === "1" && env.NODE_ENV !== "production";
}
