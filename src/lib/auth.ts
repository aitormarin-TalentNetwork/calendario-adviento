import NextAuth from "next-auth";
import { fetchMutation } from "convex/nextjs";
import { api } from "../../convex/_generated/api";
import { authConfig } from "@/lib/auth.config";
import { convexAppServerSecret } from "@/lib/convex-server";

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
    //
    // TAL-11 — restaura el upsert (retirado en TAL-10 junto con Prisma),
    // ahora contra Convex vía la función pública delgada
    // `users.upsertUserOnLoginPublic` (mismo secreto compartido que el
    // resto de la frontera, `docs/convex-auth-investigacion-tal11.md`).
    // Si falla (Convex no configurado, red caída, secreto no coincide): NO
    // se lanza aquí a propósito — el flujo OAuth de Google (y el login de
    // desarrollo) completa sin un error crudo en la pantalla de callback,
    // el resultado es una sesión válida pero sin `userId` resuelto, así
    // que `getAuthorizedUser` (que también falla cerrado ante cualquier
    // error de Convex) trata a esa persona como no autorizada de todas
    // formas. Fallar aquí en vez de ahí sería una degradación peor
    // (pantalla de error de NextAuth en vez de un redirect limpio a
    // `/login` desde cada página protegida) — mismo criterio que ya
    // adoptó TAL-10.
    async jwt({ token, user }) {
      if (user?.email) {
        const email = user.email.toLowerCase();
        try {
          const userId = await fetchMutation(api.users.upsertUserOnLoginPublic, {
            serverSecret: convexAppServerSecret(),
            email,
            name: user.name ?? undefined,
            // TAL-28 — foto de perfil de Gmail: `user.image` la rellena el
            // proveedor de Google (perfil OAuth estándar); el login de
            // desarrollo (`Credentials`) nunca la manda, así que llega
            // `undefined` ahí — `createUserHandler` ya trata "no llegó
            // nada esta vez" como "no tocar lo que ya hubiera guardado",
            // igual que con `name`.
            image: user.image ?? undefined,
            // Solo se aplica al crear el usuario — una vez existe,
            // promover o degradar a Super Admin es cosa del panel
            // (TAL-4/TAL-15), no de esta variable de entorno en cada
            // login (ver convex/users.ts::createUser).
            isSuperAdminOnCreate: isBootstrapSuperAdmin(email),
          });
          token.userId = userId;
        } catch {
          // Ver comentario de arriba — sesión válida pero sin userId,
          // getAuthorizedUser la trata como no autorizada.
        }
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
