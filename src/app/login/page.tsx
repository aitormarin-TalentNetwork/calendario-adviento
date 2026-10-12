import { CalendarDays } from "lucide-react";
import { devLoginEnabled } from "@/lib/auth.config";
import { signIn } from "@/lib/auth";

// TAL-70 — `/login` es genérico (design-system.md § "Bienvenida con foto
// (después de entrar)"): una persona puede tener varios calendarios, así
// que antes de entrar no se sabe cuál mostrar. Ya no lee ningún calendario
// (ni con `callbackUrl` de invitación): la portada personalizada de TAL-25
// y su consulta pública sin autenticar (`calendars.getPublicCoverInfoForLogin`)
// se retiran. La foto de portada se ve después de entrar, en la bienvenida
// de `/c/<id>` (`welcome-overlay.tsx`).

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { callbackUrl: callbackUrlRaw } = await searchParams;
  const callbackUrl = typeof callbackUrlRaw === "string" ? callbackUrlRaw : undefined;

  // Hallazgo de auditoría, TAL-17: `"/"` ya no es un destino real — desde
  // esa misma tarea, `/` redirige a `/login` (no hay landing prevista en
  // el PRD). Usarlo aquí como destino por defecto creaba un bucle
  // /login → / → /login para cualquiera que entrara a /login directamente
  // (sin `callbackUrl`, justo el caso normal ahora que `/` ya no muestra
  // nada). TAL-59 — `/start` reparte según el rol y el último modo
  // elegido en el menú de la cuenta: un invitado puro va siempre al modo
  // Usuario (`/c`, TAL-58); un Admin/Super Admin, a su último modo (Admin
  // si nunca eligió). Con `callbackUrl` (link de invitación `/c/<id>`)
  // manda siempre `callbackUrl`, sin cambios.
  const redirectTo = callbackUrl ?? "/start";

  return (
    <main
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1rem",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <div className="login-logo" aria-hidden="true">
        <CalendarDays size={36} strokeWidth={2} />
      </div>
      <div>
        <h1 className="login-title">Calendario de Adviento</h1>
        <p className="login-tagline">Una sorpresa cada día.</p>
      </div>

      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo });
        }}
      >
        <button type="submit" className="btn btn-primary">
          Entrar con Google
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
          <p style={{ fontSize: "0.75rem", color: "var(--ink-dim)" }}>
            Login de desarrollo (simulado) — solo disponible en local, sin
            credenciales reales de Google.
          </p>
          <input name="email" type="email" placeholder="tu@email.com" required />
          <input name="name" type="text" placeholder="Nombre (opcional)" />
          <button type="submit" className="btn">Entrar (dev)</button>
        </form>
      )}
    </main>
  );
}
