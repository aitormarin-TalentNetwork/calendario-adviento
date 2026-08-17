import Link from "next/link";
import { redirect } from "next/navigation";
import { NewCalendarSubmit } from "@/components/new-calendar-submit";
import { SessionIndicator } from "@/components/session-indicator";
import { formatCalendarDate, listAdminCalendars } from "@/lib/calendars";
import { getAuthorizedUser } from "@/lib/current-user";

export default async function AdminCalendarsPage() {
  const user = await getAuthorizedUser();
  if (!user) redirect("/login?callbackUrl=/admin");

  // TAL-12 — reconectada contra Convex (`calendars.listCalendarsForUserPublic`).
  // Ya no hay ningún estado especial de "no disponible" que distinguir de
  // la lista vacía real — `[]` aquí siempre significa "todavía no
  // administras ningún calendario", igual que con Prisma.
  const calendars = await listAdminCalendars(user.id);

  return (
    <main style={{ flex: 1, padding: "2rem", maxWidth: "480px" }}>
      {/* TAL-28, sugerencia no bloqueante de auditoría ronda 1: a diferencia
          de admin/[calendarId]/page.tsx y superadmin/page.tsx, esta página
          no es específica de un calendario (lista TODOS los que administra
          el usuario), así que el rol se resuelve directamente de
          `user.isSuperAdmin` (el mismo override global que ya usa el resto
          de la app) en vez de `resolveCalendarAccess` — no hay ningún
          calendario concreto contra el que resolverlo aquí. */}
      <SessionIndicator email={user.email} image={user.image} roleLabel={user.isSuperAdmin ? "Super Admin" : "Admin"} />
      <h1>Mis calendarios</h1>

      {calendars.length === 0 ? (
        <p>Todavía no administras ningún calendario.</p>
      ) : (
        <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "1rem" }}>
          {calendars.map((calendar) => (
            <li key={calendar.id}>
              <Link href={`/admin/${calendar.id}`}>
                {calendar.name} — {formatCalendarDate(calendar.startDate)} a{" "}
                {formatCalendarDate(calendar.endDate)} ({calendar.skin.name})
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* El <form> entero (nombre + creationKey + envío) vive dentro de
          NewCalendarSubmit — TAL-26 lo convirtió en un Client Component
          completo (useActionState) para poder pintar errores de
          validación del nombre sin perder lo que el Admin ya había
          escrito. creationKey sigue asignándose tras montar, exclusivamente
          en cliente (TAL-19): mientras no se recargue la página, un doble
          clic o un reenvío del mismo formulario manda la misma clave y el
          servidor lo trata como el mismo intento — ver createCalendarForAdmin. */}
      <div style={{ marginTop: "1.5rem" }}>
        <NewCalendarSubmit />
      </div>
    </main>
  );
}
