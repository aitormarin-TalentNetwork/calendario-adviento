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
    <main
      className="session-page-main"
      style={{ flex: 1, paddingLeft: "2rem", paddingRight: "2rem", paddingBottom: "2rem", maxWidth: "480px" }}
    >
      {/* TAL-28, sugerencia no bloqueante de auditoría ronda 1: a diferencia
          de admin/[calendarId]/page.tsx y superadmin/page.tsx, esta página
          no es específica de un calendario (lista TODOS los que administra
          el usuario), así que el rol se resuelve directamente de
          `user.isSuperAdmin` (el mismo override global que ya usa el resto
          de la app) en vez de `resolveCalendarAccess` — no hay ningún
          calendario concreto contra el que resolverlo aquí. */}
      <SessionIndicator email={user.email} image={user.image} roleLabel={user.isSuperAdmin ? "Super Admin" : "Admin"} />
      <h1>Mis calendarios</h1>

      {/* TAL-32 — el botón "+ Nuevo calendario" va ENCIMA de la tabla, no
          debajo (antes aparecía después del mensaje de lista vacía). El
          <form> entero (nombre + creationKey + envío) vive dentro de
          NewCalendarSubmit — TAL-26 lo convirtió en un Client Component
          completo (useActionState) para poder pintar errores de
          validación del nombre sin perder lo que el Admin ya había
          escrito. creationKey sigue asignándose tras montar, exclusivamente
          en cliente (TAL-19): mientras no se recargue la página, un doble
          clic o un reenvío del mismo formulario manda la misma clave y el
          servidor lo trata como el mismo intento — ver createCalendarForAdmin. */}
      <div style={{ marginTop: "1rem" }}>
        <NewCalendarSubmit />
      </div>

      {calendars.length === 0 ? (
        <p style={{ marginTop: "1.5rem" }}>Todavía no administras ningún calendario.</p>
      ) : (
        // TAL-32 — lista como TABLA (antes, enlaces sueltos en un <ul>).
        // Contenedor con `overflow-x: auto` propio (design/design-system.md
        // § "Responsive / Mobile" — "Tablas... contenedor con overflow-x:
        // auto propio en vez de romper el layout de la página"): en mobile,
        // si la tabla no cabe, scrollea ELLA sola, la página nunca lo hace
        // en horizontal.
        <div style={{ overflowX: "auto", marginTop: "1.5rem" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--accent)" }}>
                <th style={{ padding: "0.5rem 0.75rem 0.5rem 0" }}>Nombre</th>
                <th style={{ padding: "0.5rem 0.75rem" }}>Fechas</th>
                <th style={{ padding: "0.5rem 0 0.5rem 0.75rem" }}>Skin</th>
              </tr>
            </thead>
            <tbody>
              {calendars.map((calendar) => (
                <tr
                  key={calendar.id}
                  style={{ borderBottom: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)" }}
                >
                  <td style={{ padding: "0.5rem 0.75rem 0.5rem 0", whiteSpace: "nowrap" }}>
                    {/* TAL-32, pedido explícito de Aitor: el nombre tiene
                        que VERSE como un link (subrayado o color de
                        enlace), no texto plano — antes toda la fila era
                        un <Link> sin ningún estilo propio de enlace, así
                        que en una tabla no quedaba claro qué se podía
                        pinchar. */}
                    <Link href={`/admin/${calendar.id}`} style={{ textDecoration: "underline", color: "var(--accent)" }}>
                      {calendar.name}
                    </Link>
                  </td>
                  <td style={{ padding: "0.5rem 0.75rem", whiteSpace: "nowrap" }}>
                    {formatCalendarDate(calendar.startDate)} a {formatCalendarDate(calendar.endDate)}
                  </td>
                  <td style={{ padding: "0.5rem 0 0.5rem 0.75rem", whiteSpace: "nowrap" }}>{calendar.skin.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
