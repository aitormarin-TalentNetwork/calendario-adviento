import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { signOut } from "@/lib/auth";
import { getAuthorizedUser } from "@/lib/current-user";
import { DataLayerUnavailableError, tryDataLayer } from "@/lib/not-migrated";
import {
  addAdmin,
  listAdmins,
  listCalendarOptions,
  listCalendarsWithStats,
  removeAdminEverywhere,
  type CalendarStatus,
} from "@/lib/superadmin";

const STATUS_LABEL: Record<CalendarStatus, string> = {
  upcoming: "Sin empezar",
  live: "En marcha",
  finished: "Finalizado",
};

const ERROR_MESSAGE: Record<string, string> = {
  "invalid-email": "Escribe un email válido.",
  "calendar-not-found": "Ese calendario ya no existe — refresca la página.",
  // TAL-10 — Prisma/Postgres se retiran de la infraestructura: `addAdmin`
  // lanza `DataLayerUnavailableError` en vez de devolver
  // `{error:"calendar-not-found"}` cuando en realidad no se pudo consultar
  // (hallazgo de auditoría, ronda 1 — ese mensaje habría sido un motivo
  // inventado). `addAdminAction`, más abajo, la atrapa y redirige con este
  // motivo distinto.
  unavailable: "Esta acción no está disponible ahora mismo.",
};

