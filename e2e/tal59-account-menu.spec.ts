import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page, type Request } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { DEFAULT_COVER_ICON } from "../src/lib/cover-icons";
import { loginAs, loginAsWithoutCallback, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-59 — menú de la cuenta en el avatar (modo Usuario | Admin, saltar de
 * calendario, cerrar sesión) y recordar el último modo tras el login.
 *
 * Datos (sembrados por un Super Admin "actor", el único que puede crear
 * calendarios desde TAL-57):
 * - ADMIN (no Super Admin): administra A (☃️), B (🎁) y C (sin coverIcon →
 *   DEFAULT_COVER_ICON), e invitado a D. TAL-60: A y B son emojis del
 *   catálogo antiguo (los acepta la escritura tolerante) y el menú los pinta
 *   como su icono Lucide equivalente.
 * - GUEST_MANY: invitado puro a A y D. GUEST_ONE: invitado puro solo a D.
 * - ADMIN_ONE: administra solo E. SUPER_EMPTY: Super Admin sin memberships.
 */
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const email = (role: string) => `e2e-tal59-${role}-${runId}@example.com`;
const ACTOR_EMAIL = email("actor");
const ADMIN_EMAIL = email("admin");
const ADMIN_ONE_EMAIL = email("admin-one");
const GUEST_MANY_EMAIL = email("guest-many");
const GUEST_ONE_EMAIL = email("guest-one");
const SUPER_EMPTY_EMAIL = email("superadmin-empty");
const EVIDENCE_DIR = path.resolve(__dirname, "..", "docs", "evidence", "tal59");

const NAME = {
  A: `TAL-59 A ${runId}`,
  B: `TAL-59 B ${runId}`,
  C: `TAL-59 C ${runId}`,
  D: `TAL-59 D ${runId}`,
  E: `TAL-59 E ${runId}`,
};

let actorId: Id<"users">;
let adminId: Id<"users">;
let guestManyId: Id<"users">;
const cal = {} as Record<keyof typeof NAME, Id<"calendars">>;
const createdCalendarIds = new Set<Id<"calendars">>();

/** La petición real de "Admin" en el menú (caso 5), para reenviarla en el caso 7. */
let switchToAdminRequest: { url: string; headers: Record<string, string>; body: Buffer } | null = null;

async function createCalendar(key: keyof typeof NAME, coverIcon?: string): Promise<void> {
  // `coverTitle` = `name`: el menú pinta `name` en modo Admin y el título de
  // la tarjeta (`coverTitle`, TAL-58) en modo Usuario — así coinciden.
  const id = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: actorId,
    name: NAME[key],
    coverTitle: NAME[key],
    ...(coverIcon ? { coverIcon } : {}),
    startDate: "2026-12-01",
    endDate: "2026-12-24",
    creationKey: `e2e-tal59-${key}-${runId}`,
  });
  createdCalendarIds.add(id);
  cal[key] = id;
}

async function addAdmin(calendarId: Id<"calendars">, adminEmail: string): Promise<void> {
  const added = await convex.mutation(api.superadmin.addAdminPublic, {
    serverSecret: serverSecret(),
    actorUserId: actorId,
    calendarId,
    email: adminEmail,
  });
  expect(added).toMatchObject({ ok: true });
}

async function invite(calendarId: Id<"calendars">, guestEmail: string): Promise<void> {
  await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId, email: guestEmail });
}

async function preferredModeOf(userId: Id<"users">): Promise<string | null> {
  const user = await convex.query(api.users.getByIdPublic, { serverSecret: serverSecret(), userId });
  return user?.preferredMode ?? null;
}

async function newContext(browser: Browser, viewport?: { width: number; height: number }): Promise<BrowserContext> {
  return await browser.newContext(viewport ? { viewport } : {});
}

const trigger = (page: Page) => page.getByRole("button", { name: "Menú de la cuenta" });
const menu = (page: Page) => page.getByRole("menu", { name: "Menú de la cuenta" });

