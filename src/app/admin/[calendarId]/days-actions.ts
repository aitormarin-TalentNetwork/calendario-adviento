"use server";

import { fetchMutation } from "convex/nextjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "../../../../convex/_generated/api";
import {
  CALENDAR_NO_LONGER_EXISTS_ERROR_MESSAGE,
  DAY_OUTSIDE_CALENDAR_RANGE_ERROR_MESSAGE,
} from "../../../../convex/calendarErrorMessages";
import type { Id } from "../../../../convex/_generated/dataModel";
import { parseUtcDateOnly } from "@/lib/calendars";
import { convexAppServerSecret } from "@/lib/convex-server";
import { extractConvexErrorMessage } from "@/lib/convex-error";
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

/**
 * TAL-45 — antes esta Server Action era "de fuego y olvido"
 * (`<form action={saveDayAction.bind(...)}>` plano): un error de
 * validación se escapaba como una excepción sin capturar, que Next.js
 * trataba como un fallo genérico de la página entera, y un guardado con
 * éxito no le daba a `days-grid-editor.tsx` ninguna señal fiable para
 * cerrar el diálogo solo — mismo motivo por el que TAL-45 pide cerrar el
 * diálogo automáticamente solo en el caso de éxito. Se cablea con
 * `useActionState` (mismo patrón ya auditado en `updateCalendarAction`,
 * `src/app/admin/actions.ts`, TAL-20): la action ya no lanza para errores
 * de validación esperables, devuelve un estado — `status: "success"` es
 * la única señal fiable de que ESTE guardado en concreto se completó
 * (distinta del estado inicial, que nunca es "success", y de un resultado
 * anterior, que `useActionState` sustituye por un objeto nuevo en cada
 * envío — nunca reutiliza la referencia de un guardado previo).
 */
export type SaveDayState = {
  status: "idle" | "error" | "success";
  error: string | null;
};

const GENERIC_SAVE_DAY_ERROR_MESSAGE = "No se pudo guardar el día. Inténtalo de nuevo.";

export async function saveDayAction(
  calendarId: string,
  dateStr: string,
  _prevState: SaveDayState,
  formData: FormData
): Promise<SaveDayState> {
  await requireCalendarAdmin(calendarId);

  // `dateStr` no viene de un campo editable por el Admin (se ata con
  // `.bind`, generado por el propio servidor a partir de la lista de días
  // — ver `days-grid-editor.tsx`), así que un fallo aquí es una
  // invariante rota de verdad, no una validación de formulario normal —
  // se deja como excepción de verdad, igual que antes.
  const date = parseUtcDateOnly(dateStr);
  if (!date) throw new Error("Fecha inválida.");

  const videoUrlRaw = formData.get("videoUrl")?.toString().trim();
  if (!videoUrlRaw) return { status: "error", error: "El vídeo es obligatorio." };
  if (videoUrlRaw.length > MAX_VIDEO_URL_LENGTH) {
    return { status: "error", error: `La URL del vídeo no puede superar los ${MAX_VIDEO_URL_LENGTH} caracteres.` };
  }
  let videoUrl: string;
  try {
    videoUrl = parseVideoUrl(videoUrlRaw).toString();
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : GENERIC_SAVE_DAY_ERROR_MESSAGE };
  }

  const messageRaw = formData.get("message")?.toString().trim();
  if (messageRaw && messageRaw.length > MAX_MESSAGE_LENGTH) {
    return { status: "error", error: `El mensaje no puede superar los ${MAX_MESSAGE_LENGTH} caracteres.` };
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
  //
  // TAL-45 — `upsertDayHandler` puede lanzar dos reglas de negocio reales
  // (calendario borrado entre medias, fecha que quedó fuera de rango tras
  // un cambio de rango en otra pestaña) — mismo criterio que
  // `updateCalendarAction`: se capturan y se reconocen por texto exacto
  // (`convex/calendarErrorMessages.ts`), cualquier otra cosa es un fallo
  // no reconocido con mensaje genérico, nunca el texto crudo de una
  // excepción no reconocida.
  try {
    await fetchMutation(api.days.upsertDayPublic, {
      serverSecret: convexAppServerSecret(),
      calendarId: calendarId as Id<"calendars">,
      date: dateStr,
      videoUrl,
      message,
    });
  } catch (err) {
    const cleaned = extractConvexErrorMessage(err);
    if (cleaned === DAY_OUTSIDE_CALENDAR_RANGE_ERROR_MESSAGE || cleaned === CALENDAR_NO_LONGER_EXISTS_ERROR_MESSAGE) {
      return { status: "error", error: cleaned };
    }
    console.error("saveDayAction: fallo inesperado al guardar el día", err);
    return { status: "error", error: GENERIC_SAVE_DAY_ERROR_MESSAGE };
  }

  revalidatePath(`/admin/${calendarId}`);
  return { status: "success", error: null };
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
