"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  updateCalendarAction,
  type UpdateCalendarFieldValues,
  type UpdateCalendarState,
} from "@/app/admin/actions";
import { CoverIconPicker } from "@/app/admin/[calendarId]/cover-icon-picker";
import { SubmitButton } from "@/components/submit-button";
import { parseDateOnlyUTC, todayDateStrInTimeZone } from "@/lib/calendar-grid";
import { DEFAULT_COUNTDOWN_LABEL, MAX_COUNTDOWN_LABEL_LENGTH, daysUntil, formatCountdownMessage } from "@/lib/countdown";
import { DEFAULT_COVER_ICON } from "@/lib/cover-icons";

type EditCalendarFormProps = {
  calendar: {
    id: string;
    name: string;
    coverTitle: string;
    coverIcon: string;
    countdownLabel: string;
    startDate: Date;
    endDate: Date;
    skinId: string;
    coverImageUrl: string | null;
  };
  skins: { id: string; name: string }[];
};

function initialValues(calendar: EditCalendarFormProps["calendar"]): UpdateCalendarFieldValues {
  return {
    name: calendar.name,
    coverTitle: calendar.coverTitle,
    // El valor de respaldo (calendarios creados antes de TAL-23) ya se
    // resuelve más abajo, donde se lee el calendario (`getCalendarForAdminPage`,
    // `page.tsx`) — `calendar.coverIcon` aquí siempre llega con un valor
    // real, nunca vacío.
    coverIcon: calendar.coverIcon || DEFAULT_COVER_ICON,
    // Mismo criterio que `coverIcon` — el respaldo por defecto
    // (`DEFAULT_COUNTDOWN_LABEL`) ya se resolvió en `getCalendarForAdminPage`.
    countdownLabel: calendar.countdownLabel || DEFAULT_COUNTDOWN_LABEL,
    startDate: calendar.startDate.toISOString().slice(0, 10),
    endDate: calendar.endDate.toISOString().slice(0, 10),
    skinId: calendar.skinId,
    coverImageUrl: calendar.coverImageUrl ?? "",
  };
}

type EditCalendarFieldsProps = {
  fieldValues: UpdateCalendarFieldValues;
  setField: <K extends keyof UpdateCalendarFieldValues>(key: K, value: UpdateCalendarFieldValues[K]) => void;
  skins: { id: string; name: string }[];
};

/**
 * Separado de `EditCalendarForm` (hallazgo de auditoría, ronda 2) para
 * poder deshabilitar los campos mientras el envío está en curso:
 * `useFormStatus()` solo funciona en un descendiente del `<form>`, nunca
 * en el propio componente que renderiza la etiqueta `<form>` — no se puede
 * leer `pending` en `EditCalendarForm` mismo. Antes, solo el botón se
 * deshabilitaba (`SubmitButton`, mismo motivo) pero los campos seguían
 * editables durante la petición — si el admin seguía escribiendo mientras
 * `fetchMutation` estaba en curso, esa edición se perdía en cuanto llegaba
 * la respuesta y `EditCalendarForm` sincronizaba `fieldValues` con
 * `state.values` (la instantánea que se acababa de enviar, ya desfasada
 * frente a lo que el admin llevaba escrito mientras tanto).
 */
/**
 * TAL-27 — igual que `todayStr` en `days-grid-editor.tsx`: "hoy" para la
 * vista previa se resuelve tras montar, con la zona horaria real del
 * navegador (`todayDateStrInTimeZone`), nunca con la fecha cruda del
 * servidor — mismo criterio ya establecido para cualquier marcador de
 * fecha puramente decorativo en el Admin (TAL-21, hallazgos de auditoría
 * rondas 1 y 2). `null` mientras tanto: la vista previa no enseña ningún
 * número de días hasta que se resuelve, en vez de arriesgar un valor de UTC
 * que no coincida con la zona horaria real de quien mira.
 */