async function openMenu(page: Page): Promise<void> {
  await trigger(page).click();
  await expect(menu(page)).toBeVisible();
}

async function logoutFromMenu(page: Page): Promise<void> {
  await openMenu(page);
  await menu(page).getByRole("menuitem", { name: "Cerrar sesión" }).click();
  await page.waitForURL(/\/login/);
}

test.beforeAll(async () => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  actorId = await seedUser({ email: ACTOR_EMAIL, superAdmin: true });
  adminId = await seedUser({ email: ADMIN_EMAIL });
  guestManyId = await seedUser({ email: GUEST_MANY_EMAIL });
  await seedUser({ email: SUPER_EMPTY_EMAIL, superAdmin: true });

  await createCalendar("A", "☃️");
  await createCalendar("B", "🎁");
  await createCalendar("C"); // sin coverIcon → respaldo DEFAULT_COVER_ICON
  await createCalendar("D", "🦌");
  await createCalendar("E", "⭐");

  await addAdmin(cal.A, ADMIN_EMAIL);
  await addAdmin(cal.B, ADMIN_EMAIL);
  await addAdmin(cal.C, ADMIN_EMAIL);
  await invite(cal.D, ADMIN_EMAIL);
  await addAdmin(cal.E, ADMIN_ONE_EMAIL);

  await invite(cal.A, GUEST_MANY_EMAIL);
  await invite(cal.D, GUEST_MANY_EMAIL);
  await invite(cal.D, GUEST_ONE_EMAIL);
});

test.afterAll(async () => {
  // Limpieza: los calendarios del run. Los usuarios sembrados quedan como
  // residuo controlado (`e2e-tal59-*@example.com`), igual que TAL-57/58.
  const failures: string[] = [];
  for (const id of createdCalendarIds) {
    try {
      await convex.mutation(api.calendars.deleteCalendarAsUserPublic, {
        serverSecret: serverSecret(),
        calendarId: id,
        userId: actorId,
      });
    } catch (err) {
      failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  expect(failures, "calendarios de prueba sin limpiar").toEqual([]);
});

test("1 · Admin en /admin: solo la foto; menú con email, Modo Admin, lista «Administrar» con iconos y el actual marcado", async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await loginAs(page, ADMIN_EMAIL);
  await page.goto("/admin");

  // En la esquina ya no hay botón de cerrar sesión suelto.
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toHaveCount(0);
  await expect(menu(page)).toHaveCount(0);

  await openMenu(page);
  const m = menu(page);
  await expect(m.getByText(ADMIN_EMAIL)).toBeVisible();
  await expect(m.getByRole("menuitemradio", { name: "Admin" })).toHaveAttribute("aria-checked", "true");
  await expect(m.getByRole("menuitemradio", { name: "Usuario" })).toHaveAttribute("aria-checked", "false");
  await expect(m.getByText("Administrar")).toBeVisible();

  const rows = m.getByRole("menuitem").filter({ hasNotText: "Cerrar sesión" });
  await expect(rows).toHaveCount(3);
  // TAL-60 — el icono de cada fila es Lucide (`<CoverIcon>`), normalizado:
  // ☃️ → snowflake, 🎁 → gift, sin coverIcon → DEFAULT_COVER_ICON (tree-pine).
  for (const [key, icon] of [
    ["A", "snowflake"],
    ["B", "gift"],
    ["C", DEFAULT_COVER_ICON],
  ] as const) {
    const row = m.getByRole("menuitem", { name: NAME[key] });
    await expect(row).toHaveAttribute("href", `/admin/${cal[key]}`);
    await expect(row.locator(".account-menu-calendar-icon")).toHaveAttribute("data-cover-icon", icon);
    await expect(row.locator(".account-menu-calendar-icon svg.lucide")).toHaveAttribute("stroke", "currentColor");
  }
  // El invitado D no es de modo Admin.
  await expect(m.getByRole("menuitem", { name: NAME.D })).toHaveCount(0);

  await page.goto(`/admin/${cal.B}`);
  await openMenu(page);
  await expect(menu(page).getByRole("menuitem", { name: NAME.B })).toHaveAttribute("aria-current", "page");
  await expect(menu(page).getByRole("menuitem", { name: NAME.A })).not.toHaveAttribute("aria-current", /.*/);
  await page.context().close();
});

test("2 · teclado: Enter abre y enfoca el primer item, ↓ recorre, Escape devuelve el foco, Enter en una fila navega", async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await loginAs(page, ADMIN_EMAIL);
  await page.goto("/admin");

  await trigger(page).focus();
  await page.keyboard.press("Enter");
  await expect(menu(page)).toBeVisible();
  await expect(trigger(page)).toHaveAttribute("aria-expanded", "true");
  const items = menu(page).locator('[role="menuitem"], [role="menuitemradio"]');
  await expect(items.first()).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(items.last()).toBeFocused(); // en círculo

  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
  await expect(trigger(page)).toHaveAttribute("aria-expanded", "false");

  // ↓ abre en el primer item; se baja con ↓ hasta la fila de C (como mucho
  // una vuelta entera: 2 modos + 3 calendarios + cerrar sesión).
  await page.keyboard.press("ArrowDown");
  const row = menu(page).getByRole("menuitem", { name: NAME.C });
  for (let i = 0; i < 6 && !(await row.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("ArrowDown");
  }
  await expect(row).toBeFocused();
  await page.keyboard.press("Enter");
  await page.waitForURL(new RegExp(`/admin/${cal.C}$`));
  await page.context().close();
});

test("3 · pulsar fuera cierra el menú", async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await loginAs(page, ADMIN_EMAIL);
  await page.goto("/admin");
  await openMenu(page);
  await page.getByRole("heading", { name: "Mis calendarios" }).click();
  await expect(menu(page)).toHaveCount(0);
  await page.context().close();
});

