"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { CalendarCoverHeader } from "@/components/calendar-cover-header";
import { CoverIcon } from "@/components/cover-icon";
import { CountdownHero } from "@/components/countdown-hero";
import { skinStyleVars, skinTreatmentClass, type SkinStyle } from "@/lib/skin-style";

export type CalendarPreviewProps = {
  coverIcon: string;
  coverTitle: string;
  countdownLabel: string;
  // "YYYY-MM-DD" — puede llegar vacío/inválido mientras el Admin edita el
  // campo de fecha de fin (el bloque de la cuenta atrás muestra "…").
  endDate: string;
  backgroundImageUrl: string | null;
  /**
   * TAL-62 — estilo del skin seleccionado EN VIVO (catálogo 2026, o el
   * respaldo Alegre): la vista previa se pinta con las mismas variables
   * `--skin-*`, el mismo bloque de la cuenta atrás y el mismo tratamiento
   * que la portada real.
   */
  skinStyle: SkinStyle;
};

/**
 * TAL-29 — "hoy" se resuelve tras montar con la zona horaria real del
 * navegador (`todayDateStrInTimeZone`), nunca con un valor de servidor —
 * mismo criterio ya establecido para cualquier marcador de fecha
 * puramente decorativo en el Admin (`CountdownMarkerLoader`,
 * `edit-calendar-form.tsx` antes de esta tarea). "…" mientras tanto, y
 * también si `endDate` todavía no es una fecha válida (Admin ha borrado
 * temporalmente el campo) — mismo hallazgo de auditoría ya resuelto para
 * el texto suelto que este componente sustituye (TAL-27, ronda 1: NaN
 * tratado igual que "todavía no se sabe").
 */

/**
 * Vista previa en vivo del calendario en el editor de Admin (TAL-29,
 * `design/design-system.md` § "Vista previa en vivo"). Réplica en
 * miniatura (16:9, clicable) de la portada real que ve el Invitado ya
 * autenticado (`/c/[calendarId]`) — icono, título y marcador de cuenta
 * atrás reales, aunque salgan apretados en la miniatura (pedido explícito
 * de Aitor: mejor real y apretado que genérico y vacío). Clic en la
 * miniatura abre un diálogo con el mismo contenido a tamaño de
 * producción (3:4, ancho máx. 420px).
 *
 * TAL-49 — miniatura y diálogo renderizan su icono/título/countdown/fondo
 * a través de `CalendarCoverHeader` (`src/components/calendar-cover-header.tsx`),
 * el mismo componente que usa la portada real del Invitado
 * (`c/[calendarId]/page.tsx`) — mismo `skinBackgroundStyle`/
 * `resolveCoverTextTreatment`/`CoverText` en las tres superficies, sin
 * que cada una repita su propia llamada (motivo original del ticket:
 * TAL-47 tuvo que reconciliar esta vista previa a mano tras dejarla
 * desincronizada dos rondas seguidas). El layout SIGUE siendo propio de
 * cada superficie (centrado/compacto aquí, bloque simple en la portada
 * real) — `CalendarCoverHeader` no lo fuerza, ver el comentario completo
 * ahí de por qué eso es deliberado.
 *
 * La vista previa sigue alimentada por el estado del formulario SIN
 * GUARDAR (`fieldValues.skinId`/`endDate` en `edit-calendar-form.tsx`,
 * `useCountdownText` más abajo) — `CalendarCoverHeader` no hace ningún
 * fetch propio, solo recibe los datos ya resueltos, así que la
 * actualización en vivo (TAL-29) no se rompe.
 *
 * Patrón de diálogo (backdrop cierra al clicar fuera, Escape cierra, foco
 * inicial en el botón de cerrar, foco devuelto al disparador al cerrar) —
 * mismo ya establecido en `cover-icon-picker.tsx`, no un mecanismo nuevo.
 */
export function CalendarPreview({
  coverIcon,
  coverTitle,
  countdownLabel,
  endDate,
  backgroundImageUrl,
  skinStyle,
}: CalendarPreviewProps) {
  const background = skinStyle.palette.bg;
  const textColor = skinStyle.palette.ink;
  const textPill = false;
  const skinWrapperStyle = skinStyleVars(skinStyle);
  const treatmentClass = skinTreatmentClass(skinStyle);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  function closeDialog() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeDialog();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ver vista previa a tamaño completo"
        className={treatmentClass}
        data-skin-style={skinStyle.key}
        style={{
          ...skinWrapperStyle,
          display: "block",
          width: "100%",
          flex: 1,
          borderRadius: "12px",
          overflow: "hidden",
          boxShadow: "var(--shadow)",
          border: "none",
          padding: 0,
          aspectRatio: "16/9",
          cursor: "pointer",
        }}
      >
        <CalendarCoverHeader
          background={background}
          backgroundImageUrl={backgroundImageUrl}
          textColor={textColor}
          textPill={textPill}
          containerStyle={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "3px",
            padding: "8px",
            textAlign: "center",
          }}
          titleTagStyle={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
          titleStyle={{ fontWeight: 800, fontSize: "0.58rem", lineHeight: 1.15, textWrap: "balance" }}
          title={coverTitle}
          countdown={() => <CountdownHero compact daysRemaining={null} endDate={endDate} label={countdownLabel} />}
        >
          {/* TAL-60 — antes emoji con sombra; ahora icono Lucide en su
              recuadro, a la escala "apretada" de la miniatura. */}
          <CoverIcon value={coverIcon} size={14} box={26} />
        </CalendarCoverHeader>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Vista previa del calendario"
          onClick={closeDialog}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "1.5rem",
            zIndex: 50,
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            className={treatmentClass}
            data-skin-style={skinStyle.key}
            style={{ ...skinWrapperStyle, maxWidth: "420px", width: "100%", position: "relative" }}
          >
            <CalendarCoverHeader
              background={background}
              backgroundImageUrl={backgroundImageUrl}
              textColor={textColor}
              textPill={textPill}
              containerStyle={{
                borderRadius: "16px",
                overflow: "hidden",
                aspectRatio: "3/4",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                padding: "40px 32px",
                gap: "22px",
              }}
              titleStyle={{ fontWeight: 800, fontSize: "1.9rem", lineHeight: 1.25, textWrap: "balance" }}
              title={coverTitle}
              countdown={() => (
                <div style={{ width: "100%", textAlign: "left" }}>
                  <CountdownHero daysRemaining={null} endDate={endDate} label={countdownLabel} />
                </div>
              )}
            >
              {/* TAL-60 — el círculo translúcido con el emoji pasa a ser el
                  recuadro pastel con el icono Lucide (mismo componente que
                  la portada real, a mayor tamaño). */}
              <CoverIcon value={coverIcon} size={40} box={84} />
            </CalendarCoverHeader>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closeDialog}
              aria-label="Cerrar"
              style={{
                position: "absolute",
                top: "12px",
                right: "12px",
                background: "rgba(0,0,0,0.35)",
                color: "#ffffff",
                border: "none",
                width: "30px",
                height: "30px",
                borderRadius: "999px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
              }}
            >
              {/* TAL-60 — `X` de Lucide (antes ✕). */}
              <X size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
