import { expect, test } from "@playwright/test";
import { previewableImageUrl } from "../src/app/admin/[calendarId]/cover-image-preview";
import { shouldMountRouterHarness } from "../src/lib/e2e-router-harness";
import { shouldReopenWelcome } from "../src/lib/navigation-entry";
import { faintBackgroundUrl } from "../src/lib/skin-appearance";
import { toUserModeCard } from "../src/lib/user-mode-calendars";

/**
 * TAL-85 — unitarios (sin navegador ni servidor): regla de reapertura de la
 * bienvenida, respaldo del fondo tenue, `coverImageUrl` en las tarjetas,
 * guarda del harness de navegación y URLs que se previsualizan en el editor.
 */

test.describe("shouldReopenWelcome (tabla de § 3 del plan)", () => {
  const last = { navSeq: 3, renderId: "r1" };
  test("render nuevo + navegación nueva → reabre (p. ej. /c → redirect al mismo /c/<id>)", () => {
    expect(shouldReopenWelcome(last, { navSeq: 4, renderId: "r2" })).toBe(true);
  });
  test("render nuevo sin navegación → no (router.refresh de TimezoneSync, server action)", () => {
    expect(shouldReopenWelcome(last, { navSeq: 3, renderId: "r2" })).toBe(false);
  });
  test("navegación sin render nuevo → no (navegación hacia fuera)", () => {
    expect(shouldReopenWelcome(last, { navSeq: 4, renderId: "r1" })).toBe(false);
  });
  test("nada cambia → no (cerrar el diálogo de un vídeo)", () => {
    expect(shouldReopenWelcome(last, { navSeq: 3, renderId: "r1" })).toBe(false);
  });
});

test("faintBackgroundUrl: imagen de fondo; si falta, la portada; si no hay ninguna, null", () => {
  expect(faintBackgroundUrl("https://a/fondo.jpg", "https://a/portada.jpg")).toBe("https://a/fondo.jpg");
  expect(faintBackgroundUrl("https://a/fondo.jpg", null)).toBe("https://a/fondo.jpg");
  expect(faintBackgroundUrl(null, "https://a/portada.jpg")).toBe("https://a/portada.jpg");
  expect(faintBackgroundUrl("", "https://a/portada.jpg")).toBe("https://a/portada.jpg");
  expect(faintBackgroundUrl(undefined, undefined)).toBeNull();
  expect(faintBackgroundUrl("", "")).toBeNull();
});

test("toUserModeCard: coverImageUrl presente → la URL; ausente (Convex anterior) → null", () => {
  const base = {
    id: "c1",
    name: "Interno",
    coverTitle: "Título",
    startDate: new Date(Date.UTC(2026, 11, 1)),
    endDate: new Date(Date.UTC(2026, 11, 24)),
    isAdmin: false,
    skin: null,
  };
  const today = new Date(Date.UTC(2026, 11, 5));
  expect(toUserModeCard({ ...base, coverImageUrl: "https://a/portada.jpg" }, today).coverImageUrl).toBe("https://a/portada.jpg");
  expect(toUserModeCard(base, today).coverImageUrl).toBeNull();
});

test("shouldMountRouterHarness: solo con E2E_ROUTER_HARNESS=1 y fuera de producción", () => {
  expect(shouldMountRouterHarness({ E2E_ROUTER_HARNESS: "1", NODE_ENV: "development" })).toBe(true);
  expect(shouldMountRouterHarness({ E2E_ROUTER_HARNESS: "1", NODE_ENV: "test" })).toBe(true);
  expect(shouldMountRouterHarness({ E2E_ROUTER_HARNESS: "1", NODE_ENV: "production" })).toBe(false);
  expect(shouldMountRouterHarness({ NODE_ENV: "development" })).toBe(false);
  expect(shouldMountRouterHarness({ E2E_ROUTER_HARNESS: "true", NODE_ENV: "development" })).toBe(false);
});

test("previewableImageUrl: solo URLs https bien formadas", () => {
  expect(previewableImageUrl(" https://a.example/foto.jpg ")).toBe("https://a.example/foto.jpg");
  expect(previewableImageUrl("")).toBeNull();
  expect(previewableImageUrl("   ")).toBeNull();
  expect(previewableImageUrl("http://a.example/foto.jpg")).toBeNull();
  expect(previewableImageUrl("https://")).toBeNull();
  expect(previewableImageUrl("foto.jpg")).toBeNull();
});
