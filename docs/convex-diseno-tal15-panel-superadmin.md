# Diseño / pseudocódigo — Panel Super Admin sobre Convex (para TAL-15)

Fichero propio, no toca nada del worktree de T1. Pseudocódigo y firmas,
no implementación final — mismo criterio que
`docs/convex-diseno-tal12-crud-calendario.md` (TAL-12), con el que TAL-15
va en paralelo (dominios disjuntos: TAL-12 toca `calendars.ts`, TAL-15
toca `superadmin.ts` — comparten schema pero no funciones). Traduce
`src/lib/superadmin.ts` + las server actions de
`src/app/superadmin/page.tsx` (versión Prisma, TAL-4), leyendo el estado
real de TAL-9 tal como está commiteado ahora (`68afbee`) y aplicando ya
la recomendación cerrada de TAL-11
(`docs/convex-auth-investigacion-tal11.md` § "Recomendación cerrada" —
secreto compartido, no JWT/JWKS) a las funciones que este panel necesita.

## Aplicando el patrón de frontera pública (secreto compartido) aquí

Las cinco funciones de este panel (tres de lectura, dos de escritura) las
llama Next.js directamente desde `page.tsx`/server actions — igual que
TAL-12, chocan con que TAL-9 las construiría como `internalMutation`/
`internalQuery` (inalcanzables desde `fetchQuery`/`fetchMutation`). Con
la recomendación ya cerrada de TAL-11, la solución es la misma para las
dos tareas — vale la pena que el helper de verificación del secreto viva
en un módulo compartido, no duplicado en `calendars.ts` y `superadmin.ts`
cada uno por su cuenta:

```ts
// convex/serverAuth.ts — NUEVO, compartido entre TAL-12 y TAL-15
export function requireServerSecret(received: string): void {
  const expected = process.env.CONVEX_APP_SERVER_SECRET;
  if (!expected) throw new Error("CONVEX_APP_SERVER_SECRET no configurado en este deployment.");
  // Comparación en tiempo constante, no `===` — evita timing attacks
  // triviales sobre un secreto de longitud fija (mismo criterio que
  // comparar tokens/secretos en cualquier otro sitio de esta app, aunque
  // aquí el canal ya va sobre TLS del propio SDK de Convex).
  if (!timingSafeEqual(received, expected)) throw new Error("No autorizado.");
}
```

**Una función pública "delgada" por operación**, que solo comprueba el
secreto y delega en la función interna real — así la lógica de negocio
(la que ya existe o se traduce abajo) se queda `internal`, comprobada y
reutilizable desde otras funciones de Convex sin pasar por el secreto
otra vez (p. ej. si algún día una `action` interna necesita listar
Admins para otra cosa):

```ts
// convex/superadmin.ts — patrón repetido para cada función expuesta a Next.js
export const listCalendarsWithStatsPublic = query({
  args: { serverSecret: v.string(), now: v.number() },
  handler: async (ctx, args) => {
    requireServerSecret(args.serverSecret);
    return await ctx.runQuery(internal.superadmin.listCalendarsWithStats, { now: args.now });
  },
});
```

**Las lecturas también llevan el secreto, no solo las escrituras** — el
panel expone emails y quién es Admin de qué, información tan sensible
como las propias escrituras; el precedente de TAL-9 ya trató `getByEmail`
(`users.ts`) como interna por el mismo motivo, no hay razón para tratar
las lecturas de este panel de forma más laxa.

## Qué se traduce

Fuente Prisma: `src/lib/superadmin.ts` (`listCalendarsWithStats`,
`listAdmins`, `listCalendarOptions`, `addAdmin`, `removeAdminEverywhere`)
+ las server actions de `src/app/superadmin/page.tsx`. Nada de esto
existe todavía en `convex/*.ts` — a diferencia de TAL-12, TAL-9 no dejó
ningún punto de partida parcial aquí, así que todo el pseudocódigo de
abajo es nuevo.

