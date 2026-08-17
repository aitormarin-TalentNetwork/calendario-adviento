"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  updateCalendarAction,
  type UpdateCalendarFieldValues,
  type UpdateCalendarState,
} from "@/app/admin/actions";
import { CoverIconPicker } from "@/app/admin/[calendarId]/cover-icon-picker";
import { SkinPicker, type SkinOption } from "@/app/admin/[calendarId]/skin-picker";
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
    backgroundImageUrl: string | null;
  };
  skins: SkinOption[];
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
    backgroundImageUrl: calendar.backgroundImageUrl ?? "",
  };
}

type EditCalendarFieldsProps = {
  fieldValues: UpdateCalendarFieldValues;
  setField: <K extends keyof UpdateCalendarFieldValues>(key: K, value: UpdateCalendarFieldValues[K]) => void;
  skins: SkinOption[];
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

/**
 * TAL-33 — "Datos del calendario" en dos columnas
 * (design/design-system.md § "Editor de calendario"): izquierda = solo
 * fechas, derecha = nombre/título/icono/skin. `countdownLabel` (+ vista
 * previa) y `coverImageUrl` no están en el mockup (`propuesta-editor-
 * calendario.html` es previo a TAL-27 y nunca tuvo una URL de foto de
 * portada) — se añaden al FINAL de la columna derecha, después de los
 * cuatro campos que sí describe el mockup explícitamente, en vez de
 * inventar una tercera sección sin fuente de diseño.
 *
 * Cada fila usa la clase `.editor-field` (`globals.css`) — etiqueta a la
 * izquierda del input en desktop, apilada en mobile (`design-system.md`
 * § "Formularios"/"Responsive"). Ya no hay `<label>` envolviendo el
 * `<input>` (eran hermanos en una fila `flex`, no anidados) — `htmlFor`/
 * `id` explícitos para mantener el mismo comportamiento de accesibilidad
 * (clic en la etiqueta enfoca el campo).
 *
 * TAL-37 — la fila "Skin" pasa de `<select>` de texto a `SkinPicker`
 * (galería de muestras de color). Sin `htmlFor`/`id` (no es un `<input>`
 * nativo, mismo motivo que el campo de icono) y con la clase adicional
 * `.editor-field-skin` (`globals.css`, no un `style` inline: un inline
 * `alignItems` ganaría también en mobile y rompería el `align-items:
 * stretch` que el `@media` de `.editor-field` necesita ahí — ver el
 * comentario en `globals.css`) — en desktop alinea la etiqueta arriba en
 * vez de centrada, porque la galería puede envolver a varias líneas con
 * 22+ skins, más alta que una fila de texto normal.
 *
 * TAL-39 — "Imagen de fondo (URL, opcional)" justo debajo de "Skin"
 * (brief: "junto al selector de skin"), campo propio e independiente de
 * `coverImageUrl` (esa es la foto redonda de portada; esta se aplica
 * como fondo en grid/modal/página del Invitado, ver `skin-appearance.ts`).
 */
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
    <div className="editor-columns">
      <div className="editor-col">
        <div className="editor-field">
          <label htmlFor="calendar-startDate">Fecha de inicio</label>
          <input
            id="calendar-startDate"
            name="startDate"
            type="date"
            value={fieldValues.startDate}
            onChange={(e) => setField("startDate", e.target.value)}
            disabled={pending}
            required
          />
        </div>
        <div className="editor-field">
          <label htmlFor="calendar-endDate">Fecha de fin</label>
          <input
            id="calendar-endDate"
            name="endDate"
            type="date"
            value={fieldValues.endDate}
            onChange={(e) => setField("endDate", e.target.value)}
            disabled={pending}
            required
          />
        </div>
      </div>

      <div className="editor-col">
        <div className="editor-field">
          <label htmlFor="calendar-name">Nombre del calendario</label>
          <input
            id="calendar-name"
            name="name"
            type="text"
            value={fieldValues.name}
            onChange={(e) => setField("name", e.target.value)}
            disabled={pending}
            required
          />
        </div>
        <div className="editor-field">
          <label htmlFor="calendar-coverTitle">Título de portada</label>
          <input
            id="calendar-coverTitle"
            name="coverTitle"
            type="text"
            value={fieldValues.coverTitle}
            onChange={(e) => setField("coverTitle", e.target.value)}
            disabled={pending}
            required
          />
        </div>
        <div className="editor-field">
          <label>Icono de portada</label>
          <CoverIconPicker
            value={fieldValues.coverIcon}
            onChange={(icon) => setField("coverIcon", icon)}
            disabled={pending}
          />
          {/* Campo oculto: el picker no es un <input> nativo (es un botón +
              diálogo), así que el valor seleccionado se manda al form
              explícitamente, igual que cualquier otro campo controlado de
              este formulario. */}
          <input type="hidden" name="coverIcon" value={fieldValues.coverIcon} />
        </div>
        <div className="editor-field editor-field-skin">
          <label>Skin</label>
          <SkinPicker
            value={fieldValues.skinId}
            onChange={(skinId) => setField("skinId", skinId)}
            skins={skins}
            disabled={pending}
          />
          {/* Campo oculto: la galería de muestras no es un <select> nativo
              (son botones), así que el valor elegido se manda al form
              explícitamente — mismo criterio que `coverIcon` (CoverIconPicker)
              más arriba. */}
          <input type="hidden" name="skinId" value={fieldValues.skinId} />
        </div>
        <div className="editor-field">
          <label htmlFor="calendar-backgroundImageUrl">Imagen de fondo (URL, opcional)</label>
          <input
            id="calendar-backgroundImageUrl"
            name="backgroundImageUrl"
            type="url"
            value={fieldValues.backgroundImageUrl}
            onChange={(e) => setField("backgroundImageUrl", e.target.value)}
            disabled={pending}
            placeholder="https://…"
          />
        </div>
        <div className="editor-field">
          <label htmlFor="calendar-countdownLabel">Marcador de cuenta atrás</label>
          <input
            id="calendar-countdownLabel"
            name="countdownLabel"
            type="text"
            value={fieldValues.countdownLabel}
            onChange={(e) => setField("countdownLabel", e.target.value)}
            disabled={pending}
            maxLength={MAX_COUNTDOWN_LABEL_LENGTH}
            placeholder={DEFAULT_COUNTDOWN_LABEL}
          />
        </div>
        <p style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
          Vista previa:{" "}
          <span style={{ fontFamily: "var(--font-display)" }}>
            {previewDaysRemaining === null
              ? "…"
              : formatCountdownMessage(previewDaysRemaining, fieldValues.countdownLabel)}
          </span>
        </p>
        <div className="editor-field">
          <label htmlFor="calendar-coverImageUrl">Foto de portada (URL, opcional)</label>
          <input
            id="calendar-coverImageUrl"
            name="coverImageUrl"
            type="url"
            value={fieldValues.coverImageUrl}
            onChange={(e) => setField("coverImageUrl", e.target.value)}
            disabled={pending}
            placeholder="https://…"
          />
        </div>
      </div>
    </div>
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
      <div style={{ fontSize: "0.78rem", textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-dim)" }}>
        Datos del calendario
      </div>
      <EditCalendarFields fieldValues={fieldValues} setField={setField} skins={skins} />
      <SubmitButton>Guardar cambios</SubmitButton>
    </form>
  );
}
