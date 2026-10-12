export type CalendarStatus = "upcoming" | "live" | "finished";

/**
 * Estado de un calendario según sus fechas: "upcoming" (Próximo), "live" (En
 * marcha) o "finished" (Terminado). Módulo PURO (sin imports de servidor),
 * para que lo usen tanto `convex/superadmin.ts` (panel /superadmin, TAL-15)
 * como "Mis calendarios" (`src/app/admin/page.tsx`, TAL-74) con la misma
 * regla: una sola definición.
 *
 * `now`/`startDate`/`endDate` son strings "YYYY-MM-DD" (día natural, sin
 * hora — ver docs/convex-modelo-de-datos.md § "Fechas como día natural"),
 * comparables directamente por orden lexicográfico. `now` lo calcula
 * Next.js antes de llamar (no hay zona horaria por invitado que aplicar
 * aquí — es un resumen de administración global, no la puerta de un
 * calendario concreto, mismo criterio de "esto no es el flujo sensible a
 * zona horaria de TAL-8" que ya se aplicaba en la versión Prisma con
 * `new Date()` del servidor).
 */
export function calendarStatus(startDate: string, endDate: string, now: string): CalendarStatus {
  if (now < startDate) return "upcoming";
  if (now > endDate) return "finished";
  return "live";
}
