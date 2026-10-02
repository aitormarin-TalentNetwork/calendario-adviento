import { redirect } from "next/navigation";
import { listAdminCalendars } from "@/lib/calendars";
import { getAuthorizedUser } from "@/lib/current-user";
import { landingPath } from "@/lib/account-modes";

/**
 * TAL-59 — aterrizaje tras un login sin `callbackUrl` (destino por defecto
 * de `src/app/login/page.tsx`). Sin UI: decide el modo y redirige.
 *
 * - Invitado puro (ni Super Admin ni Admin de nada) → siempre modo Usuario
 *   (`/c`, que ya resuelve 0/1/varios calendarios — TAL-58).
 * - Admin o Super Admin → el último modo que eligió en el menú de la
 *   cuenta (`users.preferredMode`); si nunca eligió, Admin (lo de siempre).
 * - TAL-68: "superadmin" → `/superadmin`, solo si sigue siendo Super Admin;
 *   si le quitaron el rol, cae a Admin o Usuario (nunca a /unauthorized).
 *
 * Ruta propia en vez de meter esta decisión en `/admin`: si `/admin`
 * redirigiera según el modo recordado, elegir "Admin" en el menú o entrar a
 * `/admin` a mano rebotaría a `/c`. `/start` solo se visita al venir del
 * login. Con `callbackUrl` (link de invitación) el login no pasa por aquí.
 */
export default async function StartPage() {
  const user = await getAuthorizedUser();
  if (!user) redirect("/login");

  // TAL-68 — la regla vive en `landingPath` (pura): el modo recordado si
  // sigue siendo válido ("superadmin" solo para quien lo es en fresco); si
  // no, Admin o Usuario según su rol.
  const administered = await listAdminCalendars(user.id);
  redirect(landingPath(user, administered.length));
}
