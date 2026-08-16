/**
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura (migración a
 * Convex, ver docs/stack.md). Toda función que antes hacía una consulta o
 * escritura real con Prisma Client y todavía no tiene equivalente
 * conectado a Convex (TAL-12+) lanza esta clase — nunca se atrapa aquí
 * dentro para fingir un resultado vacío/con éxito: eso ocultaría un fallo
 * real como si fuera un estado válido (hallazgo de auditoría, ronda 1 —
 * `guest-calendar.ts` devolviendo `{ok:true, doors:[]}`, `guests.ts`
 * devolviendo `[]`/`"calendar-not-found"` cuando en realidad no se pudo
 * consultar nada, eran justo ese error).
 *
 * Quien llama (páginas, componentes, server actions) decide qué UI honesta
 * mostrar al capturarla — ver `tryDataLayer` más abajo para el caso de
 * lectura (páginas que renderizan una lista/ficha), y los propios
 * ficheros de escritura (que ya podían fallar en su forma normal de uso,
 * antes de esta tarea) para el caso de escritura, donde dejar propagar el
 * error tal cual ya es la señal honesta correcta.
 */
export class DataLayerUnavailableError extends Error {
  constructor(what: string) {
    super(
      `${what}: Prisma/Postgres se retiraron de la infraestructura en TAL-10 (migración a Convex). Pendiente de reescribir contra Convex en TAL-12+.`
    );
    this.name = "DataLayerUnavailableError";
  }
}

export type DataLayerResult<T> = { ok: true; data: T } | { ok: false };

/**
 * Envuelve una lectura que puede lanzar `DataLayerUnavailableError` y la
 * convierte en un resultado tipado — para que cada página muestre "esta
 * sección no está disponible ahora mismo" en vez de una lista vacía (que
 * parecería un dato real) o una pantalla de error cruda. Cualquier OTRO
 * tipo de error (uno que de verdad sea un fallo de la aplicación, no la
 * retirada de Prisma) se deja propagar tal cual — atraparlo todo aquí
 * enmascararía bugs reales, mismo criterio que el resto de manejo de
 * errores de este proyecto (ver `withSerializableRetry`/`alsoRetryOn` en
 * versiones anteriores de `src/lib/db-retry.ts`, TAL-7).
 */
export async function tryDataLayer<T>(fn: () => Promise<T>): Promise<DataLayerResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    if (err instanceof DataLayerUnavailableError) return { ok: false };
    throw err;
  }
}
