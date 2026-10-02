import { cookies, headers } from "next/headers";
import {
  inviteToCalendarAction,
  removeGuestEverywhereAction,
  removePersonAction,
  setPersonRoleAction,
} from "@/app/admin/[calendarId]/guests-actions";
import { RoleSelect } from "@/app/admin/[calendarId]/role-select";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { CopyLinkButton } from "@/components/copy-link-button";
import { SubmitButton } from "@/components/submit-button";
import { listCalendarPeople, type CalendarPerson } from "@/lib/calendar-people";
import { resolveInvitationLink } from "@/lib/invitation-link";

/**
 * El link no lleva token por invitado — es el mismo para cualquiera al que
 * se invite a este calendario, porque el acceso se resuelve por email (ver
 * src/lib/roles.ts), no por un secreto en la URL. "Enviarlo" hoy es que el
 * Admin lo copie y lo pegue donde quiera (email, Slack…) — el envío
 * automático por email depende de un proveedor todavía sin decidir
 * (docs/stack.md); ver docs/invitados.md para el razonamiento completo.
 *
 * La lógica de qué origen usar (nunca confiar en el header Host fuera de
 * desarrollo local) vive en src/lib/invitation-link.ts, separada de
 * headers()/process.env — ver ahí el porqué.
 */
async function invitationLink(calendarId: string): Promise<string | null> {
  const headersList = await headers();
  return resolveInvitationLink(calendarId, {
    appUrl: process.env.APP_URL,
    host: headersList.get("host") ?? undefined,
  });
}

// Mismo criterio honesto que antes (hallazgo de auditoría TAL-10, ronda 1):
// `null` ("no disponible ahora mismo") en vez de `[]`, que se leería como
// "todavía no hay nadie", un hecho falso.
async function tryListCalendarPeople(actorUserId: string, calendarId: string): Promise<CalendarPerson[] | null> {
  try {
    return await listCalendarPeople(actorUserId, calendarId);
  } catch {
    return null;
  }
}

const LAST_ADMIN_HINT = "Es el único Admin del calendario: nombra a otro antes de cambiar su rol o quitarlo.";

const PEOPLE_ERROR_MESSAGE: Record<string, string> = {
  "invalid-email": "Introduce un email válido.",
  "last-admin": LAST_ADMIN_HINT,
  frozen: "La gestión de roles está en mantenimiento, inténtalo más tarde.",
  "not-found": "Esa persona ya no está en el calendario — refresca la página.",
};

// "2 oct" — en la zona horaria del navegador (cookie `tz`, TimezoneSync)
// si la hay; si no, o si no es válida, UTC.
function formatInvitedAt(timestamp: number, timeZone: string | undefined): string {
  const options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  try {
    return new Date(timestamp).toLocaleDateString("es-ES", { ...options, timeZone: timeZone ?? "UTC" });
  } catch {
    return new Date(timestamp).toLocaleDateString("es-ES", { ...options, timeZone: "UTC" });
  }
}

/**
 * TAL-65 — "Personas del calendario" (design/design-system.md § "Personas
 * del calendario", mockup design/propuesta-invitar-con-rol.html), con el
 * estilo vigente (TAL-61 la repinta con el Estilo 2026). Sustituye a la
 * tabla de "Invitados" de TAL-7/16: ahora lista a todas las personas
 * (Admins incluidos) con su rol, que cualquier Admin del calendario (o el
 * Super Admin) puede cambiar. La autorización real vive en Convex
 * (`convex/calendarPeople.ts`), no aquí.
 */
