"use client";

import { useEffect, useState } from "react";
import { useFormStatus } from "react-dom";

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
 * El botón queda deshabilitado mientras `creationKey` todavía sea `null`
 * (los primeros milisegundos tras montar, antes de que el efecto corra) —
 * nunca se puede enviar el formulario sin un `creationKey` real.
 */
export function NewCalendarSubmit() {
  const [creationKey, setCreationKey] = useState<string | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- excepción deliberada: el valor tiene que ser exclusivamente de cliente (no determinista, no debe calcularse durante el render/SSR — ver el porqué completo arriba), no "sincronizar con un sistema externo" en el sentido que asume esta regla.
    setCreationKey(crypto.randomUUID());
  }, []);

  const { pending } = useFormStatus();

  return (
    <>
      <input type="hidden" name="creationKey" value={creationKey ?? ""} />
      <button type="submit" disabled={pending || creationKey === null}>
        {pending ? "…" : "+ Nuevo calendario"}
      </button>
    </>
  );
}
