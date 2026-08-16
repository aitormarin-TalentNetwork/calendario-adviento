"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { fetchMutation } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import { DAY_OUTSIDE_RANGE_ERROR_MESSAGE } from "../../../convex/calendarErrorMessages";
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

export type UpdateCalendarFieldValues = {
  name: string;
  coverTitle: string;
  startDate: string;
  endDate: string;
  skinId: string;
  coverImageUrl: string;
};

export type UpdateCalendarState = {
  error: string | null;
  values: UpdateCalendarFieldValues;
};

// TAL-20, hallazgo de auditoría ronda 1: el mensaje que ve el usuario ante
// un fallo NO reconocido no puede ser el texto crudo de la excepción — ni
// siquiera "solo la línea de mensaje" (ver más abajo por qué esa
// extracción tampoco basta). Un mensaje genérico y neutro para cualquier
// cosa que no sea una de las validaciones de negocio ya conocidas.
const GENERIC_SAVE_ERROR_MESSAGE = "No se pudo guardar el calendario. Inténtalo de nuevo.";

export async function updateCalendarAction(
  calendarId: string,
  _prevState: UpdateCalendarState,
  formData: FormData
): Promise<UpdateCalendarState> {
  await requireCalendarAdmin(calendarId);

  const name = formData.get("name")?.toString().trim() ?? "";
  const coverTitle = formData.get("coverTitle")?.toString().trim() ?? "";
  const startDateRaw = formData.get("startDate")?.toString() ?? "";
  const endDateRaw = formData.get("endDate")?.toString() ?? "";
  const skinId = formData.get("skinId")?.toString() ?? "";
  const coverImageUrlRaw = formData.get("coverImageUrl")?.toString().trim() ?? "";

  // Lo que el admin acababa de escribir se devuelve siempre junto al
  // resultado (éxito o error) — TAL-20, hallazgo de auditoría ronda 1:
  // `useActionState`/`<form action>` resetea los campos no controlados del
  // formulario en cuanto la action termina, con éxito o sin él (no es un
  // reset "solo si falla" — es "en cuanto la promesa se resuelve", y
  // devolver `{error: ...}` sin lanzar cuenta como resolución). Sin esto,
  // un admin que corrige un fallo de validación perdería también el resto
  // de campos que sí había rellenado bien. Ver `edit-calendar-form.tsx`,
  // que usa estos valores como formulario controlado en vez de
  // `defaultValue` para que el reset automático no les afecte.
  const values: UpdateCalendarFieldValues = {
    name,
    coverTitle,
    startDate: startDateRaw,
    endDate: endDateRaw,
    skinId,
    coverImageUrl: coverImageUrlRaw,
  };

  if (!name || !coverTitle || !startDateRaw || !endDateRaw || !skinId) {
    return { error: "Faltan campos obligatorios.", values };
  }

  const startDate = parseUtcDateOnly(startDateRaw);
  const endDate = parseUtcDateOnly(endDateRaw);
  if (!startDate || !endDate) {
    return { error: "Las fechas deben tener formato YYYY-MM-DD y ser fechas reales.", values };
  }
  if (startDate > endDate) {
    return { error: "La fecha de inicio no puede ser posterior a la fecha de fin.", values };
  }

  const coverImageUrl = coverImageUrlRaw || null;
  if (coverImageUrl) {
    let parsed: URL;
    try {
      parsed = new URL(coverImageUrl);
    } catch {
      return { error: "La foto de portada debe ser una URL válida.", values };
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
      return {
        error: "La foto de portada debe ser una URL https:// — no se aceptan otros esquemas por seguridad.",
        values,
      };
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
  //
  // TAL-20 — hallazgo: `updateCalendarHandler` también valida en Convex
  // (p.ej. `assertNoDayOutsideRange`, "no se puede estrechar el rango si
  // deja un día con vídeo fuera") y esas comprobaciones lanzan `Error` de
  // verdad. Eso NO es un fallo inesperado — es una regla de negocio ya
  // auditada (TAL-12) tan legítima como las de arriba — pero al no
  // capturarse aquí, la excepción se escapaba entera del Server Action y
  // Next.js la trataba como un crash de verdad: la misma pantalla genérica
  // de error de producción que un fallo de hidratación (React error #441
  // en consola, sin relación real con hidratación esta vez). Se captura
  // aquí y se trata igual que las validaciones de arriba: un resultado
  // esperado del formulario, no una excepción — PERO solo para el fallo
  // concreto que reconocemos (hallazgo de auditoría, ronda 1): capturar
  // cualquier rechazo de `fetchMutation` y devolver su mensaje tal cual
  // disfrazaba de "validación normal" cualquier otra cosa (Convex mal
  // configurado, red caída, un bug de verdad futuro) y además podía filtrar
  // detalles internos si Convex cambia de formato de mensaje algún día.
  try {
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // fetchMutation envuelve el `Error` del handler de Convex en un mensaje
    // con formato fijo (comprobado contra un throw real):
    //   "[Request ID: …] Server Error\nUncaught Error: <mensaje>\n    at …\n    at …"
    // — la primera línea es un identificador de petición y el resto, tras
    // el mensaje real, es la traza de pila del lado de Convex. Extraemos la
    // primera línea que no sea ninguna de esas dos cosas y le quitamos el
    // prefijo "Uncaught Error:"/"Error:" que antepone Convex — pero el
    // resultado SOLO se le enseña al usuario si coincide EXACTAMENTE con un
    // mensaje de validación de negocio que ya conocemos y ya está pensado
    // para leerse tal cual (`DAY_OUTSIDE_RANGE_ERROR_MESSAGE`, importado de
    // `convex/calendarErrorMessages.ts` — fichero compartido sin
    // dependencias de runtime de Convex a propósito, para que este texto no
    // pueda divergir entre los dos sitios). Cualquier otro mensaje —
    // incluida cualquier extracción con este mismo formato pero de un
    // `Error` que no reconocemos — se trata como fallo NO reconocido: se
    // registra en el servidor (para que quede rastro real de que algo se
    // rompió) y al usuario se le da un mensaje genérico, nunca el texto
    // crudo de una excepción no reconocida.
    const messageLine = message
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0 && !line.startsWith("[Request ID") && !line.startsWith("at "));
    const cleaned = (messageLine ?? "").replace(/^Uncaught Error:\s*/, "").replace(/^Error:\s*/, "");

    if (cleaned === DAY_OUTSIDE_RANGE_ERROR_MESSAGE) {
      return { error: cleaned, values };
    }

    console.error("updateCalendarAction: fallo inesperado al actualizar el calendario", err);
    return { error: GENERIC_SAVE_ERROR_MESSAGE, values };
  }

  revalidatePath(`/admin/${calendarId}`);
  revalidatePath("/admin");
  return { error: null, values };
}

export async function deleteCalendarAction(calendarId: string) {
  const user = await getAuthorizedUser();
  if (!user) redirect(`/login?callbackUrl=/admin/${calendarId}`);

  // Hallazgo de auditoría, TAL-12 ronda 1 (reenvío secuencial) Y ronda 2
  // (concurrencia real): la versión anterior resolvía existencia,
  // autorización y borrado como TRES operaciones Convex independientes
  // desde aquí. Bajo dos peticiones de verdad solapadas (no solo una
  // detrás de otra), las dos podían ver el calendario existir antes de
  // que la primera lo borrara — la segunda entonces SÍ llegaba a
  // comprobar membership, ya no la encontraba (la primera ya se la había
  // llevado por delante) y caía en `/unauthorized` en vez de tratarse
  // como éxito. Repartir en varias llamadas desde Next.js no se puede
  // arreglar añadiendo más comprobaciones en el mismo sitio — la ventana
  // de carrera está en el reparto en sí.
  //
  // Corrección: `calendars.deleteCalendarAsUserPublic` resuelve
  // existencia + autorización + borrado en UNA sola mutation de Convex
  // (mismo patrón que `access.resolveMemberAccessPublic`, TAL-11, para el
  // mismo tipo de problema — ver el comentario completo en
  // `convex/calendars.ts::deleteCalendarAsUserHandler`).
  //
  // Hallazgo de auditoría, ronda 3: NO se manda `user.isSuperAdmin` como
  // argumento — sería un resultado de autorización afirmado desde fuera
  // (esta misma sesión de Next.js, resuelto en una query Convex aparte
  // por `getAuthorizedUser`), exactamente el tipo de dato que esta
  // mutation no debe aceptar tal cual: un privilegio revocado entre esa
  // lectura y esta llamada seguiría surtiendo efecto si se confiara en él
  // aquí. Solo se manda `userId` — una referencia de identidad, no un
  // privilegio — y la propia mutation relee `isSuperAdmin` del documento
  // `users` dentro de su misma transacción.
  const result = await fetchMutation(api.calendars.deleteCalendarAsUserPublic, {
    serverSecret: convexAppServerSecret(),
    calendarId: calendarId as Id<"calendars">,
    userId: user.id as Id<"users">,
  });
  if (result === "unauthorized") redirect("/unauthorized");

  // "deleted" o "already-gone" son los dos el mismo éxito observable desde
  // fuera: el estado que pedía el usuario (que el calendario no exista) ya
  // se cumple.
  revalidatePath("/admin");
  redirect("/admin");
}
