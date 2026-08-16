/**
 * TAL-11 — helper compartido para llamar a las funciones públicas
 * "delgadas" de Convex (`convex/serverAuth.ts` § frontera pública) desde
 * código de servidor de Next.js. Centraliza dónde se lee
 * `CONVEX_APP_SERVER_SECRET` (variable de servidor en Railway, NUNCA
 * `NEXT_PUBLIC_*` — si lo fuera, llegaría al navegador) para no repetir
 * `process.env.CONVEX_APP_SERVER_SECRET` suelto en cada llamador.
 *
 * Lanza si la variable no está configurada — quien llama (`getAuthorizedUser`/
 * `resolveCalendarAccess`, ver src/lib/current-user.ts y src/lib/roles.ts)
 * lo atrapa y falla cerrado ("no autorizado"), no es responsabilidad de
 * este helper decidir esa degradación.
 */
export function convexAppServerSecret(): string {
  const secret = process.env.CONVEX_APP_SERVER_SECRET;
  if (!secret) throw new Error("CONVEX_APP_SERVER_SECRET no configurado.");
  return secret;
}
