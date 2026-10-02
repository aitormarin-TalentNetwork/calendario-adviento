// TAL-60 — catálogo de iconos de portada (Lucide) + compatibilidad con los
// emojis del catálogo antiguo (TAL-23). Design System: `design/design-system.md`
// § "Estilo 2026 → Iconos"; tabla emoji → icono ajustada por el PM.
//
// Fichero NEUTRAL a propósito (sin `./_generated/server` ni nada de runtime
// de Convex), mismo patrón que `calendarErrorMessages.ts`: lo importan tanto
// las mutations de Convex (validación, migración) como Next.js (selector,
// render). Solo datos y funciones puras — los componentes de Lucide viven en
// `src/lib/cover-icons.ts`, que Convex no debe arrastrar a su bundle.
//
// Restricción: todo nombre ≤ 16 caracteres. El backend anterior a TAL-60
// (`MAX_COVER_ICON_LENGTH = 16`) tiene que aceptar cualquier nombre del
// catálogo si hay que volver atrás con Convex (docs/iconos.md § "Rollback").
// Lo comprueba `e2e/tal-60-cover-icon-catalog.spec.ts`.

export const COVER_ICON_CATEGORIES = [
  {
    label: "Navidad",
    icons: [
      { name: "tree-pine", searchTerms: "árbol de navidad pino" },
      { name: "gift", searchTerms: "regalo" },
      { name: "snowflake", searchTerms: "copo de nieve" },
      { name: "bell", searchTerms: "campana" },
      { name: "candy-cane", searchTerms: "bastón de caramelo" },
      { name: "cookie", searchTerms: "galleta" },
      { name: "flame", searchTerms: "vela llama fuego" },
      { name: "cloud-snow", searchTerms: "nieve nube nevando" },
      { name: "mountain-snow", searchTerms: "montaña nevada" },
    ],
  },
  {
    label: "Fiesta",
    icons: [
      { name: "party-popper", searchTerms: "confeti fiesta" },
      { name: "balloon", searchTerms: "globo" },
      { name: "cake", searchTerms: "tarta cumpleaños" },
      { name: "cake-slice", searchTerms: "porción de tarta pastel" },
      { name: "wine", searchTerms: "brindis copa vino champán" },
      { name: "martini", searchTerms: "cóctel copa" },
      { name: "music", searchTerms: "música" },
      { name: "disc-3", searchTerms: "disco discoteca" },
      { name: "camera", searchTerms: "cámara fotos" },
    ],
  },
  {
    label: "Cariño",
    icons: [
      { name: "heart", searchTerms: "corazón amor" },
      { name: "hand-heart", searchTerms: "corazón en la mano cariño" },
      { name: "heart-handshake", searchTerms: "abrazo apretón de manos" },
      { name: "flower", searchTerms: "flor ramo" },
      { name: "rose", searchTerms: "rosa" },
      { name: "mail", searchTerms: "carta sobre" },
      { name: "book-heart", searchTerms: "libro de amor recuerdos" },
      { name: "gem", searchTerms: "joya diamante" },
      { name: "baby", searchTerms: "bebé" },
    ],
  },
  {
    label: "Naturaleza y cielo",
    icons: [
      { name: "star", searchTerms: "estrella" },
      { name: "sparkles", searchTerms: "destellos brillo" },
      { name: "sun", searchTerms: "sol" },
      { name: "moon", searchTerms: "luna" },
      { name: "moon-star", searchTerms: "luna y estrella noche" },
      { name: "rainbow", searchTerms: "arcoíris" },
      { name: "flower-2", searchTerms: "flor margarita" },
      { name: "clover", searchTerms: "trébol suerte" },
      { name: "plane", searchTerms: "avión viaje" },
    ],
  },
  {
    label: "Animales",
    icons: [
      { name: "rabbit", searchTerms: "conejo" },
      { name: "cat", searchTerms: "gato" },
      { name: "dog", searchTerms: "perro" },
      { name: "bird", searchTerms: "pájaro" },
      { name: "fish", searchTerms: "pez" },
      { name: "turtle", searchTerms: "tortuga" },
      { name: "squirrel", searchTerms: "ardilla" },
      { name: "paw-print", searchTerms: "huella pata animal" },
    ],
  },
] as const;

export type CoverIconName = (typeof COVER_ICON_CATEGORIES)[number]["icons"][number]["name"];

export const ALL_COVER_ICON_NAMES: readonly CoverIconName[] = COVER_ICON_CATEGORIES.flatMap((category) =>
  category.icons.map((icon) => icon.name)
);

