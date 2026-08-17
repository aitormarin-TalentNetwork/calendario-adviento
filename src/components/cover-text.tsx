import type { CoverTextTreatment } from "@/lib/skin-appearance";

/**
 * TAL-47 — envoltorio de texto compartido entre las 4 superficies que
 * aplican `resolveCoverTextTreatment` (`src/lib/skin-appearance.ts`):
 * portada del Invitado, cabecera de mes del grid (Invitado y editor de
 * Admin) y modal de vídeo. Decide, según el `kind` del tratamiento, si el
 * texto va con color plano (+ `text-shadow` solo en el caso "photo") o
 * envuelto en una píldora de fondo semitransparente ("pill", 6 de 24
 * skins — degradado/rayas demasiado amplio para un color plano).
 *
 * Componente compartido a propósito, no duplicado en cada fichero — a
 * diferencia de otros casos de este proyecto donde SÍ se duplica algo
 * pequeño para no acoplar ficheros que tocan terminales distintas en
 * momentos distintos, este mismo cambio (TAL-47) introduce el patrón en
 * las 4 superficies A LA VEZ, en el mismo commit — no hay ningún otro
 * terminal cuyo trabajo pueda romperse por depender de este fichero
 * nuevo.
 */
export function CoverText({
  treatment,
  as: Tag = "span",
  style,
  children,
}: {
  treatment: CoverTextTreatment;
  as?: "span" | "div";
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  if (treatment.kind === "pill") {
    return (
      <Tag
        style={{
          ...style,
          display: "inline-block",
          color: treatment.color,
          background: treatment.pillBackground,
          padding: "0.2em 0.6em",
          borderRadius: "12px",
        }}
      >
        {children}
      </Tag>
    );
  }
  return (
    <Tag
      style={{
        ...style,
        color: treatment.color,
        textShadow: treatment.kind === "photo" ? treatment.textShadow : undefined,
      }}
    >
      {children}
    </Tag>
  );
}