### `listCalendarsWithStats(now)` — sin `include`, mismo patrón N+1 que TAL-12

```ts
// convex/superadmin.ts
export const listCalendarsWithStats = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const calendars = await ctx.db.query("calendars").collect(); // sin índice — ver nota de escala abajo

    return await Promise.all(calendars.map(async (calendar) => {
      const memberships = await ctx.db.query("calendarMemberships")
        .withIndex("by_calendar_and_user", q => q.eq("calendarId", calendar._id))
        .collect();
      const adminMemberships = memberships.filter(m => m.role === "ADMIN");
      const admins = await Promise.all(
        adminMemberships.map(async (m) => {
          const user = await ctx.db.get(m.userId);
          return user ? { id: user._id, name: user.name ?? null, email: user.email } : null;
        })
      );

      const days = await ctx.db.query("days")
        .withIndex("by_calendar_and_date", q => q.eq("calendarId", calendar._id)).collect();
      const invitations = await ctx.db.query("invitations")
        .withIndex("by_calendar_and_email", q => q.eq("calendarId", calendar._id)).collect();

      return {
        id: calendar._id, name: calendar.name,
        startDate: calendar.startDate, endDate: calendar.endDate, // strings YYYY-MM-DD, no Date — ver nota abajo
        status: calendarStatus(calendar.startDate, calendar.endDate, args.now),
        admins: admins.filter((a) => a !== null),
        daysCount: days.length,
        invitedCount: invitations.length,
        viewedCount: 0, // ver "Pregunta abierta: viewedCount" más abajo — NO copiar sin más
      };
    }));
  },
});
```

**`calendarStatus` cambia de forma al traducirse**: la versión Prisma
compara objetos `Date` (`now < startDate`). Aquí `startDate`/`endDate`
son strings `"YYYY-MM-DD"` (ver `docs/convex-modelo-de-datos.md` §
"Fechas como día natural") — hay que comparar `now` también como string
`"YYYY-MM-DD"` (construido en Next.js antes de llamar, con el mismo
cuidado de zona horaria que ya usa `todayInTimeZone`, TAL-8) en vez de
como epoch-ms, para no reintroducir la ambigüedad de zona horaria que
todo el resto del schema ya evitó a propósito.

**Nota de escala, no bloqueante**: `ctx.db.query("calendars").collect()`
sin índice ni límite trae TODOS los calendarios del sistema en cada carga
del panel — aceptable al volumen actual del proyecto (sin datos de
producción todavía, ver TAL-9 § "Qué no toca esta tarea"), pero si el
número de calendarios crece mucho, valdría la pena paginar. Anotado, no
bloqueante para TAL-15 tal como está el producto hoy.

### Pregunta abierta: `viewedCount` — el comentario de Prisma está desactualizado

El comentario de `src/lib/superadmin.ts` dice literalmente: *"Siempre 0
por ahora: todavía no existe ningún mecanismo que marque un día como
visto (eso es de TAL-8... en Backlog)"* — pero TAL-8 (Experiencia del
Invitado) **ya está publicada** (ver `docs/dias.md`/historial de tareas);
la tabla `dayViews` existe de verdad, tanto en Prisma como en el schema
de Convex de TAL-9. Es decir: la versión Prisma actual del panel Super
Admin **ya está mostrando un dato falso** (0 vistos, siempre, aunque haya
vistas reales) porque nadie volvió a este código después de TAL-8 para
actualizarlo — no es una decisión, es una desincronización entre partes
del proyecto que avanzaron en paralelo. Para TAL-15, dos caminos, ninguno
decidido aquí:

- (a) Trasladar el mismo placeholder (`viewedCount: 0`) sin más — más
  simple, pero perpetúa un dato incorrecto que ya lo era antes de migrar.
- (b) Calcularlo de verdad: por cada calendario, por cada `Day` de ese
  calendario, contar `dayViews` (`by_day_and_user`, prefijo por `dayId`)
  — un tercer nivel de N+1 (calendario → días → vistas por día) además de
  los dos que ya tiene esta función. A la escala de "24 días por
  calendario como mucho" (brief del producto) no debería ser
  prohibitivo, pero es más lectura por carga de panel de la que hay hoy.

