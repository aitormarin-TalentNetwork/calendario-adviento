import { DataLayerUnavailableError } from "@/lib/not-migrated";

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
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: lanza
 * `DataLayerUnavailableError` en vez de `{ok:true, doors:[]}` (hallazgo de
 * auditoría, ronda 1 — una rejilla vacía se leería como "este calendario
 * no tiene ningún día desbloqueado todavía", un hecho falso, no "no se
 * pudo consultar"; y `{ok:false, reason:"range-too-long"}` habría sido
 * directamente mentira sobre el rango del calendario). Quien llama debe
 * usar `tryDataLayer` y mostrar un mensaje honesto de "no disponible".
 */
export async function resolveDoors(calendarId: string, userId: string, today: Date): Promise<DoorGridResult> {
  void calendarId;
  void userId;
  void today;
  throw new DataLayerUnavailableError("resolveDoors");
}

export type MarkViewedResult = { ok: true } | { ok: false; error: "not-found" | "locked" };

/**
 * Marca un día como visto por un usuario — ver `docs/dias.md` para el
 * resto de reglas (idempotencia, revalidación de rango en servidor).
 *
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: lanza en vez
 * de devolver `{ok:false, error:"not-found"}` (hallazgo de auditoría,
 * ronda 1 — ese día casi seguro SÍ existe, solo que no se pudo comprobar;
 * "not-found" sería un motivo inventado). Escritura sin representación de
 * "vacío" razonable — falla explícitamente, mismo criterio que el resto de
 * escrituras de este proyecto.
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
  throw new DataLayerUnavailableError("markDayViewed");
}
