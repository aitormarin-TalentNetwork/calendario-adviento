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

export type SkinAppearance = {
  background: string;
  accent: string;
  // TAL-47 — color de texto propio del skin (sustituye la capa de
  // oscurecimiento + `text-shadow` fijos de TAL-24). `textPill` marca los
  // 6 skins cuyo rango de degradado/rayas es demasiado amplio para un
  // color plano — llevan una píldora de fondo semitransparente detrás
  // del texto en vez de aplicarlo directo. Ver `resolveCoverTextTreatment`
  // más abajo, el consumidor real de estos dos campos.
  textColor: string;
  textPill: boolean;
};

export type SkinLike = {
  _id: string;
  background?: string;
  accent?: string;
  textColor?: string;
  textPill?: boolean;
};

/**
 * Respaldo cuando el skin referenciado no existe (calendario huérfano,
 * no debería pasar — `skinId` es requerido desde TAL-9) o todavía no
 * tiene `background`/`accent`/`textColor` (`v.optional` desde TAL-22/
 * TAL-47, mientras el catálogo compartido no se confirme migrado del
 * todo — ver `docs/skins.md` § "Migración segura"). Los tokens del
 * Design System (`--pine`/`--gold`/`--paper`) en vez de un hex fijo: si
 * algún día cambian de valor, este respaldo los sigue automáticamente
 * sin tocar código. `textPill: false` — el respaldo es un fondo oscuro
 * (`--pine`) con texto claro (`--paper`), combinación que ya tiene
 * contraste de sobra sin necesitar píldora.
 */
export const DEFAULT_SKIN_APPEARANCE: SkinAppearance = {
  background: "var(--pine)",
  accent: "var(--gold)",
  textColor: "var(--paper)",
  textPill: false,
};

