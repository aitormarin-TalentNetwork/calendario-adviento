import type { DefaultSession } from "next-auth";

// Ampliamos la sesión y el JWT de Auth.js con el id de nuestro propio User
// (no el `sub` de Google). Deliberadamente NO llevan `isSuperAdmin` ni ningún
// otro privilegio: eso se lee siempre en fresco de la base de datos vía
// src/lib/current-user.ts, nunca del JWT — ver ahí el porqué (hallazgo de
// auditoría, ronda 1: un privilegio cacheado en el JWT no se revoca hasta
// que caduca la sesión).
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    userId?: string;
  }
}