test("4 · cambiar a Usuario → /c; «Ir a calendario» con todos y el actual marcado en /c/<id>", async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await loginAs(page, ADMIN_EMAIL);
  await page.goto("/admin");
  await openMenu(page);
  await menu(page).getByRole("menuitemradio", { name: "Usuario" }).click();
  await page.waitForURL(/\/c$/);
  expect(await preferredModeOf(adminId)).toBe("user");

  await openMenu(page);
  const m = menu(page);
  await expect(m.getByRole("menuitemradio", { name: "Usuario" })).toHaveAttribute("aria-checked", "true");
  await expect(m.getByText("Ir a calendario")).toBeVisible();
  for (const key of ["A", "B", "C", "D"] as const) {
    await expect(m.getByRole("menuitem", { name: NAME[key] })).toHaveAttribute("href", `/c/${cal[key]}`);
  }

  await m.getByRole("menuitem", { name: NAME.D }).click();
  await page.waitForURL(new RegExp(`/c/${cal.D}$`));
  await openMenu(page);
  await expect(menu(page).getByRole("menuitem", { name: NAME.D })).toHaveAttribute("aria-current", "page");
  await expect(menu(page).getByRole("menuitem", { name: NAME.A })).not.toHaveAttribute("aria-current", /.*/);
  await page.context().close();
});

test("5 · recordar el modo: Usuario → logout → login sin callback → /c; Admin → logout → login → /admin", async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  // El caso 4 dejó preferredMode = "user".
  await loginAsWithoutCallback(page, ADMIN_EMAIL);
  await page.waitForURL(/\/c$/);

  await logoutFromMenu(page);
  await page.goto("/admin");
  await page.waitForURL(/\/login/); // la sesión se cerró de verdad

  await loginAsWithoutCallback(page, ADMIN_EMAIL);
  await page.waitForURL(/\/c$/);

  // Cambiar a Admin (se captura la petición real para el caso 7).
  await openMenu(page);
  const captured = page.waitForRequest((r: Request) => r.method() === "POST" && !!r.headers()["next-action"]);
  await menu(page).getByRole("menuitemradio", { name: "Admin" }).click();
  const request = await captured;
  switchToAdminRequest = {
    url: request.url(),
    headers: await request.allHeaders(),
    body: request.postDataBuffer() ?? Buffer.alloc(0),
  };
  await page.waitForURL(/\/admin$/);
  expect(await preferredModeOf(adminId)).toBe("admin");

  await logoutFromMenu(page);
  await loginAsWithoutCallback(page, ADMIN_EMAIL);
  await page.waitForURL(/\/admin$/);
  await page.context().close();
});

