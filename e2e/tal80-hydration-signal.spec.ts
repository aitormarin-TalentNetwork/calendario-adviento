import { expect, test } from "@playwright/test";
import { loginAs, seedUser, uniqueRunId } from "./helpers/auth";
import { accountMenuTrigger, openAccountMenu } from "./helpers/account-menu";

/**
 * TAL-80 — la señal `data-hydrated` del disparador del menú de la cuenta no
 * es trivial: el HTML del servidor NO la trae (con el JavaScript de la app
 * bloqueado, el botón existe pero sin el atributo) y aparece solo cuando
 * React ha hidratado el componente (con JavaScript, y entonces el clic abre
 * el menú).
 */
const runId = uniqueRunId();
const SA_EMAIL = `e2e-tal80-super-${runId}@example.com`;

test.beforeAll(async () => {
  await seedUser({ email: SA_EMAIL, superAdmin: true });
});

test("sin JavaScript de la app: el botón del SSR existe y NO tiene data-hydrated", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAs(page, SA_EMAIL);
  // A partir de aquí, ningún chunk de JavaScript de Next llega al navegador.
  await context.route("**/_next/static/chunks/**", (route) => route.abort());
  await page.goto("/superadmin");
  const trigger = accountMenuTrigger(page);
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-label", "Menú de la cuenta");
  // Margen para que, si algo hidratara, lo hiciera: no debe pasar.
  await page.waitForTimeout(2000);
  await expect(trigger).not.toHaveAttribute("data-hydrated", /.*/);
  await context.close();
});

test("con JavaScript: data-hydrated=true y el clic abre el menú", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await loginAs(page, SA_EMAIL);
  await page.goto("/superadmin");
  await expect(accountMenuTrigger(page)).toHaveAttribute("data-hydrated", "true");
  const menu = await openAccountMenu(page);
  await expect(menu.getByRole("menuitemradio")).toHaveCount(3);
  await page.context().close();
});
