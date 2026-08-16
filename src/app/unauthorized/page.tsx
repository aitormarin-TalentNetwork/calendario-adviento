import { auth, signOut } from "@/lib/auth";

export default async function UnauthorizedPage() {
  const session = await auth();

  return (
    <main
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <h1 style={{ fontSize: "1.5rem" }}>No tienes acceso a esto</h1>
      <p style={{ color: "var(--accent)" }}>
        {session?.user
          ? `${session.user.email} no tiene invitación ni rol para lo que intentabas abrir.`
          : "Inicia sesión para continuar."}
      </p>
      {session?.user && (
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit">Cerrar sesión</button>
        </form>
      )}
    </main>
  );
}
