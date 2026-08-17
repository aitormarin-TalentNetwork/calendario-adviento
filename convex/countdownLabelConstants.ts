// TAL-27 — mismo patrón que `coverIconConstants.ts` (TAL-23): fichero
// neutral bajo `convex/`, sin ningún import de runtime de Convex, para que
// tanto las mutations de Convex como el código de servidor de Next.js
// (`src/lib/countdown.ts`, que lo reexporta) puedan importarlo tal cual.
export const MAX_COUNTDOWN_LABEL_LENGTH = 100;
