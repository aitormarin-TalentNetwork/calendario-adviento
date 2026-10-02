import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { loginAs, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-64 — el Super Admin ve y administra TODOS los calendarios: en "Mis
 * calendarios" (/admin, con la etiqueta "Super Admin" en los que no
 * administra por membership), desde las tarjetas de /superadmin y en la
 * lista "Administrar" del menú de la cuenta. Un Admin normal no cambia.
 *
 * Datos: ACTOR (Super Admin) crea OTHER_1 y OTHER_2 (ajenos para SA_TEST);
 * SA_TEST (Super Admin) crea OWN (queda ADMIN por membership); ADMIN (no
 * Super Admin) es ADMIN solo de ADMIN_CAL. El deployment de dev tiene más
 * calendarios: para el Super Admin se comprueba inclusión; para el Admin
 * normal, la lista exacta.
 */
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const email = (role: string) => `e2e-tal64-${role}-${runId}@example.com`;
const ACTOR_EMAIL = email("actor");
const SA_EMAIL = email("superadmin");
const ADMIN_EMAIL = email("admin");
const INVITED_EMAIL = email("invited");
const EVIDENCE_DIR = path.resolve(__dirname, "..", "docs", "evidence", "tal64");

const NAME = {
  OWN: `TAL-64 propio ${runId}`,
  OTHER_1: `TAL-64 ajeno 1 ${runId}`,
  OTHER_2: `TAL-64 ajeno 2 ${runId}`,
  ADMIN_CAL: `TAL-64 del admin ${runId}`,
};

let actorId: Id<"users">;
let saId: Id<"users">;
let adminId: Id<"users">;
const cal = {} as Record<keyof typeof NAME, Id<"calendars">>;
const createdCalendarIds = new Set<Id<"calendars">>();

async function createCalendar(key: keyof typeof NAME, creator: Id<"users">): Promise<void> {
  const id = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: creator,
    name: NAME[key],
    coverTitle: NAME[key],
    startDate: "2026-12-01",
    endDate: "2026-12-03",
    creationKey: `e2e-tal64-${key}-${runId}`,
  });
  createdCalendarIds.add(id);
  cal[key] = id;
}

async function getCalendar(calendarId: Id<"calendars">) {
  return await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId });
}

async function newPageAs(browser: Browser, userEmail: string, viewport?: { width: number; height: number }): Promise<Page> {
  const page = await (await browser.newContext(viewport ? { viewport } : {})).newPage();
  await loginAs(page, userEmail);
  return page;
}

/** Fila de la tabla de "Mis calendarios" de un calendario concreto. */
const adminRow = (page: Page, name: string) => page.getByRole("row").filter({ has: page.getByRole("link", { name }) });

test.beforeAll(async () => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  actorId = await seedUser({ email: ACTOR_EMAIL, superAdmin: true });
  saId = await seedUser({ email: SA_EMAIL, superAdmin: true });
  adminId = await seedUser({ email: ADMIN_EMAIL });

  await createCalendar("OTHER_1", actorId);
  await createCalendar("OTHER_2", actorId);
  await createCalendar("OWN", saId);
  await createCalendar("ADMIN_CAL", actorId);
  const added = await convex.mutation(api.superadmin.addAdminPublic, {
    serverSecret: serverSecret(),
    actorUserId: actorId,
    calendarId: cal.ADMIN_CAL,
    email: ADMIN_EMAIL,
  });
  expect(added).toMatchObject({ ok: true });
});

