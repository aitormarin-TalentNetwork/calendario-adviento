import { signOut } from "@/lib/auth";

const AVATAR_SIZE = 40;

type SessionIndicatorProps = {
  email: string;
  image: string | null;
  /**
   * Rol a mostrar solo en el tooltip (`title`) del avatar — el brief pide
   * quitar el texto VISIBLE "Sesión: email (ROL)", no perder del todo la
   * información: sigue disponible al pasar el ratón/con lector de
   * pantalla (`title`), solo deja de ocupar espacio permanente en la
   * pantalla.
   */
  roleLabel?: string;
};

/**
 * Indicador de sesión (TAL-28) — reemplaza el patrón de texto plano
 * "Sesión: email (ROL)" + botón "Cerrar sesión" en las 4 pantallas
 * autenticadas (design/design-system.md § "Indicador de sesión").
 * `position: fixed` a propósito: no depende de que el contenedor de cada
 * página tenga `position: relative`, funciona igual en las 4 pantallas sin
 * tocar el layout de cada una, y se queda visible al hacer scroll.
 *
 * Botón de cerrar sesión SOLO icono ("🚪"), sin texto visible — brief:
 * "evitar palabras en un idioma concreto". `aria-label` sigue en español
 * (como el resto de la app) porque es para tecnología de asistencia, no
 * texto visible en pantalla — no es lo que el brief pide evitar.
 */
export function SessionIndicator({ email, image, roleLabel }: SessionIndicatorProps) {
  const title = roleLabel ? `${email} (${roleLabel})` : email;

  return (
    <div
      style={{
        position: "fixed",
        top: "1rem",
        right: "1rem",
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
      }}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL externa (perfil OAuth de Google), no vale next/image sin configurar dominios remotos — mismo criterio ya establecido para coverImageUrl (TAL-5).
        <img
          src={image}
          alt={title}
          title={title}
          style={{
            width: AVATAR_SIZE,
            height: AVATAR_SIZE,
            borderRadius: "50%",
            objectFit: "cover",
          }}
        />
      ) : (
        <div
          role="img"
          aria-label={title}
          title={title}
          style={{
            width: AVATAR_SIZE,
            height: AVATAR_SIZE,
            borderRadius: "50%",
            background: "var(--pine-2)",
            color: "var(--paper)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--font-display)",
            fontSize: "1.1rem",
          }}
        >
          {email.charAt(0).toUpperCase()}
        </div>
      )}
      <form
        action={async () => {
          "use server";
          await signOut({ redirectTo: "/login" });
        }}
      >
        <button
          type="submit"
          aria-label="Cerrar sesión"
          title="Cerrar sesión"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            fontSize: "1.3rem",
            lineHeight: 1,
            padding: "0.25rem",
          }}
        >
          🚪
        </button>
      </form>
    </div>
  );
}
