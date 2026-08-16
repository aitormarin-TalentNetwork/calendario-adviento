import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

// Login de desarrollo simulado: solo disponible si se activa explícitamente
// (AUTH_DEV_LOGIN=true) y nunca en producción, aunque alguien active la
// variable por error — es la vía de evidencia cuando no hay credenciales
// reales de Google OAuth en el entorno (ver docs/auth.md).
export const devLoginEnabled =
  process.env.AUTH_DEV_LOGIN === "true" && process.env.NODE_ENV !== "production";

// Config "ligera": sin nada que dependa de Prisma/pg, para que la pueda usar
// el middleware (Edge runtime) sin arrastrar el driver de Postgres. La config
// completa (con los callbacks que sí tocan la base de datos) vive en
// src/lib/auth.ts.
export const authConfig = {
  trustHost: true,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
    ...(devLoginEnabled
      ? [
          Credentials({
            id: "dev-login",
            name: "Login de desarrollo (simulado)",
            credentials: {
              email: { label: "Email", type: "email" },
              name: { label: "Nombre", type: "text" },
            },
            authorize: async (credentials) => {
              const email = credentials?.email?.toString().trim().toLowerCase();
              if (!email) return null;
              return {
                id: email,
                email,
                name: credentials?.name?.toString().trim() || email,
              };
            },
          }),
        ]
      : []),
  ],
} satisfies NextAuthConfig;
