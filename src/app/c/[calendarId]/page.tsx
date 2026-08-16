import { notFound, redirect } from "next/navigation";
import { signOut } from "@/lib/auth";
import { getAuthorizedUser } from "@/lib/current-user";
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

  return (
    <main style={{ flex: 1, padding: "2rem" }}>
      <h1>{calendar.coverTitle}</h1>
      <p style={{ color: "var(--accent)" }}>
        Sesión: {user.email} (
        {access.kind === "super-admin" ? "Super Admin" : access.role}) — la
        cuadrícula de puertas es contenido real de TAL-5.
      </p>
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button type="submit">Cerrar sesión</button>
      </form>
    </main>
  );
}
