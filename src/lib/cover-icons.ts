/**
 * Catálogo de iconos de portada (TAL-23) — Design System
 * (`design/design-system.md` § "Selector de icono de portada (Admin)"),
 * fuente `design/propuesta-skins.html`. Constante de frontend a
 * propósito, no un enum acoplado a validación estricta en Convex ni
 * registros de una tabla (a diferencia de `skins`, TAL-12/TAL-22) — el
 * brief pide explícitamente que ampliar la lista más adelante sea tocar
 * este array, no cambiar lógica en varios sitios. Cada icono lleva un
 * `searchTerms` en español para el buscador (`🔍 Buscar icono…`) — el
 * mockup no especifica el texto de búsqueda de cada emoji (es un `<div>`
 * estático, sin JS real), así que esta es una decisión de implementación,
 * no de fidelidad visual: términos cortos y directos en español, no
 * nombres técnicos de Unicode.
 */
import { MAX_COVER_ICON_LENGTH } from "../../convex/coverIconConstants";

// Reexportado desde el fichero neutral compartido con Convex (sugerencia
// no bloqueante de auditoría, TAL-23 ronda 1 — antes vivía duplicado a
// mano aquí y en `convex/calendars.ts`) — ver
// `convex/coverIconConstants.ts` para el porqué de vivir ahí y no aquí.
export { MAX_COVER_ICON_LENGTH };

export type CoverIconCategory = {
  label: string;
  icons: { emoji: string; searchTerms: string }[];
};

export const COVER_ICON_CATEGORIES: CoverIconCategory[] = [
  {
    label: "Navidad",
    icons: [
      { emoji: "🎄", searchTerms: "árbol de navidad" },
      { emoji: "🎁", searchTerms: "regalo" },
      { emoji: "❄️", searchTerms: "copo de nieve" },
      { emoji: "☃️", searchTerms: "muñeco de nieve" },
      { emoji: "🔔", searchTerms: "campana" },
      { emoji: "🕯️", searchTerms: "vela" },
      { emoji: "🧑‍🎄", searchTerms: "papá noel santa" },
      { emoji: "🦌", searchTerms: "reno" },
      { emoji: "🍪", searchTerms: "galleta" },
    ],
  },
  {
    label: "Fiesta",
    icons: [
      { emoji: "🎉", searchTerms: "confeti fiesta" },
      { emoji: "🎊", searchTerms: "confeti bola" },
      { emoji: "🥳", searchTerms: "cara de fiesta" },
      { emoji: "🎈", searchTerms: "globo" },
      { emoji: "🍾", searchTerms: "champán botella brindis" },
      { emoji: "🥂", searchTerms: "brindis copas" },
      { emoji: "🪩", searchTerms: "bola de discoteca" },
      { emoji: "🎂", searchTerms: "tarta cumpleaños" },
      { emoji: "🎆", searchTerms: "fuegos artificiales" },
    ],
  },
  {
    label: "Cariño",
    icons: [
      { emoji: "❤️", searchTerms: "corazón rojo amor" },
      { emoji: "💕", searchTerms: "corazones" },
      { emoji: "💖", searchTerms: "corazón brillante" },
      { emoji: "💐", searchTerms: "ramo de flores" },
      { emoji: "🌹", searchTerms: "rosa" },
      { emoji: "😍", searchTerms: "cara enamorada" },
      { emoji: "🤗", searchTerms: "abrazo" },
      { emoji: "💌", searchTerms: "carta de amor" },
      { emoji: "😻", searchTerms: "gato enamorado" },
    ],
  },
  {
    label: "Naturaleza y cielo",
    icons: [
      { emoji: "⭐", searchTerms: "estrella" },
      { emoji: "🌟", searchTerms: "estrella brillante" },
      { emoji: "💫", searchTerms: "destello mareo" },
      { emoji: "✨", searchTerms: "destellos brillo" },
      { emoji: "🌈", searchTerms: "arcoíris" },
      { emoji: "☀️", searchTerms: "sol" },
      { emoji: "🌙", searchTerms: "luna" },
      { emoji: "🌸", searchTerms: "flor de cerezo" },
      { emoji: "🌻", searchTerms: "girasol" },
    ],
  },
  {
    label: "Animales y fantasía",
    icons: [
      { emoji: "🦄", searchTerms: "unicornio" },
      { emoji: "🐱", searchTerms: "gato" },
      { emoji: "🐶", searchTerms: "perro" },
      { emoji: "🐰", searchTerms: "conejo" },
      { emoji: "🐻", searchTerms: "oso" },
      { emoji: "🦋", searchTerms: "mariposa" },
      { emoji: "🐼", searchTerms: "panda" },
      { emoji: "🐧", searchTerms: "pingüino" },
      { emoji: "🦊", searchTerms: "zorro" },
    ],
  },
];

export const ALL_COVER_ICONS: string[] = COVER_ICON_CATEGORIES.flatMap((cat) => cat.icons.map((i) => i.emoji));

/**
 * Valor de respaldo para calendarios creados antes de TAL-23 (el campo
 * `coverIcon` es `v.optional()` en el schema, ver `convex/schema.ts`) y
 * para cualquier calendario nuevo si por lo que sea no llega ninguno —
 * el mismo 🎄 que antes estaba fijo dentro del texto de `coverTitle`
 * (brief de TAL-23, punto 7: "no dejar portadas sin icono").
 */
export const DEFAULT_COVER_ICON = "🎄";
