import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page, type Request } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { loginAs, loginAsWithoutCallback, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-68 — opción «Super Admin» (→ /superadmin) en el menú de la cuenta,
 * solo para el Super Admin, y como modo recordado tras el login.
 *
 * Perfiles: SA (Super Admin), ADMIN (Admin de un calendario, no Super
 * Admin), GUEST (invitado puro). El caso del «superadmin» guardado de alguien
 * que ya no es Super Admin se prueba con scripts/verify-tal68-stale-superadmin-mode.mjs
 * (patrón _scratch_*), no aquí: no hay ninguna vía desplegada para quitar el rol.
 */
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const email = (role: string) => `e2e-tal68-${role}-${runId}@example.com`;
const SA_EMAIL = email("superadmin");
const ADMIN_EMAIL = email("admin");
const GUEST_EMAIL = email("guest");
const EVIDENCE_DIR = path.resolve(__dirname, "..", "docs", "evidence", "tal68");

let saId: Id<"users">;
let adminId: Id<"users">;
let calendarId: Id<"calendars">;
/** La petición real de «Super Admin» en el menú (caso 1), para reenviarla en el caso 5. */
let switchToSuperadmin: { url: string; headers: Record<string, string>; body: Buffer } | null = null;

const trigger = (page: Page) => page.getByRole("button", { name: "Menú de la cuenta" });
const menu = (page: Page) => page.getByRole("menu", { name: "Menú de la cuenta" });
const radio = (page: Page, name: string) => menu(page).getByRole("menuitemradio", { name, exact: true });

async function openMenu(page: Page) {
  await trigger(page).click();
  await expect(menu(page)).toBeVisible();
}

async function preferredModeOf(userId: Id<"users">): Promise<string | null> {
  const user = await convex.query(api.users.getByIdPublic, { serverSecret: serverSecret(), userId });
  return user?.preferredMode ?? null;
}

async function newPage(browser: Browser, opts: Parameters<Browser["newContext"]>[0] = {}): Promise<Page> {
  return await (await browser.newContext(opts)).newPage();
}

test.beforeAll(async () => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  saId = await seedUser({ email: SA_EMAIL, superAdmin: true });
  adminId = await seedUser({ email: ADMIN_EMAIL });
  await seedUser({ email: GUEST_EMAIL });
  calendarId = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: saId,
    name: `TAL-68 ${runId}`,
    coverTitle: `TAL-68 ${runId}`,
    startDate: "2026-12-01",
    endDate: "2026-12-24",
    creationKey: `e2e-tal68-${runId}`,
  });
  const added = await convex.mutation(api.superadmin.addAdminPublic, {
    serverSecret: serverSecret(),
    actorUserId: saId,
    calendarId,
    email: ADMIN_EMAIL,
  });
  expect(added).toMatchObject({ ok: true });
  await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId, email: GUEST_EMAIL });
});

test.afterAll(async () => {
  await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId, userId: saId });
});

test("1 · Super Admin: Usuario / Admin / Super Admin; «Super Admin» abre /superadmin y queda marcada", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAs(page, SA_EMAIL);
  await page.goto("/admin");
  await openMenu(page);
  await expect(menu(page).getByRole("menuitemradio")).toHaveText(["Usuario", "Admin", "Super Admin"]);
  await expect(radio(page, "Admin")).toHaveAttribute("aria-checked", "true");
  await expect(radio(page, "Super Admin")).toHaveAttribute("aria-checked", "false");

  const captured = page.waitForRequest((r: Request) => r.method() === "POST" && !!r.headers()["next-action"]);
  await radio(page, "Super Admin").click();
  const request = await captured;
  switchToSuperadmin = { url: request.url(), headers: await request.allHeaders(), body: request.postDataBuffer() ?? Buffer.alloc(0) };
  await page.waitForURL(/\/superadmin$/);
  expect(await preferredModeOf(saId)).toBe("superadmin");

  await openMenu(page);
  await expect(radio(page, "Super Admin")).toHaveAttribute("aria-checked", "true");
  await expect(radio(page, "Admin")).toHaveAttribute("aria-checked", "false");
  // En modo Super Admin no hay lista de calendarios (/superadmin ya los muestra).
  await expect(menu(page).getByText("Administrar")).toHaveCount(0);
  await expect(menu(page).getByText("Ir a calendario")).toHaveCount(0);
  await page.context().close();
});

