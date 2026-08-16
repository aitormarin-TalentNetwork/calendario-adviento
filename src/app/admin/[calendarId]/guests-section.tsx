import { headers } from "next/headers";
import {
  inviteGuestAction,
  removeGuestEverywhereAction,
  removeGuestFromCalendarAction,
} from "@/app/admin/[calendarId]/guests-actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { CopyLinkButton } from "@/components/copy-link-button";
import { SubmitButton } from "@/components/submit-button";
import { listCalendarGuests } from "@/lib/guests";
import { resolveInvitationLink } from "@/lib/invitation-link";
import { tryDataLayer } from "@/lib/not-migrated";

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

export async function GuestsSection({ calendarId }: { calendarId: string }) {
  // TAL-10 — Prisma/Postgres se retiran de la infraestructura:
  // `listCalendarGuests` lanza `DataLayerUnavailableError` (hallazgo de
  // auditoría, ronda 1 — antes devolvía `[]`, que esta sección ya
  // interpretaba como "todavía no hay invitados", un hecho falso).
  const [guestsResult, link] = await Promise.all([
    tryDataLayer(() => listCalendarGuests(calendarId)),
    invitationLink(calendarId),
  ]);
  const guests = guestsResult.ok ? guestsResult.data : null;

  return (
    <section style={{ marginTop: "2.5rem" }}>
      <h2>Invitados</h2>

      {link ? (
        <p style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          Link de invitación: <code>{link}</code>
          <CopyLinkButton link={link} />
        </p>
      ) : (
        <p style={{ color: "var(--accent)" }}>
          Falta configurar la variable de entorno APP_URL para mostrar el link de invitación de
          forma segura en este entorno.
        </p>
      )}

      {guests === null ? (
        <p style={{ color: "var(--accent)" }}>Los invitados no están disponibles ahora mismo.</p>
      ) : guests.length === 0 ? (
        <p>Todavía no hay invitados.</p>
      ) : (
        <table style={{ width: "100%", marginTop: "1rem", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Email</th>
              <th style={{ textAlign: "left" }}>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {guests.map((guest) => (
              <tr key={guest.email}>
                <td>{guest.email}</td>
                <td>{guest.accepted ? "Ha entrado" : "Invitado"}</td>
                <td style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                  <form action={removeGuestFromCalendarAction.bind(null, calendarId, guest.email)}>
                    <button type="submit">Quitar del calendario</button>
                  </form>
                  <form action={removeGuestEverywhereAction.bind(null, calendarId, guest.email)}>
                    <ConfirmSubmitButton
                      label="Borrar por completo"
                      confirmText={`¿Seguro que quieres borrar a ${guest.email} por completo? Se le quita como invitado de TODOS sus calendarios, no solo de este — no se puede deshacer.`}
                    />
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form
        action={inviteGuestAction.bind(null, calendarId)}
        style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}
      >
        <input name="email" type="email" placeholder="email@ejemplo.com" required />
        <SubmitButton>Invitar ahora</SubmitButton>
      </form>
    </section>
  );
}
