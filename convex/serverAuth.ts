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
 * Comparación en tiempo constante — no `===`. Un secreto de longitud fija
 * comparado con `===` sale en cuanto encuentra la primera diferencia de
 * carácter, filtrando por temporización cuántos caracteres iniciales
 * acertó un atacante (mismo motivo que comparar cualquier otro
 * secreto/token en esta app). Sin `crypto.timingSafeEqual` de Node — las
 * funciones de Convex corren en un runtime V8 por defecto (sin `"use
 * node"`), que no expone el módulo `crypto` de Node; esta comparación
 * manual no necesita ninguna API específica de runtime.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verifica el secreto recibido de una función pública "delgada" contra
 * `CONVEX_APP_SERVER_SECRET` (variable de entorno de este deployment de
 * Convex, ver `npx convex env set` — documentado en docs/auth.md). Lanza
 * si no coincide o si el deployment no tiene la variable configurada
 * (nunca "seguir sin comprobar nada" ante una variable ausente).
 */
export function requireServerSecret(received: string): void {
  const expected = process.env.CONVEX_APP_SERVER_SECRET;
  if (!expected) throw new Error("CONVEX_APP_SERVER_SECRET no configurado en este deployment.");
  if (!timingSafeEqual(received, expected)) throw new Error("Secreto de servidor inválido.");
}
