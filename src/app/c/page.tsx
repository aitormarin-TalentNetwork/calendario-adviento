import Link from "next/link";
import { redirect } from "next/navigation";
import { SessionIndicator } from "@/components/session-indicator";
import { listUserModeCalendars } from "@/lib/calendars";
import { getAuthorizedUser } from "@/lib/current-user";
import { skinBackgroundStyle } from "@/lib/skin-appearance";

/**
 * TAL-58 — "Tus calendarios", la pantalla del modo Usuario
 * (design/design-system.md § "Tus calendarios" — lista del modo Usuario;
 * mockup design/propuesta-selector-modo.html). `/c` es el índice natural de
 * `/c/<id>`, y ya queda protegido por `src/proxy.ts` (el `matcher`
 * `/c/:path*` también coincide con `/c`).
 *
 * - 0 calendarios → mensaje claro (texto aprobado por el PM).
 * - 1 → directo a `/c/<id>`, sin pasar por la lista.
 * - Varios → tarjetas; los que administra llevan la etiqueta "Admin".
 *
 * Aquí llegan los invitados puros desde `/admin` (ver el redirect de
 * `src/app/admin/page.tsx`). El selector Usuario | Admin y el menú del
 * avatar son de TAL-59, fuera de esta tarea — de momento solo el
 * `SessionIndicator` de siempre (avatar + cerrar sesión).
 */
export default async function UserCalendarsPage() {
  const user = await getAuthorizedUser();
  if (!user) redirect("/login?callbackUrl=/c");

  const calendars = await listUserModeCalendars(user.id);
  if (calendars.length === 1) redirect(`/c/${calendars[0].id}`);

  return (
    <main className="session-page-main user-calendars-main">
      <SessionIndicator email={user.email} image={user.image} />
      <h1 className="user-calendars-title">Tus calendarios</h1>

      {calendars.length === 0 ? (
        <p className="user-calendars-sub">
          Todavía no tienes ningún calendario. Cuando alguien te invite, aparecerá aquí.
        </p>
      ) : (
        <>
          <p className="user-calendars-sub">Elige cuál quieres abrir.</p>
          <ul className="user-calendars-grid">
            {calendars.map((calendar) => (
              <li key={calendar.id}>
                <Link href={`/c/${calendar.id}`} className="calendar-card">
                  <div
                    className="calendar-card-cover"
                    aria-hidden="true"
                    style={skinBackgroundStyle(calendar.appearance.background, calendar.backgroundImageUrl)}
                  >
                    {calendar.icon}
                  </div>
                  <div className="calendar-card-body">
                    <span className="calendar-card-name">{calendar.title}</span>
                    <span className="calendar-card-meta">{calendar.subtitle}</span>
                    {calendar.isAdmin && <span className="calendar-card-tag">Admin</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
