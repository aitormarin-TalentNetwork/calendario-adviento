"use server";

import { redirect } from "next/navigation";
import { fetchMutation } from "convex/nextjs";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signOut } from "@/lib/auth";
import { listAdminCalendars } from "@/lib/calendars";
import { convexAppServerSecret } from "@/lib/convex-server";
import { getAuthorizedUser, type PreferredMode } from "@/lib/current-user";
import { canUseAdminMode } from "@/lib/roles";

/**
 * TAL-59 — acciones del menú de la cuenta (`src/components/account-menu.tsx`).
 * Viven aquí, en un fichero "use server" propio, porque el menú es un
 * Client Component y no puede declarar Server Actions inline (antes el
 * logout era inline en `SessionIndicator`, que era Server Component).
 */

/**
 * Cambia de modo desde el menú: guarda la elección (`users.preferredMode`,
 * la que recuerda `/start` tras el próximo login) y navega a la pantalla
 * de ese modo. Como toda Server Action, es un endpoint invocable
 * directamente: el modo llega del cliente y se valida aquí, y "admin" se
 * vuelve a autorizar con la misma regla que oculta la sección en el menú
 * (`canUseAdminMode`) — quien no puede usarlo acaba en `/c` sin que se
 * guarde nada.
 */
export async function switchModeAction(formData: FormData): Promise<void> {
  const user = await getAuthorizedUser();
  if (!user) redirect("/login");

  const raw = formData.get("mode");
  const mode: PreferredMode | null = raw === "user" || raw === "admin" ? raw : null;
  if (!mode) redirect("/start");

  if (mode === "admin") {
    const administered = await listAdminCalendars(user.id);
    if (!canUseAdminMode(user, administered.length)) redirect("/c");
  }

  await fetchMutation(api.users.setPreferredModePublic, {
    serverSecret: convexAppServerSecret(),
    userId: user.id as Id<"users">,
    mode,
  });
  redirect(mode === "admin" ? "/admin" : "/c");
}

/** Cerrar sesión desde el menú — misma llamada que tenía `SessionIndicator` (TAL-28). */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