test("6 · el link de invitación (callbackUrl) manda sobre el modo recordado", async ({ browser }) => {
  // Modo recordado: Admin (caso 5).
  expect(await preferredModeOf(adminId)).toBe("admin");
  const page = await (await newContext(browser)).newPage();
  await page.goto(`/c/${cal.D}`);
  await page.waitForURL(/\/login\?callbackUrl=/);
  const devForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Entrar (dev)" }) });
  await devForm.locator('input[name="email"]').fill(ADMIN_EMAIL);
  await devForm.getByRole("button", { name: "Entrar (dev)" }).click();
  await page.waitForURL(new RegExp(`/c/${cal.D}$`));
  await page.context().close();
});

test("7 · invitado puro: sin sección Modo; lista solo con >1; siempre modo Usuario; forzar «Admin» no hace nada", async ({ browser }) => {
  const context = await newContext(browser);
  const page = await context.newPage();
  await loginAsWithoutCallback(page, GUEST_MANY_EMAIL);
  await page.waitForURL(/\/c$/);

  await openMenu(page);
  const m = menu(page);
  await expect(m.getByText(GUEST_MANY_EMAIL)).toBeVisible();
  await expect(m.getByRole("menuitemradio")).toHaveCount(0);
  await expect(m.getByText("Modo")).toHaveCount(0);
  await expect(m.getByRole("menuitem", { name: NAME.A })).toHaveAttribute("href", `/c/${cal.A}`);
  await expect(m.getByRole("menuitem", { name: NAME.D })).toHaveAttribute("href", `/c/${cal.D}`);
  await expect(m.getByRole("menuitem", { name: "Cerrar sesión" })).toBeVisible();

  // Forzar la Server Action de cambio de modo con "admin": se reenvía tal
  // cual la petición real capturada en el caso 5 (mode=admin), con la
  // sesión de este invitado.
  expect(switchToAdminRequest).not.toBeNull();
  const original = await new Response(new Uint8Array(switchToAdminRequest!.body), {
    headers: { "content-type": switchToAdminRequest!.headers["content-type"] },
  }).formData();
  // Mismo formato que en TAL-57: React serializa los argumentos en la
  // entrada "0" (`["$K<n>"]`) y los campos del <form> van con prefijo
  // `_<n>_` (aquí `_1_mode`). El prefijo se deriva del payload, no se
  // supone; si no hay exactamente un `mode` con valor "admin", el test falla.
  const args = JSON.parse(String(original.get("0") ?? "null"));
  const refs = (args as unknown[]).filter((a): a is string => typeof a === "string" && /^\$K\d+$/.test(a));
  expect(refs).toHaveLength(1);
  expect(original.getAll(`_${refs[0].slice(2)}_mode`)).toEqual(["admin"]);
  const replay = new FormData();
  for (const [key, value] of original.entries()) replay.append(key, value);
  const response = await context.request.post(switchToAdminRequest!.url, {
    headers: {
      "Next-Action": switchToAdminRequest!.headers["next-action"],
      "Next-Router-State-Tree": switchToAdminRequest!.headers["next-router-state-tree"],
      Accept: switchToAdminRequest!.headers["accept"] ?? "text/x-component",
      Origin: switchToAdminRequest!.headers["origin"],
    },
    multipart: replay,
    maxRedirects: 0,
  });
  const headers = response.headers();
  const target = (response.status() === 303 ? headers["location"] : headers["x-action-redirect"])?.split(";")[0];
  // TAL-68 — un modo no permitido ya no va directo a /c: redirige a /start,
  // que aterriza en el modo válido (para un invitado puro, /c). Nada se guarda.
  expect(target, `respuesta inesperada: ${response.status()} ${JSON.stringify(headers)}`).toBe("/start");
  expect(await preferredModeOf(guestManyId)).toBeNull();
  await page.goto("/start");
  await page.waitForURL(/\/c$/);
  await context.close();

  // Con un solo calendario no hay lista (y /c lleva directo a ese calendario).
  const onePage = await (await newContext(browser)).newPage();
  await loginAsWithoutCallback(onePage, GUEST_ONE_EMAIL);
  await onePage.waitForURL(new RegExp(`/c/${cal.D}$`));
  await openMenu(onePage);
  await expect(menu(onePage).getByRole("menuitemradio")).toHaveCount(0);
  await expect(menu(onePage).getByRole("menuitem")).toHaveCount(1); // solo «Cerrar sesión»
  await onePage.context().close();
});

