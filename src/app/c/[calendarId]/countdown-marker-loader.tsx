"use client";

import { useEffect, useState } from "react";
import { CoverText } from "@/components/cover-text";
import { parseDateOnlyUTC, todayDateStrInTimeZone } from "@/lib/calendar-grid";
import { daysUntil, formatCountdownMessage } from "@/lib/countdown";
import type { CoverTextTreatment } from "@/lib/skin-appearance";

/**
 * TAL-27, parte 2 — mismo patrón que `DoorGridLoader`: en la primerísima
 * visita (todavía sin cookie `tz`), el marcador no se resuelve en el
 * servidor con ningún valor por defecto tipo UTC — se calcula aquí, tras
 * montar, con la zona horaria real del navegador
 * (`todayDateStrInTimeZone`, `src/lib/calendar-grid.ts` — sin ninguna
 * dependencia de servidor, a diferencia de `todayInTimeZone`,
 * `src/lib/calendars.ts`, que no se puede importar desde un componente
 * cliente). No escribe la cookie `tz` — ya lo hace `DoorGridLoader`,
 * montado a la vez en esta misma página — solo lee `Intl` para el cálculo.
 */
export function CountdownMarkerLoader({
  endDate,
  label,
  treatment,
}: {
  endDate: string;
  label: string;
  treatment: CoverTextTreatment;
}) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const todayStr = todayDateStrInTimeZone(timeZone);
    const daysRemaining = daysUntil(parseDateOnlyUTC(todayStr), parseDateOnlyUTC(endDate));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- excepción deliberada: el valor depende de la zona horaria real del navegador, exclusivamente de cliente — mismo criterio que edit-calendar-form.tsx/days-grid-editor.tsx.
    setMessage(formatCountdownMessage(daysRemaining, label));
  }, [endDate, label]);

  return (
    <p style={{ marginTop: "0.5rem" }}>
      <CoverText treatment={treatment} style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", fontWeight: 700 }}>
        {message ?? " "}
      </CoverText>
    </p>
  );
}
