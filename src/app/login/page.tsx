import { fetchQuery } from "convex/nextjs";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { devLoginEnabled } from "@/lib/auth.config";
import { signIn } from "@/lib/auth";
import { convexAppServerSecret } from "@/lib/convex-server";
import { DEFAULT_COVER_ICON } from "@/lib/cover-icons";

// `callbackUrl` dice de qué calendario mostrar la portada personalizada
// (TAL-8, reconectada en TAL-25 tras el hueco que dejó TAL-10) cuando un
// Invitado llega desde `/c/{calendarId}` sin sesión — solo esa forma, no
// `/admin/{calendarId}` (decisión de TAL-25, ver más abajo).
const GUEST_CALLBACK_RE = /^\/c\/([^/?]+)/;

/**
 * TAL-25 — resuelve el calendario de la portada a partir de `callbackUrl`,
 * en una página pública SIN AUTENTICAR: alcanzable por cualquiera con el
 * link de invitación, incluso antes de loguearse. Dos decisiones de
 * seguridad, ambas dentro de lo que el propio brief de TAL-25 ya
 * planteaba como razonable (documentadas aquí, no escaladas — sin duda
 * real sobre ninguna de las dos):
 *
 * 1. Qué exponer: solo `coverTitle`/`coverIcon`/`coverImageUrl` — el
 *    nombre bonito, el icono y la foto del calendario, nada que no sea ya
 *    visible en la propia invitación por email (ni fechas, ni skin, ni
 *    nada de invitados/admins). Por eso esta función llama a
 *    `calendars.getPublicCoverInfoForLogin` (lista blanca explícita en
 *    Convex, ver el comentario completo ahí) y NUNCA a `calendars.getPublic`
 *    (documento entero) — así la restricción vive en la propia consulta,
 *    no en que este código recuerde no reenviar el resto del documento.
 * 2. Solo `/c/[calendarId]` (Invitado), no `/admin/[calendarId]`: esa es
 *    una ruta de Admin, no de Invitado — nadie llega ahí siguiendo un
 *    link de invitación, así que no tiene sentido de producto mostrar su
 *    portada en el login público, y ampliar la superficie que esta página
 *    sin autenticar puede resolver sin necesidad real no compensa.
 *
 * Cualquier fallo — `calendarId` con formato inválido (Convex rechaza el
 * argumento antes de que el handler compruebe si existe), el calendario
 * no existe, o un fallo genuino de Convex — cae al mismo `null` (portada
 * genérica), sin excepción ni distinción visible entre esos casos (brief
 * TAL-25 punto 4: no dar pistas de si un id existe o no a quien no
 * debería tenerlas) — mismo criterio ya establecido en esta página desde
 * TAL-10 para cualquier fallo de la capa de datos.
 */
async function getCalendarCoverForLogin(
  callbackUrl: string | undefined
): Promise<{ coverTitle: string; coverIcon: string; coverImageUrl: string | null } | null> {
  const match = callbackUrl?.match(GUEST_CALLBACK_RE);
  if (!match) return null;

  try {
    const calendar = await fetchQuery(api.calendars.getPublicCoverInfoForLogin, {
      serverSecret: convexAppServerSecret(),
      calendarId: match[1] as Id<"calendars">,
    });
    if (!calendar) return null;
    return {
      coverTitle: calendar.coverTitle,
      coverIcon: calendar.coverIcon ?? DEFAULT_COVER_ICON,
      coverImageUrl: calendar.coverImageUrl ?? null,
    };
  } catch {
    return null;
  }
}

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { callbackUrl: callbackUrlRaw } = await searchParams;
  const callbackUrl = typeof callbackUrlRaw === "string" ? callbackUrlRaw : undefined;

  // Hallazgo de auditoría, TAL-17: `"/"` ya no es un destino real — desde
  // esa misma tarea, `/` redirige a `/login` (no hay landing prevista en
  // el PRD). Usarlo aquí como destino por defecto creaba un bucle
  // /login → / → /login para cualquiera que entrara a /login directamente
  // (sin `callbackUrl`, justo el caso normal ahora que `/` ya no muestra
  // nada). `/admin` es un destino real para cualquier rol autenticado
  // (Admin, Super Admin o Guest sin calendarios propios — la página ya
  // gestiona los tres casos con contenido honesto, sin gate de rol más
  // allá de estar autenticado, ver TAL-12).
  const redirectTo = callbackUrl ?? "/admin";

  const calendar = await getCalendarCoverForLogin(callbackUrl);

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