// TAL-64 cambió este caso a propósito: el Super Admin administra TODOS los
// calendarios, así que aunque no tenga memberships su lista "Administrar"
// incluye los del sistema (aquí, como mínimo, los de este run).
test("8 · Super Admin sin memberships: ve «Modo»; en modo Admin, «Administrar» con todos (TAL-64)", async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await loginAs(page, SUPER_EMPTY_EMAIL);
  await page.goto("/admin");
  await openMenu(page);
  // TAL-68 — el Super Admin ve también «Super Admin» (nombre exacto: «Admin» es subcadena).
  await expect(menu(page).getByRole("menuitemradio")).toHaveText(["Usuario", "Admin", "Super Admin"]);
  await expect(menu(page).getByRole("menuitemradio", { name: "Admin", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(menu(page).getByText("Administrar")).toBeVisible();
  for (const key of ["A", "B", "C", "D", "E"] as const) {
    await expect(menu(page).getByRole("menuitem", { name: NAME[key] })).toHaveAttribute("href", `/admin/${cal[key]}`);
  }
  await page.context().close();
});

test("9 · Admin con un solo calendario: en modo Admin, sin lista", async ({ browser }) => {
  const page = await (await newContext(browser)).newPage();
  await loginAs(page, ADMIN_ONE_EMAIL);
  await page.goto("/admin");
  await openMenu(page);
  await expect(menu(page).getByRole("menuitemradio")).toHaveCount(2);
  await expect(menu(page).getByText("Administrar")).toHaveCount(0);
  await expect(menu(page).getByRole("menuitem")).toHaveCount(1);
  await page.context().close();
});

test("10 · 375px: disparador ≥ 44×44, menú dentro de pantalla, filas ≥ 44px, sin scroll horizontal", async ({ browser }) => {
  for (const [label, path_] of [
    ["admin", "/admin"],
    ["usuario", `/c/${cal.D}`],
  ] as const) {
    const page = await (await newContext(browser, { width: 375, height: 812 })).newPage();
    await loginAs(page, ADMIN_EMAIL);
    await page.goto(path_);

    const triggerBox = await trigger(page).boundingBox();
    expect(triggerBox!.width).toBeGreaterThanOrEqual(44);
    expect(triggerBox!.height).toBeGreaterThanOrEqual(44);

    await openMenu(page);
    const box = await menu(page).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);

    const items = menu(page).locator('[role="menuitem"], [role="menuitemradio"]');
    const count = await items.count();
    expect(count).toBeGreaterThan(2);
    for (let i = 0; i < count; i++) {
      const itemBox = await items.nth(i).boundingBox();
      expect(itemBox!.height, `item ${i}`).toBeGreaterThanOrEqual(44);
    }

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.clientWidth);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `menu-375-${label}.png`) });
    await page.context().close();
  }
});
