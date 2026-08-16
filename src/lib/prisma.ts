// TAL-10 — Prisma/Postgres se retiran de la infraestructura del proyecto
// (migración a Convex, ver docs/stack.md). El grueso de las funciones de
// `src/lib/*.ts` que hacían consultas reales con este cliente ya se
// convirtió a stubs explícitos en esta misma tarea (cada fichero documenta
// su propio caso). Este objeto es una red de seguridad por si queda algún
// `prisma.…` suelto sin stubbear en algún componente/acción: falla alto y
// claro en el momento exacto en que se intenta usar, en vez de fallar de
// forma confusa por un import roto o, peor, devolver `undefined` en
// silencio.
//
// Tipado `any` a propósito: no vale la pena reconstruir a mano los tipos
// de Prisma que este proyecto pierde al quitar la dependencia, para una
// llamada que además va a lanzar en cuanto se invoque. La reescritura real
// de esta capa (Convex) es TAL-12+.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- ver comentario de arriba: `any` deliberado para no reconstruir a mano los tipos de Prisma, en una llamada que va a lanzar en cuanto se invoque.
export const prisma: any = new Proxy(
  {},
  {
    get(_target, prop) {
      throw new Error(
        `prisma.${String(prop)}: Prisma/Postgres se retiraron de la infraestructura en TAL-10 (migración a Convex). Pendiente de reescribir contra Convex en TAL-12+.`
      );
    },
  }
);
