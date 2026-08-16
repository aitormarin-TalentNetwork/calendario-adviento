"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createCalendarForAdmin, parseUtcDateOnly } from "@/lib/calendars";
import { getAuthorizedUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { resolveCalendarAccess } from "@/lib/roles";

/**
 * Cada server action vuelve a comprobar rol por su cuenta, sin fiarse de
 * que solo se llegue aquí desde un botón que ya estaba oculto en la UI —
 * las server actions son endpoints invocables directamente, no solo lo que
 * se ve en la página.
 */
async function requireCalendarAdmin(calendarId: string) {
  const user = await getAuthorizedUser();
  if (!user) redirect(`/login?callbackUrl=/admin/${calendarId}`);

  const access = await resolveCalendarAccess(user, calendarId);
  const isAdmin = access?.kind === "super-admin" || access?.role === "ADMIN";
  if (!isAdmin) redirect("/unauthorized");

  return user;
}

export async function createCalendarAction(formData: FormData) {
  const user = await getAuthorizedUser();
  if (!user) redirect("/login?callbackUrl=/admin");

  // La clave la genera la página en cada render (ver src/app/admin/page.tsx)
  // — si por lo que sea no llega, se genera una aquí, pero entonces esa
  // llamada concreta no queda protegida frente a un reenvío (no hay nada
  // con lo que correlacionarlo).
  const creationKey = formData.get("creationKey")?.toString() || randomUUID();

  const calendar = await createCalendarForAdmin(user, creationKey);
  revalidatePath("/admin");
  redirect(`/admin/${calendar.id}`);
}

export async function updateCalendarAction(calendarId: string, formData: FormData) {
  await requireCalendarAdmin(calendarId);

  const name = formData.get("name")?.toString().trim();
  const coverTitle = formData.get("coverTitle")?.toString().trim();
  const startDateRaw = formData.get("startDate")?.toString();
  const endDateRaw = formData.get("endDate")?.toString();
  const skinId = formData.get("skinId")?.toString();
  const coverImageUrlRaw = formData.get("coverImageUrl")?.toString().trim();

  if (!name || !coverTitle || !startDateRaw || !endDateRaw || !skinId) {
    throw new Error("Faltan campos obligatorios.");
  }

  const startDate = parseUtcDateOnly(startDateRaw);
  const endDate = parseUtcDateOnly(endDateRaw);
  if (!startDate || !endDate) {
    throw new Error("Las fechas deben tener formato YYYY-MM-DD y ser fechas reales.");
  }
  if (startDate > endDate) {
    throw new Error("La fecha de inicio no puede ser posterior a la fecha de fin.");
  }

  // El selector de skin en la UI ya limita al catálogo fijo, pero esto es
  // un límite de seguridad, no de UX: nunca confiar en que el cliente
  // mandó un id válido.
  const skin = await prisma.skin.findUnique({ where: { id: skinId } });
  if (!skin) {
    throw new Error("Skin no válido.");
  }

  const coverImageUrl = coverImageUrlRaw || null;
  if (coverImageUrl) {
    let parsed: URL;
    try {
      parsed = new URL(coverImageUrl);
    } catch {
      throw new Error("La foto de portada debe ser una URL válida.");
    }
    // Solo https: — new URL() por sí sola solo valida sintaxis y acepta
    // esquemas como javascript:/data:/file:, que ejecutarían contenido
    // activo si esto se renderiza tal cual más adelante (hallazgo de
    // auditoría, ronda 1). No se hace una petición HTTP desde el servidor
    // para comprobar que es "de verdad" una imagen a propósito — eso
    // abriría un vector de SSRF (el servidor pediría lo que sea que el
    // usuario le mande) a cambio de una validación que de todas formas no
    // es determinante; una URL rota simplemente no cargará como <img> más
    // adelante, que es un fallo visible y de bajo riesgo, no de seguridad.
    if (parsed.protocol !== "https:") {
      throw new Error(
        "La foto de portada debe ser una URL https:// — no se aceptan otros esquemas por seguridad."
      );
    }
  }

  await prisma.calendar.update({
    where: { id: calendarId },
    data: { name, coverTitle, startDate, endDate, skinId, coverImageUrl },
  });

  revalidatePath(`/admin/${calendarId}`);
  revalidatePath("/admin");
}

export async function deleteCalendarAction(calendarId: string) {
  await requireCalendarAdmin(calendarId);

  // TAL-10 — Prisma/Postgres se retiran de la infraestructura: la
  // clasificación de "ya no existe" (antes P2025 de Prisma, ver
  // docs/calendarios.md) ya no está disponible sin el cliente real —
  // `requireCalendarAdmin` de arriba ya redirige a todo el mundo (ver
  // src/lib/current-user.ts), así que esta llamada es inalcanzable hoy;
  // se deja sin try/catch a propósito en vez de fingir una clasificación
  // de error que ya no se puede hacer. Pendiente de reescribir contra
  // Convex en TAL-12+.
  await prisma.calendar.delete({ where: { id: calendarId } });

  revalidatePath("/admin");
  redirect("/admin");
}
