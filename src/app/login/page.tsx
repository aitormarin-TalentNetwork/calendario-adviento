import { devLoginEnabled } from "@/lib/auth.config";
import { signIn } from "@/lib/auth";
import { DEFAULT_COVER_ICON } from "@/lib/cover-icons";

// `callbackUrl` seguía usándose para saber de qué calendario mostrar la
// portada personalizada (TAL-8) cuando un Invitado llega desde
// `/c/{calendarId}` sin sesión — TAL-10 retira esa consulta (ver más
// abajo), la constante se queda solo por si TAL-12+ la recupera.
const GUEST_CALLBACK_RE = /^\/c\/([^/?]+)/;
void GUEST_CALLBACK_RE;

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { callbackUrl } = await searchParams;
  // Hallazgo de auditoría, TAL-17: `"/"` ya no es un destino real — desde
  // esta misma tarea, `/` redirige a `/login` (no hay landing prevista en
  // el PRD). Usarlo aquí como destino por defecto creaba un bucle
  // /login → / → /login para cualquiera que entrara a /login directamente
  // (sin `callbackUrl`, justo el caso normal ahora que `/` ya no muestra
  // nada). `/admin` es un destino real para cualquier rol autenticado
  // (Admin, Super Admin o Guest sin calendarios propios — la página ya
  // gestiona los tres casos con contenido honesto, sin gate de rol más
  // allá de estar autenticado, ver TAL-12).
  const redirectTo = typeof callbackUrl === "string" ? callbackUrl : "/admin";

  // TAL-10 — Prisma/Postgres se retiran de la infraestructura: la portada
  // personalizada por calendario (TAL-8, `prisma.calendar.findUnique`)
  // todavía no tiene equivalente conectado a Convex (TAL-12+). A
  // diferencia del resto de páginas (que ya redirigen a `/login` antes de
  // tocar Prisma, porque `getAuthorizedUser` devuelve siempre `null` — ver
  // src/lib/current-user.ts), ESTA es la propia página de login: el punto
  // de entrada público, alcanzable sin sesión, así que no puede dejarse
  // reventar con un error crudo por un link de invitado
  // (`/login?callbackUrl=/c/{id}`). Se cae a la portada genérica siempre,
  // en vez de lanzar.
  //
  // TAL-23 — sigue sin reconectar (hallazgo de esta tarea, trackeado
  // aparte en TAL-25: reconectar esto de verdad implica resolver un
  // calendario a partir de `callbackUrl` en una página pública sin
  // autenticar, con su propia superficie de seguridad a considerar — no
  // algo que decidir dentro de un ticket de "selector de icono"). Se deja
  // el tipo/JSX ya preparados para pintar `coverIcon` en cuanto TAL-25
  // reconecte la búsqueda real — con `calendar` siempre `null` hoy, esto
  // no cambia nada observable todavía.
  const calendar = null as { coverTitle: string; coverIcon: string; coverImageUrl: string | null } | null;

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
      <h1 style={{ fontSize: "1.8rem" }}>
        <span aria-hidden="true">{calendar?.coverIcon ?? DEFAULT_COVER_ICON}</span>{" "}
        {calendar?.coverTitle ?? "¡Feliz cuenta atrás, equipo!"}
      </h1>

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
