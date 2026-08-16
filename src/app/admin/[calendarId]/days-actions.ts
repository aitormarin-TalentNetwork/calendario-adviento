"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseUtcDateOnly } from "@/lib/calendars";
import { getAuthorizedUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
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

  // Comprobar el rango del calendario y guardar el día en una única
  // transacción, con `FOR UPDATE` sobre la fila del Calendar (hallazgo de
  // auditoría, ronda 1): sin esto, había una ventana entre leer el rango y
  // guardar el Day en la que otra petición podía reducir el rango del
  // calendario (updateCalendarAction, TAL-5) justo en medio — el Day
  // quedaba fuera del rango nuevo, oculto en el listado pero reapareciendo
  // si el rango se ampliaba después. El `FOR UPDATE` bloquea esa fila del
  // Calendar hasta que esta transacción termina, así que un
  // `calendar.update()` concurrente sobre el mismo calendario espera a que
  // esto acabe (o al revés) en lugar de intercalarse.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- prisma.ts exporta `prisma` como `any` (TAL-10, Prisma se retira de la infraestructura) — esta llamada es inalcanzable hoy (ver requireCalendarAdmin más arriba).
  await prisma.$transaction(async (tx: any) => {
    const rows = await tx.$queryRaw<{ startDate: Date; endDate: Date }[]>`
      SELECT "startDate", "endDate" FROM "Calendar" WHERE id = ${calendarId} FOR UPDATE
    `;
    const calendar = rows[0];
    if (!calendar) throw new Error("El calendario ya no existe.");
    if (date < calendar.startDate || date > calendar.endDate) {
      throw new Error("Esa fecha ya no está dentro del rango del calendario.");
    }

    await tx.day.upsert({
      where: { calendarId_date: { calendarId, date } },
      update: { videoUrl, message },
      create: { calendarId, date, videoUrl, message },
    });
  });

  revalidatePath(`/admin/${calendarId}`);
}

export async function deleteDayAction(calendarId: string, dateStr: string) {
  await requireCalendarAdmin(calendarId);

  const date = parseUtcDateOnly(dateStr);
  if (!date) throw new Error("Fecha inválida.");

  // TAL-10 — Prisma/Postgres se retiran de la infraestructura: la
  // clasificación de "ya no existe" (antes P2025, ver docs/dias.md) ya no
  // está disponible — `requireCalendarAdmin` de arriba ya redirige a todo
  // el mundo (ver src/lib/current-user.ts), así que esta llamada es
  // inalcanzable hoy. Pendiente de reescribir contra Convex en TAL-12+.
  await prisma.day.delete({ where: { calendarId_date: { calendarId, date } } });

  revalidatePath(`/admin/${calendarId}`);
}
