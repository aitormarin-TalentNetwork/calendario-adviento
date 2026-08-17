// TAL-23 — sugerencia no bloqueante de auditoría, ronda 1: `MAX_COVER_ICON_LENGTH`
// vivía duplicado a mano en `convex/calendars.ts` y `src/lib/cover-icons.ts`
// porque `src/lib/*` no es alcanzable desde `convex/*.ts` (rutas de
// bundling distintas). Mismo patrón que `calendarErrorMessages.ts`
// (TAL-20): fichero sin dependencias de runtime de Convex a propósito
// (nada de `./_generated/server`), así que SÍ puede importarse tal cual
// tanto desde las mutations de Convex como desde código de servidor de
// Next.js — la dirección correcta es esta (un fichero neutral bajo
// `convex/`), no al revés (`convex/*.ts` no puede importar de `src/lib/*`
// sin arrastrar el resto de ese módulo al bundle de Convex).
export const MAX_COVER_ICON_LENGTH = 16;
