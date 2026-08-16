import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    // TAL-10 — Prisma/Postgres se retiran de la infraestructura: este
    // callback hacía `prisma.user.upsert` para crear/actualizar el User en
    // BD al iniciar sesión (ver docs/auth.md) — todavía no tiene
    // equivalente conectado a Convex (TAL-12+). Se deja sin ese upsert en
    // vez de lanzar aquí a propósito: el flujo OAuth de Google (y el login
    // de desarrollo) completa sin un error crudo en la pantalla de
    // callback — el resultado es una sesión válida pero sin `userId`
    // resuelto, así que `getAuthorizedUser` (TAL-10, ver
    // src/lib/current-user.ts) trata a todo el mundo como no autorizado de
    // todas formas. Fallar aquí en vez de ahí sería una degradación peor
    // (pantalla de error de NextAuth en vez de un redirect limpio a
    // `/login` desde cada página protegida).
    async jwt({ token }) {
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.userId) {
        session.user.id = token.userId;
      }
      return session;
    },
  },
});
