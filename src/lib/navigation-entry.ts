/**
 * TAL-85 — "entrada desde fuera" en `/c/<id>` sin `welcomeViews`
 * (docs/bienvenida.md). Dos señales, y hacen falta las dos para reabrir la
 * bienvenida:
 *
 * 1. `navSeq`: cuántas navegaciones del router de Next han empezado en este
 *    documento. Lo incrementa `onRouterTransitionStart`
 *    (`src/instrumentation-client.ts`), que Next 16 llama en cada push /
 *    replace (`<Link>`, `useRouter().push`) y en cada atrás/adelante, pero NO
 *    en `router.refresh()` ni en las server actions.
 * 2. `renderId`: identificador nuevo en cada render del servidor de la
 *    página (`c/[calendarId]/page.tsx`).
 *
 * Una navegación que acaba en el mismo `/c/<id>` (p. ej. `/c` → redirect al
 * mismo calendario) cambia las dos; un `router.refresh()` solo cambia el
 * `renderId`; una navegación hacia fuera solo el `navSeq` (y la página se
 * desmonta sin volver a pintarse).
 *
 * Sin imports de React ni de servidor: se prueba directamente
 * (`e2e/tal85-foto-portada-unit.spec.ts`).
 */

let navSeq = 0;
const listeners = new Set<() => void>();

export function noteNavigation(): void {
  navSeq += 1;
  for (const listener of listeners) listener();
}

/** Contrato de `useSyncExternalStore`: `subscribe`, `getSnapshot` y `getServerSnapshot`. */
export function subscribeNavigation(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getNavigationSeq(): number {
  return navSeq;
}

/** En el servidor no hay navegaciones de cliente. */
export function getServerNavigationSeq(): number {
  return 0;
}

export type WelcomeEntryMark = { navSeq: number; renderId: string };

/**
 * Se llama cuando cambia el `renderId` (nuevo render del servidor):
 * reabrir solo si además ha empezado alguna navegación desde la última marca.
 */
export function shouldReopenWelcome(last: WelcomeEntryMark, current: WelcomeEntryMark): boolean {
  return current.renderId !== last.renderId && current.navSeq > last.navSeq;
}
