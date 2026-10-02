import { AccountMenu, type AccountMenuCalendar } from "@/components/account-menu";
import { listAdminCalendars, listUserModeCalendars } from "@/lib/calendars";
import type { AuthorizedUser } from "@/lib/current-user";
import { allowedModes, type AccountMode } from "@/lib/account-modes";

type SessionIndicatorProps = {
  user: AuthorizedUser;
  /**
   * Modo de la pantalla que lo pinta: `/admin*` y `/superadmin` → "admin";
   * `/c*` → "user". El modo marcado en el menú es siempre el de la ruta,
   * nunca un estado aparte que pudiera no corresponder a la pantalla.
   */
  mode: AccountMode;
  /** Calendario en el que se está (`/admin/<id>`, `/c/<id>`), marcado en la lista. */
  currentCalendarId?: string;
  /**
   * Lo que devolvió `listAdminCalendars` si la página ya lo cargó (`/admin`)
   * — así el indicador no repite la consulta.
   */
  adminCalendars?: Awaited<ReturnType<typeof listAdminCalendars>>;
};

/**
 * Indicador de sesión (TAL-28) → menú de la cuenta (TAL-59,
 * design/design-system.md § "Menú de la cuenta (avatar)"). En la esquina
 * solo queda la foto; al pulsarla se abre el menú (`AccountMenu`, Client
 * Component). Aquí, en servidor, se cargan los datos del menú:
 *
 * - Modo Admin: los calendarios que administra → `/admin/<id>`.
 * - Modo Usuario: los de "Tus calendarios" (TAL-58, invitado +
 *   administrados) → `/c/<id>`.
 * - La sección "Modo" solo para quien puede usar el modo Admin; "Super
 *   Admin" solo para el Super Admin (TAL-68). Una sola regla
 *   (`account-modes.ts::allowedModes`) para el menú, el aterrizaje y
 *   `switchModeAction`.
 * - Modo Super Admin (`/superadmin`, TAL-68): sin lista de calendarios.
 * - La lista solo si hay más de un calendario en el modo actual.
 *
 * Posicionamiento (`position: fixed` + override de mobile) sigue en
 * `.session-indicator` de `globals.css`, igual que en TAL-28.
 */
export async function SessionIndicator({ user, mode, currentCalendarId, adminCalendars }: SessionIndicatorProps) {
  let calendars: AccountMenuCalendar[];
  let modes: AccountMode[];

  if (mode === "superadmin") {
    // TAL-68 — en modo Super Admin el menú no lista calendarios: /superadmin
    // ya los muestra todos (decisión del plan, ronda 1). Solo se llega aquí
    // desde /superadmin, que exige isSuperAdmin.
    calendars = [];
    modes = allowedModes(user, 0);
  } else if (mode === "admin") {
    const administered = adminCalendars ?? (await listAdminCalendars(user.id));
    calendars = administered.map((c) => ({ id: c.id, label: c.name, icon: c.coverIcon, href: `/admin/${c.id}` }));
    modes = allowedModes(user, administered.length);
  } else {
    const cards = await listUserModeCalendars(user.id);
    calendars = cards.map((c) => ({ id: c.id, label: c.title, icon: c.icon, href: `/c/${c.id}` }));
    modes = allowedModes(user, cards.filter((c) => c.isAdmin).length);
  }

  return (
    <div className="session-indicator">
      <AccountMenu
        email={user.email}
        image={user.image}
        mode={mode}
        modes={modes}
        calendars={calendars.length > 1 ? calendars : []}
        currentCalendarId={currentCalendarId}
      />
    </div>
  );
}
