import { expect, type Locator, type Page } from "@playwright/test";

/**
 * TAL-80 — abrir el menú de la cuenta sin carrera de hidratación. El
 * disparador llega en el HTML del servidor antes de que React lo hidrate; un
 * clic en esa ventana se "completa" (Playwright da «click action done») pero
 * no llega a `onClick` y el menú no se abre. `AccountMenu` marca el
 * disparador con `data-hydrated="true"` solo cuando ya está hidratado
 * (`src/components/account-menu.tsx`): se espera a esa señal explícita, no a
 * `networkidle`. Nunca `force: true`: forzar el clic se saltaría justo las
 * comprobaciones de accionabilidad que delatan un disparador tapado.
 */
export const accountMenuTrigger = (page: Page): Locator => page.getByRole("button", { name: "Menú de la cuenta" });
export const accountMenu = (page: Page): Locator => page.getByRole("menu", { name: "Menú de la cuenta" });

/** Espera a que el disparador esté hidratado (para abrir con teclado, p. ej. Enter). */
export async function waitAccountMenuReady(page: Page): Promise<Locator> {
  const trigger = accountMenuTrigger(page);
  await expect(trigger).toHaveAttribute("data-hydrated", "true");
  return trigger;
}

/** Espera la hidratación, hace clic y espera el menú. Devuelve el localizador del menú. */
export async function openAccountMenu(page: Page): Promise<Locator> {
  const trigger = await waitAccountMenuReady(page);
  await trigger.click();
  const menu = accountMenu(page);
  await expect(menu).toBeVisible();
  return menu;
}
