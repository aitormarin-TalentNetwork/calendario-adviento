import { devLoginEnabled } from "@/lib/auth.config";
import { signIn } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// `callbackUrl` no solo dice a dónde volver tras el login — si apunta a
// `/c/{calendarId}` (un Invitado que llega al link de su calendario sin
// sesión todavía), también dice de qué calendario mostrar la portada
// personalizada (TAL-8, brief: "portada de login personalizada por
// calendario"). Un id que no exista simplemente no encuentra Calendar más
// abajo y se cae a la portada genérica — no hace falta validar el formato
// aquí.
const GUEST_CALLBACK_RE = /^\/c\/([^/?]+)/;

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { callbackUrl } = await searchParams;
  const redirectTo = typeof callbackUrl === "string" ? callbackUrl : "/";

  const calendarId = typeof callbackUrl === "string" ? GUEST_CALLBACK_RE.exec(callbackUrl)?.[1] : undefined;
  const calendar = calendarId
    ? await prisma.calendar.findUnique({
        where: { id: calendarId },
        select: { coverTitle: true, coverImageUrl: true },
      })
    : null;

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
      {calendar?.coverImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- URL externa arbitraria (validada como https:// al guardarla, TAL-5), no vale next/image sin configurar dominios remotos.
        <img
          src={calendar.coverImageUrl}
          alt=""
          style={{ width: "120px", height: "120px", objectFit: "cover", borderRadius: "50%" }}
        />
      )}
      <h1 style={{ fontSize: "1.8rem" }}>{calendar?.coverTitle ?? "¡Feliz cuenta atrás, equipo! 🎄"}</h1>

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
