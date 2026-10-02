import { defineConfig, devices } from "@playwright/test";
import "./e2e/helpers/env";

/**
 * Tests end-to-end (TAL-57, primera tarea que introduce Playwright — ver
 * docs/e2e.md). Chromium propio de Playwright en headless: no usa el
 * Chrome compartido entre terminales, así que no necesita `.chrome-lock/`.
 *
 * Puerto: `E2E_PORT` (por defecto 3000, el de T1). Cada terminal usa el
 * suyo porque las URIs de callback OAuth dependen del puerto (T2 → 3001).
 * Si ya hay un `next dev` levantado en ese puerto se reutiliza; si no, lo
 * arranca Playwright.
 *
 * Un solo worker y sin paralelismo: los specs comparten el deployment de
 * Convex de desarrollo de la terminal y encadenan pasos (crear → nombrar
 * Admin → forzar → editar → borrar).
 */
const port = Number(process.env.E2E_PORT ?? 3000);
const baseURL = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // `next dev` compila cada ruta la primera vez que se visita.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev -p ${port}`,
    url: `${baseURL}/login`,
    reuseExistingServer: true,
    // TAL-69 — stub determinista del comprobador de URLs de imagen (sin red
    // en la suite). SOLO se define aquí; el código lo ignora en producción
    // (`selectImageChecker`, src/lib/image-checker.ts).
    env: { E2E_IMAGE_CHECK_STUB: "1" },
    timeout: 180_000,
  },
});
