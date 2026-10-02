import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { loginAs, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-60 — iconos Lucide en vez de emojis (portada, login, vista previa,
 * "Tus calendarios", selector, candado, botones de cerrar) + migración de
 * un coverIcon antiguo visto desde la UI.
 *
 * Sembrado: un actor Super Admin crea los calendarios (desde TAL-57 solo él
 * puede); un Admin no Super Admin (`addAdminPublic`) edita el icono; un
 * invitado ve la portada y `/c`. El calendario con un emoji ANTIGUO crudo
 * (🦄) se siembra con `npx convex import --append` — por las mutations no
 * se puede: la escritura nueva solo acepta nombres del catálogo o emojis
 * del catálogo antiguo, y 🦄 lo guardaría tal cual pero aquí queremos
 * reproducir exactamente un dato de antes de TAL-60 sin pasar por ella.
 * Todo contra el deployment de desarrollo de la terminal (`.env.local`).
 */
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const ACTOR_EMAIL = `e2e-tal60-actor-${runId}@example.com`;
const ADMIN_EMAIL = `e2e-tal60-admin-${runId}@example.com`;
const GUEST_EMAIL = `e2e-tal60-guest-${runId}@example.com`;
const EVIDENCE_DIR = path.resolve(__dirname, "..", "docs", "evidence", "tal60");

const TITLE_A = `TAL-60 A ${runId}`;
const TITLE_B = `TAL-60 B ${runId}`;
const NAME_LEGACY = `tal60-e2e-legacy-${runId}`;

let actorId: Id<"users">;
let calendarA: Id<"calendars">;
let calendarB: Id<"calendars">;
let calendarLegacy: Id<"calendars">;
let skinId: Id<"skins">;
const createdCalendarIds = new Set<Id<"calendars">>();

// Rangos de emojis que la UI no debe pintar (mismo barrido que el grep de evidencia).
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{25A0}-\u{25FF}\u{FE0F}]/u;

async function expectLucideSvg(container: Locator) {
  const svg = container.locator("svg").first();
  await expect(svg).toHaveAttribute("class", /\blucide\b/);
  await expect(svg).toHaveAttribute("fill", "none");
  await expect(svg).toHaveAttribute("stroke", "currentColor");
  await expect(svg).toHaveAttribute("stroke-width", "2");
}

async function expectNoEmoji(page: Page) {
  const text = await page.evaluate(() => document.body.innerText);
  expect(text.match(EMOJI_RE), "la UI no pinta ningún emoji").toBeNull();
}

async function expectNoHorizontalScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

async function newPage(browser: Browser, opts: { colorScheme?: "light" | "dark"; viewport?: { width: number; height: number } } = {}) {
  const context = await browser.newContext({ colorScheme: opts.colorScheme ?? "light", ...(opts.viewport ? { viewport: opts.viewport } : {}) });
  return await context.newPage();
}

async function createCalendar(coverTitle: string, coverIcon: string): Promise<Id<"calendars">> {
  const id = await convex.mutation(api.calendars.createCalendarPublic, {
    serverSecret: serverSecret(),
    userId: actorId,
    name: `${coverTitle} (interno)`,
    coverTitle,
    coverIcon,
    startDate: "2026-12-01",
    endDate: "2026-12-24",
    creationKey: `e2e-tal60-${coverTitle}`,
  });
  createdCalendarIds.add(id);
  return id;
}

async function storedCoverIcon(calendarId: Id<"calendars">): Promise<string | undefined> {
  const calendar = await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId });
  return calendar?.coverIcon;
}

test.beforeAll(async () => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  actorId = await seedUser({ email: ACTOR_EMAIL, superAdmin: true });
  calendarA = await createCalendar(TITLE_A, "cake");
  calendarB = await createCalendar(TITLE_B, "heart");
  const calA = await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId: calendarA });
  skinId = calA!.skinId;

  const added = await convex.mutation(api.superadmin.addAdminPublic, {
    serverSecret: serverSecret(),
    actorUserId: actorId,
    calendarId: calendarA,
    email: ADMIN_EMAIL,
  });
  expect(added).toMatchObject({ ok: true });

  // Calendario con un coverIcon ANTIGUO crudo (🦄), sembrado como dato previo a TAL-60.
  const dir = mkdtempSync(path.join(tmpdir(), "tal60-e2e-"));
  const file = path.join(dir, "legacy.jsonl");
  writeFileSync(
    file,
    JSON.stringify({
      name: NAME_LEGACY,
      coverTitle: `TAL-60 antiguo ${runId}`,
      coverIcon: "🦄",
      startDate: "2026-12-01",
      endDate: "2026-12-24",
      updatedAt: Date.now(),
      skinId,
    }) + "\n"
  );
  execFileSync("npx", ["convex", "import", "--table", "calendars", "--append", "-y", file], { stdio: "pipe" });
  const all = await convex.query(api.superadmin.listCalendarsWithStatsPublic, {
    serverSecret: serverSecret(),
    actorUserId: actorId,
    now: new Date().toISOString().slice(0, 10),
  });
  calendarLegacy = all.find((c) => c.name === NAME_LEGACY)!.id;
  createdCalendarIds.add(calendarLegacy);
  expect(await storedCoverIcon(calendarLegacy)).toBe("🦄");

  for (const id of [calendarA, calendarB, calendarLegacy]) {
    await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId: id, email: GUEST_EMAIL });
  }
});

