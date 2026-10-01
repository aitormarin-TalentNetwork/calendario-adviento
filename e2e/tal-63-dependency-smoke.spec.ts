import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { loginAs, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-63 — humo de regresión tras subir Next 16.3.1 → 16.3.8 (y sharp,
 * brace-expansion, js-yaml) por las vulnerabilidades de `npm audit`. Cubre
 * los flujos que pide el criterio de aceptación del issue: sesión (Auth.js),
 * panel de administración, editor, "Tus calendarios" y vista del invitado.
 * El login con Google real no se puede automatizar aquí: se entra por
 * `dev-login`, igual que el resto de specs (ver docs/e2e.md).
 *
 * Sembrado: un Super Admin propio crea dos calendarios (dos, para que `/c`
 * muestre la lista en vez de redirigir al único calendario) e invita a un
 * invitado a ambos. Emails únicos por ejecución.
 */
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const email = (role: string) => `e2e-tal63-${role}-${runId}@example.com`;
const ACTOR_EMAIL = email("actor");
const GUEST_EMAIL = email("guest");
const EVIDENCE_DIR = path.resolve(__dirname, "..", "docs", "evidence", "tal63");

const TITLE_A = `TAL-63 A ${runId}`;
const TITLE_B = `TAL-63 B ${runId}`;
const NAME_A = `${TITLE_A} (interno)`;

let actorId: Id<"users">;
let calendarA: Id<"calendars">;
const createdCalendarIds = new Set<Id<"calendars">>();

async function createCalendar(coverTitle: string, startDate: string, endDate: string): Promise<Id<"calendars">> {
  const id = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: actorId,
    name: `${coverTitle} (interno)`,
    coverTitle,
    startDate,
    endDate,
    creationKey: `e2e-tal63-${coverTitle}`,
  });
  createdCalendarIds.add(id);
  return id;
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return await context.newPage();
}

test.beforeAll(async () => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  actorId = await seedUser({ email: ACTOR_EMAIL, superAdmin: true });
  calendarA = await createCalendar(TITLE_A, "2026-09-01", "2026-12-24");
  const calendarB = await createCalendar(TITLE_B, "2026-12-28", "2027-01-06");
  for (const calendarId of [calendarA, calendarB]) {
    await convex.mutation(api.invitations.inviteGuestPublic, {
      serverSecret: serverSecret(),
      calendarId,
      email: GUEST_EMAIL,
    });
  }
});

test.afterAll(async () => {
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

test("1 · sin sesión: /login responde 200 y /api/auth/session no devuelve usuario", async ({ request }) => {
  const login = await request.get("/login");
  expect(login.status()).toBe(200);
  const session = await request.get("/api/auth/session");
  expect(session.status()).toBe(200);
  const body = await session.json();
  expect(body?.user ?? null).toBeNull();
});

test("2 · Super Admin: sesión activa, /admin y editor del calendario cargan", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAs(page, ACTOR_EMAIL);

  const session = await page.context().request.get("/api/auth/session");
  expect(session.status()).toBe(200);
  expect((await session.json())?.user?.email).toBe(ACTOR_EMAIL);

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Mis calendarios" })).toBeVisible();
  await expect(page.getByText(NAME_A)).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "2-admin.png"), fullPage: true });

  await page.goto(`/admin/${calendarA}`);
  await expect(page.getByRole("heading", { name: "Editar calendario" })).toBeVisible();
  await expect(page.locator("#calendar-name")).toHaveValue(NAME_A);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "2-editor.png"), fullPage: true });
  await page.context().close();
});

test("3 · invitado: «Tus calendarios» lista ambos y la vista del calendario carga", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAs(page, GUEST_EMAIL);

  await page.goto("/c");
  await expect(page.getByRole("heading", { name: "Tus calendarios" })).toBeVisible();
  await expect(page.locator(".calendar-card")).toHaveCount(2);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "3-tus-calendarios.png"), fullPage: true });

  await page.locator(".calendar-card", { hasText: TITLE_A }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${calendarA}$`));
  await expect(page.getByRole("heading", { level: 1, name: TITLE_A })).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "3-vista-invitado.png"), fullPage: true });
  await page.context().close();
});
