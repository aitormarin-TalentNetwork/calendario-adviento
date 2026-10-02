"use client";

import { useEffect, useState } from "react";
import { parseDateOnlyUTC, todayDateStrInTimeZone } from "@/lib/calendar-grid";
import { countdownParts, daysUntil, type CountdownParts } from "@/lib/countdown";

/**
 * TAL-62 — bloque de la cuenta atrás del Estilo 2026
 * (`design/propuesta-skins-modernos.html`, `.hero`): etiqueta "Cuenta
 * atrás", número destacado y "para …", con los colores del skin
 * (`--skin-hero`, `--skin-hero-ink`, `--skin-hero-num`, `--skin-glow`) y su
 * tratamiento (`.skin-comic`, `.skin-stripes-pill`). CSS en `globals.css`,
 * bloque "TAL-62 — skins".
 *
 * Contraste (aprobado por el PM): todos los textos del bloque son TEXTO
 * GRANDE (≥ 18.66px en negrita), sin opacidad, y el halo es decorativo: el
 * contenido deja libre su esquina, así que nunca queda bajo texto.
 *
 * `compact` (miniatura de la vista previa del editor, decisión del PM tras
 * el NO-GO M1 del loop2): SIN texto — a ese tamaño sería texto pequeño y no
 * llega a 4,5:1 en varios skins. Tres barras decorativas (`aria-hidden`)
 * con los colores del skin ocupan el sitio de "Cuenta atrás", el número y
 * "para …"; los colores aprobados no se tocan.
 *
 * Mismo criterio de zona horaria que el resto de la portada: si el servidor
 * ya conoce "hoy" (cookie `tz`), llega `daysRemaining`; si no (primera
 * visita), se calcula en el navegador tras montar — nunca con un valor por
 * defecto tipo UTC.
 */
export function CountdownHero({
  daysRemaining,
  endDate,
  label,
  compact,
}: {
  daysRemaining: number | null;
  endDate: string;
  label: string;
  compact?: boolean;
}) {
  const [clientDays, setClientDays] = useState<number | null>(null);

  useEffect(() => {
    if (compact || daysRemaining !== null) return;
    const end = parseDateOnlyUTC(endDate);
    if (Number.isNaN(end.getTime())) return;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- excepción deliberada: el valor depende de la zona horaria real del navegador, exclusivamente de cliente — mismo criterio que countdown-marker-loader.tsx/calendar-preview.tsx.
    setClientDays(daysUntil(parseDateOnlyUTC(todayDateStrInTimeZone(timeZone)), end));
  }, [compact, daysRemaining, endDate]);

  if (compact) {
    return (
      <section className="skin-hero skin-hero-compact" aria-hidden="true" data-skin-hero>
        <span className="skin-hero-bar skin-hero-bar-label" />
        <span className="skin-hero-bar skin-hero-bar-num" />
        <span className="skin-hero-bar skin-hero-bar-for" />
      </section>
    );
  }

  const days = daysRemaining ?? clientDays;
  const parts: CountdownParts | null = days === null ? null : countdownParts(days, label);

  return (
    <section className="skin-hero" aria-label="Cuenta atrás" data-skin-hero>
      <span className="skin-hero-label">Cuenta atrás</span>
      {parts === null ? (
        <span className="skin-hero-big num" aria-hidden="true">
          …
        </span>
      ) : parts.kind === "today" ? (
        <span className="skin-hero-big">{parts.text}</span>
      ) : (
        <>
          <span className="skin-hero-big num">
            <span className="visually-hidden">{parts.prefix} </span>
            <span className="skin-hero-num">{parts.number}</span> {parts.unit}
          </span>
          <span className="skin-hero-for">{parts.forLabel}</span>
        </>
      )}
    </section>
  );
}
