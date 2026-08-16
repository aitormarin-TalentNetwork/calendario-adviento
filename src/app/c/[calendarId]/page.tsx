import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DoorGrid } from "@/app/c/[calendarId]/door-grid";
import { DoorGridLoader } from "@/app/c/[calendarId]/door-grid-loader";
import { signOut } from "@/lib/auth";
import { todayInTimeZone } from "@/lib/calendars";
import { getAuthorizedUser } from "@/lib/current-user";
import { resolveDoors } from "@/lib/guest-calendar";
import { DataLayerUnavailableError, tryDataLayer } from "@/lib/not-migrated";
import { resolveCalendarAccess } from "@/lib/roles";

/**
 * TAL-10 — Prisma/Postgres se retiran de la infraestructura: antes
 * `prisma.calendar.findUnique`. Aislado en su propia función (mismo
 * patrón que los stubs de `src/lib/*.ts`) para que quede claro qué pieza
 * exacta falta reconectar en TAL-12+, en vez de un `throw` suelto dentro
 * del cuerpo de la página.
 */
async function getCalendarForGuestPage(calendarId: string): Promise<{ coverTitle: string }> {
  void calendarId;
  throw new DataLayerUnavailableError("GuestCalendarPage:calendar");
}

export default async function GuestCalendarPage({
  params,
}: PageProps<"/c/[calendarId]">) {
  const { calendarId } = await params;

  const user = await getAuthorizedUser();
  if (!user) redirect(`/login?callbackUrl=/c/${calendarId}`);

  // `notFound()` sin más habría sido una mentira — "este calendario no
  // existe" es un hecho distinto de "no se pudo consultar" (hallazgo de
  // auditoría, ronda 1) — así que se muestra un mensaje honesto de no
  // disponible en su lugar. `getAuthorizedUser` de arriba ya redirige a
  // todo el mundo hoy (ver src/lib/current-user.ts), pero esta llamada
  // tenía que dejar de ser un residuo real de Prisma para cuando TAL-12
  // restaure la autorización.
  const calendarResult = await tryDataLayer(() => getCalendarForGuestPage(calendarId));
  if (!calendarResult.ok) {
    return (
      <main style={{ flex: 1, padding: "2rem" }}>
        <p style={{ color: "var(--accent)" }}>Este calendario no está disponible ahora mismo.</p>
      </main>
    );
  }
  const calendar = calendarResult.data;

  // Cualquier rol (Guest, Admin o Super Admin) puede ver el calendario; para
  // un Guest sin membership todavía, resolveCalendarAccess la crea aquí
  // mismo si existe una Invitation a su nombre (ver src/lib/roles.ts).
  const access = await resolveCalendarAccess(user, calendarId);
  if (!access) redirect("/unauthorized");

  // La zona horaria la trae la cookie `tz` (TimezoneSync, layout raíz).
  // Si ya existe, se resuelven las puertas aquí mismo, en el servidor
  // (vía rápida, sin ida y vuelta al cliente).
  //
  // Si NO existe todavía (primerísima visita de esta persona): NO se
  // resuelve ninguna puerta en el servidor con un valor por defecto tipo
  // UTC. Hallazgo de auditoría, ronda 2: eso podía filtrar en la
  // respuesta inicial (HTML/payload de React Server Components) el
  // vídeo/mensaje de un día que en la zona horaria REAL de quien mira
  // todavía es futuro — comprobado con São Paulo entre las 21:00 y
  // medianoche local, donde UTC ya considera "mañana". El refresco
  // posterior de `TimezoneSync` no arregla esto: no revoca una respuesta
  // que el servidor ya mandó. En su lugar, `DoorGridLoader` (componente
  // cliente) resuelve las puertas en cuanto conoce la zona horaria real
  // del navegador — el servidor no manda contenido de ningún día hasta
  // entonces.
  const tz = (await cookies()).get("tz")?.value;

  return (
    <main style={{ flex: 1, padding: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "1.5rem" }}>
        <div>
          <h1>{calendar.coverTitle}</h1>
          <p style={{ color: "var(--accent)" }}>
            Sesión: {user.email} ({access.kind === "super-admin" ? "Super Admin" : access.role})
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

      {tz ? (
        <ServerResolvedDoors calendarId={calendarId} userId={user.id} timeZone={tz} />
      ) : (
        <DoorGridLoader calendarId={calendarId} />
      )}
    </main>
  );
}

async function ServerResolvedDoors({ calendarId, userId, timeZone }: { calendarId: string; userId: string; timeZone: string }) {
  const today = todayInTimeZone(new Date(), timeZone);
  const result = await tryDataLayer(() => resolveDoors(calendarId, userId, today));

  // TAL-10 — Prisma/Postgres se retiran de la infraestructura:
  // `resolveDoors` lanza `DataLayerUnavailableError` (hallazgo de
  // auditoría, ronda 1 — antes devolvía `{ok:true, doors:[]}`, una mentira
  // sobre el estado real del calendario). `tryDataLayer` la convierte en
  // `{ok:false}` sin dato — se distingue explícitamente del `!result.data.ok`
  // de más abajo, que sigue siendo un caso real y vigente (rango de
  // fechas demasiado largo para gestionar).
  if (!result.ok) {
    return <p style={{ color: "var(--accent)" }}>Este calendario no está disponible ahora mismo.</p>;
  }
  if (!result.data.ok) {
    return (
      <p style={{ color: "var(--accent)" }}>
        Este calendario tiene un rango de fechas demasiado largo ({result.data.span} días) para mostrarlo aquí —
        contacta con quien lo administra.
      </p>
    );
  }
  return <DoorGrid calendarId={calendarId} doors={result.data.doors} />;
}
