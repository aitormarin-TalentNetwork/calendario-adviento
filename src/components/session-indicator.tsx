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
 * Posicionamiento (`position: fixed` + el override de mobile) vive en la
 * clase `.session-indicator` de `globals.css`, no inline — un `style`
 * inline no puede llevar `@media`, y este componente sí necesita uno
 * (ver el comentario del breakpoint en `globals.css`).
 *
 * Botón de cerrar sesión SOLO icono, sin texto visible — brief: "evitar
 * palabras en un idioma concreto". Ajuste 2026-08-17 (feedback de
 * Aitor): el emoji de puerta ("🚪") resultaba demasiado literal/
 * skeuomórfico — sustituido por un SVG de línea inline, mismo path que
 * el icono "log-out" de Feather Icons (MIT, feathericons.com) — no hay
 * ninguna librería de iconos instalada en el proyecto todavía, así que
 * se reproduce el path a mano en vez de añadir una dependencia nueva
 * solo para un icono. `stroke="currentColor"` — hereda el `color` del
 * botón, mismo criterio que pide el Design System.
 *
 * `aria-label` sigue en español (como el resto de la app) porque es
 * para tecnología de asistencia, no texto visible en pantalla — no es
 * lo que el brief pide evitar.
 */
export function SessionIndicator({ email, image, roleLabel }: SessionIndicatorProps) {
  const title = roleLabel ? `${email} (${roleLabel})` : email;

  return (
    <div className="session-indicator">
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
            color: "var(--text)",
            display: "flex",
            padding: "0.25rem",
          }}
        >
          {/* Icono "log-out" (Feather Icons, MIT) — flecha saliendo de un
              marco/puerta abierta por un lado. */}
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </form>
    </div>
  );
}
