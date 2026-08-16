import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { DoorGrid } from "@/app/c/[calendarId]/door-grid";
import { signOut } from "@/lib/auth";
import { todayInTimeZone } from "@/lib/calendars";
import { getAuthorizedUser } from "@/lib/current-user";
import { resolveDoors } from "@/lib/guest-calendar";
import { prisma } from "@/lib/prisma";
import { resolveCalendarAccess } from "@/lib/roles";

export default async function GuestCalendarPage({
  params,
}: PageProps<"/c/[calendarId]">) {
  const { calendarId } = await params;

  const user = await getAuthorizedUser();
  if (!user) redirect(`/login?callbackUrl=/c/${calendarId}`);

  const calendar = await prisma.calendar.findUnique({ where: { id: calendarId } });
  if (!calendar) notFound();

  // Cualquier rol (Guest, Admin o Super Admin) puede ver el calendario; para
  // un Guest sin membership todavía, resolveCalendarAccess la crea aquí
  // mismo si existe una Invitation a su nombre (ver src/lib/roles.ts).
  const access = await resolveCalendarAccess(user, calendarId);
  if (!access) redirect("/unauthorized");

  // La zona horaria la trae la cookie `tz` (TimezoneSync, layout raíz) —
  // en la primerísima visita (antes de que ese componente cliente haya
  // podido escribirla) cae a UTC vía todayInTimeZone/safeTimeZone; el
  // propio TimezoneSync fuerza un refresco en cuanto la deja escrita, así
  // que el hueco es de una sola carga.
  const tz = (await cookies()).get("tz")?.value;
  const today = todayInTimeZone(new Date(), tz);
  const result = await resolveDoors(calendarId, user.id, today);

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

      {result.ok ? (
        <DoorGrid calendarId={calendarId} doors={result.doors} />
      ) : (
        <p style={{ color: "var(--accent)" }}>
          Este calendario tiene un rango de fechas demasiado largo ({result.span} días) para mostrarlo aquí —
          contacta con quien lo administra.
        </p>
      )}
    </main>
  );
}