test("2 · Admin normal: solo Usuario / Admin; invitado puro: sin sección Modo", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAs(page, ADMIN_EMAIL);
  await page.goto("/admin");
  await openMenu(page);
  await expect(menu(page).getByRole("menuitemradio")).toHaveText(["Usuario", "Admin"]);
  await expect(radio(page, "Super Admin")).toHaveCount(0);
  await page.context().close();

  const guest = await newPage(browser);
  await loginAs(guest, GUEST_EMAIL);
  await openMenu(guest);
  await expect(menu(guest).getByRole("menuitemradio")).toHaveCount(0);
  await expect(menu(guest).getByText("Modo")).toHaveCount(0);
  await guest.context().close();
});

test("3 · recordar el modo: Super Admin cierra sesión en /superadmin y vuelve ahí al entrar", async ({ browser }) => {
  expect(await preferredModeOf(saId)).toBe("superadmin");
  const page = await newPage(browser);
  await loginAsWithoutCallback(page, SA_EMAIL);
  await page.waitForURL(/\/superadmin$/);

  await openMenu(page);
  await menu(page).getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await page.waitForURL(/\/login/);
  await loginAsWithoutCallback(page, SA_EMAIL);
  await page.waitForURL(/\/superadmin$/);

  // Y al volver a Admin, recuerda Admin.
  await openMenu(page);
  await radio(page, "Admin").click();
  await page.waitForURL(/\/admin$/);
  await openMenu(page);
  await menu(page).getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await page.waitForURL(/\/login/);
  await loginAsWithoutCallback(page, SA_EMAIL);
  await page.waitForURL(/\/admin$/);
  await page.context().close();
});

test("4b · Convex rechaza guardar «superadmin» para quien no es Super Admin", async () => {
  await expect(
    convex.mutation(api.users.setPreferredModePublic, { serverSecret: serverSecret(), userId: adminId, mode: "superadmin" })
  ).rejects.toThrow(/No autorizado\./);
  expect(await preferredModeOf(adminId)).toBeNull();
});

test("5 · un Admin normal que fuerza la Server Action con «superadmin» acaba en su modo válido sin guardar nada", async ({ browser }) => {
  expect(switchToSuperadmin).not.toBeNull();
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAs(page, ADMIN_EMAIL);

  const original = await new Response(new Uint8Array(switchToSuperadmin!.body), {
    headers: { "content-type": switchToSuperadmin!.headers["content-type"] },
  }).formData();
  // Mismo formato que en TAL-57/59: argumentos en la entrada "0" (["$K<n>"]) y
  // campos del <form> con prefijo `_<n>_`.
  const args = JSON.parse(String(original.get("0") ?? "null"));
  const refs = (args as unknown[]).filter((a): a is string => typeof a === "string" && /^\$K\d+$/.test(a));
  expect(refs).toHaveLength(1);
  expect(original.getAll(`_${refs[0].slice(2)}_mode`)).toEqual(["superadmin"]);
  const replay = new FormData();
  for (const [key, value] of original.entries()) replay.append(key, value);

  const response = await context.request.post(switchToSuperadmin!.url, {
    headers: {
      "Next-Action": switchToSuperadmin!.headers["next-action"],
      "Next-Router-State-Tree": switchToSuperadmin!.headers["next-router-state-tree"],
      Accept: switchToSuperadmin!.headers["accept"] ?? "text/x-component",
      Origin: switchToSuperadmin!.headers["origin"],
    },
    multipart: replay,
    maxRedirects: 0,
  });
  const headers = response.headers();
  const target = (response.status() === 303 ? headers["location"] : headers["x-action-redirect"])?.split(";")[0];
  expect(target, `respuesta inesperada: ${response.status()} ${JSON.stringify(headers)}`).toBe("/start");
  expect(await preferredModeOf(adminId)).toBeNull();

  // Y /start lo lleva a su modo válido.
  await page.goto("/start");
  await page.waitForURL(/\/admin$/);
  await context.close();
});

for (const scheme of ["light", "dark"] as const) {
  test(`6 · 375px (${scheme === "light" ? "claro" : "oscuro"}): menú con las tres opciones dentro de pantalla, filas ≥ 44px`, async ({ browser }) => {
    const page = await newPage(browser, { viewport: { width: 375, height: 812 }, colorScheme: scheme });
    await loginAs(page, SA_EMAIL);
    await page.goto("/superadmin");
    await openMenu(page);
    await expect(menu(page).getByRole("menuitemradio")).toHaveCount(3);
    const box = (await menu(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    const items = menu(page).locator('[role="menuitem"], [role="menuitemradio"]');
    for (let i = 0; i < (await items.count()); i++) {
      expect((await items.nth(i).boundingBox())!.height, `fila ${i}`).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `menu-superadmin-375-${scheme}.png`) });
    await page.context().close();
  });
}
