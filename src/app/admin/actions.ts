"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fetchMutation } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { createCalendarForAdmin, parseUtcDateOnly } from "@/lib/calendars";
import { getAuthorizedUser } from "@/lib/current-user";
import { convexAppServerSecret } from "@/lib/convex-server";
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

  // TAL-12 — reconectada contra Convex (`calendars.updateCalendarPublic`).
  // La comprobación de que `skinId` es de verdad del catálogo fijo (límite
  // de seguridad — el selector de la UI ya limita al catálogo, esto es
  // defensa por si alguien manda un id distinto a mano) vive ahora dentro
  // de la propia mutation de Convex (`convex/calendars.ts::updateCalendarHandler`),
  // igual que antes vivía en la capa de datos con `prisma.skin.findUnique`
  // — nunca en la Server Action. Todo lo de arriba (campos obligatorios,
  // formato/orden de fechas, URL https) sigue siendo validación de
  // servidor real, aquí igual que con Prisma.
  await fetchMutation(api.calendars.updateCalendarPublic, {
    serverSecret: convexAppServerSecret(),
    calendarId: calendarId as Id<"calendars">,
    name,
    coverTitle,
    coverImageUrl: coverImageUrl ?? undefined,
    startDate: startDateRaw,
    endDate: endDateRaw,
    skinId: skinId as Id<"skins">,
  });

  revalidatePath(`/admin/${calendarId}`);
  revalidatePath("/admin");
}

export async function deleteCalendarAction(calendarId: string) {
  await requireCalendarAdmin(calendarId);

  // TAL-12 — reconectada contra Convex (`calendars.deleteCalendarPublic`).
  // Idempotente (ver `convex/calendars.ts::deleteCalendarHandler`): un
  // reenvío del mismo formulario de borrado (doble clic, navegar atrás) no
  // falla — mismo criterio que el P2025 ("ya no existe") de la versión
  // Prisma.
  await fetchMutation(api.calendars.deleteCalendarPublic, {
    serverSecret: convexAppServerSecret(),
    calendarId: calendarId as Id<"calendars">,
  });

  revalidatePath("/admin");
  redirect("/admin");
}
