import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { Id } from "../convex/_generated/dataModel";
import { calendarStatus } from "../convex/calendarStatus";
import { loginAs, seedUser, uniqueRunId } from "./helpers/auth";
import { api, convex, serverSecret } from "./helpers/convex";

/**
 * TAL-74 — etiqueta de estado (En marcha / Próximo / Terminado) en cada fila
 * de "Mis calendarios" (/admin). Incluye el test UNITARIO de `calendarStatus`
 * (convex/calendarStatus.ts, la única definición, compartida con
 * /superadmin), que se ejecuta con el runner de Playwright sin navegador.
 */

test.describe("calendarStatus (unitario)", () => {
  test("bordes: el primer y el último día cuentan como «En marcha»", () => {
    expect(calendarStatus("2026-12-01", "2026-12-24", "2026-12-01")).toBe("live");
    expect(calendarStatus("2026-12-01", "2026-12-24", "2026-12-24")).toBe("live");
    expect(calendarStatus("2026-12-01", "2026-12-24", "2026-12-10")).toBe("live");
  });
  test("el día antes del inicio es «Próximo» y el día después del fin, «Terminado»", () => {
    expect(calendarStatus("2026-12-01", "2026-12-24", "2026-11-30")).toBe("upcoming");
    expect(calendarStatus("2026-12-01", "2026-12-24", "2026-12-25")).toBe("finished");
  });
  test("calendario de un solo día", () => {
    expect(calendarStatus("2026-12-24", "2026-12-24", "2026-12-24")).toBe("live");
    expect(calendarStatus("2026-12-24", "2026-12-24", "2026-12-23")).toBe("upcoming");
    expect(calendarStatus("2026-12-24", "2026-12-24", "2026-12-25")).toBe("finished");
  });
});

test.describe("«Mis calendarios» (E2E)", () => {
  test.describe.configure({ mode: "serial" });

  const runId = uniqueRunId();
  const SA_EMAIL = `e2e-tal74-superadmin-${runId}@example.com`;
  const ACTOR_EMAIL = `e2e-tal74-actor-${runId}@example.com`;
  const EVIDENCE_DIR = path.resolve(__dirname, "..", "docs", "evidence", "tal74");
  const TOKENS = {
    light: { ink: "#1d2320", live: "#cdf7e3", upcoming: "#e6e0ff", finished: "#f7f6f3" },
    dark: { ink: "#f2f1ec", live: "#1f3a2e", upcoming: "#2a2645", finished: "#212825" },
  } as const;

  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const NAME = { finished: `TAL-74 terminado ${runId}`, live: `TAL-74 en marcha ${runId}`, upcoming: `TAL-74 próximo ${runId}`, foreign: `TAL-74 ajeno ${runId}` };
  let saId: Id<"users">;
  let actorId: Id<"users">;
  const created: { id: Id<"calendars">; owner: Id<"users"> }[] = [];

  const rgbToHex = (rgb: string) => "#" + rgb.match(/\d+/g)!.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
  const row = (page: Page, name: string) => page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
  async function pageAs(browser: Browser, opts: Parameters<Browser["newContext"]>[0] = {}) {
    const page = await (await browser.newContext(opts)).newPage();
    await loginAs(page, SA_EMAIL);
    await page.goto("/admin");
    return page;
  }

  test.beforeAll(async () => {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    saId = await seedUser({ email: SA_EMAIL, superAdmin: true });
    actorId = await seedUser({ email: ACTOR_EMAIL, superAdmin: true });
    const create = async (key: keyof typeof NAME, owner: Id<"users">, startDate: string, endDate: string) => {
      const id = await convex.mutation(api.calendars.createCalendarPublic, {
        serverSecret: serverSecret(),
        userId: owner,
        name: NAME[key],
        coverTitle: NAME[key],
        startDate,
        endDate,
        creationKey: `e2e-tal74-${key}-${runId}`,
      });
      created.push({ id, owner });
    };
    await create("finished", saId, day(-20), day(-5));
    await create("live", saId, day(-3), day(3));
    await create("upcoming", saId, day(5), day(20));
    await create("foreign", actorId, day(-1), day(1)); // ajeno para SA → píldora «Super Admin»
  });

  test.afterAll(async () => {
    for (const { id, owner } of created) {
      await convex.mutation(api.calendars.deleteCalendarAsUserPublic, { serverSecret: serverSecret(), calendarId: id, userId: owner });
    }
  });

  test("1 · cada fila lleva su estado; la ajena, «Super Admin» y su estado sin solaparse", async ({ browser }) => {
    const page = await pageAs(browser);
    await expect(page.getByRole("columnheader", { name: "Estado" })).toBeVisible();
    await expect(row(page, NAME.finished).locator(".status-pill")).toHaveText("Terminado");
    await expect(row(page, NAME.live).locator(".status-pill")).toHaveText("En marcha");
    await expect(row(page, NAME.upcoming).locator(".status-pill")).toHaveText("Próximo");

    const foreign = row(page, NAME.foreign);
    await expect(foreign.locator(".status-pill")).toHaveText("En marcha");
    await expect(foreign.getByText("Super Admin", { exact: true })).toBeVisible();
    const a = (await foreign.getByText("Super Admin", { exact: true }).boundingBox())!;
    const b = (await foreign.locator(".status-pill").boundingBox())!;
    const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(overlap, `las píldoras se solapan: ${JSON.stringify({ a, b })}`).toBe(false);
    await page.context().close();
  });

  for (const scheme of ["light", "dark"] as const) {
    test(`2 · colores computados en ${scheme === "light" ? "claro" : "oscuro"}: fondo de su token y texto --ink`, async ({ browser }) => {
      const page = await pageAs(browser, { colorScheme: scheme });
      const t = TOKENS[scheme];
      for (const key of ["live", "upcoming", "finished"] as const) {
        const pill = row(page, NAME[key]).locator(".status-pill");
        const style = await pill.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color, weight: getComputedStyle(el).fontWeight }));
        expect(rgbToHex(style.bg), key).toBe(t[key]);
        expect(rgbToHex(style.fg), key).toBe(t.ink);
        expect(style.weight, key).toBe("800");
      }
      await page.context().close();
    });

    test(`3 · 375px (${scheme === "light" ? "claro" : "oscuro"}): sin scroll horizontal de página`, async ({ browser }) => {
      const page = await pageAs(browser, { colorScheme: scheme, viewport: { width: 375, height: 812 } });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      // La tabla se desplaza dentro de su contenedor (DS § Responsive); se lleva la fila a la vista para la captura.
      await row(page, NAME.foreign).locator(".status-pill").scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(EVIDENCE_DIR, `mis-calendarios-375-${scheme}.png`) });
      await page.context().close();
    });
  }
});
