// Schema de Convex — equivalente a prisma/schema.prisma (TAL-3 y
// siguientes). Ver docs/convex-modelo-de-datos.md para el porqué de cada
// decisión de traducción (tipos, índices, dónde vive cada invariante que
// antes garantizaba Postgres). En paralelo al Prisma existente (TAL-9,
// milestone de migración) — todavía no lo usa el código de aplicación.
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    // Siempre en minúsculas al escribir (mutations) — Convex no tiene un
    // tipo citext ni collation configurable como Postgres, así que la
    // unicidad insensible a mayúsculas se hace cumplir normalizando antes
    // de cada escritura + consultando por el índice antes de insertar. Ver
    // docs/convex-modelo-de-datos.md § "Email insensible a mayúsculas".
    email: v.string(),
    name: v.optional(v.string()),
    isSuperAdmin: v.boolean(),
    // Sin `createdAt` propio — el campo de sistema `_creationTime` (todo
    // documento de Convex lo tiene) cubre exactamente el mismo dato.
  }).index("by_email", ["email"]),

  calendars: defineTable({
    name: v.string(),
    coverTitle: v.string(),
    coverImageUrl: v.optional(v.string()),
    // "YYYY-MM-DD", no un timestamp — ver docs/convex-modelo-de-datos.md §
    // "Fechas como día natural". Comparan correctamente como string
    // (orden lexicográfico == orden cronológico en ISO 8601).
    startDate: v.string(),
    endDate: v.string(),
    // A diferencia de `@updatedAt` en Prisma, Convex no actualiza ningún
    // campo automáticamente al hacer `patch`/`replace` — quien escriba
    // aquí en el futuro (TAL-10+) tiene que poner `updatedAt: Date.now()`
    // a mano en cada mutation que toque este documento.
    updatedAt: v.number(),
    // Idempotencia de "+ Nuevo calendario" (mismo motivo que en Prisma,
    // TAL-5 ronda 1) — único por índice, comprobado antes de insertar.
    creationKey: v.optional(v.string()),
    skinId: v.id("skins"),
  })
    .index("by_creation_key", ["creationKey"]),

  calendarMemberships: defineTable({
    // Sin enum nativo en Convex — unión discriminada de literales, el
    // equivalente idiomático a `enum CalendarRole` de Prisma.
    role: v.union(v.literal("ADMIN"), v.literal("GUEST")),
    calendarId: v.id("calendars"),
    userId: v.id("users"),
  })
    .index("by_calendar_and_user", ["calendarId", "userId"])
    .index("by_user", ["userId"]),

  days: defineTable({
    // "YYYY-MM-DD" — mismo criterio que Calendar.startDate/endDate.
    date: v.string(),
    videoUrl: v.string(),
    message: v.optional(v.string()),
    calendarId: v.id("calendars"),
  })
    .index("by_calendar_and_date", ["calendarId", "date"]),

  dayViews: defineTable({
    dayId: v.id("days"),
    userId: v.id("users"),
    // Sin `viewedAt` propio — igual que `users.createdAt`, `_creationTime`
    // ya es exactamente "cuándo se creó esta fila", y una DayView nunca se
    // actualiza tras crearse (ver guest-calendar.ts en la versión Prisma:
    // el upsert no toca nada en `update`).
  })
    .index("by_day_and_user", ["dayId", "userId"])
    .index("by_user", ["userId"]),

  invitations: defineTable({
    // Normalizado a minúsculas al escribir, mismo motivo que users.email.
    email: v.string(),
    calendarId: v.id("calendars"),
  })
    .index("by_calendar_and_email", ["calendarId", "email"]),

  skins: defineTable({
    key: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
  }).index("by_key", ["key"]),
});
