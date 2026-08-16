// TAL-11 — frontera pública de Convex: las funciones `internal*` de TAL-9
// no son alcanzables desde `fetchQuery`/`fetchMutation`/`ConvexHttpClient`
// (verificado contra el deployment real — "Could not find public
// function"), así que Next.js necesita una capa pública para invocarlas.
// Decisión ya cerrada en docs/convex-auth-investigacion-tal11.md §
// "Recomendación cerrada": secreto compartido comparado dentro de Convex,
// no el puente JWT/JWKS (`ctx.auth`) que la propia documentación de Convex
// avisa que no garantiza. El secreto no dice "quién eres" — eso lo sigue
// resolviendo Next.js (`getAuthorizedUser`/`resolveCalendarAccess`,
// idéntico modelo de confianza que con Prisma) — dice "esta llamada viene
// de nuestro servidor de confianza, no de un navegador cualquiera con la
// URL pública del deployment".
//
// Compartido entre TAL-11/TAL-12/TAL-15 (docs/convex-diseno-tal12-crud-calendario.md,
// docs/convex-diseno-tal15-panel-superadmin.md ya lo dan por existente) —
// no duplicar este helper en cada fichero de función pública.

/**
 * Comparación en tiempo constante — no `===`, ni siquiera con un
 * early-return por longitud (hallazgo de auditoría, ronda 1: `if (a.length
 * !== b.length) return false` SÍ filtra por temporización si las
 * longitudes coinciden o no, antes incluso de mirar el contenido — sigue
 * siendo una rama que un atacante puede medir). En vez de comparar `a`/`b`
 * directamente, se hashean los dos con la misma función (SHA-256, vía Web
 * Crypto — disponible en el runtime V8 por defecto de Convex, sin `"use
 * node"`, verificado contra el deployment real) y se comparan los dos
 * digests, que SIEMPRE tienen la misma longitud fija (32 bytes) con
 * independencia de la longitud de `a`/`b` — el bucle de comparación final
 * itera siempre las mismas 32 veces, así que ni el contenido ni la
 * longitud de los secretos originales afectan al tiempo de esta función.
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const [digestA, digestB] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < digestA.length; i++) {
    diff |= digestA[i] ^ digestB[i];
  }
  return diff === 0;
}

async function sha256(value: string): Promise<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

/**
 * Verifica el secreto recibido de una función pública "delgada" contra
 * `CONVEX_APP_SERVER_SECRET` (variable de entorno de este deployment de
 * Convex, ver `npx convex env set` — documentado en docs/auth.md). Lanza
 * si no coincide o si el deployment no tiene la variable configurada
 * (nunca "seguir sin comprobar nada" ante una variable ausente).
 */
export async function requireServerSecret(received: string): Promise<void> {
  const expected = process.env.CONVEX_APP_SERVER_SECRET;
  if (!expected) throw new Error("CONVEX_APP_SERVER_SECRET no configurado en este deployment.");
  if (!(await timingSafeEqual(received, expected))) throw new Error("Secreto de servidor inválido.");
}
