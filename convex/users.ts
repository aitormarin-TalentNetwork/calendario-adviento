import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Alta idempotente por email normalizado — el equivalente Convex al
 * `citext` + `@unique` de Prisma (ver docs/convex-modelo-de-datos.md §
 * "Email insensible a mayúsculas"). No hace falta un try/catch de "choque
 * de índice único" como en Prisma (TAL-8, P2002 bajo concurrencia): una
 * mutation de Convex se ejecuta con aislamiento serializable y reintento
 * automático si detecta que otra mutation concurrente tocó el mismo rango
 * de índice — el check-then-insert de abajo es seguro tal cual (verificado
 * con concurrencia real, ver docs/convex-modelo-de-datos.md §
 * "Concurrencia").
 */
export const createUser = mutation({
  args: { email: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("users", { email, name: args.name, isSuperAdmin: false });
  },
});

export const getByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    return await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
  },
});
