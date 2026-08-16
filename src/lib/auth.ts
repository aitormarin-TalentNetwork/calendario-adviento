import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";
import { prisma } from "@/lib/prisma";

function isBootstrapSuperAdmin(email: string) {
  const allowlist = (process.env.SUPER_ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.toLowerCase());
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  callbacks: {
    // Solo hay `user` la vez que se acaba de iniciar sesión (Google o el
    // login de desarrollo) — en el resto de peticiones next-auth decodifica
    // el JWT ya existente sin volver a pasar por aquí, así que este upsert
    // no se ejecuta en cada request. Nota: `token.userId` es solo un
    // identificador (nunca cambia); los privilegios (isSuperAdmin) NO se
    // guardan aquí — ver src/lib/current-user.ts.
    async jwt({ token, user }) {
      if (user?.email) {
        const email = user.email.toLowerCase();
        const dbUser = await prisma.user.upsert({
          where: { email },
          update: { name: user.name ?? undefined },
          create: {
            email,
            name: user.name ?? null,
            // Solo se aplica al crear el User — una vez existe, promover o
            // degradar a Super Admin es cosa del panel (TAL-4), no de esta
            // variable de entorno en cada login.
            isSuperAdmin: isBootstrapSuperAdmin(email),
          },
        });
        token.userId = dbUser.id;
      }
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
