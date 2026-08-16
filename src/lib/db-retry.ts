import { Prisma } from "@/generated/prisma/client";

/**
 * Postgres aborta con SQLSTATE 40001 (serialization_failure) cuando dos
 * transacciones SERIALIZABLE tienen un conflicto de lectura/escritura real
 * — es el comportamiento esperado, no un fallo de la aplicación.
 *
 * Con el conector `@prisma/adapter-pg` de Prisma 7 esto NO llega como
 * `Prisma.PrismaClientKnownRequestError` con código P2034 (comprobado
 * disparando la condición de carrera de verdad con un script ad-hoc —
 * ver docs/invitados.md): llega como `DriverAdapterError`, con el SQLSTATE
 * real en `err.cause.originalCode`. Se comprueban las dos formas — la del
 * código de error clásico de Prisma por si algún día cambia de conector o
 * de versión de motor, y la del driver adapter actual, que es la que de
 * verdad se dispara hoy.
 */
function isSerializationFailure(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034") return true;

  const cause = (err as { cause?: { originalCode?: string } } | null | undefined)?.cause;
  return cause?.originalCode === "40001";
}

/**
 * Reintenta una transacción cuando Postgres la aborta por conflicto de
 * escritura bajo aislamiento SERIALIZABLE — una gana, la otra tiene que
 * repetirse desde el principio (con datos ya frescos, así que normalmente
 * basta un reintento).
 *
 * `alsoRetryOn` permite que un llamador concreto trate además otro error
 * como "hay que reintentar la transacción entera desde cero" — por
 * ejemplo, una violación de índice único (P2002) causada por otra
 * transacción concurrente que ganó la misma carrera: una vez esa violación
 * aborta la transacción de Postgres, ninguna consulta posterior DENTRO de
 * esa misma transacción puede "recuperarse" releyendo la fila (hallazgo de
 * auditoría, TAL-7 ronda 2, ver src/lib/roles.ts) — hay que reintentar
 * desde el principio en una transacción nueva. Deliberadamente no se trata
 * P2002 como reintentable por defecto para todo el mundo: en otros
 * contextos, un P2002 inesperado sería un error real de la aplicación, no
 * una carrera benigna, y tragárselo siempre podría enmascararlo.
 */
export async function withSerializableRetry<T>(
  run: () => Promise<T>,
  opts: { attempts?: number; alsoRetryOn?: (err: unknown) => boolean } = {}
): Promise<T> {
  const attempts = opts.attempts ?? 5;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await run();
    } catch (err) {
      const retryable = isSerializationFailure(err) || (opts.alsoRetryOn?.(err) ?? false);
      if (!retryable || attempt === attempts) throw err;
    }
  }
  throw new Error("withSerializableRetry: unreachable");
}
