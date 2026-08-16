export type DoorState = "locked" | "unseen" | "watched";

export type DoorInfo = {
  dateStr: string;
  label: string;
  isToday: boolean;
  state: DoorState;
  // Solo se rellenan para puertas desbloqueadas — una puerta bloqueada no
  // debe filtrar en el HTML el vídeo/mensaje de un día futuro aunque el
  // Admin ya lo tenga asignado (defensa en profundidad: no depender solo
  // de que la UI no la deje pinchar).
  dayId: string | null;
  videoUrl: string | null;
  message: string | null;
};

export type DoorGridResult =
  | { ok: true; doors: DoorInfo[] }
  | { ok: false; reason: "range-too-long"; span: number };

/**
 * Resuelve el estado de cada puerta del calendario para un Invitado
 * concreto — ver `docs/dias.md`/`docs/convex-modelo-de-datos.md` para las
 * reglas completas (bloqueado/sin ver/visto, límite de rango gestionable).
 *
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: la consulta
 * real (`Calendar` + `Day` + `DayView` del usuario) todavía no tiene
 * equivalente conectado a Convex (TAL-12+). `{ok:true, doors:[]}` es la
 * degradación segura ya contemplada por el tipo de retorno — una rejilla
 * vacía, no un error inventado sobre el rango del calendario (`reason:
 * "range-too-long"` significaría algo que no es cierto).
 */
export async function resolveDoors(calendarId: string, userId: string, today: Date): Promise<DoorGridResult> {
  void calendarId;
  void userId;
  void today;
  return { ok: true, doors: [] };
}

export type MarkViewedResult = { ok: true } | { ok: false; error: "not-found" | "locked" };

/**
 * Marca un día como visto por un usuario — ver `docs/dias.md` para el
 * resto de reglas (idempotencia, revalidación de rango en servidor).
 *
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: la escritura
 * real (`DayView` upsert) todavía no tiene equivalente conectado a Convex
 * (TAL-12+). Se devuelve `{ok:false, error:"not-found"}` — degradación
 * segura ya contemplada por el tipo de retorno (la UI, `door-grid.tsx`, ya
 * sabe mostrar "no se ha podido guardar" ante cualquier `ok:false`) en vez
 * de fingir que se guardó.
 */
export async function markDayViewed(
  calendarId: string,
  dayId: string,
  userId: string,
  today: Date
): Promise<MarkViewedResult> {
  void calendarId;
  void dayId;
  void userId;
  void today;
  return { ok: false, error: "not-found" };
}
