"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarCoverHeader } from "@/components/calendar-cover-header";
import { CoverText } from "@/components/cover-text";
import { parseDateOnlyUTC, todayDateStrInTimeZone } from "@/lib/calendar-grid";
import { daysUntil, formatCountdownMessage } from "@/lib/countdown";

export type CalendarPreviewProps = {
  coverIcon: string;
  coverTitle: string;
  countdownLabel: string;
  // "YYYY-MM-DD" — puede llegar vacío/inválido mientras el Admin edita el
  // campo de fecha de fin (ver `useCountdownText` más abajo).
  endDate: string;
  // Ya resuelto por quien llama (`resolveSkinAppearance(skinId, skins)`)
  // — este componente no conoce Convex ni el catálogo de skins.
  background: string;
  backgroundImageUrl: string | null;
  textColor: string;
  textPill: boolean;
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
function useCountdownText(endDate: string, countdownLabel: string): string {
  const [todayStr, setTodayStr] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- excepción deliberada: el valor depende de la zona horaria real del navegador, exclusivamente de cliente — mismo criterio que countdown-marker-loader.tsx/edit-calendar-form.tsx.
    setTodayStr(todayDateStrInTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone));
  }, []);
  if (todayStr === null) return "…";
  const daysRemaining = daysUntil(parseDateOnlyUTC(todayStr), parseDateOnlyUTC(endDate));
  if (Number.isNaN(daysRemaining)) return "…";
  return formatCountdownMessage(daysRemaining, countdownLabel);
}

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
  background,
  backgroundImageUrl,
  textColor,
  textPill,
}: CalendarPreviewProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const countdownText = useCountdownText(endDate, countdownLabel);

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
        style={{
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
          titleStyle={{ fontFamily: "var(--font-display)", fontSize: "0.58rem", lineHeight: 1.15, textWrap: "balance" }}
          title={coverTitle}
          countdown={(treatment) => (
            <CoverText
              treatment={treatment}
              style={{ fontFamily: "var(--font-mono)", fontSize: "0.46rem", letterSpacing: "0.02em", whiteSpace: "nowrap" }}
            >
              {countdownText}
            </CoverText>
          )}
        >
          <span aria-hidden="true" style={{ fontSize: "1.1rem", filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.35))" }}>
            {coverIcon}
          </span>
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
          <div onClick={(event) => event.stopPropagation()} style={{ maxWidth: "420px", width: "100%", position: "relative" }}>
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
              titleStyle={{ fontFamily: "var(--font-display)", fontSize: "1.9rem", lineHeight: 1.25, textWrap: "balance" }}
              title={coverTitle}
              countdown={(treatment) => (
                <CoverText treatment={treatment} style={{ fontFamily: "var(--font-mono)", fontSize: "1rem", letterSpacing: "0.03em" }}>
                  {countdownText}
                </CoverText>
              )}
            >
              <div
                aria-hidden="true"
                style={{
                  width: "84px",
                  height: "84px",
                  borderRadius: "999px",
                  background: "rgba(246,241,228,0.16)",
                  border: "1px solid rgba(246,241,228,0.4)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "2.4rem",
                }}
              >
                {coverIcon}
              </div>
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
                color: "var(--paper)",
                border: "none",
                width: "30px",
                height: "30px",
                borderRadius: "999px",
                cursor: "pointer",
                fontSize: "1rem",
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