export async function GuestsSection({
  calendarId,
  actorUserId,
  peopleError,
}: {
  calendarId: string;
  actorUserId: string;
  peopleError?: string;
}) {
  const [people, link, cookieStore] = await Promise.all([
    tryListCalendarPeople(actorUserId, calendarId),
    invitationLink(calendarId),
    cookies(),
  ]);
  const timeZone = cookieStore.get("tz")?.value;
  const errorMessage = peopleError ? PEOPLE_ERROR_MESSAGE[peopleError] : undefined;

  return (
    <section className="people-section" style={{ marginTop: "2.5rem" }}>
      <h2>Personas del calendario</h2>
      <p className="people-sub">Invita por email y elige qué puede hacer cada uno.</p>

      <form action={inviteToCalendarAction.bind(null, calendarId)} className="people-invite">
        <input name="email" type="email" placeholder="email@ejemplo.com" required aria-label="Email" />
        <fieldset className="people-seg">
          <legend className="visually-hidden">Rol</legend>
          <label>
            <input type="radio" name="role" value="GUEST" defaultChecked />
            <span>Visitante</span>
          </label>
          <label>
            <input type="radio" name="role" value="ADMIN" />
            <span>Administrador</span>
          </label>
        </fieldset>
        <SubmitButton>Invitar ahora</SubmitButton>
      </form>

      {errorMessage && (
        <p role="alert" className="people-error">
          {errorMessage}
        </p>
      )}

      {people === null ? (
        <p style={{ color: "var(--accent)" }}>Las personas del calendario no están disponibles ahora mismo.</p>
      ) : people.length === 0 ? (
        <p>Todavía no hay nadie en este calendario.</p>
      ) : (
        <ul className="people-list">
          {people.map((person) => {
            const hintId = person.isLastAdmin ? `last-admin-${person.email}` : undefined;
            const secondary = person.isSelf
              ? "Tú"
              : `Invitación del ${formatInvitedAt(person.invitedAt, timeZone)}${person.pending ? " · pendiente" : ""}`;
            return (
              <li key={person.email} className="people-row" data-email={person.email}>
                <span className="people-avatar" aria-hidden="true">
                  {person.email.charAt(0).toUpperCase()}
                </span>
                <div className="people-who">
                  <b>{person.email}</b>
                  <small>{secondary}</small>
                </div>
                <form action={setPersonRoleAction.bind(null, calendarId, person.email)} className="people-role-form">
                  <RoleSelect
                    role={person.role}
                    email={person.email}
                    disabled={person.isLastAdmin}
                    describedBy={hintId}
                  />
                  <noscript>
                    <button type="submit" disabled={person.isLastAdmin}>
                      Cambiar
                    </button>
                  </noscript>
                </form>
                <form action={removePersonAction.bind(null, calendarId, person.email)}>
                  <button
                    type="submit"
                    className="people-remove"
                    disabled={person.isLastAdmin}
                    aria-describedby={hintId}
                  >
                    Quitar
                  </button>
                </form>
                {person.role === "GUEST" && (
                  <form action={removeGuestEverywhereAction.bind(null, calendarId, person.email)}>
                    <ConfirmSubmitButton
                      label="Borrar por completo"
                      confirmText={`¿Seguro que quieres borrar a ${person.email} por completo? Se le quita como invitado de TODOS sus calendarios, no solo de este — no se puede deshacer.`}
                    />
                  </form>
                )}
                {person.isLastAdmin && (
                  <p id={hintId} className="people-hint">
                    {LAST_ADMIN_HINT}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {link ? (
        // TAL-35 (design/design-system.md § "Invitados — link de invitación
        // único"): un único link por calendario, con botón de copiar.
        <>
          <div className="invite-link-row">
            <span className="invite-link-label">Link de invitación</span>
            <span className="invite-link-url num">{link}</span>
            <CopyLinkButton link={link} />
          </div>
          {/* TAL-65 — decisión del PM: el link no da acceso ni rol por sí
              mismo; cada persona entra con el rol de su invitación. */}
          <p className="people-link-note">Cada persona entra con el rol con el que la invitaste (Visitante por defecto).</p>
        </>
      ) : (
        <p style={{ color: "var(--accent)" }}>
          Falta configurar la variable de entorno APP_URL para mostrar el link de invitación de
          forma segura en este entorno.
        </p>
      )}
    </section>
  );
}
