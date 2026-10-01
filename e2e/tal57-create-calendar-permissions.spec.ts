import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type BrowserContext } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { loginAs, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-57 — solo el Super Admin puede crear calendarios.
 *
 * Los pasos van encadenados (modo serial): el Super Admin crea un
 * calendario por la UI (y de paso se captura la petición real de la
 * Server Action), lo administra un Admin que no es Super Admin, ese Admin
 * intenta crear por todas las vías (UI, Server Action forzada, Convex
 * directo) y sigue pudiendo editar y borrar lo suyo.
 */
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const SUPER_ADMIN_EMAIL = `e2e-tal57-superadmin-${runId}@example.com`;
const ADMIN_EMAIL = `e2e-tal57-admin-${runId}@example.com`;
const EVIDENCE_DIR = path.resolve(__dirname, "..", "docs", "evidence", "tal57");

let superAdminId: Id<"users">;
let adminId: Id<"users">;
let superAdminContext: BrowserContext;
let adminContext: BrowserContext;

let calendarId: Id<"calendars">;
let calendarName = `TAL-57 e2e ${runId}`;
const createdCalendarIds = new Set<Id<"calendars">>();

/** La petición real de "+ Nuevo calendario" tal como la mandó el navegador. */
let captured: { url: string; headers: Record<string, string>; body: Buffer };

test.beforeAll(async ({ browser }) => {
  superAdminId = await seedUser({ email: SUPER_ADMIN_EMAIL, superAdmin: true });
  adminId = await seedUser({ email: ADMIN_EMAIL });

  superAdminContext = await browser.newContext();
  adminContext = await browser.newContext();
  await loginAs(await superAdminContext.newPage(), SUPER_ADMIN_EMAIL);
  await loginAs(await adminContext.newPage(), ADMIN_EMAIL);
});

test.afterAll(async () => {
  // Limpieza: todos los calendarios creados en esta ejecución. Los usuarios
  // sembrados se quedan (no hay mutation pública para borrar usuarios); son
  // `e2e-tal57-*@example.com`, sin calendarios ni memberships tras esto.
  // Cada borrado por separado: que uno falle no deja huérfanos los demás.
  const failures: string[] = [];
  for (const id of createdCalendarIds) {
    try {
      await convex.mutation(api.calendars.deleteCalendarAsUserPublic, {
        serverSecret: serverSecret(),
        calendarId: id,
        userId: superAdminId,
      });
    } catch (err) {
      failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await superAdminContext?.close();
  await adminContext?.close();
  expect(failures, "calendarios de prueba sin limpiar").toEqual([]);
});

async function allCalendarNames(): Promise<string[]> {
  const calendars = await convex.query(api.superadmin.listCalendarsWithStatsPublic, {
    serverSecret: serverSecret(),
    actorUserId: superAdminId,
    now: new Date().toISOString().slice(0, 10),
  });
  return calendars.map((c) => c.name);
}

async function adminCalendarIds(): Promise<string[]> {
  const calendars = await convex.query(api.calendars.listCalendarsForUserPublic, {
    serverSecret: serverSecret(),
    userId: adminId,
  });
  return calendars.map((c) => c._id);
}

/**
 * Reenvía la petición capturada de la Server Action con la sesión de
 * `context`, cambiando SOLO `name` y `creationKey`. El cuerpo se parsea
 * como multipart (no se edita como texto) y se reconstruye un `FormData`
 * con TODAS sus entradas en el mismo orden — las `$ACTION_*` intactas.
 */
async function forceCreateAction(context: BrowserContext, name: string, creationKey: string): Promise<APIResponse> {
  const original = await new Response(new Uint8Array(captured.body), {
    headers: { "content-type": captured.headers["content-type"] },
  }).formData();

  // El formulario declara `name="name"` y `name="creationKey"`
  // (src/components/new-calendar-submit.tsx), pero con `useActionState` React
  // no los manda con esa clave literal: serializa los argumentos de la acción
  // en la entrada `0` (`[estadoPrevio, "$K<n>"]`) y el `FormData` del
  // formulario va como entradas con prefijo `_<n>_` (`_1_name`,
  // `_1_creationKey`, junto a sus `_1_$ACTION_*`). El prefijo se deriva de
  // esa referencia `$K<n>` del propio payload, no se supone. Si la
  // serialización cambia y no aparece exactamente una entrada de cada, el
  // test falla en vez de mandar algo inválido que "pasaría" por el motivo
  // equivocado.
  const args = JSON.parse(String(original.get("0") ?? "null"));
  expect(Array.isArray(args)).toBe(true);
  const formDataRefs = (args as unknown[]).filter((a): a is string => typeof a === "string" && /^\$K\d+$/.test(a));
  expect(formDataRefs).toHaveLength(1);
  const prefix = `_${formDataRefs[0].slice(2)}_`;
  const nameKey = `${prefix}name`;
  const creationKeyKey = `${prefix}creationKey`;

  expect(original.getAll(nameKey)).toHaveLength(1);
  expect(original.getAll(creationKeyKey)).toHaveLength(1);
  expect([...original.keys()].some((key) => key.includes("$ACTION_"))).toBe(true);

  const rebuilt = new FormData();
  for (const [key, value] of original.entries()) {
    if (key === nameKey) rebuilt.append(key, name);
    else if (key === creationKeyKey) rebuilt.append(key, creationKey);
    else rebuilt.append(key, value);
  }

  return await context.request.post(captured.url, {
    headers: {
      "Next-Action": captured.headers["next-action"],
      "Next-Router-State-Tree": captured.headers["next-router-state-tree"],
      Accept: captured.headers["accept"] ?? "text/x-component",
      Origin: captured.headers["origin"],
    },
    multipart: rebuilt,
    maxRedirects: 0,
  });
}

/**
 * Next.js entrega el redirect de una Server Action por 303+`location` o por
 * `x-action-redirect` (este último con sufijo de tipo de navegación, p. ej.
 * `/admin/<id>;push`). Devuelve solo la ruta, sin ese sufijo.
 */
function actionRedirectTarget(response: APIResponse): string | null {
  const headers = response.headers();
  let target: string | null = null;
  if (response.status() === 303 && headers["location"]) target = headers["location"];
  else if (response.status() === 200 && headers["x-action-redirect"]) target = headers["x-action-redirect"];
  return target === null ? null : target.split(";")[0];
}

test("1 · el Super Admin ve «+ Nuevo calendario» y crea un calendario", async () => {
  const page = await superAdminContext.newPage();
  await page.goto("/admin");

  const createButton = page.getByRole("button", { name: "+ Nuevo calendario" });
  await expect(createButton).toBeVisible();
  await expect(createButton).toBeEnabled(); // creationKey ya asignada tras montar

  await page.getByPlaceholder("Nombre del calendario").fill(calendarName);
  const actionRequest = page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]);
  await createButton.click();
  const request = await actionRequest;

  await page.waitForURL(/\/admin\/[^/?#]+$/);
  calendarId = new URL(page.url()).pathname.split("/").pop() as Id<"calendars">;
  createdCalendarIds.add(calendarId);

  captured = { url: request.url(), headers: await request.allHeaders(), body: request.postDataBuffer() ?? Buffer.alloc(0) };

  const stored = await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId });
  expect(stored?.name).toBe(calendarName);
});

test("2 · el Admin (no Super Admin) no ve el botón de crear, sí su calendario", async () => {
  await convex.mutation(api.superadmin.addAdminPublic, {
    serverSecret: serverSecret(),
    actorUserId: superAdminId,
    calendarId,
    email: ADMIN_EMAIL,
  });

  const page = await adminContext.newPage();
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Mis calendarios" })).toBeVisible();
  await expect(page.getByRole("link", { name: calendarName })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ Nuevo calendario" })).toHaveCount(0);
  await expect(page.getByPlaceholder("Nombre del calendario")).toHaveCount(0);
});

test("3 · el Admin fuerza la Server Action: redirige a /unauthorized y no se crea nada", async () => {
  const forcedName = `TAL-57 forzado admin ${runId}`;
  const response = await forceCreateAction(adminContext, forcedName, `tal57-forced-admin-${runId}`);

  const target = actionRedirectTarget(response);
  expect(target, `respuesta inesperada: ${response.status()} ${JSON.stringify(response.headers())}`).toContain(
    "/unauthorized"
  );
  expect(await allCalendarNames()).not.toContain(forcedName);
  expect(await adminCalendarIds()).toEqual([calendarId]);
});

test("3 · control positivo: la misma petición reconstruida con la sesión del Super Admin SÍ crea", async () => {
  const controlName = `TAL-57 forzado superadmin ${runId}`;
  const response = await forceCreateAction(superAdminContext, controlName, `tal57-forced-superadmin-${runId}`);

  const target = actionRedirectTarget(response);
  expect(target, `respuesta inesperada: ${response.status()} ${JSON.stringify(response.headers())}`).toMatch(
    /\/admin\/[^/?#]+$/
  );
  const controlId = target!.split("/").pop() as Id<"calendars">;
  createdCalendarIds.add(controlId);

  const stored = await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId: controlId });
  expect(stored?.name).toBe(controlName);
});

test("3b · el Admin sigue pudiendo editar su calendario y el cambio persiste", async () => {
  const page = await adminContext.newPage();
  await page.goto(`/admin/${calendarId}`);

  const renamed = `TAL-57 editado por admin ${runId}`;
  await page.locator("#calendar-name").fill(renamed);
  await page.getByRole("button", { name: "Guardar cambios" }).click();

  await expect
    .poll(async () => (await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId }))?.name)
    .toBe(renamed);
  await page.reload();
  await expect(page.locator("#calendar-name")).toHaveValue(renamed);
  calendarName = renamed;
});

