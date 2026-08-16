import { notFound, redirect } from "next/navigation";
import { deleteCalendarAction, updateCalendarAction } from "@/app/admin/actions";
import { DaysSection } from "@/app/admin/[calendarId]/days-section";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { SubmitButton } from "@/components/submit-button";
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

  const skins = await prisma.skin.findMany({ orderBy: { key: "asc" } });

  return (
    <main style={{ flex: 1, padding: "2rem", maxWidth: "480px" }}>
      <h1>Editar calendario</h1>
      <p style={{ color: "var(--accent)" }}>
        Sesión: {user.email} ({access?.kind === "super-admin" ? "Super Admin" : "Admin"})
      </p>

      <form
        action={updateCalendarAction.bind(null, calendar.id)}
        style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "1.5rem" }}
      >
        <label>
          Nombre del calendario
          <br />
          <input name="name" type="text" defaultValue={calendar.name} required />
        </label>
        <label>
          Título de portada
          <br />
          <input name="coverTitle" type="text" defaultValue={calendar.coverTitle} required />
        </label>
        <label>
          Fecha de inicio
          <br />
          <input
            name="startDate"
            type="date"
            defaultValue={calendar.startDate.toISOString().slice(0, 10)}
            required
          />
        </label>
        <label>
          Fecha de fin
          <br />
          <input
            name="endDate"
            type="date"
            defaultValue={calendar.endDate.toISOString().slice(0, 10)}
            required
          />
        </label>
        <label>
          Skin
          <br />
          <select name="skinId" defaultValue={calendar.skinId} required>
            {skins.map((skin) => (
              <option key={skin.id} value={skin.id}>
                {skin.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Foto de portada (URL, opcional)
          <br />
          <input
            name="coverImageUrl"
            type="url"
            defaultValue={calendar.coverImageUrl ?? ""}
            placeholder="https://…"
          />
        </label>
        <SubmitButton>Guardar cambios</SubmitButton>
      </form>

      <DaysSection calendarId={calendar.id} />

      <form action={deleteCalendarAction.bind(null, calendar.id)} style={{ marginTop: "2rem" }}>
        <ConfirmSubmitButton
          label="Borrar calendario"
          confirmText={`¿Seguro que quieres borrar "${calendar.name}"? Esto borra también sus días, invitaciones y membresías — no se puede deshacer.`}
        />
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
