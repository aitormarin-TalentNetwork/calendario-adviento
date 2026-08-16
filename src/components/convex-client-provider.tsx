"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";

// Un solo cliente por proceso del navegador (mismo motivo que el
// PrismaClient global que este proyecto tenía antes, TAL-3): crear uno
// nuevo en cada render abriría una conexión WebSocket nueva de más.
// `NEXT_PUBLIC_CONVEX_URL` la genera `npx convex dev`/`npx convex deploy`
// en `.env.local` (dev) o en las variables de entorno del servicio de
// Railway (producción) — ver docs/stack.md.
//
// Sin esa variable (hallazgo de auditoría, ronda 1): `new
// ConvexReactClient(undefined!)` compila gracias al `!`, pero Convex
// lanza en tiempo de ejecución en cuanto se instancia — con el `!` a
// secas eso rompía el layout raíz para TODA la app (login incluido)
// mientras Railway no tuviera todavía la variable configurada (el propio
// despliegue de esta tarea, pendiente de que el CEO ejecute los pasos de
// infraestructura). Nada en `src/` usa `useQuery`/`useMutation` todavía
// (TAL-12+), así que no montar el `ConvexProvider` cuando falta la URL no
// pierde ninguna funcionalidad real hoy — en cuanto la variable exista, se
// activa solo, sin ningún otro cambio.
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

export function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  if (!convex) return <>{children}</>;
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
