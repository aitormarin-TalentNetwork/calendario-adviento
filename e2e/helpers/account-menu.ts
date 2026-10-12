import { expect, type Locator, type Page } from "@playwright/test";

/**
 * TAL-80 — abrir el menú de la cuenta con una barrera conservadora de
 * hidratación: se espera a `data-hydrated="true"` en el disparador
 * (`src/components/account-menu.tsx`, aparece en el render que sigue a la
 * hidratación, así que `onClick` ya está conectado) y solo entonces se hace
 * clic. Es una estabilización, NO una causa raíz demostrada: el caso 6 de
 * tal68 falló de forma intermitente (1/39 en el entorno de T3) con «click
 * action done» y sin menú; una carrera entre el clic y la hidratación es una
 * hipótesis plausible (sin la barrera, el clic llega solo 10–99 ms después de
 * la señal), pero ninguna traza ha capturado un fallo con el clic antes de la
 * señal. Señal explícita en vez de `networkidle`. Nunca `force: true`: forzar
 * el clic se saltaría las comprobaciones de accionabilidad que delatan un
 * disparador tapado.
 */
export const accountMenuTrigger = (page: Page): Locator => page.getByRole("button", { name: "Menú de la cuenta" });
export const accountMenu = (page: Page): Locator => page.getByRole("menu", { name: "Menú de la cuenta" });

/** Espera a que el disparador esté hidratado (para abrir con teclado, p. ej. Enter). */
export async function waitAccountMenuReady(page: Page): Promise<Locator> {
  const trigger = accountMenuTrigger(page);
  await expect(trigger).toHaveAttribute("data-hydrated", "true");
  return trigger;
}

/**
 * Medición SOLO para la evidencia de TAL-80 (`E2E_HYDRATION_TRACE=1`): antes
 * de navegar, instala en la página un observador que anota, con
 * `performance.now()` del documento, cuándo aparece `data-hydrated` y cuándo
 * llega el `pointerdown` del clic al disparador. `openAccountMenu` lo lee y
 * lo imprime («TAL80-TRACE {…}») junto al fin de `load` y al inicio de su espera.
 */
export async function installHydrationTrace(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const trace = { hydratedAt: null as number | null, clickAt: null as number | null };
    (window as unknown as { __tal80Trace: typeof trace }).__tal80Trace = trace;
    const selector = 'button[aria-label="Menú de la cuenta"]';
    const observer = new MutationObserver(() => {
      if (document.querySelector(`${selector}[data-hydrated="true"]`)) {
        trace.hydratedAt = performance.now();
        observer.disconnect(); // capturado: no hace falta seguir observando
      }
    });
    observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-hydrated"] });
    document.addEventListener(
      "pointerdown",
      (event) => {
        if (trace.clickAt === null && event.target instanceof Element && event.target.closest(selector)) trace.clickAt = performance.now();
      },
      true
    );
  });
}

/** Espera la hidratación, hace clic y espera el menú. Devuelve el localizador del menú. */
export async function openAccountMenu(page: Page): Promise<Locator> {
  const waitStart = await page.evaluate(() => performance.now());
  const trigger = await waitAccountMenuReady(page);
  await trigger.click();
  const menu = accountMenu(page);
  await expect(menu).toBeVisible();
  const trace = await page.evaluate(() => {
    const t = (window as unknown as { __tal80Trace?: { hydratedAt: number | null; clickAt: number | null } }).__tal80Trace;
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return t ? { loadEnd: nav?.loadEventEnd ?? null, hydratedAt: t.hydratedAt, clickAt: t.clickAt } : null;
  });
  if (trace) console.log(`TAL80-TRACE ${JSON.stringify({ ...trace, waitStart })}`);
  return menu;
}
