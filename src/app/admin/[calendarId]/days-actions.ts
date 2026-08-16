"use server";

import { fetchMutation } from "convex/nextjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { parseUtcDateOnly } from "@/lib/calendars";
import { convexAppServerSecret } from "@/lib/convex-server";
import { getAuthorizedUser } from "@/lib/current-user";
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
  const message = messageRaw || undefined;

  // TAL-13 — reconectado contra Convex. La comprobación de rango +
  // escritura real vive ahora en `days.ts::upsertDayHandler` (antes una
  // única transacción con `FOR UPDATE` sobre la fila del Calendar, ver
  // docs/dias.md para el motivo original de esa transacción y cómo se
  // traduce). `date` se manda como el string "YYYY-MM-DD" ya validado por
  // `parseUtcDateOnly` arriba — no el `Date` que devuelve esa función:
  // Convex guarda fechas como día natural en ese mismo formato (ver
  // docs/convex-modelo-de-datos.md § "Fechas como día natural"), así que
  // no hace falta (ni conviene) un viaje de ida y vuelta por `Date`.
  await fetchMutation(api.days.upsertDayPublic, {
    serverSecret: convexAppServerSecret(),
    calendarId: calendarId as Id<"calendars">,
    date: dateStr,
    videoUrl,
    message,
  });

  revalidatePath(`/admin/${calendarId}`);
}

export async function deleteDayAction(calendarId: string, dateStr: string) {
  await requireCalendarAdmin(calendarId);

  if (!parseUtcDateOnly(dateStr)) throw new Error("Fecha inválida.");

  // TAL-13 — reconectado contra Convex. `deleteDayHandler` (convex/days.ts)
  // es idempotente por sí mismo (si el día ya no existe, no hace nada) —
  // ya no hace falta el catch de "P2025" de la versión Prisma, era
  // específico de ese error de Prisma. También borra en cascada las
  // `dayViews` asociadas (decisión de producto cerrada con Aitor, ver
  // brief de esta tarea — mismo comportamiento que tenía Prisma por
  // defecto vía `onDelete: Cascade`).
  await fetchMutation(api.days.deleteDayPublic, {
    serverSecret: convexAppServerSecret(),
    calendarId: calendarId as Id<"calendars">,
    date: dateStr,
  });

  revalidatePath(`/admin/${calendarId}`);
}
