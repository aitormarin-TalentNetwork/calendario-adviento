/**
 * TAL-68 — modos del menú de la cuenta y aterrizaje tras el login, en
 * funciones PURAS (sin imports de servidor), para que el aterrizaje, el menú
 * y `switchModeAction` compartan una sola definición y se puedan probar
 * directamente (e2e/tal68-account-modes.spec.ts).
 *
 * - "user" → /c (TAL-58), "admin" → /admin, "superadmin" → /superadmin.
 * - "superadmin" solo para quien es Super Admin, leído en fresco por quien
 *   llama (`getAuthorizedUser`). Convex lo vuelve a exigir al guardarlo
 *   (`users.ts::setPreferredModeHandler`).
 * - Un modo guardado que ya no es válido (p. ej. "superadmin" de alguien a
 *   quien le quitaron el rol) cae a su modo válido, nunca a una pantalla que
 *   le daría /unauthorized.
 */
export type AccountMode = "user" | "admin" | "superadmin";

type ModeUser = { isSuperAdmin: boolean; preferredMode?: AccountMode | null };

/**
 * TAL-59 — ¿puede esta persona usar el modo Admin? Es Super Admin o
 * administra al menos un calendario. Única definición de la regla: la usan
 * el aterrizaje (`/start`), el redirect de `/admin` (TAL-58), el menú de la
 * cuenta (si enseña la sección "Modo") y `switchModeAction`. Pura a
 * propósito: cada llamador le pasa el número de calendarios que administra
 * desde la lista que ya ha cargado, sin consultas duplicadas.
 */
export function canUseAdminMode(user: { isSuperAdmin: boolean }, administeredCount: number): boolean {
  return user.isSuperAdmin || administeredCount > 0;
}

/** Modos que esta persona puede usar, en el orden del menú. */
export function allowedModes(user: ModeUser, administeredCount: number): AccountMode[] {
  if (!canUseAdminMode(user, administeredCount)) return ["user"];
  return user.isSuperAdmin ? ["user", "admin", "superadmin"] : ["user", "admin"];
}

export function isAllowedMode(mode: AccountMode, user: ModeUser, administeredCount: number): boolean {
  return allowedModes(user, administeredCount).includes(mode);
}

export const MODE_PATH: Record<AccountMode, string> = {
  user: "/c",
  admin: "/admin",
  superadmin: "/superadmin",
};

/**
 * A dónde aterriza tras un login sin `callbackUrl` (`src/app/start/page.tsx`):
 * el modo recordado si sigue siendo válido; si no (o si nunca eligió),
 * Admin para quien puede usarlo y Usuario para el invitado puro.
 */
export function landingPath(user: ModeUser, administeredCount: number): string {
  const remembered = user.preferredMode ?? null;
  if (remembered && remembered !== "admin" && isAllowedMode(remembered, user, administeredCount)) {
    return MODE_PATH[remembered];
  }
  return canUseAdminMode(user, administeredCount) ? MODE_PATH.admin : MODE_PATH.user;
}
