import { devLoginEnabled } from "@/lib/auth.config";
import { signIn } from "@/lib/auth";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { callbackUrl } = await searchParams;
  const redirectTo = typeof callbackUrl === "string" ? callbackUrl : "/";

  return (
    <main
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.5rem",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <h1 style={{ fontSize: "1.8rem" }}>¡Feliz cuenta atrás, equipo! 🎄</h1>

      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo });
        }}
      >
        <button
          type="submit"
          style={{
            padding: "0.75rem 1.5rem",
            borderRadius: "999px",
            border: "1px solid var(--accent)",
            background: "transparent",
            color: "inherit",
            fontSize: "1rem",
            cursor: "pointer",
          }}
        >
          Continuar con Google
        </button>
      </form>

      {devLoginEnabled && (
        <form
          action={async (formData: FormData) => {
            "use server";
            await signIn("dev-login", {
              email: formData.get("email"),
              name: formData.get("name"),
              redirectTo,
            });
          }}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", width: "260px" }}
        >
          <p style={{ fontSize: "0.75rem", color: "var(--accent)" }}>
            Login de desarrollo (simulado) — solo disponible en local, sin
            credenciales reales de Google.
          </p>
          <input name="email" type="email" placeholder="tu@email.com" required />
          <input name="name" type="text" placeholder="Nombre (opcional)" />
          <button type="submit">Entrar (dev)</button>
        </form>
      )}
    </main>
  );
}
