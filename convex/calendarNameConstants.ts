// TAL-26 — mismo patrón que convex/coverIconConstants.ts (TAL-23) /
// convex/calendarErrorMessages.ts (TAL-20): fichero sin dependencias de
// runtime de Convex a propósito (nada de `./_generated/server`), para
// poder importarse tal cual tanto desde las mutations de Convex como
// desde código de servidor de Next.js (`src/app/admin/actions.ts`).
export const MAX_CALENDAR_NAME_LENGTH = 100;
