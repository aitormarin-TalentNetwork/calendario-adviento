import Link from "next/link";
import { redirect } from "next/navigation";
import { createCalendarAction } from "@/app/admin/actions";
import { CreationKeyInput } from "@/components/creation-key-input";
import { SubmitButton } from "@/components/submit-button";
import { formatCalendarDate, listAdminCalendars } from "@/lib/calendars";
import { signOut } from "@/lib/auth";
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
      <h1>Mis calendarios</h1>
      <p style={{ color: "var(--accent)" }}>Sesión: {user.email}</p>

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

      <form action={createCalendarAction} style={{ marginTop: "1.5rem" }}>
        {/* Generada una sola vez en el cliente (TAL-19 — ver
            src/components/creation-key-input.tsx): mientras no se recargue
            la página, un doble clic o un reenvío del mismo formulario manda
            la misma clave y el servidor lo trata como el mismo intento —
            ver createCalendarForAdmin. */}
        <CreationKeyInput />
        <SubmitButton>+ Nuevo calendario</SubmitButton>
      </form>

      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
        style={{ marginTop: "1.5rem" }}
      >
        <button type="submit">Cerrar sesión</button>
      </form>
    </main>
  );
}
