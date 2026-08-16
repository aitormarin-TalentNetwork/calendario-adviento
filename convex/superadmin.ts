import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requireServerSecret } from "./serverAuth";

export type CalendarStatus = "upcoming" | "live" | "finished";

/**
 * Vuelve a comprobar dentro de la propia mutation/query que quien actúa
 * es de verdad Super Admin — leyendo su `isSuperAdmin` en fresco de la
 * BD por `actorUserId`, nunca confiando en un booleano afirmado desde
 * fuera (hallazgo de auditoría en TAL-12/TAL-16, tareas hermanas: 2/2
 * veces que alguien resolvió el rol/identidad del actor FUERA de la
 * mutation que autoriza y actúa, dejando una ventana de carrera real —
 * no solo sobre A QUIÉN le toca el rol, sino sobre QUIÉN lo está
 * tocando). Next.js (`getAuthorizedUser`, TAL-2/TAL-11) ya releía
 * `isSuperAdmin` fresco antes de llamar aquí, pero pasar solo un
 * booleano ya afirmado ("confía en mí, soy Super Admin") deja la
 * garantía real en manos de que TODO código futuro que llame a estas
 * funciones recuerde comprobarlo antes — exactamente el mismo tipo de
 * garantía de convención, frágil, que TAL-9 ya documentó para la
 * invariante de rango sin trigger. Aquí se cierra pasando el `userId`
 * del actor (identidad, no privilegio afirmado) y resolviendo el
 * privilegio dentro de la misma transacción que el efecto — mismo
 * criterio que `resolveMemberAccessHandler` (`convex/access.ts`, TAL-11)
 * deriva el email del `userId` cargado, nunca acepta un email aparte.
 */
async function requireSuperAdmin(ctx: QueryCtx | MutationCtx, actorUserId: Id<"users">): Promise<void> {
  const actor = await ctx.db.get(actorUserId);
  if (!actor?.isSuperAdmin) throw new Error("No autorizado.");
}

/**
 * `now`/`startDate`/`endDate` son strings "YYYY-MM-DD" (día natural, sin
 * hora — ver docs/convex-modelo-de-datos.md § "Fechas como día natural"),
 * comparables directamente por orden lexicográfico. `now` lo calcula
 * Next.js antes de llamar (no hay zona horaria por invitado que aplicar
 * aquí — es un resumen de administración global, no la puerta de un
 * calendario concreto, mismo criterio de "esto no es el flujo sensible a
 * zona horaria de TAL-8" que ya se aplicaba en la versión Prisma con
 * `new Date()` del servidor).
 */
function calendarStatus(startDate: string, endDate: string, now: string): CalendarStatus {
  if (now < startDate) return "upcoming";
  if (now > endDate) return "finished";
  return "live";
}

/**
 * Todos los calendarios del sistema con sus stats — equivalente a
 * `listCalendarsWithStats` (Prisma, TAL-4). Sin `include`/join real
 * (Convex no lo tiene) — patrón N+1 explícito, mismo criterio que el
 * resto de esta serie de traducciones (ver docs/convex-diseno-tal12-crud-calendario.md
 * § `listCalendarsForUser`).
 *
 * `viewedCount` se calcula de verdad (decisión ya cerrada, ver brief de
 * TAL-15 — el placeholder `0` de la versión Prisma llevaba mostrando un
 * dato falso en producción desde que TAL-8 introdujo `DayView`, nadie
 * volvió a actualizar este código después). Tercer nivel de N+1
 * (calendario → días → vistas por día) — a la escala de "24 días como
 * mucho por calendario" (brief del producto) no debería ser prohibitivo;
 * si en algún momento se admiten calendarios mucho más grandes, valdría
 * la pena revisarlo (mismo aviso que ya se dejó para el `.collect()` de
 * `days.ts::deleteDay`/`dayViews.ts::cleanupDayViewsBatch`, TAL-13).
 */