function useTodayStr(): string | null {
  const [todayStr, setTodayStr] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- excepción deliberada: el valor depende de la zona horaria real del navegador, exclusivamente de cliente — mismo criterio que days-grid-editor.tsx.
    setTodayStr(todayDateStrInTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone));
  }, []);
  return todayStr;
}

function EditCalendarFields({ fieldValues, setField, skins }: EditCalendarFieldsProps) {
  const { pending } = useFormStatus();
  const todayStr = useTodayStr();
  // Hallazgo no bloqueante de auditoría (TAL-27, ronda 1): si el Admin borra
  // temporalmente la fecha de fin, `parseDateOnlyUTC("")` da un `Date`
  // inválido (`NaN`) y el mensaje salía "Faltan NaN días para Y". `NaN` se
  // trata igual que "todavía no se sabe" (`null`) — mismo placeholder "…"
  // de más abajo, en vez de un número sin sentido.
  const rawPreviewDaysRemaining = todayStr
    ? daysUntil(parseDateOnlyUTC(todayStr), parseDateOnlyUTC(fieldValues.endDate))
    : null;
  const previewDaysRemaining =
    rawPreviewDaysRemaining !== null && !Number.isNaN(rawPreviewDaysRemaining) ? rawPreviewDaysRemaining : null;

  return (
    <>
      <label>
        Nombre del calendario
        <br />
        <input
          name="name"
          type="text"
          value={fieldValues.name}
          onChange={(e) => setField("name", e.target.value)}
          disabled={pending}
          required
        />
      </label>
      <label>
        Título de portada
        <br />
        <input
          name="coverTitle"
          type="text"
          value={fieldValues.coverTitle}
          onChange={(e) => setField("coverTitle", e.target.value)}
          disabled={pending}
          required
        />
      </label>
      <label>
        Icono de portada
        <CoverIconPicker
          value={fieldValues.coverIcon}
          onChange={(icon) => setField("coverIcon", icon)}
          disabled={pending}
        />
        {/* Campo oculto: el picker no es un <input> nativo (es una rejilla
            de botones), así que el valor seleccionado se manda al form
            explícitamente, igual que cualquier otro campo controlado de
            este formulario. */}
        <input type="hidden" name="coverIcon" value={fieldValues.coverIcon} />
      </label>
      <label>
        Fecha de inicio
        <br />
        <input
          name="startDate"
          type="date"
          value={fieldValues.startDate}
          onChange={(e) => setField("startDate", e.target.value)}
          disabled={pending}
          required
        />
      </label>
      <label>
        Fecha de fin
        <br />
        <input
          name="endDate"
          type="date"
          value={fieldValues.endDate}
          onChange={(e) => setField("endDate", e.target.value)}
          disabled={pending}
          required
        />
      </label>
      <label>
        Marcador de cuenta atrás
        <br />
        <input
          name="countdownLabel"
          type="text"
          value={fieldValues.countdownLabel}
          onChange={(e) => setField("countdownLabel", e.target.value)}
          disabled={pending}
          maxLength={MAX_COUNTDOWN_LABEL_LENGTH}
          placeholder={DEFAULT_COUNTDOWN_LABEL}
        />
      </label>
      <p style={{ color: "var(--text-dim)" }}>
        Vista previa:{" "}
        <span style={{ fontFamily: "var(--font-display)" }}>
          {previewDaysRemaining === null
            ? "…"
            : formatCountdownMessage(previewDaysRemaining, fieldValues.countdownLabel)}
        </span>
      </p>
      <label>
        Skin
        <br />
        <select
          name="skinId"
          value={fieldValues.skinId}
          onChange={(e) => setField("skinId", e.target.value)}
          disabled={pending}
          required
        >
          {skins.map((skin) => (
            <option key={skin.id} value={skin.id}>
              {skin.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Foto de portada (URL, opcional)
        <br />
        <input
          name="coverImageUrl"
          type="url"
          value={fieldValues.coverImageUrl}
          onChange={(e) => setField("coverImageUrl", e.target.value)}
          disabled={pending}
          placeholder="https://…"
        />
      </label>
    </>
  );
}

/**
 * TAL-20 — antes, este formulario invocaba `updateCalendarAction` como una
 * server action "de fuego y olvido" (`<form action={...}>` plano): si
 * `updateCalendarAction` lanzaba una excepción (p.ej. la validación de
 * Convex "hay un día fuera del rango nuevo", ya legítima desde TAL-12),
 * Next.js no tenía ningún resultado que renderizar y trataba la página
 * entera como si hubiera reventado — misma pantalla genérica que un fallo
 * de hidratación real, aunque la causa aquí no tuviera nada que ver con
 * hidratación.
 *
 * `useActionState` le da a la acción un canal de vuelta normal (el
 * `UpdateCalendarState` que devuelve) sin salir nunca del árbol de React
 * — un fallo de validación esperado se pinta como texto de error normal
 * en el propio formulario, no como una excepción sin capturar.
 *
 * Campos CONTROLADOS (hallazgo de auditoría, ronda 1): React resetea los
 * campos no controlados de un `<form action={...}>` en cuanto la action
 * TERMINA — con éxito o con error, "terminar" aquí es solo "la promesa se
 * resolvió sin lanzar", que es justo lo que hace `updateCalendarAction`
 * incluso cuando devuelve `{error: ...}`. Con campos no controlados, un
 * admin que se equivoca en un campo y acierta en el resto vería TODO el
 * formulario volver a los valores guardados en servidor al fallar, perdiendo
 * los cambios buenos junto con el malo. Al ser controlados por
 * `fieldValues` (estado de React, no del DOM), ese reset automático no
 * tiene nada que pisar — el valor mostrado siempre es el que gestiona
 * React, se sincroniza con lo último que devolvió el servidor
 * (`state.values`, lo que el admin acababa de enviar) en cada envío.
 *
 * Campos deshabilitados mientras el envío está en curso (hallazgo de
 * auditoría, ronda 2, ver `EditCalendarFields`): sin esto, sincronizar
 * `fieldValues` con `state.values` al terminar un envío pisaba sin
 * condición cualquier tecleo hecho DURANTE la petición en curso, no solo
 * el que llega después de que termine.
 */
export function EditCalendarForm({ calendar, skins }: EditCalendarFormProps) {
  const initialState: UpdateCalendarState = { error: null, values: initialValues(calendar) };
  const [state, formAction] = useActionState(updateCalendarAction.bind(null, calendar.id), initialState);
  const [fieldValues, setFieldValues] = useState(state.values);
  // Referencia al último `state` (el objeto entero que devuelve
  // `useActionState`, no `state.values`) ya sincronizado — para detectar
  // SOLO la transición real "terminó un envío nuevo", no "el usuario
  // escribió algo" (bug real encontrado probando esto: comparar contra
  // `state.values` directamente da un resultado distinto de `fieldValues`
  // en CUANTO el usuario teclea una vez, así que cualquier re-render
  // posterior por cualquier motivo ajeno — no solo un envío nuevo — volvía
  // a pisar lo que el usuario acababa de escribir).
  const [syncedState, setSyncedState] = useState(state);

  if (state !== syncedState) {
    setSyncedState(state);
    setFieldValues(state.values);
  }

  function setField<K extends keyof UpdateCalendarFieldValues>(key: K, value: UpdateCalendarFieldValues[K]) {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <form
      action={formAction}
      style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1.5rem" }}
    >
      {state.error ? (
        <p role="alert" style={{ color: "#c00" }}>
          {state.error}
        </p>
      ) : null}
      <EditCalendarFields fieldValues={fieldValues} setField={setField} skins={skins} />
      <SubmitButton>Guardar cambios</SubmitButton>
    </form>
  );
}