test.afterAll(async () => {
  // Limpieza: calendarios del run (los usuarios quedan como residuo
  // controlado, `e2e-tal64-*@example.com`, igual que TAL-57/58/59).
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

test("1 · Super Admin en /admin: ve también los ajenos, con la etiqueta «Super Admin»; el propio sin ella", async ({ browser }) => {
  const page = await newPageAs(browser, SA_EMAIL);
  await page.goto("/admin");

  for (const key of ["OTHER_1", "OTHER_2", "ADMIN_CAL"] as const) {
    const row = adminRow(page, NAME[key]);
    await expect(row.getByRole("link", { name: NAME[key] })).toHaveAttribute("href", `/admin/${cal[key]}`);
    await expect(row.getByText("Super Admin", { exact: true })).toBeVisible();
  }
  const own = adminRow(page, NAME.OWN);
  await expect(own.getByRole("link", { name: NAME.OWN })).toHaveAttribute("href", `/admin/${cal.OWN}`);
  await expect(own.getByText("Super Admin", { exact: true })).toHaveCount(0);
  await page.context().close();
});

test("2 · Super Admin administra un ajeno sin membership: edita, invita, guarda un día y borra otro", async ({ browser }) => {
  const page = await newPageAs(browser, SA_EMAIL);

  // Editar (abre el editor desde "Mis calendarios").
  await page.goto("/admin");
  await adminRow(page, NAME.OTHER_1).getByRole("link", { name: NAME.OTHER_1 }).click();
  await page.waitForURL(new RegExp(`/admin/${cal.OTHER_1}$`));
  const renamed = `TAL-64 ajeno 1 editado ${runId}`;
  await page.locator("#calendar-name").fill(renamed);
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect.poll(async () => (await getCalendar(cal.OTHER_1))?.name).toBe(renamed);
  await page.reload();
  await expect(page.locator("#calendar-name")).toHaveValue(renamed);
  NAME.OTHER_1 = renamed;

  // Invitar.
  await page.getByPlaceholder("email@ejemplo.com").fill(INVITED_EMAIL);
  await page.getByRole("button", { name: "Invitar ahora" }).click();
  await expect(page.getByRole("cell", { name: INVITED_EMAIL })).toBeVisible();

  // Guardar un día con vídeo.
  const emptyDay = page.locator('button[aria-label$=" — sin vídeo"]').first();
  const dayLabel = (await emptyDay.getAttribute("aria-label"))!.replace(" — sin vídeo", "");
  await emptyDay.click();
  const dialog = page.getByRole("dialog", { name: `Editar día — ${dayLabel}` });
  await dialog.locator('input[name="videoUrl"]').fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  await dialog.getByRole("button", { name: "Guardar día" }).click();
  await expect(page.getByRole("button", { name: `${dayLabel} — vídeo asignado` })).toBeVisible();

  // Borrar otro ajeno.
  await page.goto(`/admin/${cal.OTHER_2}`);
  await page.getByRole("button", { name: "Eliminar calendario" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sí, eliminar calendario" }).click();
  await page.waitForURL(/\/admin$/);
  await expect(page.getByRole("link", { name: NAME.OTHER_2 })).toHaveCount(0);
  expect(await getCalendar(cal.OTHER_2)).toBeNull();
  createdCalendarIds.delete(cal.OTHER_2);
  await page.context().close();
});

test("3 · /superadmin: la tarjeta de un calendario abre su editor", async ({ browser }) => {
  const page = await newPageAs(browser, SA_EMAIL);
  await page.goto("/superadmin");
  const card = page.getByRole("link", { name: new RegExp(NAME.ADMIN_CAL) });
  await expect(card).toHaveAttribute("href", `/admin/${cal.ADMIN_CAL}`);
  await card.click();
  await page.waitForURL(new RegExp(`/admin/${cal.ADMIN_CAL}$`));
  await expect(page.getByRole("heading", { name: "Editar calendario" })).toBeVisible();
  await page.context().close();
});

test("4 · menú de la cuenta del Super Admin: «Administrar» incluye los ajenos y el propio", async ({ browser }) => {
  const page = await newPageAs(browser, SA_EMAIL);
  await page.goto("/admin");
  await page.getByRole("button", { name: "Menú de la cuenta" }).click();
  const menu = page.getByRole("menu", { name: "Menú de la cuenta" });
  await expect(menu.getByText("Administrar")).toBeVisible();
  for (const key of ["OWN", "OTHER_1", "ADMIN_CAL"] as const) {
    await expect(menu.getByRole("menuitem", { name: NAME[key] })).toHaveAttribute("href", `/admin/${cal[key]}`);
  }
  await page.context().close();
});

test("5 · Admin normal: solo los suyos, sin etiqueta; un ajeno sigue dando /unauthorized", async ({ browser }) => {
  const page = await newPageAs(browser, ADMIN_EMAIL);
  await page.goto("/admin");
  const links = page.getByRole("table").getByRole("link");
  await expect(links).toHaveCount(1);
  await expect(links.first()).toHaveText(NAME.ADMIN_CAL);
  await expect(page.getByText("Super Admin", { exact: true })).toHaveCount(0);

  // Con un solo calendario, el menú no muestra la lista.
  await page.getByRole("button", { name: "Menú de la cuenta" }).click();
  await expect(page.getByRole("menu", { name: "Menú de la cuenta" }).getByText("Administrar")).toHaveCount(0);

  await page.goto(`/admin/${cal.OTHER_1}`);
  await page.waitForURL(/\/unauthorized/);
  await page.context().close();
});

test("6 · la lista sale del servidor según el rol, no del cliente", async () => {
  const forAdmin = await convex.query(api.calendars.listCalendarsForUserPublic, {
    serverSecret: serverSecret(),
    userId: adminId,
  });
  expect(forAdmin.map((c) => c._id)).toEqual([cal.ADMIN_CAL]);
  expect(forAdmin.every((c) => c.isAdminMember)).toBe(true);

  const forSuperAdmin = await convex.query(api.calendars.listCalendarsForUserPublic, {
    serverSecret: serverSecret(),
    userId: saId,
  });
  const byId = new Map(forSuperAdmin.map((c) => [c._id, c]));
  expect(byId.get(cal.OWN)?.isAdminMember).toBe(true);
  expect(byId.get(cal.OTHER_1)?.isAdminMember).toBe(false);
  expect(byId.get(cal.ADMIN_CAL)?.isAdminMember).toBe(false);
});

test("7 · 375px: /admin y /superadmin sin scroll horizontal; menú dentro de pantalla", async ({ browser }) => {
  const page = await newPageAs(browser, SA_EMAIL, { width: 375, height: 812 });
  for (const [label, route] of [
    ["admin", "/admin"],
    ["superadmin", "/superadmin"],
  ] as const) {
    await page.goto(route);
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth, `${label}: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.clientWidth);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `${label}-375.png`), fullPage: true });
  }

  await page.goto("/admin");
  await page.getByRole("button", { name: "Menú de la cuenta" }).click();
  const box = await page.getByRole("menu", { name: "Menú de la cuenta" }).boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  expect(box!.y + box!.height).toBeLessThanOrEqual(812);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "menu-375.png") });
  await page.context().close();
});