function formatDate(date: Date) {
  return date.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

async function addAdminAction(formData: FormData) {
  "use server";
  const user = await getAuthorizedUser();
  if (!user?.isSuperAdmin) redirect("/unauthorized");

  const calendarId = String(formData.get("calendarId") ?? "");
  const email = String(formData.get("email") ?? "");

  // TAL-10 — Prisma/Postgres se retiran de la infraestructura: `addAdmin`
  // sigue validando el formato de email de verdad (no toca Prisma), pero
  // lanza `DataLayerUnavailableError` en la parte real de la escritura —
  // se atrapa aquí para redirigir con un motivo honesto ("no disponible"),
  // en vez de dejarlo propagar como un error crudo o inventar
  // "calendar-not-found" (hallazgo de auditoría, ronda 1).
  try {
    const result = await addAdmin(calendarId, email);
    revalidatePath("/superadmin");
    redirect(result.ok ? "/superadmin" : `/superadmin?error=${result.error}`);
  } catch (err) {
    if (!(err instanceof DataLayerUnavailableError)) throw err;
    revalidatePath("/superadmin");
    redirect("/superadmin?error=unavailable");
  }
}

async function removeAdminAction(formData: FormData) {
  "use server";
  const user = await getAuthorizedUser();
  if (!user?.isSuperAdmin) redirect("/unauthorized");

  const userId = String(formData.get("userId") ?? "");
  if (userId) await removeAdminEverywhere(userId);

  revalidatePath("/superadmin");
  redirect("/superadmin");
}

export default async function SuperAdminPage({ searchParams }: PageProps<"/superadmin">) {
  const user = await getAuthorizedUser();
  if (!user) redirect("/login?callbackUrl=/superadmin");
  if (!user.isSuperAdmin) redirect("/unauthorized");

  const { error } = await searchParams;
  const errorMessage = typeof error === "string" ? ERROR_MESSAGE[error] : undefined;

  // TAL-10 — Prisma/Postgres se retiran de la infraestructura: las tres
  // lanzan `DataLayerUnavailableError` (hallazgo de auditoría, ronda 1 —
  // antes devolvían `[]`, que esta página interpretaba como "no hay
  // calendarios"/"no hay ningún Admin", hechos falsos). Cada resultado se
  // distingue explícitamente de su lista vacía real más abajo.
  const now = new Date();
  const [calendarsResult, adminsResult, calendarOptionsResult] = await Promise.all([
    tryDataLayer(() => listCalendarsWithStats(now)),
    tryDataLayer(() => listAdmins()),
    tryDataLayer(() => listCalendarOptions()),
  ]);
  const calendars = calendarsResult.ok ? calendarsResult.data : null;
  const admins = adminsResult.ok ? adminsResult.data : null;
  const calendarOptions = calendarOptionsResult.ok ? calendarOptionsResult.data : null;

  return (
    <main style={{ flex: 1, padding: "2rem", display: "flex", flexDirection: "column", gap: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div>
          <h1>Todos los calendarios</h1>
          <p style={{ color: "var(--accent)" }}>
            Sesión: {user.email} — visión global, cualquier calendario de cualquier Admin.
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit">Cerrar sesión</button>
        </form>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {calendars === null && <p style={{ color: "var(--accent)" }}>Los calendarios no están disponibles ahora mismo.</p>}
        {calendars?.length === 0 && <p>Todavía no hay ningún calendario creado.</p>}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "1rem" }}>
          {calendars?.map((calendar) => (
            <div
              key={calendar.id}
              style={{ border: "1px solid var(--accent)", borderRadius: "0.75rem", padding: "1rem" }}
            >
              <span style={{ fontSize: "0.75rem", textTransform: "uppercase", color: "var(--accent)" }}>
                {STATUS_LABEL[calendar.status]}
              </span>
              <h3 style={{ margin: "0.25rem 0" }}>{calendar.name}</h3>
              <div style={{ fontSize: "0.85rem", color: "var(--accent)" }}>
                Admin: {calendar.admins.length > 0
                  ? calendar.admins.map((admin) => admin.name ?? admin.email).join(", ")
                  : "— sin Admin asignado"}
                {" · "}
                {formatDate(calendar.startDate)} – {formatDate(calendar.endDate)}
              </div>
              <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem", fontSize: "0.9rem" }}>
                <span><strong>{calendar.daysCount}</strong> días</span>
                <span><strong>{calendar.invitedCount}</strong> invitados</span>
                <span><strong>{calendar.viewedCount}</strong> vistos</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>Admins</h2>

        {errorMessage && <p style={{ color: "crimson" }}>{errorMessage}</p>}

        <form
          action={addAdminAction}
          style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}
        >
          <select name="calendarId" required defaultValue="">
            <option value="" disabled>
              Calendario…
            </option>
            {calendarOptions?.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          <input name="email" type="email" placeholder="email@ejemplo.com" required />
          <button type="submit" disabled={!calendarOptions || calendarOptions.length === 0}>
            + Nuevo Admin
          </button>
        </form>
        {calendarOptions === null && (
          <p style={{ fontSize: "0.85rem", color: "var(--accent)" }}>Los calendarios no están disponibles ahora mismo.</p>
        )}
        {calendarOptions?.length === 0 && (
          <p style={{ fontSize: "0.85rem", color: "var(--accent)" }}>
            No hay ningún calendario todavía — crea uno antes de asignarle un Admin.
          </p>
        )}

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--accent)" }}>
              <th>Persona</th>
              <th>Calendarios a cargo</th>
              <th>Creado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {admins?.map((admin) => (
              <tr key={admin.userId} style={{ borderBottom: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)" }}>
                <td>
                  <strong>{admin.name ?? admin.email}</strong>
                  {admin.name && <div style={{ fontSize: "0.85rem", color: "var(--accent)" }}>{admin.email}</div>}
                </td>
                <td>{admin.calendarsCount}</td>
                <td>{formatDate(admin.createdAt)}</td>
                <td style={{ textAlign: "right" }}>
                  <form action={removeAdminAction}>
                    <input type="hidden" name="userId" value={admin.userId} />
                    <button type="submit">Quitar</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {admins === null && <p style={{ color: "var(--accent)" }}>Los Admins no están disponibles ahora mismo.</p>}
        {admins?.length === 0 && <p>Todavía no hay ningún Admin.</p>}
      </section>
    </main>
  );
}
