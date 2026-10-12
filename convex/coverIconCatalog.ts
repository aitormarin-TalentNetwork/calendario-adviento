// TAL-60 — catálogo de iconos de portada (Lucide). Design System:
// `design/design-system.md` § "Estilo 2026 → Iconos". La compatibilidad con
// los emojis del catálogo antiguo (TAL-23) se retiró en TAL-72.
//
// Fichero NEUTRAL a propósito (sin `./_generated/server` ni nada de runtime
// de Convex), mismo patrón que `calendarErrorMessages.ts`: lo importan tanto
// las mutations de Convex (validación) como Next.js (selector,
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

export function isCoverIconName(value: string): value is CoverIconName {
  return COVER_ICON_NAME_SET.has(value);
}

/**
 * Lectura — nunca falla: cualquier dato (nombre del catálogo, campo ausente,
 * basura) se pinta con un icono del catálogo.
 * - nombre del catálogo → el mismo;
 * - `undefined`/vacío → `DEFAULT_COVER_ICON` (mismo respaldo de siempre);
 * - cualquier otra cosa → `FALLBACK_COVER_ICON`.
 *
 * TAL-72 retiró el respaldo emoji → Lucide de TAL-60: la migración de
 * producción (fase d) dejó 0 iconos fuera del catálogo, así que un emoji ya
 * es "cualquier otra cosa".
 */
export function normalizeCoverIcon(value: string | null | undefined): CoverIconName {
  if (value === undefined || value === null || value.trim() === "") return DEFAULT_COVER_ICON;
  if (isCoverIconName(value)) return value;
  return FALLBACK_COVER_ICON;
}

/**
 * Escritura (Convex y Server Action). Devuelve el valor A GUARDAR, o `null`
 * si se rechaza: solo se aceptan nombres del catálogo (TAL-72: ya no se
 * guardan emojis tal cual, ver `normalizeCoverIcon`).
 */
export function coverIconForWrite(value: string): string | null {
  return isCoverIconName(value) ? value : null;
}
