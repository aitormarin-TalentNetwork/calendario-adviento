"use client";

import { useState } from "react";

/**
 * `creationKey` como campo oculto del formulario "+ Nuevo calendario" —
 * TAL-19 (React error #441 en producción, sin ninguna petición de red
 * disparada al enviar el formulario). La versión anterior generaba este
 * valor con `crypto.randomUUID()` directamente en el JSX de
 * `admin/page.tsx`, un Server Component async — un valor no determinista
 * calculado dentro del render de un Server Component es un patrón
 * conocido como inseguro: si Next.js llega a volver a ejecutar ese
 * componente más de una vez para la misma navegación (p. ej.
 * `createCalendarAction` llama a `revalidatePath("/admin")` antes de
 * `redirect(...)`, lo que fuerza una re-ejecución de `/admin` en segundo
 * plano para refrescar la caché del router — con un `randomUUID()`
 * distinto cada vez), el valor que ve el cliente en el payload RSC puede
 * no coincidir con el que quedó en el HTML servido, y React puede tratar
 * un mismatch en un campo de formulario como un error de hidratación en
 * vez de solo un warning.
 *
 * Corrección: el valor se genera aquí, en un Client Component, con
 * `useState(() => crypto.randomUUID())` — el inicializador de `useState`
 * corre UNA SOLA VEZ en el cliente, nunca en el servidor, así que queda
 * fuera de esta clase de problema por completo con independencia del
 * mecanismo exacto que la dispare. La garantía real de idempotencia sigue
 * viviendo en el servidor (`createCalendarForAdmin`, por `creationKey`
 * único) — este valor solo tiene que ser estable mientras no se recargue
 * la página, igual que antes.
 */
export function CreationKeyInput() {
  const [creationKey] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="creationKey" value={creationKey} />;
}
