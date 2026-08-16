import { notFound, redirect } from "next/navigation";
import { signOut } from "@/lib/auth";
import { getAuthorizedUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { resolveCalendarAccess } from "@/lib/roles";

export default async function AdminCalendarPage({
  params,
}: PageProps<"/admin/[calendarId]">) {
  const { calendarId } = await params;

  const user = await getAuthorizedUser();
  if (!user) redirect(`/login?callbackUrl=/admin/${calendarId}`);

  const calendar = await prisma.calendar.findUnique({ where: { id: calendarId } });
  if (!calendar) notFound();

  const access = await resolveCalendarAccess(user, calendarId);
  const isAdmin = access?.kind === "super-admin" || access?.role === "ADMIN";
  if (!isAdmin) redirect("/unauthorized");

  return (
    <main style={{ flex: 1, padding: "2rem" }}>
      <h1>Admin — {calendar.name}</h1>
      <p style={{ color: "var(--accent)" }}>
        Sesión: {user.email} ({access?.kind === "super-admin" ? "Super Admin" : "Admin"}
        ) — gestión de días/invitados (contenido real en TAL-5).
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