Mi lectura: (b) es lo correcto (arreglar el dato falso ya que se está
tocando este código de todas formas), pero lo dejo como pregunta abierta
explícita — no algo que TAL-15 deba asumir sin que quien lo implemente lo
vea y decida con el coste real delante.

### `listAdmins()` — agrupado en JS, igual que la versión Prisma; sin índice por `role` solo

```ts
export const listAdmins = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Sin índice que empiece por "role" en el schema actual de
    // calendarMemberships (solo by_calendar_and_user, by_user) — full
    // scan + filtro en JS, igual de aceptable a esta escala que el resto
    // del schema (ninguna otra función de TAL-9 optimiza para volumen que
    // este proyecto no tiene todavía). Si hiciera falta más adelante,
    // añadir un índice `by_role` es un cambio de schema aislado, no
    // arquitectónico.
    const adminMemberships = (await ctx.db.query("calendarMemberships").collect())
      .filter((m) => m.role === "ADMIN");

    const byUser = new Map();
    for (const m of adminMemberships) {
      const existing = byUser.get(m.userId);
      if (existing) { existing.calendarsCount += 1; continue; }
      const user = await ctx.db.get(m.userId);
      if (!user) continue; // referencia rota — no debería pasar, defensivo
      byUser.set(m.userId, {
        userId: m.userId, name: user.name ?? null, email: user.email,
        createdAt: user._creationTime, // _creationTime, no un campo propio — igual que el resto del schema
        calendarsCount: 1,
      });
    }
    return [...byUser.values()].sort((a, b) => a.email.localeCompare(b.email));
  },
});
```

### `listCalendarOptions()` — trivial, sin cambios de forma

```ts
export const listCalendarOptions = internalQuery({
  args: {},
  handler: async (ctx) => {
    const calendars = await ctx.db.query("calendars").collect();
    return calendars.map((c) => ({ id: c._id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
  },
});
```

### `addAdmin(calendarId, email)` — choca con una decisión ya tomada por TAL-9: `addMembership` NO promociona rol existente

La versión Prisma necesita que, si la persona ya era GUEST de ese
calendario, `addAdmin` la **ascienda** a ADMIN (`upsert` con
`update: { role: "ADMIN" }`). El `addMembership` que ya existe en
`convex/calendarMemberships.ts` (TAL-9) hace explícitamente lo
contrario: *"si ya existe la membership se devuelve tal cual sin tocar
`role`"* — decisión correcta para su propio caso de uso (TAL-9 no tenía
ningún flujo de "ascender" todavía, solo alta), pero **no sirve tal cual
para `addAdmin`** sin perder el comportamiento de ascenso que el brief de
TAL-4 pide explícitamente. Dos formas de resolverlo, sin decidir aquí
cuál:

- (a) `addAdmin` no reutiliza `addMembership` — escribe su propio
  check-then-upsert con `ctx.db.patch` si la membership ya existe con
  otro rol.
- (b) `addMembership` (TAL-9) gana un argumento opcional
  `promoteIfExists: v.optional(v.boolean())` que, si es `true`, hace
  `patch` en vez de devolver tal cual — reutilizable por los dos casos de
  uso (alta simple de TAL-9, ascenso de TAL-15) sin duplicar la lógica de
  índice/inserción. Preferible si no hay motivo para que las dos
  funciones diverjan en su forma de comprobar existencia — pero cambia
  una función que ya pasó la ronda 1 de auditoría de TAL-9, así que
  conviene que quien lo decida sepa que está tocando código ya cerrado,
  no solo añadiendo algo nuevo.

Pseudocódigo asumiendo (a) (más aislado, no toca TAL-9):

