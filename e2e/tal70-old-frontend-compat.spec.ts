import { expect, test } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-70 — compatibilidad de la ventana real del despliegue: el Next
 * ANTERIOR (sin TAL-70) contra el Convex NUEVO, donde ya no existe
 * `calendars.getPublicCoverInfoForLogin`. Solo corre con `OLD_FRONTEND=1`,
 * copiado a un worktree de la base y con su Next en otro puerto (ver el
 * export). Comprueba que su `/login?callbackUrl=/c/<id>` responde 200 sin
 * errores (cae a su portada genérica de respaldo) y que entrar conserva el
 * `callbackUrl`.
 */
test.skip(process.env.OLD_FRONTEND !== "1", "Solo contra el Next anterior (OLD_FRONTEND=1).");
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const S_EMAIL = `e2e-tal70-oldfront-super-${runId}@example.com`;
const G_EMAIL = `e2e-tal70-oldfront-guest-${runId}@example.com`;
let sId: Id<"users">;
let calendarId: Id<"calendars">;

test.beforeAll(async () => {
  sId = await seedUser({ email: S_EMAIL, superAdmin: true });
  await seedUser({ email: G_EMAIL });
  calendarId = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: sId,
    name: "compat-tal70",
    coverTitle: "Portada que el login ya no enseña",
    coverImageUrl: "https://tal70-e2e.example.com/white.png",
    startDate: "2026-09-01",
    endDate: "2026-12-24",
    creationKey: `e2e-tal70-oldfront-${runId}`,
  });
  await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId, email: G_EMAIL });
});

test.afterAll(async () => {
  await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId, userId: sId });
});

test("el Convex nuevo ya no tiene la consulta pública del login", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- la función existe en el `api` del Next anterior, no en el Convex desplegado.
  const removed = (api.calendars as any).getPublicCoverInfoForLogin;
  await expect(convex.query(removed, { serverSecret: serverSecret(), calendarId })).rejects.toThrow(/Could not find public function/);
});

test("Next anterior: /login?callbackUrl=/c/<id> → 200, sin errores y sin la portada; entrar conserva el callbackUrl", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const response = await page.goto(`/login?callbackUrl=/c/${calendarId}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText("Portada que el login ya no enseña")).toHaveCount(0);
  const devForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Entrar (dev)" }) });
  await devForm.locator('input[name="email"]').fill(G_EMAIL);
  await devForm.getByRole("button", { name: "Entrar (dev)" }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${calendarId}$`));
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Portada que el login ya no enseña");
  expect(errors).toEqual([]);
});
