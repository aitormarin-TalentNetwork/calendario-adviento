import { expect, test } from "@playwright/test";
import { DEFAULT_SKIN_APPEARANCE } from "../src/lib/skin-appearance";
import {
  cardSubtitle,
  cardTitle,
  formatDateRangeShort,
  normalizeCardAppearance,
  toUserModeCard,
} from "../src/lib/user-mode-calendars";

/**
 * TAL-58 — tests puros (sin navegador) de la normalización de las tarjetas
 * de "Tus calendarios" (`src/lib/user-mode-calendars.ts`). El respaldo del
 * skin no se puede sembrar por la vía pública (crear un calendario siempre
 * asigna un skin válido), así que se prueba aquí directamente.
 */

const utc = (s: string) => new Date(`${s}T00:00:00Z`);

test.describe("normalizeCardAppearance", () => {
  test("skin inexistente/roto (null) → DEFAULT_SKIN_APPEARANCE", () => {
    expect(normalizeCardAppearance(null)).toEqual(DEFAULT_SKIN_APPEARANCE);
  });

  test("skin sin background, sin accent o sin textColor → DEFAULT_SKIN_APPEARANCE", () => {
    const full = { _id: "s1", background: "#123456", accent: "#abcdef", textColor: "#ffffff" };
    expect(normalizeCardAppearance({ ...full, background: undefined })).toEqual(DEFAULT_SKIN_APPEARANCE);
    expect(normalizeCardAppearance({ ...full, accent: undefined })).toEqual(DEFAULT_SKIN_APPEARANCE);
    expect(normalizeCardAppearance({ ...full, textColor: undefined })).toEqual(DEFAULT_SKIN_APPEARANCE);
    expect(normalizeCardAppearance({ _id: "s2" })).toEqual(DEFAULT_SKIN_APPEARANCE);
  });

  test("skin completo sin textPill → sus valores con textPill false", () => {
    expect(
      normalizeCardAppearance({ _id: "s1", background: "#123456", accent: "#abcdef", textColor: "#ffffff" })
    ).toEqual({ background: "#123456", accent: "#abcdef", textColor: "#ffffff", textPill: false });
  });

  test("skin completo con textPill true → se respeta", () => {
    expect(
      normalizeCardAppearance({ _id: "s1", background: "#fff", accent: "#c00", textColor: "#fff", textPill: true })
    ).toEqual({ background: "#fff", accent: "#c00", textColor: "#fff", textPill: true });
  });
});

test.describe("formatDateRangeShort", () => {
  test("mismo mes", () => {
    expect(formatDateRangeShort(utc("2026-12-01"), utc("2026-12-24"))).toBe("1 dic – 24 dic 2026");
  });

  test("meses distintos, mismo año", () => {
    expect(formatDateRangeShort(utc("2026-11-28"), utc("2026-12-24"))).toBe("28 nov – 24 dic 2026");
  });

  test("años distintos", () => {
    expect(formatDateRangeShort(utc("2026-12-28"), utc("2027-01-06"))).toBe("28 dic 2026 – 6 ene 2027");
  });

  test("septiembre es 'sep' (no 'sept.') y sin punto en ningún mes", () => {
    expect(formatDateRangeShort(utc("2026-09-01"), utc("2026-10-31"))).toBe("1 sep – 31 oct 2026");
  });
});

test.describe("cardTitle", () => {
  test("coverTitle con contenido → coverTitle", () => {
    expect(cardTitle("Navidad en la oficina", "Interno")).toBe("Navidad en la oficina");
  });

  test("coverTitle vacío o en blanco → name", () => {
    expect(cardTitle("", "Interno")).toBe("Interno");
    expect(cardTitle("   ", "Interno")).toBe("Interno");
  });

  test("los dos vacíos → literal defensivo, nunca sin título", () => {
    expect(cardTitle(" ", " ")).toBe("Calendario");
  });
});

test.describe("cardSubtitle", () => {
  test("Admin → 'Lo administras tú'", () => {
    expect(cardSubtitle(true, utc("2026-12-01"), utc("2026-12-24"))).toBe("Lo administras tú");
  });

  test("invitado → rango de fechas", () => {
    expect(cardSubtitle(false, utc("2026-12-01"), utc("2026-12-24"))).toBe("1 dic – 24 dic 2026");
  });
});

test("toUserModeCard compone título, icono por defecto, skin de respaldo y línea secundaria", () => {
  expect(
    toUserModeCard({
      id: "c1",
      name: "Interno",
      coverTitle: "",
      startDate: utc("2026-12-28"),
      endDate: utc("2027-01-06"),
      isAdmin: false,
      skin: null,
    })
  ).toEqual({
    id: "c1",
    title: "Interno",
    icon: "🎄",
    appearance: DEFAULT_SKIN_APPEARANCE,
    backgroundImageUrl: null,
    subtitle: "28 dic 2026 – 6 ene 2027",
    isAdmin: false,
  });
});