const COVER_ICON_NAME_SET: ReadonlySet<string> = new Set(ALL_COVER_ICON_NAMES);

/** Icono de los calendarios nuevos y respaldo cuando `coverIcon` no existe (el mismo árbol que antes era 🎄). */
export const DEFAULT_COVER_ICON: CoverIconName = "tree-pine";

/** Respaldo de cualquier valor que no se reconozca (regla del Design System: "si no hay equivalente claro, regalo"). */
export const FALLBACK_COVER_ICON: CoverIconName = "gift";

/**
 * Los 45 emojis del catálogo de TAL-23 → su icono Lucide (tabla ajustada por
 * el PM, 2026-10-01). Clave SIN el selector de variación U+FE0F (ver
 * `stripVariationSelector`), así "❄" y "❄️" son la misma entrada.
 * 🐼 → paw-print: `panda` no está en el catálogo nuevo (decisión de T2 por
 * coherencia con 🐻, comunicada a la Directora).
 */
export const LEGACY_EMOJI_TO_COVER_ICON: Readonly<Record<string, CoverIconName>> = {
  // Navidad
  "🎄": "tree-pine",
  "🎁": "gift",
  "❄": "snowflake",
  "☃": "snowflake",
  "🔔": "bell",
  "🕯": "flame",
  "🧑‍🎄": "gift",
  "🦌": "paw-print",
  "🍪": "cookie",
  // Fiesta
  "🎉": "party-popper",
  "🎊": "party-popper",
  "🥳": "party-popper",
  "🎈": "balloon",
  "🍾": "wine",
  "🥂": "wine",
  "🪩": "disc-3",
  "🎂": "cake",
  "🎆": "sparkles",
  // Cariño
  "❤": "heart",
  "💕": "heart",
  "💖": "heart",
  "💐": "flower",
  "🌹": "rose",
  "😍": "heart",
  "🤗": "heart-handshake",
  "💌": "mail",
  "😻": "cat",
  // Naturaleza y cielo
  "⭐": "star",
  "🌟": "star",
  "💫": "sparkles",
  "✨": "sparkles",
  "🌈": "rainbow",
  "☀": "sun",
  "🌙": "moon",
  "🌸": "flower-2",
  "🌻": "flower",
  // Animales y fantasía (catálogo antiguo)
  "🦄": "sparkles",
  "🐱": "cat",
  "🐶": "dog",
  "🐰": "rabbit",
  "🐻": "paw-print",
  "🦋": "flower-2",
  "🐼": "paw-print",
  "🐧": "bird",
  "🦊": "paw-print",
};

function stripVariationSelector(value: string): string {
  return value.replace(/️/g, "");
}

export function isCoverIconName(value: string): value is CoverIconName {
  return COVER_ICON_NAME_SET.has(value);
}

export function isLegacyCoverEmoji(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(LEGACY_EMOJI_TO_COVER_ICON, stripVariationSelector(value));
}

/**
 * Lectura — nunca falla. Es la capa de compatibilidad de TAL-60: cualquier
 * dato (nombre nuevo, emoji antiguo sin migrar, campo ausente, basura) se
 * pinta con un icono del catálogo.
 * - nombre del catálogo → el mismo;
 * - emoji del catálogo antiguo → su equivalente;
 * - `undefined`/vacío → `DEFAULT_COVER_ICON` (mismo respaldo de siempre);
 * - cualquier otra cosa → `FALLBACK_COVER_ICON`.
 */
export function normalizeCoverIcon(value: string | null | undefined): CoverIconName {
  if (value === undefined || value === null || value.trim() === "") return DEFAULT_COVER_ICON;
  if (isCoverIconName(value)) return value;
  return LEGACY_EMOJI_TO_COVER_ICON[stripVariationSelector(value)] ?? FALLBACK_COVER_ICON;
}

/**
 * Escritura (Convex y Server Action). Devuelve el valor A GUARDAR, o `null`
 * si se rechaza:
 * - nombre del catálogo → el mismo;
 * - emoji del catálogo antiguo → el MISMO emoji, sin convertir. Así, mientras
 *   el Next anterior a TAL-60 siga sirviendo durante el despliegue, lo que él
 *   escribe sigue siendo un emoji que él sabe pintar — nunca ve un nombre
 *   Lucide. Los emojis restantes los convierte la migración
 *   (`convex/coverIconMigration.ts`), una vez el Next antiguo ya no sirve.
 * - cualquier otra cosa → `null`.
 */
export function coverIconForWrite(value: string): string | null {
  if (isCoverIconName(value)) return value;
  if (isLegacyCoverEmoji(value)) return value;
  return null;
}
