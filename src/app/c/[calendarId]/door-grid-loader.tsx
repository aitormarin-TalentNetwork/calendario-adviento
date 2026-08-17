"use client";

import { useEffect, useState } from "react";
import { getDoorsAction, type GetDoorsResult } from "@/app/c/[calendarId]/actions";
import { DoorGrid } from "@/app/c/[calendarId]/door-grid";

const COOKIE_NAME = "tz";

/**
 * Se usa en la primerísima visita de alguien al calendario, cuando
 * todavía no existe la cookie `tz` y `page.tsx` no ha resuelto ninguna
 * puerta en el servidor (ver comentario ahí — hallazgo de auditoría, TAL-8
 * ronda 2: resolverlas con un valor por defecto antes de conocer la zona
 * horaria real podía filtrar en la respuesta inicial contenido de un día
 * que ahí todavía es futuro). En cuanto monta, lee la zona horaria real
 * del navegador, dos cosas con ella: deja la cookie escrita (para que la
 * próxima visita ya entre por la vía rápida del servidor) y pide las
 * puertas ya resueltas correctamente — nada de contenido de días se manda
 * hasta este punto.
 */
export function DoorGridLoader({ calendarId, background }: { calendarId: string; background: string }) {
  const [result, setResult] = useState<GetDoorsResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(timeZone)}; path=/; max-age=31536000; samesite=lax`;

    getDoorsAction(calendarId, timeZone)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch(() => {
        // Fallo de red/servidor al pedir las puertas (no un `ok:false` de
        // negocio, que ya llega como valor normal más abajo) — sin este
        // catch, la promesa rechazada se quedaba sin gestionar y la
        // pantalla se quedaba en "Cargando…" para siempre (no bloqueante,
        // hallazgo de auditoría, ronda 3).
        if (!cancelled) setResult({ ok: false, reason: "network-error" });
      });
    return () => {
      cancelled = true;
    };
  }, [calendarId]);

  if (!result) {
    return <p style={{ color: "var(--accent)" }}>Cargando calendario…</p>;
  }
  if (!result.ok) {
    return (
      <p style={{ color: "var(--accent)" }}>
        {result.reason === "range-too-long"
          ? `Este calendario tiene un rango de fechas demasiado largo (${result.span} días) para mostrarlo aquí — contacta con quien lo administra.`
          : "No se ha podido cargar el calendario. Recarga la página."}
      </p>
    );
  }
  return <DoorGrid calendarId={calendarId} doors={result.doors} background={background} />;
}
