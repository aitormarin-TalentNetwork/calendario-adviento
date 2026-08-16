"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@/generated/prisma/client";
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

export async function saveDayAction(calendarId: string, dateStr: string, formData: FormData) {
  await requireCalendarAdmin(calendarId);

  const date = parseUtcDateOnly(dateStr);
  if (!date) throw new Error("Fecha inválida.");

  const calendar = await prisma.calendar.findUnique({ where: { id: calendarId } });
  if (!calendar) throw new Error("El calendario ya no existe.");
  // Defensa en profundidad: el formulario solo se renderiza para fechas
  // dentro del rango actual del calendario, pero ese rango puede haber
  // cambiado (TAL-5) entre que se cargó la página y que se envía este
  // formulario — nunca confiar solo en lo que ya filtró la UI.
  if (date < calendar.startDate || date > calendar.endDate) {
    throw new Error("Esa fecha ya no está dentro del rango del calendario.");
  }

  const videoUrlRaw = formData.get("videoUrl")?.toString().trim();
  if (!videoUrlRaw) throw new Error("El vídeo es obligatorio.");
  const videoUrl = parseVideoUrl(videoUrlRaw).toString();

  const messageRaw = formData.get("message")?.toString().trim();
  const message = messageRaw || null;

  await prisma.day.upsert({
    where: { calendarId_date: { calendarId, date } },
    update: { videoUrl, message },
    create: { calendarId, date, videoUrl, message },
  });

  revalidatePath(`/admin/${calendarId}`);
}

export async function deleteDayAction(calendarId: string, dateStr: string) {
  await requireCalendarAdmin(calendarId);

  const date = parseUtcDateOnly(dateStr);
  if (!date) throw new Error("Fecha inválida.");

  try {
    await prisma.day.delete({ where: { calendarId_date: { calendarId, date } } });
  } catch (err) {
    // P2025 = ya no existe — un reenvío (doble clic) no debe fallar, el
    // resultado que pedía ("que ese día no tenga vídeo") ya se cumple.
    const alreadyGone = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025";
    if (!alreadyGone) throw err;
  }

  revalidatePath(`/admin/${calendarId}`);
}
