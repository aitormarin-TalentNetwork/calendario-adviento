import { noteNavigation } from "@/lib/navigation-entry";

/**
 * TAL-85 — hook de cliente de Next (`instrumentation-client.ts`): cada
 * navegación del router (push / replace / atrás-adelante) suma una al
 * contador de `src/lib/navigation-entry.ts`, con el que la bienvenida de
 * `/c/<id>` distingue "entrar desde fuera" de un `router.refresh()`.
 */
export function onRouterTransitionStart(): void {
  noteNavigation();
}
