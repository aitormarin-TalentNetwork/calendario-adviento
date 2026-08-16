/**
 * Resuelve el origen del link de invitación de forma comprobable sin tocar
 * `headers()`/`process.env` directamente (eso lo hace el llamador) —
 * separado a propósito para poder probar la lógica de decisión sola, sin
 * arrancar Next.js ni Auth.js (hallazgo de auditoría, TAL-7 ronda 1: un
 * `Host` falsificado queda bloqueado antes de llegar aquí por el propio
 * middleware de autenticación al no encontrar sesión válida para ese host,
 * lo cual es una capa extra de protección — pero también impide probar
 * este código concreto disparando una petición real con `Host` falso).
 *
 * Nunca confía en `host` fuera de desarrollo local si no hay `appUrl`
 * configurado — ver docs/invitados.md.
 */
export function resolveInvitationLink(
  calendarId: string,
  opts: { appUrl?: string; host?: string }
): string | null {
  const trustedOrigin = opts.appUrl?.replace(/\/+$/, "");
  if (trustedOrigin) return `${trustedOrigin}/c/${calendarId}`;

  const host = opts.host ?? "localhost:3001";
  const isLocalDev = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  if (!isLocalDev) return null;

  return `http://${host}/c/${calendarId}`;
}
