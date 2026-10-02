// TAL-62 — catálogo de 8 skins del Design System "Estilo 2026"
// (`design/design-system.md` § "Estilo 2026 → Skins"), con los valores
// EXACTOS de `design/propuesta-skins-modernos.html`. Son DATOS de sembrado
// (los siembra `skins.seedSkinCatalog2026` en las tablas `skins` +
// `skinStyles`); la app nunca los lee de aquí, siempre de Convex.
//
// Fichero NEUTRAL (sin runtime de Convex), mismo patrón que
// `coverIconCatalog.ts`: lo importan la mutation de sembrado y los tests
// puros (`e2e/tal-62-skin-catalog.spec.ts`).
//
// Migración (decisión del PM, 2026-10-01): `nieve`, `tira-comica` y
// `rojiblanco` YA EXISTEN en el catálogo antiguo y se conservan (mismo
// `_id`, sus calendarios no cambian de skin); los otros 5 son filas nuevas.
// En las 3 conservadas el sembrado NO toca los campos antiguos
// (`background`/`accent`/`textColor`/`textPill`), para que el Next anterior
// a TAL-62 las siga pintando igual durante el despliegue.

export type SkinPalette = {
  bg: string;
  ink: string;
  dim: string;
  line: string;
  card: string;
  cell: string;
  tile: string;
  /** `--accent` del mockup: color del icono dentro del recuadro (`tile`). */
  tileInk: string;
  hero: string;
  heroInk: string;
  heroNum: string;
  glow: string;
  today: string;
  todayInk: string;
  todayShadow: string;
  seenA: string;
  seenB: string;
  weekend: string;
};

export type SkinTreatment = "comic" | "stripes-pill";

export type SkinCatalogEntry = {
  key: string;
  name: string;
  description: string;
  sortOrder: number;
  /** true en las 3 filas que ya existen en el catálogo antiguo y se conservan. */
  keepsExistingRow: boolean;
  palette: SkinPalette;
  treatment?: SkinTreatment;
  /** Muestras del selector, exactas del array `sw` del mockup (no se derivan de la paleta). */
  swatches: string[];
  /**
   * Campos antiguos para las filas NUEVAS (compatibilidad con el Next
   * anterior a TAL-62, que solo lee estos). En las conservadas se ignoran.
   */
  legacy: { background: string; accent: string; textColor: string; textPill?: boolean };
};

export const PALETTE_KEYS: readonly (keyof SkinPalette)[] = [
  "bg", "ink", "dim", "line", "card", "cell", "tile", "tileInk", "hero", "heroInk",
  "heroNum", "glow", "today", "todayInk", "todayShadow", "seenA", "seenB", "weekend",
];

/** Keys del catálogo antiguo que se conservan (versión nueva) — el resto de antiguos pasa a Alegre. */
export const KEPT_SKIN_KEYS = ["nieve", "tira-comica", "rojiblanco"] as const;

export const DEFAULT_SKIN_KEY_2026 = "alegre";

