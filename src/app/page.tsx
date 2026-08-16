import { redirect } from "next/navigation";

// No hay landing real prevista en el PRD (decisión del PM, TAL-17) — solo
// login de Admin/Super Admin y portadas de invitado por calendario. Este
// placeholder de TAL-1 quedó huérfano desde el MVP; `/` no está en
// `PROTECTED_PREFIXES` de `src/proxy.ts` (el middleware ni siquiera corre
// aquí, ver su `matcher`), así que el redirect tiene que vivir en la
// propia página.
export default function Home() {
  redirect("/login");
}
