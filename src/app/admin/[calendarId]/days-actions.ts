"use server";

import { redirect } from "next/navigation";
import { parseUtcDateOnly } from "@/lib/calendars";
import { getAuthorizedUser } from "@/lib/current-user";
import { DataLayerUnavailableError } from "@/lib/not-migrated";
import { resolveCalendarAccess } from "@/lib/roles";

/**
 * Misma comprobación que `requireCalendarAdmin` en
 * `src/app/admin/actions.ts` (TAL-5) — duplicada aquí a propósito en vez de
 * importada: ese fichero es de CRUD de calendario, no de días, y T2 lo está
 * tocando en paralelo para TAL-7. Son 6 líneas; el riesgo de una futura
 * divergencia es menor que el de dos terminales editando el mismo fichero a
 * la vez. Candidata a extraer a un helper compartido más adelante si hace
 * falta un tercer sitio que la necesite.
 */
async function requireCalendarAdmin(calendarId: string) {
  const user = await getAuthorizedUser();
  if (!user) redirect(`/login?callbackUrl=/admin/${calendarId}`);

  const access = await resolveCalendarAccess(user, calendarId);
  const isAdmin = access?.kind === "super-admin" || access?.role === "ADMIN";
  if (!isAdmin) redirect("/unauthorized");

  return user;
}

/**
 * Mismo criterio que `coverImageUrl` en `src/app/admin/actions.ts`: solo
 * https:, para no aceptar `javascript:`/`data:`/etc. Sin comprobación HTTP
 * de que la URL sirve de verdad un vídeo — eso abriría un vector de SSRF a
 * cambio de una validación no determinante (una URL rota simplemente no
 * reproduce, fallo visible y de bajo riesgo).
 */
function parseVideoUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("El vídeo debe ser una URL válida.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("El vídeo debe ser una URL https:// — no se aceptan otros esquemas por seguridad.");
  }
  return parsed;
}

// Límite defensivo, no de producto: evita filas con campos absurdamente
// largos (nadie necesita una URL o un mensaje de más de esto para un
// vídeo-regalo del calendario) — hallazgo de auditoría, ronda 1.
const MAX_VIDEO_URL_LENGTH = 2000;
const MAX_MESSAGE_LENGTH = 2000;

export async function saveDayAction(calendarId: string, dateStr: string, formData: FormData) {
  await requireCalendarAdmin(calendarId);

  const date = parseUtcDateOnly(dateStr);
  if (!date) throw new Error("Fecha inválida.");

  const videoUrlRaw = formData.get("videoUrl")?.toString().trim();
  if (!videoUrlRaw) throw new Error("El vídeo es obligatorio.");
  if (videoUrlRaw.length > MAX_VIDEO_URL_LENGTH) {
    throw new Error(`La URL del vídeo no puede superar los ${MAX_VIDEO_URL_LENGTH} caracteres.`);
  }
  const videoUrl = parseVideoUrl(videoUrlRaw).toString();

  const messageRaw = formData.get("message")?.toString().trim();
  if (messageRaw && messageRaw.length > MAX_MESSAGE_LENGTH) {
    throw new Error(`El mensaje no puede superar los ${MAX_MESSAGE_LENGTH} caracteres.`);
  }
  const message = messageRaw || null;

  // TAL-10 — Prisma/Postgres se retiran de la infraestructura: la
  // comprobación de rango + escritura real (antes una única transacción
  // con `FOR UPDATE` sobre la fila del Calendar, ver docs/dias.md — el
  // motivo de esa transacción sigue documentado ahí, este comentario no lo
  // repite) todavía no tiene equivalente conectado a Convex (TAL-12+).
  // Todo lo de arriba (fecha, longitud/formato de URL/mensaje) sigue
  // siendo validación real, sin tocar Prisma — se mantiene. Falla
  // explícitamente en vez de fingir que se guardó. `requireCalendarAdmin`
  // de arriba ya redirige a todo el mundo hoy (ver
  // src/lib/current-user.ts), pero esta llamada tenía que dejar de ser un
  // residuo real de Prisma (hallazgo de auditoría, ronda 1).
  void calendarId;
  void date;
  void videoUrl;
  void message;
  throw new DataLayerUnavailableError("saveDayAction");
}

export async function deleteDayAction(calendarId: string, dateStr: string) {
  await requireCalendarAdmin(calendarId);

  const date = parseUtcDateOnly(dateStr);
  if (!date) throw new Error("Fecha inválida.");

  // TAL-10 — Prisma/Postgres se retiran de la infraestructura: la
  // escritura real (antes `prisma.day.delete`, ver docs/dias.md) todavía
  // no tiene equivalente conectado a Convex (TAL-12+). Falla
  // explícitamente en vez de fingir que se borró. `requireCalendarAdmin`
  // de arriba ya redirige a todo el mundo hoy (ver
  // src/lib/current-user.ts), pero esta llamada tenía que dejar de ser un
  // residuo real de Prisma (hallazgo de auditoría, ronda 1).
  void calendarId;
  void date;
  throw new DataLayerUnavailableError("deleteDayAction");
}
