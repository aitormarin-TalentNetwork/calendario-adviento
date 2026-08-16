"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";

// Un solo cliente por proceso del navegador (mismo motivo que el
// PrismaClient global que este proyecto tenía antes, TAL-3): crear uno
// nuevo en cada render abriría una conexión WebSocket nueva de más.
// `NEXT_PUBLIC_CONVEX_URL` la genera `npx convex dev`/`npx convex deploy`
// en `.env.local` (dev) o en las variables de entorno del servicio de
// Railway (producción) — ver docs/stack.md.
const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
