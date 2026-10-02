import { expect, test } from "@playwright/test";
import { loginAsWithoutCallback } from "./helpers/auth";

/**
 * TAL-68 — aterrizaje con un «superadmin» guardado de alguien que YA NO es
 * Super Admin. Solo se ejecuta desde scripts/verify-tal68-stale-superadmin-mode.mjs,
 * que prepara a los dos usuarios con una mutation _scratch_ temporal (no hay
 * ninguna vía desplegada para quitar el rol) y pasa sus emails en TAL68_STALE.
 * En la suite normal se salta.
 */
const stale = process.env.TAL68_STALE ? (JSON.parse(process.env.TAL68_STALE) as { admin: string; guest: string }) : null;

test.describe("TAL-68 · «superadmin» guardado que ya no es válido", () => {
  test.skip(!stale, "solo desde scripts/verify-tal68-stale-superadmin-mode.mjs (TAL68_STALE)");

  test("ex Super Admin que administra un calendario → /admin, nunca /superadmin ni /unauthorized", async ({ page }) => {
    await loginAsWithoutCallback(page, stale!.admin);
    await page.waitForURL(/\/admin$/);
    expect(page.url()).not.toMatch(/superadmin|unauthorized/);
  });

  test("ex Super Admin sin calendarios que administrar → /c, nunca /superadmin ni /unauthorized", async ({ page }) => {
    await loginAsWithoutCallback(page, stale!.guest);
    await page.waitForURL(/\/c$/);
    expect(page.url()).not.toMatch(/superadmin|unauthorized/);
  });
});
