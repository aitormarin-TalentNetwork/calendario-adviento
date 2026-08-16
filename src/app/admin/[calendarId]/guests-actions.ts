"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { inviteGuest, isCalendarGuest, removeGuestEverywhere, removeGuestFromCalendar } from "@/lib/guests";
import { getAuthorizedUser } from "@/lib/current-user";
import { resolveCalendarAccess, type CalendarAccess } from "@/lib/roles";

// Duplicado a propósito del mismo chequeo en src/app/admin/actions.ts (TAL-5)
// — no está exportado de allí, y centralizarlo ahora mismo arriesgaba
// chocar con TAL-6 (T1), que está tocando el mismo directorio en paralelo.
// Queda anotado como posible refactor de seguimiento, no de esta tarea.
// Devuelve el `access` resuelto (no solo un booleano) porque
// removeGuestEverywhereAction necesita distinguir Super Admin de Admin
// normal — ver ahí el porqué.
async function requireCalendarAdmin(calendarId: string): Promise<CalendarAccess> {
  const user = await getAuthorizedUser();
  if (!user) redirect(`/login?callbackUrl=/admin/${calendarId}`);

  const access = await resolveCalendarAccess(user, calendarId);
  const isAdmin = access?.kind === "super-admin" || access?.role === "ADMIN";
  if (!isAdmin) redirect("/unauthorized");

  return access;
}

export async function inviteGuestAction(calendarId: string, formData: FormData) {
  await requireCalendarAdmin(calendarId);

  const email = formData.get("email")?.toString() ?? "";
  // TAL-10 — Prisma/Postgres se retiran de la infraestructura:
  // `inviteGuest` sigue validando el formato de email de verdad (no toca
  // Prisma), pero lanza `DataLayerUnavailableError` en la parte real de la
  // escritura — antes de esta tarea, un `{ok:false, error:"calendar-not-
  // found"}` inventado quedaba mapeado a "El calendario no existe."
  // (hallazgo de auditoría, ronda 1: ese calendario casi seguro SÍ existe,
  // era un motivo falso). Se deja que el error de invalid-email siga
  // devuelto normalmente y que `DataLayerUnavailableError` se propague tal
  // cual — su mensaje ya es honesto, no hace falta reescribirlo.
  const result = await inviteGuest(calendarId, email);
  if (!result.ok) {
    throw new Error("Introduce un email válido.");
  }

  revalidatePath(`/admin/${calendarId}`);
}

export async function removeGuestFromCalendarAction(calendarId: string, email: string) {
  await requireCalendarAdmin(calendarId);
  // No hace falta comprobar aparte que `email` sea invitado de este
  // calendario: removeGuestFromCalendar ya filtra sus borrados por
  // `calendarId`, así que llamarla con un email que no tiene relación con
  // este calendario es, como mucho, un no-op — nunca toca datos de otro
  // calendario (a diferencia de removeGuestEverywhereAction, ver abajo).
  await removeGuestFromCalendar(calendarId, email);
  revalidatePath(`/admin/${calendarId}`);
}

export async function removeGuestEverywhereAction(calendarId: string, email: string) {
  const access = await requireCalendarAdmin(calendarId);

  // Hallazgo de auditoría, ronda 1: `calendarId` y `email` llegan los dos
  // del cliente — sin esta comprobación, cualquier Admin de CUALQUIER
  // calendario podía invocar esta action con el email de alguien que no
  // tiene ninguna relación con su calendario y borrarlo por completo de
  // calendarios de terceros que no administra. Se exige que `email` sea de
  // verdad invitado (o ya GUEST) de ESTE calendario concreto — el mismo
  // que se acaba de comprobar que administra — antes de disparar el efecto
  // global. Super Admin queda exceptuado a propósito: ya tiene autoridad
  // global sobre cualquier calendario (mismo criterio que el resto de
  // rutas protegidas desde TAL-2), así que no tiene sentido exigirle
  // además una relación previa con este calendario en particular.
  if (access.kind !== "super-admin") {
    const isGuestHere = await isCalendarGuest(calendarId, email);
    if (!isGuestHere) redirect("/unauthorized");
  }

  await removeGuestEverywhere(email);
  revalidatePath(`/admin/${calendarId}`);
}
