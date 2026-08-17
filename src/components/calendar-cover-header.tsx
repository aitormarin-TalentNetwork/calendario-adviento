import { CoverText } from "@/components/cover-text";
import { resolveCoverTextTreatment, skinBackgroundStyle, type CoverTextTreatment } from "@/lib/skin-appearance";

export type CalendarCoverHeaderProps = {
  background: string;
  backgroundImageUrl: string | null;
  textColor: string;
  textPill: boolean;
  // Contenido completo del título — incluye el icono SOLO si va en línea
  // con el texto (portada real del Invitado, `page.tsx`). Si el icono va
  // aparte (círculo decorativo de la vista previa del editor de Admin),
  // no forma parte de este prop — se pasa como `children` (ver abajo),
  // fuera de `CoverText`, porque los layouts de icono difieren de verdad
  // entre superficies (no es solo una cuestión de tamaño).
  title: React.ReactNode;
  titleTag?: "h1" | "div";
  // Estilos del propio `<TitleTag>` — SOLO layout/clamp, nunca color (eso
  // lo decide `CoverText` con `treatment`, más abajo). Separado de
  // `titleStyle` porque la rama "pill" de `CoverText` fuerza `display:
  // inline-block` en su propio nodo — un `-webkit-box`/`WebkitLineClamp`
  // puesto ahí en vez de aquí se rompería para los 6 skins con píldora
  // (ver `cover-text.tsx`).
  titleTagStyle?: React.CSSProperties;
  titleStyle?: React.CSSProperties;
  // La cuenta atrás ya resuelta por quien llama (texto server-side
  // (portada real, con cookie `tz`), o el `<CountdownMarkerLoader>`
  // cliente para la primerísima visita sin cookie, o el `useCountdownText`
  // puramente cliente de la vista previa del editor) — este componente
  // NUNCA la calcula ni hace fetch por su cuenta (ni a Convex ni al reloj
  // del navegador, TAL-49: la vista previa en vivo del editor sigue
  // alimentada por el estado del formulario sin guardar, nunca por un
  // fetch). Recibe el `treatment` ya resuelto AQUÍ — única llamada a
  // `resolveCoverTextTreatment` para toda la cabecera — para que
  // `CountdownMarkerLoader` (que también lo necesita) no tenga que
  // recalcularlo por su lado.
  countdown: (treatment: CoverTextTreatment) => React.ReactNode;
  // Fusionado con el fondo calculado (`skinBackgroundStyle`) en el `<div>`
  // contenedor — cada superficie decide su propio layout (centrado/flex
  // de la vista previa del editor vs. bloque simple de la portada real).
  containerStyle?: React.CSSProperties;
  // Se pinta ANTES del título, dentro del mismo contenedor — icono en su
  // propio bloque/círculo decorativo, botón de cerrar del diálogo... No
  // pasa por `CoverText`: cada superficie decide su propio tratamiento si
  // lo necesita (un emoji no se tiñe por `color` de todas formas).
  children?: React.ReactNode;
};

/**
 * TAL-49 — cabecera/portada compartida entre la portada real del Invitado
 * (`c/[calendarId]/page.tsx`) y la vista previa del editor de Admin
 * (`admin/[calendarId]/calendar-preview.tsx`, miniatura 16:9 y diálogo a
 * tamaño completo): mismo cálculo de `skinBackgroundStyle`/
 * `resolveCoverTextTreatment` y el mismo `CoverText` para el título y la
 * cuenta atrás en las tres superficies, en vez de que cada una repita su
 * propia llamada — así una tarea futura que cambie esta lógica (como
 * TAL-47) ya no puede dejar una superficie desincronizada por olvido,
 * tiene que tocar necesariamente el mismo sitio para las tres.
 *
 * Deliberadamente NO fuerza el mismo layout visual en las tres — la
 * portada real es un bloque simple alineado a la izquierda con el icono
 * en línea con el título; la vista previa del editor es un layout
 * centrado en flex con el icono aparte (círculo decorativo en el
 * diálogo, encima del título en la miniatura, con clamp de 2 líneas) —
 * esas diferencias son deliberadas (la miniatura tiene que verse
 * "apretada" a propósito, pedido explícito de Aitor) y no son la fuente
 * real del riesgo de desincronización que motivó este ticket (que era el
 * color/fondo, no el layout) — `containerStyle`/`titleTagStyle`/
 * `titleStyle`/`children` dejan que cada superficie mantenga su propio
 * layout mientras comparten la lógica que sí importa.
 *
 * Sin `"use client"` — no usa hooks ni APIs de navegador, así que sirve
 * tal cual tanto desde un Server Component (`page.tsx`) como desde uno de
 * Cliente (`calendar-preview.tsx`).
 */
export function CalendarCoverHeader({
  background,
  backgroundImageUrl,
  textColor,
  textPill,
  title,
  titleTag: TitleTag = "div",
  titleTagStyle,
  titleStyle,
  countdown,
  containerStyle,
  children,
}: CalendarCoverHeaderProps) {
  const treatment = resolveCoverTextTreatment({ textColor, textPill }, !!backgroundImageUrl);
  const backgroundStyle = skinBackgroundStyle(background, backgroundImageUrl);

  return (
    <div style={{ ...containerStyle, ...backgroundStyle }}>
      {children}
      <TitleTag style={titleTagStyle}>
        <CoverText treatment={treatment} style={titleStyle}>
          {title}
        </CoverText>
      </TitleTag>
      {countdown(treatment)}
    </div>
  );
}