test.afterAll(async () => {
  // Mismo patrón que TAL-57/58: cada calendario por separado.
  const failures: string[] = [];
  for (const id of createdCalendarIds) {
    try {
      await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId: id, userId: actorId });
    } catch (err) {
      failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  expect(failures, "calendarios de prueba sin limpiar").toEqual([]);
});

test("1 · selector: mismas categorías, buscador en español, elegir y guardar persiste el nombre Lucide", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAs(page, ADMIN_EMAIL);
  await page.goto(`/admin/${calendarA}`);

  const trigger = page.getByRole("button", { name: "Icono", exact: true });
  await expect(trigger.locator("[data-cover-icon]")).toHaveAttribute("data-cover-icon", "cake");
  await expectLucideSvg(trigger);
  await trigger.click();

  const dialog = page.getByRole("dialog", { name: "Elegir icono de portada" });
  await expect(dialog).toBeVisible();
  for (const label of ["Navidad", "Fiesta", "Cariño", "Naturaleza y cielo", "Animales"]) {
    await expect(dialog.getByText(label, { exact: true })).toBeVisible();
  }
  await expectLucideSvg(dialog.getByRole("button", { name: "Cerrar" }));
  await expect(dialog.getByPlaceholder("Buscar icono…")).toBeVisible();
  await expectLucideSvg(dialog.locator("div").filter({ has: page.getByPlaceholder("Buscar icono…") }).last());
  await expectNoEmoji(page);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "1-selector-claro.png") });

  await dialog.getByPlaceholder("Buscar icono…").fill("perro");
  const results = dialog.locator("[data-icon-name]");
  await expect(results).toHaveCount(1);
  await expect(results.first()).toHaveAttribute("data-icon-name", "dog");
  await expectLucideSvg(results.first());
  await results.first().click();
  await expect(dialog).toBeHidden();
  await expect(trigger.locator("[data-cover-icon]")).toHaveAttribute("data-cover-icon", "dog");

  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect.poll(() => storedCoverIcon(calendarA), { timeout: 20_000 }).toBe("dog");
  await page.context().close();
});

test("2 · portada del invitado: icono Lucide en su recuadro, candado Lucide en los días bloqueados, sin emojis", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAs(page, GUEST_EMAIL);
  await page.goto(`/c/${calendarA}`);
  const icon = page.locator(".cover-icon-box[data-cover-icon='dog']");
  await expect(icon).toBeVisible();
  await expectLucideSvg(icon);
  const lock = page.locator(".dg-lock-icon").first();
  await expect(lock).toBeVisible();
  await expectLucideSvg(lock);
  await expectNoEmoji(page);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "2-portada-claro.png"), fullPage: true });
  await page.context().close();
});

test("3 · login con callbackUrl del calendario: icono Lucide", async ({ browser }) => {
  const page = await newPage(browser);
  await page.goto(`/login?callbackUrl=/c/${calendarA}`);
  const icon = page.locator(".cover-icon-box[data-cover-icon='dog']");
  await expect(icon).toBeVisible();
  await expectLucideSvg(icon);
  await expectNoEmoji(page);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "3-login-claro.png") });
  await page.context().close();
});

test("4 · 'Tus calendarios' (/c): cada tarjeta lleva su icono Lucide", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAs(page, GUEST_EMAIL);
  await page.goto("/c");
  const cards = page.locator(".calendar-card");
  await expect(cards).toHaveCount(3);
  for (const card of await cards.all()) await expectLucideSvg(card.locator(".cover-icon-box"));
  await expect(cards.filter({ hasText: TITLE_A }).locator("[data-cover-icon]")).toHaveAttribute("data-cover-icon", "dog");
  await expect(cards.filter({ hasText: TITLE_B }).locator("[data-cover-icon]")).toHaveAttribute("data-cover-icon", "heart");
  await expectNoEmoji(page);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "4-tus-calendarios-claro.png"), fullPage: true });
  await page.context().close();
});

