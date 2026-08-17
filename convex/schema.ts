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
    // Foto de perfil de Gmail (TAL-28) — llega en el perfil OAuth de Google
    // (`user.image`, ver `src/lib/auth.ts`), nunca del login de desarrollo
    // (`Credentials`, sin ese campo). `v.optional()` por dos motivos: los
    // usuarios creados antes de esta tarea no lo tienen, y el propio
    // login de desarrollo seguirá sin mandarlo nunca. Se refresca en CADA
    // login si Google manda un valor distinto — mismo criterio que `name`
    // (ver `createUserHandler`), para no quedarse con una foto vieja si el
    // usuario cambia su avatar de Google más adelante.
    image: v.optional(v.string()),
    // Sin `createdAt` propio — el campo de sistema `_creationTime` (todo
    // documento de Convex lo tiene) cubre exactamente el mismo dato.
  }).index("by_email", ["email"]),

  calendars: defineTable({
    name: v.string(),
    coverTitle: v.string(),
    // Icono de portada (TAL-23) — antes incrustado a mano dentro del texto
    // de `coverTitle` (p. ej. "...🎄"). Campo propio, `v.string()` libre
    // (no una unión de literales del catálogo): el catálogo de iconos vive
    // como constante en el frontend (`src/lib/cover-icons.ts`), sin límite
    // fijo en la lógica (brief de TAL-23) — igual que `skins` no vive como
    // enum acoplado al schema. `v.optional()` porque los calendarios
    // creados ANTES de esta tarea no tienen este campo — ver
    // `DEFAULT_COVER_ICON` (`src/lib/cover-icons.ts`) para el valor de
    // respaldo, aplicado en cada sitio que lee este campo.
    //
    // Hallazgo de auditoría, ronda 1: el respaldo de lectura por sí solo
    // no bastaba para los calendarios cuyo `coverTitle` ya llevaba el 🎄
    // incrustado (único mecanismo que existía antes de esta tarea) —
    // duplicaba el emoji al mostrarlo. Corregido con un backfill real y
    // acotado (`convex/calendars.ts::backfillEmbeddedCoverIcon`, corregido
    // de nuevo en ronda 2 para no tocar títulos editados a mano que solo
    // COINCIDEN por casualidad con el patrón viejo — ver el comentario
    // completo ahí), no un script genérico: solo migra el literal exacto
    // que generaba el mecanismo viejo, nunca escribe sobre filas ya
    // migradas (idempotente).
    coverIcon: v.optional(v.string()),
    coverImageUrl: v.optional(v.string()),
    // Marcador de cuenta atrás (TAL-27) — la frase/palabra Y de "Faltan X
    // días para Y" en la vista del Invitado, texto libre configurable por
    // el Admin. `v.optional()` con respaldo de lectura, mismo criterio que
    // `coverIcon`/`coverImageUrl` arriba: los calendarios creados ANTES de
    // esta tarea no tienen este campo, y no hay ningún texto duplicado que
    // limpiar (a diferencia de `coverIcon`) — no hace falta backfill, solo
    // `countdownLabel ?? DEFAULT_COUNTDOWN_LABEL` en cada sitio que lo lee
    // (`src/lib/countdown.ts`).
    countdownLabel: v.optional(v.string()),
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
    .index("by_calendar_and_email", ["calendarId", "email"])
    // TAL-16 — `removeGuestEverywhere` borra TODAS las invitaciones de un
    // email, en cualquier calendario; sin este índice haría falta un
    // `collect()` de la tabla entera + filtro en JS. A diferencia de scans
    // similares de esta serie (p. ej. `listAdmins`, TAL-15), esta operación
    // se dispara desde una acción de usuario frecuente ("borrar por
    // completo" en el panel de invitados), no una operación rara de
    // administración global — ver docs/convex-diseno-tal16-gestion-invitados.md.
    .index("by_email", ["email"]),

  skins: defineTable({
    key: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    // TAL-22 — el Design System exige, como mínimo, un color/degradado de
    // fondo + un color de acento por skin (design/design-system.md §
    // "Skins"). `background` es el valor CSS completo de la propiedad
    // `background` (color sólido, `linear-gradient(...)`,
    // `conic-gradient(...)`, `repeating-linear-gradient(...)` — lo que
    // necesite cada skin; no se modela por stops separados, no hace
    // falta para lo que consume TAL-24). `accent` es un único color hex.
    //
    // `v.optional`, corrección de auditoría ronda 1 — NO son requeridos
    // todavía, aunque tras esta tarea las 22 filas del catálogo siempre
    // los tienen. Motivo: Convex valida TODOS los documentos existentes
    // de una tabla contra el schema nuevo ANTES de aceptar un `push` — si
    // el deployment real (compartido, o algún día producción) ya tiene
    // filas de `skins` de antes de esta tarea sin `background`/`accent`,
    // desplegar aquí con campos requeridos habría rechazado el push
    // ENTERO antes de que `seedSkinCatalog` pudiera ejecutarse nunca, y
    // esas filas se habrían quedado sin poder arreglarse por este camino.
    // Secuencia segura de dos pasos (Convex, y cualquier migración de
    // "columna NOT NULL" en general): (1) campo opcional + desplegar, (2)
    // correr el backfill (`seedSkinCatalog`) y verificar que TODAS las
    // filas ya tienen valor, (3) solo ENTONCES un segundo `push` de
    // schema que los pase a requeridos. Este commit es el paso (1)+(2)
    // para el deployment de desarrollo de esta terminal (verificado
    // contra un estado simulado con filas "viejas" sin color — ver
    // `docs/skins.md` § "Migración segura" y
    // `scripts/verify-tal22-skin-schema-migration.mjs`); el paso (3)
    // queda como seguimiento explícito, NO ejecutado aquí, para quien
    // aplique este cambio al deployment compartido/producción — solo
    // después de confirmar ahí que las filas existentes ya están
    // pobladas (con este mismo `seedSkinCatalog`).
    background: v.optional(v.string()),
    accent: v.optional(v.string()),
  }).index("by_key", ["key"]),
});
