import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Browser } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { loginAs, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-60 — lectura con datos MEZCLADOS (emojis antiguos, nombres Lucide,
 * campo ausente): es lo que garantiza el commit de compatibilidad y lo que
 * hace válido un destino de rollback (docs/iconos.md § "Rollback"). Se
 * ejecuta contra el build normal de la rama y también contra el build de
 * `aitormarin/tal-60-rollback-compat` (solo el commit de compatibilidad).
 *
 * Datos: "🎁" (emoji antiguo, guardado tal cual por la escritura
 * tolerante), "dog" (nombre), y dos sembrados crudos con
 * `npx convex import --append`: "🦄" (emoji antiguo sin equivalente
 * directo) y uno sin `coverIcon`.
 */
test.describe.configure({ mode: "serial" });

const runId = uniqueRunId();
const ACTOR_EMAIL = `e2e-tal60c-actor-${runId}@example.com`;
const GUEST_EMAIL = `e2e-tal60c-guest-${runId}@example.com`;
// Propiedad de compatibilidad: el `coverIcon` guardado (emoji o nombre)
// NUNCA aparece como texto en la página — siempre como icono. Es más
// estrecha que el barrido general de emojis de `tal-60-iconos-lucide.spec.ts`
// a propósito: este spec también se ejecuta contra el build del commit de
// compatibilidad SOLO, que todavía no incluye el candado/botones de cerrar
// del commit 2.
const STORED_VALUES = ["🎁", "🦄", "dog"];
async function expectStoredValueNotAsText(page: import("@playwright/test").Page) {
  const text = await page.evaluate(() => document.body.innerText);
  for (const value of STORED_VALUES) expect(text.includes(value), `"${value}" no aparece como texto`).toBe(false);
}

const CASES = [
  { key: "emoji-gift", coverIcon: "🎁", expected: "gift", raw: false },
  { key: "nombre-lucide", coverIcon: "dog", expected: "dog", raw: false },
  { key: "raw-unicorn", coverIcon: "🦄", expected: "sparkles", raw: true },
  { key: "raw-missing", coverIcon: undefined, expected: "tree-pine", raw: true },
] as const;

let actorId: Id<"users">;
const ids: Record<string, Id<"calendars">> = {};

test.beforeAll(async () => {
  actorId = await seedUser({ email: ACTOR_EMAIL, superAdmin: true });
  for (const c of CASES.filter((x) => !x.raw)) {
    ids[c.key] = await convex.mutation(api.calendars.createCalendarPublic, {
      serverSecret: serverSecret(),
      userId: actorId,
      name: `tal60c-${c.key}-${runId}`,
      coverTitle: `Compat ${c.key}`,
      coverIcon: c.coverIcon,
      startDate: "2026-12-01",
      endDate: "2026-12-24",
      creationKey: `tal60c-${c.key}-${runId}`,
    });
  }
  const skinId = (await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId: ids["nombre-lucide"] }))!.skinId;
  const file = path.join(mkdtempSync(path.join(tmpdir(), "tal60c-")), "raw.jsonl");
  writeFileSync(
    file,
    CASES.filter((x) => x.raw)
      .map((c) =>
        JSON.stringify({
          name: `tal60c-${c.key}-${runId}`,
          coverTitle: `Compat ${c.key}`,
          ...(c.coverIcon !== undefined ? { coverIcon: c.coverIcon } : {}),
          startDate: "2026-12-01",
          endDate: "2026-12-24",
          updatedAt: Date.now(),
          skinId,
        })
      )
      .join("\n") + "\n"
  );
  execFileSync("npx", ["convex", "import", "--table", "calendars", "--append", "-y", file], { stdio: "pipe" });
  const all = await convex.query(api.superadmin.listCalendarsWithStatsPublic, {
    serverSecret: serverSecret(),
    actorUserId: actorId,
    now: new Date().toISOString().slice(0, 10),
  });
  for (const c of CASES.filter((x) => x.raw)) ids[c.key] = all.find((x) => x.name === `tal60c-${c.key}-${runId}`)!.id;
  for (const id of Object.values(ids)) {
    await convex.mutation(api.invitations.inviteGuestPublic, { serverSecret: serverSecret(), calendarId: id, email: GUEST_EMAIL });
  }
  // El dato sigue tal cual en Convex (no se ha migrado nada).
  expect((await convex.query(api.calendars.getPublic, { serverSecret: serverSecret(), calendarId: ids["emoji-gift"] }))!.coverIcon).toBe("🎁");
});

test.afterAll(async () => {
  const failures: string[] = [];
  for (const id of Object.values(ids)) {
    try {
      await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId: id, userId: actorId });
    } catch (err) {
      failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  expect(failures, "calendarios de prueba sin limpiar").toEqual([]);
});

async function guestPage(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await loginAs(page, GUEST_EMAIL);
  return page;
}

for (const c of CASES) {
  test(`portada y login: ${String(c.coverIcon)} → ${c.expected}`, async ({ browser }) => {
    const page = await guestPage(browser);
    await page.goto(`/c/${ids[c.key]}`);
    const icon = page.locator(`.cover-icon-box[data-cover-icon='${c.expected}'] svg.lucide`);
    await expect(icon).toBeVisible();
    await expect(icon).toHaveAttribute("stroke", "currentColor");
    await expectStoredValueNotAsText(page);

    const anon = await (await browser.newContext()).newPage();
    await anon.goto(`/login?callbackUrl=/c/${ids[c.key]}`);
    await expect(anon.locator(`.cover-icon-box[data-cover-icon='${c.expected}'] svg.lucide`)).toBeVisible();
    await expectStoredValueNotAsText(anon);
    await anon.context().close();
    await page.context().close();
  });
}

test("'Tus calendarios' con los 4 datos mezclados", async ({ browser }) => {
  const page = await guestPage(browser);
  await page.goto("/c");
  await expect(page.locator(".calendar-card")).toHaveCount(CASES.length);
  for (const c of CASES) {
    await expect(page.locator(".calendar-card", { hasText: `Compat ${c.key}` }).locator("[data-cover-icon]")).toHaveAttribute(
      "data-cover-icon",
      c.expected
    );
  }
  await expectStoredValueNotAsText(page);
  await page.context().close();
});