test("5 · dato antiguo 🦄: se ve como 'sparkles' ANTES de migrar; tras la migración el dato es 'sparkles'", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAs(page, GUEST_EMAIL);
  await page.goto(`/c/${calendarLegacy}`);
  await expect(page.locator(".cover-icon-box[data-cover-icon='sparkles']")).toBeVisible();
  await expectNoEmoji(page);
  expect(await storedCoverIcon(calendarLegacy)).toBe("🦄");

  const output = execFileSync(
    "npx",
    ["convex", "run", "coverIconMigration:runCoverIconMigration", JSON.stringify({ migrationId: `e2e-tal60-${runId}` })],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  console.log(`runCoverIconMigration → ${output.trim()}`);
  expect(await storedCoverIcon(calendarLegacy)).toBe("sparkles");
  await page.reload();
  await expect(page.locator(".cover-icon-box[data-cover-icon='sparkles']")).toBeVisible();
  await page.context().close();
});

test("6 · botones de cerrar con 'X' Lucide (vista previa y diálogo de día del editor)", async ({ browser }) => {
  const page = await newPage(browser);
  await loginAs(page, ADMIN_EMAIL);
  await page.goto(`/admin/${calendarA}`);

  await page.getByRole("button", { name: "Ver vista previa a tamaño completo" }).click();
  const preview = page.getByRole("dialog", { name: "Vista previa del calendario" });
  await expect(preview).toBeVisible();
  await expectLucideSvg(preview.locator(".cover-icon-box"));
  await expectLucideSvg(preview.getByRole("button", { name: "Cerrar" }));
  await preview.getByRole("button", { name: "Cerrar" }).click();
  await expect(preview).toBeHidden();

  await page.getByRole("button", { name: /— sin vídeo$/ }).first().click();
  const dayDialog = page.getByRole("dialog", { name: /^Editar día — / });
  await expect(dayDialog).toBeVisible();
  await expectLucideSvg(dayDialog.getByRole("button", { name: "Cerrar" }));
  await expectNoEmoji(page);
  await page.context().close();
});

test("7 · escritura en Convex: emoji antiguo se guarda TAL CUAL (compatibilidad); desconocido se rechaza", async () => {
  const calendar = (await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId: calendarB }))!;
  const base = {
    serverSecret: serverSecret(),
    calendarId: calendarB,
    name: calendar.name,
    coverTitle: calendar.coverTitle,
    startDate: calendar.startDate,
    endDate: calendar.endDate,
    skinId: calendar.skinId,
  };
  await convex.mutation(api.calendars.updateCalendarPublic, { ...base, coverIcon: "🎁" });
  expect(await storedCoverIcon(calendarB)).toBe("🎁");
  await expect(convex.mutation(api.calendars.updateCalendarPublic, { ...base, coverIcon: "🚀" })).rejects.toThrow(/Icono de portada no válido/);
  await convex.mutation(api.calendars.updateCalendarPublic, { ...base, coverIcon: "heart" });
  expect(await storedCoverIcon(calendarB)).toBe("heart");
});

test("8 · oscuro y 375px: selector, portada, /c y login sin scroll horizontal", async ({ browser }) => {
  for (const colorScheme of ["light", "dark"] as const) {
    const mobile = await newPage(browser, { colorScheme, viewport: { width: 375, height: 812 } });
    const desktop = await newPage(browser, { colorScheme });
    for (const page of [mobile, desktop]) {
      const suffix = `${colorScheme}-${page === mobile ? "375" : "desktop"}`;
      await page.goto(`/login?callbackUrl=/c/${calendarA}`);
      await expect(page.locator(".cover-icon-box")).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `8-login-${suffix}.png`) });

      await loginAs(page, ADMIN_EMAIL);
      await page.goto(`/admin/${calendarA}`);
      await page.getByRole("button", { name: "Icono", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Elegir icono de portada" })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `8-selector-${suffix}.png`) });
      await page.keyboard.press("Escape");

      await page.goto(`/c/${calendarA}`);
      await expect(page.locator(".cover-icon-box")).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `8-portada-${suffix}.png`), fullPage: true });
    }
    await mobile.context().close();
    await desktop.context().close();

    const guest = await newPage(browser, { colorScheme, viewport: { width: 375, height: 812 } });
    await loginAs(guest, GUEST_EMAIL);
    await guest.goto("/c");
    await expect(guest.locator(".calendar-card")).toHaveCount(3);
    await expectNoHorizontalScroll(guest);
    await guest.screenshot({ path: path.join(EVIDENCE_DIR, `8-tus-calendarios-${colorScheme}-375.png`), fullPage: true });
    await guest.context().close();
  }
});
