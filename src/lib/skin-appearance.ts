/**
 * TAL-24 — resuelve qué `background`/`accent` de skin (TAL-22) aplica a
 * un calendario concreto, con el respaldo del Design System cuando el
 * skin referenciado no tiene esos campos todavía o no se encuentra.
 *
 * No hace ninguna llamada a Convex por sí sola — recibe el catálogo ya
 * cargado (`skins.listAllPublic`, que tanto la página de Admin como la de
 * Invitado ya piden) y busca el `skinId` del calendario ahí, en vez de
 * añadir una consulta nueva por `id` (`skins.getByIdPublic`) — el
 * catálogo es pequeño (22 filas) y ya se pedía completo en la página de
 * Admin desde TAL-12, así que reutilizar esa misma llamada en la página
 * de Invitado (que hasta ahora no lo hacía) evita una función nueva de
 * Convex sin necesidad real, sin tocar `convex/skins.ts` (fuera de
 * alcance de esta tarea, ver brief).
 */

export type SkinAppearance = { background: string; accent: string };

export type SkinLike = {
  _id: string;
  background?: string;
  accent?: string;
};

/**
 * Respaldo cuando el skin referenciado no existe (calendario huérfano,
 * no debería pasar — `skinId` es requerido desde TAL-9) o todavía no
 * tiene `background`/`accent` (`v.optional` desde TAL-22, mientras el
 * catálogo compartido no se confirme migrado del todo — ver
 * `docs/skins.md` § "Migración segura"). Los tokens del Design System
 * (`--pine`/`--gold`) en vez de un hex fijo: si algún día cambian de
 * valor, este respaldo los sigue automáticamente sin tocar código.
 */
export const DEFAULT_SKIN_APPEARANCE: SkinAppearance = {
  background: "var(--pine)",
  accent: "var(--gold)",
};

export function resolveSkinAppearance(skinId: string, skins: SkinLike[]): SkinAppearance {
  const skin = skins.find((candidate) => candidate._id === skinId);
  if (!skin?.background || !skin.accent) return DEFAULT_SKIN_APPEARANCE;
  return { background: skin.background, accent: skin.accent };
}

/**
 * Corrección de auditoría, ronda 1 (TAL-24): texto blanco + `text-shadow`
 * SOLO no garantiza contraste legible sobre cualquier `background` del
 * catálogo — el skin "Nieve" llega hasta `#ffffff` puro, donde un texto
 * blanco encima es directamente invisible, con o sin sombra. En vez de
 * calcular un color de texto por skin (obligaría a "parsear" el string de
 * `background` para estimar su luminosidad, justo lo que el brief pide
 * evitar — "aplícalo directo, no intentes parsearlo"), se antepone una
 * capa de oscurecimiento uniforme semitransparente ANTES del `background`
 * del skin — `background` en CSS acepta una lista de capas separadas por
 * comas, pintadas de arriba a abajo en ese orden; la primera capa
 * (`rgba(0,0,0,0.6)` sólido) se compone SOBRE cualquier cosa que venga
 * después, sin importar si es un color sólido o cualquier tipo de
 * gradiente — mismo mecanismo (y opacidad de referencia, 0.55) que ya usa
 * este proyecto para garantizar texto legible sobre una miniatura de
 * vídeo arbitraria (`door-grid.tsx`/`days-grid-editor.tsx`, casilla
 * "visto": `linear-gradient(to top, rgba(10,16,12,0.55), transparent
 * 60%), url(...)`), no una técnica nueva sin precedente en este código.
 *
 * Contraste verificado matemáticamente (fórmula de contraste de WCAG 2.x,
 * `(L1+0.05)/(L2+0.05)`), no solo argumentado — el caso más exigente
 * posible es un `background` que llegue a blanco puro (`#ffffff`, el caso
 * real de "Nieve"): con la capa negra al 60% de opacidad encima, el color
 * compuesto resultante es `rgb(102,102,102)` (`255 × (1 − 0,6)`, la
 * fórmula de composición alfa simple que usa CSS al pintar dos capas), cuya luminancia
 * relativa es ≈0,133 — el texto blanco (`luminancia 1,0`) sobre eso da un
 * ratio de contraste ≈5,74:1, por encima del 4.5:1 que exige WCAG AA para
 * texto normal (y con margen: el 0,6 de opacidad se eligió por encima del
 * mínimo estricto ≈0,535 que ya bastaría solo para el caso de blanco
 * puro, para no depender de que ningún skin futuro del catálogo sea
 * literalmente MÁS claro que blanco). Contra cualquier `background` más
 * oscuro que blanco puro (el resto de los 22, y cualquier futuro) el
 * contraste resultante es siempre igual o mejor — blanco puro es,
 * matemáticamente, el peor caso posible para esta fórmula.
 */
export function coverBackgroundCss(background: string): string {
  return `linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.6)), ${background}`;
}
