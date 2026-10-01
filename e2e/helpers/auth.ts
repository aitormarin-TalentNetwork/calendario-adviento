import { expect, type Page } from "@playwright/test";
import type { Id } from "../../convex/_generated/dataModel";
import { api, convex, serverSecret } from "./convex";

/**
 * Crea (o recupera) el usuario en Convex antes de que inicie sesión.
 * `isSuperAdminOnCreate` solo se aplica al CREAR (`convex/users.ts`): el
 * login posterior por `dev-login` no lo toca, así que el rol queda fijado
 * aquí. Usar emails únicos por ejecución para no reutilizar usuarios con
 * otro rol de una ejecución anterior.
 */
export async function seedUser(opts: { email: string; superAdmin?: boolean }): Promise<Id<"users">> {
  return await convex.mutation(api.users.upsertUserOnLoginPublic, {
    serverSecret: serverSecret(),
    email: opts.email,
    isSuperAdminOnCreate: opts.superAdmin ?? false,
  });
}

/**
 * Inicia sesión por el proveedor `dev-login` (`src/lib/auth.config.ts`,
 * requiere `AUTH_DEV_LOGIN=true` y nunca existe en producción). La cookie
 * de sesión queda en el contexto del navegador de `page`, así que
 * `page.context().request` también va autenticado.
 */
export async function loginAs(page: Page, email: string): Promise<void> {
  await page.goto("/login?callbackUrl=/admin");
  const devForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Entrar (dev)" }) });
  await devForm.locator('input[name="email"]').fill(email);
  await devForm.getByRole("button", { name: "Entrar (dev)" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** Sufijo único por ejecución para emails y nombres de datos de prueba. */
export function uniqueRunId(): string {
  return `${Date.now()}-${process.pid}`;
}

/**
 * TAL-58 — igual que `loginAs`, pero entrando por `/login` a secas, sin
 * `callbackUrl`: es el contrato de "aterrizaje tras login" (destino por
 * defecto `/admin`, que reparte a modo Usuario a quien no administra nada).
 * `loginAs` fija `callbackUrl=/admin` y no prueba ese caso.
 */
export async function loginAsWithoutCallback(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  const devForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Entrar (dev)" }) });
  await devForm.locator('input[name="email"]').fill(email);
  await devForm.getByRole("button", { name: "Entrar (dev)" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}
