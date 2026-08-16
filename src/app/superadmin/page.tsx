import { redirect } from "next/navigation";
import { signOut } from "@/lib/auth";
import { getAuthorizedUser } from "@/lib/current-user";

export default async function SuperAdminPage() {
  const user = await getAuthorizedUser();
  if (!user) redirect("/login?callbackUrl=/superadmin");
  if (!user.isSuperAdmin) redirect("/unauthorized");

  return (
    <main style={{ flex: 1, padding: "2rem" }}>
      <h1>Panel Super Admin</h1>
      <p style={{ color: "var(--accent)" }}>
        Sesión: {user.email} — visión global, cualquier calendario de
        cualquier Admin (contenido real en TAL-4).
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