async function listCalendarsWithStatsHandler(
  ctx: QueryCtx,
  args: { actorUserId: Id<"users">; now: string }
): Promise<
  {
    id: Id<"calendars">;
    name: string;
    startDate: string;
    endDate: string;
    status: CalendarStatus;
    admins: { id: Id<"users">; name: string | undefined; email: string }[];
    daysCount: number;
    invitedCount: number;
    viewedCount: number;
  }[]
> {
  await requireSuperAdmin(ctx, args.actorUserId);

  const calendars = await ctx.db.query("calendars").collect(); // sin índice, sin límite — ver nota de escala en docs/convex-diseno-tal15-panel-superadmin.md

  return await Promise.all(
    calendars.map(async (calendar) => {
      const memberships = await ctx.db
        .query("calendarMemberships")
        .withIndex("by_calendar_and_user", (q) => q.eq("calendarId", calendar._id))
        .collect();
      const adminMemberships = memberships.filter((m) => m.role === "ADMIN");
      const admins = (
        await Promise.all(
          adminMemberships.map(async (m) => {
            const user = await ctx.db.get(m.userId);
            return user ? { id: user._id, name: user.name, email: user.email } : null;
          })
        )
      ).filter((a): a is NonNullable<typeof a> => a !== null);

      const days = await ctx.db
        .query("days")
        .withIndex("by_calendar_and_date", (q) => q.eq("calendarId", calendar._id))
        .collect();
      const invitations = await ctx.db
        .query("invitations")
        .withIndex("by_calendar_and_email", (q) => q.eq("calendarId", calendar._id))
        .collect();

      const viewsPerDay = await Promise.all(
        days.map((day) =>
          ctx.db
            .query("dayViews")
            .withIndex("by_day_and_user", (q) => q.eq("dayId", day._id))
            .collect()
        )
      );
      const viewedCount = viewsPerDay.reduce((total, views) => total + views.length, 0);

      return {
        id: calendar._id,
        name: calendar.name,
        startDate: calendar.startDate,
        endDate: calendar.endDate,
        status: calendarStatus(calendar.startDate, calendar.endDate, args.now),
        admins,
        daysCount: days.length,
        invitedCount: invitations.length,
        viewedCount,
      };
    })
  );
}

export const listCalendarsWithStats = internalQuery({
  args: { actorUserId: v.id("users"), now: v.string() },
  handler: listCalendarsWithStatsHandler,
});

/**
 * Personas con rol ADMIN en al menos un calendario, una fila por persona
 * — equivalente a `listAdmins` (Prisma, TAL-4). Sin índice que empiece
 * por `role` en `calendarMemberships` (solo `by_calendar_and_user`,
 * `by_user`) — full scan + filtro en JS, aceptable a esta escala (mismo
 * criterio que el resto del schema, que no optimiza para volumen que
 * este proyecto no tiene todavía); un índice `by_role` sería un cambio
 * de schema aislado si hiciera falta más adelante.
 */
async function listAdminsHandler(
  ctx: QueryCtx,
  args: { actorUserId: Id<"users"> }
): Promise<{ userId: Id<"users">; name: string | undefined; email: string; createdAt: number; calendarsCount: number }[]> {
  await requireSuperAdmin(ctx, args.actorUserId);

  const adminMemberships = (await ctx.db.query("calendarMemberships").collect()).filter(
    (m) => m.role === "ADMIN"
  );

  const byUser = new Map<
    Id<"users">,
    { userId: Id<"users">; name: string | undefined; email: string; createdAt: number; calendarsCount: number }
  >();
  for (const membership of adminMemberships) {
    const existing = byUser.get(membership.userId);
    if (existing) {
      existing.calendarsCount += 1;
      continue;
    }
    const user = await ctx.db.get(membership.userId);
    if (!user) continue; // referencia rota — no debería pasar, defensivo (ver docs/convex-modelo-de-datos.md § "Integridad referencial")
    byUser.set(membership.userId, {
      userId: membership.userId,
      name: user.name,
      email: user.email,
      createdAt: user._creationTime, // _creationTime, no un campo propio — igual que el resto del schema (users no tiene createdAt)
      calendarsCount: 1,
    });
  }

  return [...byUser.values()].sort((a, b) => a.email.localeCompare(b.email));
}