export const SKIN_CATALOG_2026: readonly SkinCatalogEntry[] = [
  {
    key: "alegre",
    name: "Alegre",
    description: "El estilo estándar de la app: violeta, sol, coral y menta sobre crema.",
    sortOrder: 1,
    keepsExistingRow: false,
    palette: {
      bg: "#fff8ee", ink: "#1d2320", dim: "#6b726e", line: "#e8dfcf", card: "#ffffff", cell: "#f6f1ff",
      tile: "#e6e0ff", tileInk: "#7b61ff", hero: "#7b61ff", heroInk: "#fff", heroNum: "#ffd23f",
      glow: "rgba(255,210,63,0.45)", today: "#ffd23f", todayInk: "#1d2320", todayShadow: "rgba(255,210,63,0.6)",
      seenA: "#ff8a8d", seenB: "#ff5a5f", weekend: "#ff5a5f",
    },
    swatches: ["#7b61ff", "#ffd23f", "#ff5a5f", "#3ddc97"],
    legacy: { background: "#fff8ee", accent: "#7b61ff", textColor: "#1d2320" },
  },
  {
    key: "navidad-pop",
    name: "Navidad pop",
    description: "Navidad viva: rojo y verde vivos con dorado.",
    sortOrder: 2,
    keepsExistingRow: false,
    palette: {
      bg: "#fff7f2", ink: "#2a1a1c", dim: "#7a6466", line: "#f0d9d3", card: "#ffffff", cell: "#fff0ee",
      tile: "#ffd6db", tileInk: "#f2374b", hero: "#f2374b", heroInk: "#fff", heroNum: "#ffc23d",
      glow: "rgba(255,194,61,0.5)", today: "#ffc23d", todayInk: "#2a1a1c", todayShadow: "rgba(255,194,61,0.6)",
      seenA: "#3fd394", seenB: "#1fb57a", weekend: "#f2374b",
    },
    swatches: ["#f2374b", "#1fb57a", "#ffc23d"],
    legacy: { background: "#fff7f2", accent: "#f2374b", textColor: "#2a1a1c" },
  },
  {
    key: "caramelo",
    name: "Caramelo",
    description: "Dulce e infantil: rosa, azul y limón.",
    sortOrder: 3,
    keepsExistingRow: false,
    palette: {
      bg: "#fffaf3", ink: "#24202a", dim: "#77707f", line: "#f1dfe8", card: "#ffffff", cell: "#fff0f7",
      tile: "#d3f0fd", tileInk: "#4f8dff", hero: "#4f8dff", heroInk: "#fff", heroNum: "#ffe45c",
      glow: "rgba(255,228,92,0.55)", today: "#ffe45c", todayInk: "#24202a", todayShadow: "rgba(255,228,92,0.7)",
      seenA: "#ff9bcb", seenB: "#ff6fb5", weekend: "#ff6fb5",
    },
    swatches: ["#ff6fb5", "#4f8dff", "#ffe45c", "#4fc3f7"],
    legacy: { background: "#fffaf3", accent: "#4f8dff", textColor: "#24202a" },
  },
  {
    key: "noche",
    name: "Noche",
    description: "Oscuro elegante con dorado.",
    sortOrder: 4,
    keepsExistingRow: false,
    palette: {
      bg: "#10142a", ink: "#f3f1ff", dim: "#a4a8c8", line: "#2c3256", card: "#181d3a", cell: "#222852",
      tile: "#2a2f5e", tileInk: "#f5c451", hero: "linear-gradient(140deg,#2b2f6b,#5b3fd1)", heroInk: "#fff",
      heroNum: "#f5c451", glow: "rgba(245,196,81,0.3)", today: "#f5c451", todayInk: "#10142a",
      todayShadow: "rgba(245,196,81,0.45)", seenA: "#8f7bff", seenB: "#5b3fd1", weekend: "#ff8fb1",
    },
    swatches: ["#10142a", "#5b3fd1", "#f5c451"],
    legacy: { background: "#10142a", accent: "#f5c451", textColor: "#f3f1ff" },
  },
  {
    key: "nieve",
    name: "Nieve",
    description: "Frío y limpio: azules fríos y blanco.",
    sortOrder: 5,
    keepsExistingRow: true,
    palette: {
      bg: "#f2f8ff", ink: "#14233a", dim: "#64748b", line: "#d6e4f5", card: "#ffffff", cell: "#e8f2ff",
      tile: "#dcecff", tileInk: "#2f6bff", hero: "linear-gradient(140deg,#5aa9ff,#2f6bff)", heroInk: "#fff",
      heroNum: "#ffffff", glow: "rgba(255,255,255,0.35)", today: "#2f6bff", todayInk: "#fff",
      todayShadow: "rgba(47,107,255,0.4)", seenA: "#9fd0ff", seenB: "#5aa9ff", weekend: "#2f6bff",
    },
    swatches: ["#f2f8ff", "#5aa9ff", "#2f6bff"],
    legacy: { background: "#f2f8ff", accent: "#2f6bff", textColor: "#14233a" },
  },
  {
    key: "minimal",
    name: "Minimal",
    description: "Sobrio moderno: blanco y negro con un toque naranja.",
    sortOrder: 6,
    keepsExistingRow: false,
    palette: {
      bg: "#ffffff", ink: "#111111", dim: "#7a7a7a", line: "#e6e6e6", card: "#f6f6f6", cell: "#ffffff",
      tile: "#111111", tileInk: "#ffffff", hero: "#111111", heroInk: "#fff", heroNum: "#ff4d2e",
      glow: "rgba(255,77,46,0.25)", today: "#ff4d2e", todayInk: "#fff", todayShadow: "rgba(255,77,46,0.35)",
      seenA: "#3a3a3a", seenB: "#111111", weekend: "#ff4d2e",
    },
    swatches: ["#ffffff", "#111111", "#ff4d2e"],
    legacy: { background: "#ffffff", accent: "#ff4d2e", textColor: "#111111" },
  },
  {
    key: "tira-comica",
    name: "Tira Cómica",
    description: "Cómic: rojo, azul y amarillo con contorno negro.",
    sortOrder: 7,
    keepsExistingRow: true,
    palette: {
      bg: "#fdf8ec", ink: "#1a1a1a", dim: "#5c5650", line: "#1a1a1a", card: "#ffffff", cell: "#ffffff",
      tile: "#ffd23f", tileInk: "#1a1a1a", hero: "#e63946", heroInk: "#fff", heroNum: "#ffd23f",
      glow: "rgba(47,168,224,0.55)", today: "#ffd23f", todayInk: "#1a1a1a", todayShadow: "rgba(0,0,0,0)",
      seenA: "#2fa8e0", seenB: "#2fa8e0", weekend: "#e63946",
    },
    treatment: "comic",
    swatches: ["#e63946", "#2fa8e0", "#ffd23f", "#1a1a1a"],
    legacy: { background: "#fdf8ec", accent: "#e63946", textColor: "#1a1a1a" },
  },
  {
    key: "rojiblanco",
    name: "Rojiblanco",
    description: "Rayas rojas y blancas, sin escudo ni nombre de equipo.",
    sortOrder: 8,
    keepsExistingRow: true,
    palette: {
      bg: "#ffffff", ink: "#1a1a1a", dim: "#6b6b6b", line: "#e9d2d3", card: "#ffffff", cell: "#fbeeee",
      tile: "#1a1a1a", tileInk: "#ffffff", hero: "repeating-linear-gradient(90deg, #d61f26 0 22px, #ffffff 22px 44px)",
      heroInk: "#1a1a1a", heroNum: "#d61f26", glow: "rgba(0,0,0,0)", today: "#1a1a1a", todayInk: "#fff",
      todayShadow: "rgba(0,0,0,0.25)", seenA: "#e5484e", seenB: "#d61f26", weekend: "#d61f26",
    },
    treatment: "stripes-pill",
    swatches: ["#d61f26", "#ffffff", "#1a1a1a"],
    legacy: { background: "#ffffff", accent: "#1a1a1a", textColor: "#1a1a1a" },
  },
];