```ts
export const addAdmin = internalMutation({
  args: { calendarId: v.id("calendars"), email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) return { ok: false, error: "invalid-email" };

    const calendar = await ctx.db.get(args.calendarId);
    if (!calendar) return { ok: false, error: "calendar-not-found" };

    // Igual que createUser (users.ts, TAL-9): alta idempotente por email
    // normalizado. Podría llamarse a internal.users.createUser vía
    // ctx.runMutation en vez de reimplementar el upsert — a decidir junto
    // con la pregunta de addMembership de arriba (misma disyuntiva:
    // reutilizar función ya auditada de TAL-9 vs. código propio aislado).
    let user = await ctx.db.query("users").withIndex("by_email", q => q.eq("email", email)).unique();
    const userId = user ? user._id : await ctx.db.insert("users", { email, isSuperAdmin: false });

    const existingMembership = await ctx.db.query("calendarMemberships")
      .withIndex("by_calendar_and_user", q => q.eq("calendarId", args.calendarId).eq("userId", userId))
      .unique();
    if (existingMembership) {
      if (existingMembership.role !== "ADMIN") await ctx.db.patch(existingMembership._id, { role: "ADMIN" });
    } else {
      await ctx.db.insert("calendarMemberships", { calendarId: args.calendarId, userId, role: "ADMIN" });
    }
    return { ok: true };
  },
});
```

### `removeAdminEverywhere(userId)` — degradar a GUEST si hay Invitation viva, borrar si no

```ts
export const removeAdminEverywhere = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const user = await ctx.db.get(args.userId);
    if (!user) return; // idempotente, igual que el resto del panel — usuario ya no existe, nada que quitar

    const adminMemberships = (await ctx.db.query("calendarMemberships")
      .withIndex("by_user", q => q.eq("userId", args.userId)).collect())
      .filter((m) => m.role === "ADMIN");

    for (const membership of adminMemberships) {
      const invitation = await ctx.db.query("invitations")
        .withIndex("by_calendar_and_email", q => q.eq("calendarId", membership.calendarId).eq("email", user.email))
        .unique();
      if (invitation) {
        await ctx.db.patch(membership._id, { role: "GUEST" });
      } else {
        await ctx.db.delete(membership._id);
      }
    }
  },
});
```

Nota de concurrencia, no probada por mí: esta mutation lee y escribe
sobre varios `calendarMemberships` de golpe — si en algún momento se
prueba una carrera real contra ella (p. ej. alguien aceptando una
invitación mientras se le quita el Admin en otro calendario a la vez),
conviene aplicar el mismo criterio que TAL-7/TAL-9 ya establecieron:
probar la carrera de verdad, no solo razonar que "debería estar bien
porque Convex es serializable" — la propia segunda opinión de TAL-9 lo
demostró necesario para la invariante de rango.

## Resumen para quien implemente TAL-15

1. Aplicar el secreto compartido (Opción 4 de TAL-11) — helper
   `convex/serverAuth.ts` compartido con TAL-12, no reinventado aquí.
2. Decidir la disyuntiva de `addAdmin`/`addMembership`: función propia
   aislada vs. extender la de TAL-9 con un flag de promoción — afecta si
   se toca código ya auditado o no.
3. Resolver la pregunta de `viewedCount` — el placeholder de la versión
   Prisma ya está desactualizado (TAL-8 existe), decidir si TAL-15 lo
   arregla de una vez o lo traslada tal cual con el mismo defecto.
4. `calendarStatus` compara fechas como string `"YYYY-MM-DD"`, no `Date`
   — `now` tiene que llegar desde Next.js ya en ese formato, con el mismo
   cuidado de zona horaria que TAL-8 (`todayInTimeZone`).
5. Sin índice por `role` en `calendarMemberships` — full scan + filtro en
   JS, aceptable a esta escala; añadir `by_role` si en algún momento hace
   falta.

Nada de este documento es una decisión tomada — mismo criterio que el
resto de esta serie de investigaciones: huecos y preguntas abiertas
señalados explícitamente, no rellenados a ciegas.
