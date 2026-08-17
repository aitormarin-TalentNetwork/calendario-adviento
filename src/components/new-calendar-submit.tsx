"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { createCalendarAction, type CreateCalendarState } from "@/app/admin/actions";
import { MAX_CALENDAR_NAME_LENGTH } from "../../convex/calendarNameConstants";

/**
 * `creationKey` del formulario "+ Nuevo calendario" — TAL-19 (React error
 * #441 en producción, sin ninguna petición de red disparada al enviar el
 * formulario).
 *
 * Ronda 1 (corregida aquí): mover la generación de `crypto.randomUUID()`
 * de `admin/page.tsx` (Server Component) a un Client Component con
 * `useState(() => crypto.randomUUID())` NO bastaba — hallazgo de
 * auditoría: `"use client"` no exime a un componente de ejecutarse
 * también durante el SSR inicial. El inicializador de `useState` corre
 * tanto en el servidor (SSR, el UUID queda emitido en el HTML servido)
 * como al crear el estado durante la hidratación del cliente — dos
 * invocaciones de `crypto.randomUUID()`, dos valores distintos, EXACTAMENTE
 * el mismo mismatch de antes, solo movido de fichero.
 *
 * Corrección real: el valor se asigna DESPUÉS de montar, dentro de un
 * `useEffect` — los efectos nunca corren durante SSR (ni durante la
 * propia hidratación), así que no hay ningún momento en el que el
 * servidor y el cliente puedan discrepar sobre qué UUID renderizar: el
 * servidor (y el primer render del cliente, antes de que el efecto
 * corra) siempre pintan el mismo valor estable (`""`, cadena vacía) — solo
 * DESPUÉS de que la hidratación ya haya terminado con éxito se sustituye
 * por el UUID real, un `setState` posterior normal y corriente, no una
 * discrepancia de hidratación.
 *
 * TAL-26 — el mismo cuidado aplica ahora al campo `name`: es un valor que
 * depende de lo que el Admin teclee, así que tiene que vivir como estado
 * de React normal (controlado), no como algo calculado durante el
 * render/SSR — sin relación con el problema de no-determinismo del
 * `creationKey` de arriba (el nombre SÍ puede empezar vacío en servidor y
 * cliente por igual, sin discrepancia), pero sigue el mismo patrón que
 * `EditCalendarForm` (TAL-20): campo controlado + `useActionState` para
 * que un error de validación se pinte en el propio formulario en vez de
 * perder lo que el Admin ya había escrito.
 */
export function NewCalendarSubmit() {
  const initialState: CreateCalendarState = { error: null, name: "" };
  const [state, formAction] = useActionState(createCalendarAction, initialState);
  const [name, setName] = useState(state.name);

  const [creationKey, setCreationKey] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- excepción deliberada: el valor tiene que ser exclusivamente de cliente (no determinista, no debe calcularse durante el render/SSR — ver el porqué completo arriba), no "sincronizar con un sistema externo" en el sentido que asume esta regla.
    setCreationKey(crypto.randomUUID());
  }, []);

  return (
    <form action={formAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {state.error ? (
        <p role="alert" style={{ color: "#c00" }}>
          {state.error}
        </p>
      ) : null}
      <NewCalendarFields name={name} setName={setName} />
      <input type="hidden" name="creationKey" value={creationKey ?? ""} />
      <SubmitButton disabled={creationKey === null} />
    </form>
  );
}

type NewCalendarFieldsProps = {
  name: string;
  setName: (value: string) => void;
};

/**
 * Separado de `NewCalendarSubmit` por el mismo motivo que
 * `EditCalendarFields`/`EditCalendarForm` (TAL-20): `useFormStatus()`
 * solo funciona en un descendiente del `<form>`, nunca en el propio
 * componente que renderiza la etiqueta `<form>`.
 */
function NewCalendarFields({ name, setName }: NewCalendarFieldsProps) {
  const { pending } = useFormStatus();
  return (
    <input
      name="name"
      type="text"
      value={name}
      onChange={(e) => setName(e.target.value)}
      disabled={pending}
      placeholder="Nombre del calendario"
      maxLength={MAX_CALENDAR_NAME_LENGTH}
      required
      autoFocus
    />
  );
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled}>
      {pending ? "…" : "+ Nuevo calendario"}
    </button>
  );
}
