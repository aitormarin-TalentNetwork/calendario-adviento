import "./env";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";

export { api };

/**
 * Cliente de Convex para sembrar y consultar datos desde los tests, contra
 * el deployment de desarrollo de la terminal (`NEXT_PUBLIC_CONVEX_URL` de
 * `.env.local`) — nunca producción. Las funciones `*Public` piden el
 * secreto compartido de la frontera Next.js↔Convex (TAL-11); se pasa con
 * `serverSecret()`.
 */
export const convex = new ConvexHttpClient(requireEnv("NEXT_PUBLIC_CONVEX_URL"));

export function serverSecret(): string {
  return requireEnv("CONVEX_APP_SERVER_SECRET");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en el entorno (.env.local) para los tests e2e.`);
  return value;
}