test("4 · el Admin llama a Convex directamente: «No autorizado.» y no se crea nada", async () => {
  const before = await allCalendarNames();
  const directName = `TAL-57 convex directo ${runId}`;
  const baseArgs = {
    serverSecret: serverSecret(),
    userId: adminId,
    name: directName,
    coverTitle: "x",
    startDate: "2099-12-01",
    endDate: "2099-12-24",
  };

  await expect(
    convex.mutation(api.calendars.createCalendarPublic, { ...baseArgs, creationKey: `tal57-direct-${runId}` })
  ).rejects.toThrow(/No autorizado\./);

  // Reutilizar una creationKey que ya existe (la del paso 1) tampoco
  // devuelve el id de ese calendario: la autorización va antes del atajo
  // de idempotencia.
  const existingKey = (await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId }))
    ?.creationKey;
  expect(existingKey).toBeTruthy();
  await expect(
    convex.mutation(api.calendars.createCalendarPublic, { ...baseArgs, creationKey: existingKey! })
  ).rejects.toThrow(/No autorizado\./);

  expect(await allCalendarNames()).toEqual(before);
  expect(await adminCalendarIds()).toEqual([calendarId]);
});

test("6 · /admin a 375px sin scroll horizontal (Super Admin y Admin)", async () => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  for (const [role, context] of [
    ["superadmin", superAdminContext],
    ["admin", adminContext],
  ] as const) {
    const page = await context.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Mis calendarios" })).toBeVisible();
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth, `${role}: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(overflow.clientWidth);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, `admin-375-${role}.png`), fullPage: true });
    await page.close();
  }
});

test("5 · el Admin sigue pudiendo borrar su calendario", async () => {
  const page = await adminContext.newPage();
  await page.goto(`/admin/${calendarId}`);
  await page.getByRole("button", { name: "Eliminar calendario" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Sí, eliminar calendario" }).click();

  await page.waitForURL(/\/admin$/);
  await expect(page.getByRole("link", { name: calendarName })).toHaveCount(0);
  expect(await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId })).toBeNull();
  createdCalendarIds.delete(calendarId);
});