export function resolveSkinAppearance(skinId: string, skins: SkinLike[]): SkinAppearance {
  const skin = skins.find((candidate) => candidate._id === skinId);
  if (!skin?.background || !skin.accent || !skin.textColor) return DEFAULT_SKIN_APPEARANCE;
  return { background: skin.background, accent: skin.accent, textColor: skin.textColor, textPill: skin.textPill ?? false };
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

export type CoverBackgroundStyle =
  | { background: string; backgroundImage?: never; backgroundSize?: never; backgroundPosition?: never }
  | { background?: never; backgroundImage: string; backgroundSize: string; backgroundPosition: string };

/**
 * TAL-39 — cuando el calendario tiene `backgroundImageUrl`, la imagen
 * SUSTITUYE el color/degradado del skin como base visual en los mismos
 * sitios donde TAL-24 ya aplicaba `coverBackgroundCss(background)`
 * (cabecera de mes del grid, cabecera de portada del Invitado, modal de
 * vídeo) — el acento del skin (`--accent`) sigue gobernando puertas/
 * casillas/bordes/"hoy"/píldoras sin relación con esta función, y
 * `skinId` sigue siendo obligatorio siempre (brief: la imagen convive con
 * el skin, no lo sustituye como dato).
 *
 * Misma capa de oscurecimiento uniforme que `coverBackgroundCss` (mismo
 * motivo/contraste verificado matemáticamente ahí arriba), antepuesta a la
 * imagen en vez de al `background` del skin. `backgroundImage` (longhand),
 * no el shorthand `background`, para poder acompañarla de
 * `backgroundSize`/`backgroundPosition` — mismo criterio ya establecido en
 * `days-grid-editor.tsx`/`door-grid.tsx` para las miniaturas de vídeo de
 * las casillas "visto" (`style.backgroundImage = ...`). Corregido
 * (TAL-29): la primera versión de esta función SÍ mezclaba el shorthand
 * `background` con `backgroundSize`/`backgroundPosition` en el mismo
 * objeto de estilo — válido en CSS estático de una sola pasada (el
 * shorthand gana y ya, sin re-render de por medio), pero React avisa en
 * consola ("don't mix shorthand and non-shorthand properties") en cuanto
 * ese estilo se aplica a través de un componente que puede re-renderizar
 * con esos valores — no se detectó en TAL-39 porque sus 3 consumidores
 * (`door-grid.tsx`/`days-grid-editor.tsx`/`page.tsx`) montan
 * `backgroundImageUrl` una vez por carga de página, sin cambiar en vivo;
 * TAL-29 sí lo cambia en vivo (vista previa reactiva a lo que teclea el
 * Admin) y ahí se manifestó en consola por primera vez. Sin imagen, se
 * comporta exactamente igual que antes (`coverBackgroundCss` a secas,
 * shorthand `background` SOLO — sin mezclar con las otras dos, así que no
 * hace falta tocar ese caso).
 */
export function coverBackgroundStyle(background: string, backgroundImageUrl?: string | null): CoverBackgroundStyle {
  if (backgroundImageUrl) {
    return {
      backgroundImage: `linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.6)), url("${backgroundImageUrl}")`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  return { background: coverBackgroundCss(background) };
}

/**
 * TAL-47 — reemplaza a `coverBackgroundStyle` (arriba) en las superficies
 * que ya adoptaron `textColor`/`textPill`: portada del Invitado, cabecera
 * de mes del grid (Invitado y editor de Admin), modal de vídeo, y el
 * fondo a pantalla completa (TAL-46/47 núcleo). Diferencia clave: SIN la
 * capa de oscurecimiento cuando no hay `backgroundImageUrl` — el
 * contraste ya lo garantiza `textColor`, verificado matemáticamente por
 * skin (`scripts/verify-tal47-textcolor-wcag.mjs`), así que esa capa ya
 * no hace falta ahí y solo apagaba los colores reales del skin (motivo
 * original del cambio, pedido de Aitor probando en real). CON
 * `backgroundImageUrl` (foto arbitraria subida por el Admin, sin
 * `textColor` propio verificado) SÍ mantiene la misma capa de
 * oscurecimiento que antes — sigue siendo necesaria ahí; ese caso queda
 * fuera de alcance de TAL-47 (que es sobre el color de texto del SKIN,
 * no sobre fotos arbitrarias sin verificar).
 *
 * `coverBackgroundStyle` (arriba) se queda TAL CUAL, sin tocar — sigue en
 * uso por `calendar-preview.tsx` (TAL-29, vista previa del editor de
 * Admin), que todavía no ha adoptado `textColor` (fuera de alcance de
 * esta ronda de TAL-47) y necesita seguir garantizando contraste con
 * texto blanco fijo — de ahí que esta sea una función NUEVA en vez de
 * modificar la existente: cambiar `coverBackgroundStyle` in-place habría
 * roto silenciosamente el contraste de esa vista previa (sigue mostrando
 * texto blanco fijo, sin capa oscura, sobre skins claros).
 */
export function skinBackgroundStyle(background: string, backgroundImageUrl?: string | null): CoverBackgroundStyle {
  if (backgroundImageUrl) {
    return {
      backgroundImage: `linear-gradient(rgba(0,0,0,0.6), rgba(0,0,0,0.6)), url("${backgroundImageUrl}")`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  return { background };
}

export type CoverTextTreatment =
  | { kind: "photo"; color: string; textShadow: string }
  | { kind: "flat"; color: string }
  | { kind: "pill"; color: string; pillBackground: string };

// 0.7, NO 0.6 (la píldora de "visto" del grid, la referencia original del
// brief de TAL-47) — subida tras un hallazgo real de
// `scripts/verify-tal47-textcolor-wcag.mjs`: "rojiblanco" (rayas
// verticales rojo/blanco puro) fallaba WCAG AA en su parada blanca con
// 0.6 (4.20:1); con 0.7 pasa con margen (5.96:1) sin perjudicar a los
// otros 5 skins con píldora. Ver `docs/skins.md` § "textColor" para el
// detalle completo.
const TEXT_PILL_BACKGROUND = "rgba(15,24,18,0.7)";

/**
 * TAL-47 — decide CÓMO mostrar el texto (título/número/marcador) sobre el
 * fondo resuelto por `skinBackgroundStyle`: tres casos.
 *
 * - `backgroundImageUrl` puesto ("photo"): mismo tratamiento de siempre
 *   (blanco + `text-shadow`) — una foto arbitraria no tiene `textColor`
 *   verificado, así que se mantiene el mecanismo que SÍ garantiza
 *   contraste sin conocer los colores de antemano.
 * - Sin foto, `textPill: true` ("pill"): el color de texto del skin
 *   sobre una píldora de fondo semitransparente (`TEXT_PILL_BACKGROUND`)
 *   en vez de directo sobre el degradado — 6 de 24 skins, los que un
 *   color plano no cubre en todo su rango (ver `docs/skins.md`).
 * - Sin foto, `textPill: false` ("flat"): el color de texto del skin
 *   directo, sin capa ni sombra ni píldora — el caso normal, 18 de 24
 *   skins, ya verificado WCAG AA contra el peor caso real de su
 *   degradado/rayas.
 */
export function resolveCoverTextTreatment(
  appearance: Pick<SkinAppearance, "textColor" | "textPill">,
  hasBackgroundImage: boolean
): CoverTextTreatment {
  if (hasBackgroundImage) {
    return { kind: "photo", color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,0.5)" };
  }
  if (appearance.textPill) {
    return { kind: "pill", color: appearance.textColor, pillBackground: TEXT_PILL_BACKGROUND };
  }
  return { kind: "flat", color: appearance.textColor };
}