export const listAdmins = internalQuery({
  args: { actorUserId: v.id("users") },
  handler: listAdminsHandler,
});

/**
 * Opciones de calendario para el selector de "+ Nuevo Admin" — equivalente
 * a `listCalendarOptions` (Prisma, TAL-4). Trivial, sin huecos.
 */
async function listCalendarOptionsHandler(
  ctx: QueryCtx,
  args: { actorUserId: Id<"users"> }
): Promise<{ id: Id<"calendars">; name: string }[]> {
  await requireSuperAdmin(ctx, args.actorUserId);

  const calendars = await ctx.db.query("calendars").collect();
  return calendars.map((c) => ({ id: c._id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
}

export const listCalendarOptions = internalQuery({
  args: { actorUserId: v.id("users") },
  handler: listCalendarOptionsHandler,
});

export type AddAdminResult = { ok: true } | { ok: false; error: "invalid-email" | "calendar-not-found" };

// Validación real de formato — el `type="email"` del HTML es solo una
// ayuda de UI, no sustituye validar en servidor (hallazgo de auditoría,
// ronda 1, TAL-4).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Da de alta a alguien como ADMIN de un calendario concreto — equivalente
 * a `addAdmin` (Prisma, TAL-4). Si la persona no tiene todavía `User`, se
 * crea (upsert por email normalizado inline, no reutiliza
 * `users.ts::createUser` — ver docs/convex-diseno-tal15-panel-superadmin.md,
 * decisión ya cerrada: aislar esta función en vez de tocar código de
 * TAL-9 ya auditado); si ya tenía membership GUEST en ese calendario, se
 * asciende a ADMIN — a propósito NO reutiliza
 * `calendarMemberships.ts::addMembership` (TAL-9), que deliberadamente
 * NUNCA promociona un rol existente (decisión correcta para su propio
 * caso de uso, pero no sirve para el ascenso que este panel necesita).
 *
 * **Todo en UNA sola mutation** (lección de las rondas de auditoría de
 * TAL-12/TAL-16 en tareas hermanas, ver brief de esta tarea: resolver
 * existencia/autorización/acción en llamadas Convex separadas abre una
 * ventana de carrera real incluso cuando cada mutation es correcta por su
 * cuenta) — comprobar que el calendario existe, dar de alta o releer el
 * `User`, y crear o ascender la `CalendarMembership`, todo dentro de esta
 * única función, nunca repartido en varias llamadas desde Next.js.
 */
async function addAdminHandler(
  ctx: MutationCtx,
  args: { actorUserId: Id<"users">; calendarId: Id<"calendars">; email: string }
): Promise<AddAdminResult> {
  await requireSuperAdmin(ctx, args.actorUserId);

  const email = args.email.trim().toLowerCase();
  if (!email || !EMAIL_PATTERN.test(email)) return { ok: false, error: "invalid-email" };

  const calendar = await ctx.db.get(args.calendarId);
  if (!calendar) return { ok: false, error: "calendar-not-found" };

  const existingUser = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .unique();
  const userId = existingUser ? existingUser._id : await ctx.db.insert("users", { email, isSuperAdmin: false });

  const existingMembership = await ctx.db
    .query("calendarMemberships")
    .withIndex("by_calendar_and_user", (q) => q.eq("calendarId", args.calendarId).eq("userId", userId))
    .unique();
  if (existingMembership) {
    if (existingMembership.role !== "ADMIN") {
      await ctx.db.patch(existingMembership._id, { role: "ADMIN" });
    }
  } else {
    await ctx.db.insert("calendarMemberships", { calendarId: args.calendarId, userId, role: "ADMIN" });
  }

  return { ok: true };
}

export const addAdmin = internalMutation({
  args: { actorUserId: v.id("users"), calendarId: v.id("calendars"), email: v.string() },
  handler: addAdminHandler,
});

/**
 * Quita a una persona del rol de Admin en TODOS los calendarios donde lo
 * tuviera — equivalente a `removeAdminEverywhere` (Prisma, TAL-4). Por
 * cada calendario donde era Admin: si todavía existe una `Invitation`
 * suya para ese calendario, se degrada a GUEST en vez de borrar la
 * membership (sigue siendo un invitado legítimo); si no, se borra la
 * membership entera.
 *
 * **Todo en UNA sola mutation**, mismo motivo que `addAdminHandler`
 * arriba — leer las membresías ADMIN de esta persona, y para cada una
 * comprobar la invitación y degradar/borrar, todo dentro de esta única
 * función. El volumen esperado (calendarios de los que una persona es
 * Admin) es bajo — no hace falta el patrón de borrado por lotes de
 * `dayViews.ts::cleanupDayViewsBatch` (TAL-13) aquí; si en algún momento
 * una persona pudiera ser Admin de un número de calendarios que se
 * acercara a los límites de una transacción, valdría la pena revisarlo
 * con el mismo criterio.
 */
async function removeAdminEverywhereHandler(
  ctx: MutationCtx,
  args: { actorUserId: Id<"users">; userId: Id<"users"> }
): Promise<void> {
  await requireSuperAdmin(ctx, args.actorUserId);

  const user = await ctx.db.get(args.userId);
  if (!user) return; // idempotente — usuario ya no existe, nada que quitar

  const adminMemberships = (
    await ctx.db.query("calendarMemberships").withIndex("by_user", (q) => q.eq("userId", args.userId)).collect()
  ).filter((m) => m.role === "ADMIN");

  for (const membership of adminMemberships) {
    const invitation = await ctx.db
      .query("invitations")
      .withIndex("by_calendar_and_email", (q) => q.eq("calendarId", membership.calendarId).eq("email", user.email))
      .unique();
    if (invitation) {
      await ctx.db.patch(membership._id, { role: "GUEST" });
    } else {
      await ctx.db.delete(membership._id);
    }
  }
}

export const removeAdminEverywhere = internalMutation({
  args: { actorUserId: v.id("users"), userId: v.id("users") },
  handler: removeAdminEverywhereHandler,
});

// --- Frontera pública (TAL-11) — ver convex/serverAuth.ts ---
// Función delgada por operación, lecturas incluidas: el panel expone
// emails/roles de todo el sistema, información tan sensible como las
// propias escrituras — mismo criterio que el resto de esta serie
// (precedente de convex/users.ts::getByIdPublic, TAL-11).

export const listCalendarsWithStatsPublic = query({
  args: { serverSecret: v.string(), actorUserId: v.id("users"), now: v.string() },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await listCalendarsWithStatsHandler(ctx, { actorUserId: args.actorUserId, now: args.now });
  },
});

export const listAdminsPublic = query({
  args: { serverSecret: v.string(), actorUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await listAdminsHandler(ctx, { actorUserId: args.actorUserId });
  },
});

export const listCalendarOptionsPublic = query({
  args: { serverSecret: v.string(), actorUserId: v.id("users") },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await listCalendarOptionsHandler(ctx, { actorUserId: args.actorUserId });
  },
});

export const addAdminPublic = mutation({
  args: { serverSecret: v.string(), actorUserId: v.id("users"), calendarId: v.id("calendars"), email: v.string() },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    return await addAdminHandler(ctx, {
      actorUserId: args.actorUserId,
      calendarId: args.calendarId,
      email: args.email,
    });
  },
});

export const removeAdminEverywherePublic = mutation({
  args: { serverSecret: v.string(), actorUserId: v.id("users"), userId: v.id("users") },
  handler: async (ctx, args) => {
    await requireServerSecret(args.serverSecret);
    await removeAdminEverywhereHandler(ctx, { actorUserId: args.actorUserId, userId: args.userId });
  },
});
