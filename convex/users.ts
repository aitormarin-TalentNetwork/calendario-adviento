import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireServerSecret } from "./serverAuth";

/**
 * TAL-28 — mismo criterio que `assertSafeCoverImageUrl` (`convex/calendars.ts`,
 * TAL-5/TAL-12): solo `https:`. `image` llega del perfil OAuth de Google en
 * el flujo normal (nunca texto libre tecleado por nadie), pero esta función
 * pública sigue siendo alcanzable con el secreto compartido sin pasar por
 * el flujo OAuth real — invariante de escritura real, no solo de UI, mismo
 * motivo que el resto de URLs externas de este proyecto.
 */
function assertSafeUserImageUrl(url: string | undefined): void {
  if (url === undefined) return;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("La foto de perfil debe ser una URL válida.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("La foto de perfil debe ser una URL https:// — no se aceptan otros esquemas por seguridad.");
  }
}

/**
 * Alta/actualización idempotente por email normalizado — el equivalente
 * Convex al `citext` + `@unique` de Prisma (ver
 * docs/convex-modelo-de-datos.md § "Email insensible a mayúsculas"). No
 * hace falta un try/catch de "choque de índice único" como en Prisma
 * (TAL-8, P2002 bajo concurrencia): una mutation de Convex se ejecuta con
 * aislamiento serializable y reintento automático si detecta que otra
 * mutation concurrente tocó el mismo rango de índice — el
 * check-then-insert de abajo es seguro tal cual (verificado con
 * concurrencia real, ver docs/convex-modelo-de-datos.md § "Concurrencia").
 *
 * TAL-11 — equivalente al `prisma.user.upsert` que hacía el callback
 * `jwt()` de NextAuth (ver `docs/auth.md`, versión Prisma): en cada login
 * (Google o dev-login) se llama con el nombre que acabe de dar el
 * proveedor. Si el usuario ya existe, se actualiza `name` (igual que
 * `update: { name }` en la versión Prisma) pero NUNCA `isSuperAdmin` —
 * promover/degradar Super Admin es cosa del panel (TAL-4/TAL-15), no de
 * volver a iniciar sesión. `isSuperAdminOnCreate` solo se aplica al CREAR
 * el usuario por primera vez (bootstrap por `SUPER_ADMIN_EMAILS`, decidido
 * en Next.js — ver `src/lib/auth.ts` — porque esa variable de entorno vive
 * en Railway, no en este deployment de Convex).
 *
 * La lógica vive en `createUserHandler`, una función plana normal, y
 * tanto `createUser` (internal, para futuros llamadores desde otras
 * funciones de Convex) como `upsertUserOnLoginPublic` (frontera pública,
 * TAL-11) la invocan directamente — en vez de que la pública delegue en la
 * interna vía `ctx.runMutation(internal.users.createUser, ...)`, lo que
 * crearía una referencia circular de tipos dentro del propio fichero
 * (`internal` se deriva de TODO lo exportado por este módulo, incluida la
 * propia función pública que se está tipando).
 */
async function createUserHandler(
  ctx: MutationCtx,
  args: { email: string; name?: string; image?: string; isSuperAdminOnCreate?: boolean }
): Promise<Id<"users">> {
  assertSafeUserImageUrl(args.image);
  const email = args.email.trim().toLowerCase();
  const existing = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  if (existing) {
    const patch: Partial<Pick<Doc<"users">, "name" | "image">> = {};
    if (args.name !== undefined && args.name !== existing.name) patch.name = args.name;
    // TAL-28 — mismo criterio que `name`: se refresca en cada login si
    // Google manda un valor distinto (el usuario cambió su avatar), nunca
    // se borra por su cuenta si esta llamada concreta no trae `image`
    // (dev-login, por ejemplo — no debe borrar la foto real de un login
    // anterior con Google).
    if (args.image !== undefined && args.image !== existing.image) patch.image = args.image;
    if (Object.keys(patch).length > 0) await ctx.db.patch(existing._id, patch);
    return existing._id;
  }
  return await ctx.db.insert("users", {
    email,
    name: args.name,
    image: args.image,
    isSuperAdmin: args.isSuperAdminOnCreate ?? false,
  });
}

export const createUser = internalMutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    isSuperAdminOnCreate: v.optional(v.boolean()),
  },
  handler: createUserHandler,
});

export const getByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
  },
});

/**
 * TAL-11 — usada por `getAuthorizedUser()` (src/lib/current-user.ts) para
 * releer `isSuperAdmin` en fresco en cada request, nunca del JWT (hallazgo
 * de auditoría, TAL-2 ronda 1). Búsqueda por id, no por email (hallazgo
 * TAL-2 ronda 2 — ver el comentario completo en current-user.ts). Mismo
 * motivo que `createUserHandler` para extraer la lógica a una función
 * plana, ver el comentario de arriba.
 */
async function getByIdHandler(ctx: QueryCtx, args: { userId: Id<"users"> }): Promise<Doc<"users"> | null> {
  return await ctx.db.get(args.userId);
}

export const getById = internalQuery({
  args: { userId: v.id("users") },
  handler: getByIdHandler,
});

// --- Frontera pública (TAL-11) — ver convex/serverAuth.ts ---
// Función delgada por operación: comprueba el secreto y delega en la
// función interna real (aquí, directamente en su función plana — ver el
// porqué en los comentarios de `createUserHandler`/`getByIdHandler`).

export const getByIdPublic = query({
  args: { serverSecret: v.string(), userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await getByIdHandler(ctx, { userId: args.userId });
  },
});

export const upsertUserOnLoginPublic = mutation({
  args: {
    serverSecret: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    image: v.optional(v.string()),
    isSuperAdminOnCreate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await createUserHandler(ctx, {
      email: args.email,
      name: args.name,
      image: args.image,
      isSuperAdminOnCreate: args.isSuperAdminOnCreate,
    });
  },
});
