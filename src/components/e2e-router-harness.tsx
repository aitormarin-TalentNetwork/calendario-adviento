"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

declare global {
  interface Window {
    __e2eRouter?: { push: (href: string) => void; refresh: () => void };
  }
}

/**
 * TAL-85 — SOLO para los E2E (lo monta `src/app/layout.tsx` cuando
 * `shouldMountRouterHarness()`): expone `useRouter().push`/`refresh` (API
 * pública de Next, el mismo camino que `<Link>`) como
 * `window.__e2eRouter`, para probar la navegación de cliente
 * `/c/<id>` → `/c` → redirect al mismo `/c/<id>`, que hoy ningún enlace de
 * la UI produce con un solo calendario. No pinta nada.
 */
export function E2ERouterHarness() {
  const router = useRouter();
  useEffect(() => {
    window.__e2eRouter = { push: (href) => router.push(href), refresh: () => router.refresh() };
    return () => {
      delete window.__e2eRouter;
    };
  }, [router]);
  return null;
}
