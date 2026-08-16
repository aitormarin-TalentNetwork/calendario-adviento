# Diseño / pseudocódigo — CRUD de Calendario sobre Convex (para TAL-12)

Fichero propio, no toca nada del worktree de T1. **Pseudocódigo y firmas,
no implementación final** — a petición de la Directora, para no arriesgar
retrabajo si TAL-9 sigue cambiando (todavía en corrección de auditoría).
Traduce `src/lib/calendars.ts` + `src/app/admin/actions.ts` (versión
Prisma, TAL-5) a la forma que tendría en `convex/calendars.ts`, leyendo el
estado real de TAL-9 tal como está commiteado ahora mismo (commit
`68afbee`, "corrige NO-GO ronda 1") — no una versión antigua.

## Bloqueante crítico — resolver antes de implementar, no una vez empezado

**`convex/calendars.ts` (TAL-9) usa `internalMutation`/`internalQuery`,
no `mutation`/`query`.** Es la corrección correcta al hallazgo de
auditoría de TAL-9 ronda 1 ("cualquiera con la URL del deployment podía
crear calendarios") — pero tiene una consecuencia que todavía no está
resuelta en ningún sitio: **una función interna de Convex NO es
alcanzable desde `fetchMutation`/`fetchQuery` (`convex/nextjs`) ni desde
`ConvexHttpClient`** — exactamente el mecanismo que mi propia
investigación de TAL-11 (`docs/convex-auth-investigacion-tal11.md`)
proponía para que Next.js llame a Convex. T1 ya lo probó empíricamente:
intentar invocar una función interna desde ese tipo de cliente devuelve
`Could not find public function for '<módulo>:<función>'` — rechazado
por el propio servidor, no por un filtro de cliente que se pueda saltar.
Solo son alcanzables desde dentro de otra función de Convex
(`ctx.runMutation(internal.foo.bar, args)`) o desde la CLI ya autenticada
como administrador (`npx convex run`, un canal de operación/pruebas, no
pensado para servir peticiones de usuarios reales).

Es decir: **tal como está construido TAL-9 hoy, ninguna Server Action de
Next.js puede llamar a `createCalendar`/`updateCalendarRange` en
absoluto** — mi propia recomendación de TAL-11 ("Next.js llama a Convex
vía `fetchMutation`, una sola mutation por operación, sin `ctx.auth`")
asumía que las funciones eran alcanzables así, y no lo comprobé contra el
hecho de que TAL-9 las volvería internas por el hallazgo de seguridad de
su propia ronda 1 — las dos decisiones, tomadas cada una correctamente
por su cuenta, chocan entre sí. Esto no es un detalle menor de TAL-12: es
una decisión de arquitectura que probablemente le corresponde a TAL-11
(auth), no a TAL-12, pero **bloquea que TAL-12 pueda implementarse de
verdad** hasta que se resuelva. Dejo el pseudocódigo de abajo escrito
contra funciones internas (mismo criterio que TAL-9 ya adoptó, no lo
contradigo sin más contexto) y señalo aquí las alternativas que veo, sin
decidir por quien lleve TAL-11/TAL-12:

1. **Una capa fina de `action` públicas** (una por operación de escritura
   expuesta a Next.js: `createCalendarPublic`, `updateCalendarPublic`,
   `deleteCalendarPublic`) que no hacen más que `ctx.runMutation(internal.
   calendars.createCalendar, args)` — el problema de "¿quién puede
   llamar a esto?" no desaparece, solo se traslada a esta capa: si no
   comprueban nada, se reabre el hueco que TAL-9 acaba de cerrar; si
   comprueban `ctx.auth`, hace falta resolver primero el puente
   JWT/JWKS de TAL-11 (Patrón B, con el aviso textual de la propia Convex
   de que no garantiza su seguridad — ver mi doc de TAL-11).
2. **Mismo problema, pero con la validación del lado de Next.js en vez de
   dentro de Convex**: no lo resuelve nada por sí solo, porque
   `fetchMutation`/`fetchQuery` en sí mismos no pueden alcanzar funciones
   internas — hiciera Next.js la comprobación que hiciera antes de
   llamar, seguiría sin poder invocarlas.
3. **Revisar si de verdad hace falta que sean `internal` en vez de
   `mutation`/`query` públicas que, en su lugar, no dependan de `ctx.auth`
   sino que confíen en su llamador** (mismo patrón que ya usa
   `src/lib/guests.ts` en la versión Prisma: la autorización vive
   exclusivamente en la Server Action de Next.js, no en la función de
   datos) — pero esto es literalmente el estado que TAL-9 ronda 1 declaró
   inaceptable ("cualquiera con la URL podía..."), así que reabrirlo sin
   una pieza adicional (p. ej. un secreto compartido en la cabecera de la
   petición, verificado dentro de la mutation) sería repetir el mismo
   hallazgo.

No decido cuál — es una decisión de TAL-11 con más contexto de auth del
que tengo aquí. La dejo como el primer punto que quien implemente TAL-12
tiene que revisar, antes que cualquier otra cosa de este documento.

## Qué se traduce y de dónde sale cada pieza

Fuente Prisma: `src/lib/calendars.ts` (`parseUtcDateOnly`,
`defaultCalendarDateRange`, `formatCalendarDate`, `listAdminCalendars`,
`defaultSkin`, `createCalendarForAdmin`) + `src/app/admin/actions.ts`
(`createCalendarAction`, `updateCalendarAction`, `deleteCalendarAction`).
Ya existe en `convex/calendars.ts` (TAL-9): `createCalendar` (sin
membership todavía — ver más abajo), `updateCalendarRange` (solo fechas),
`get`. Ya existe en `convex/dates.ts`: `assertValidCalendarDate`.

### `createCalendar` — ya existe, le falta la parte de membership

La versión Prisma (`createCalendarForAdmin`) crea el `Calendar` Y la
`CalendarMembership` ADMIN del creador **en la misma transacción** — así
es como alguien se convierte en Admin de su primer calendario (brief de
TAL-5). El `createCalendar` de TAL-9 **no toma `userId` como argumento y
no crea ninguna membership** — solo crea el `Calendar`. Para TAL-12 hace
falta extenderlo (o añadir una capa que envuelva las dos escrituras en la
misma mutation — nunca dos mutations separadas desde Next.js, porque eso
reabriría exactamente el tipo de ventana de carrera que TAL-7 tardó 2
rondas en cerrar: un calendario sin ningún Admin todavía, aunque sea
brevísimamente):

```ts
// convex/calendars.ts — createCalendar, extendido
export const createCalendar = internalMutation({
  args: {
    userId: v.id("users"),          // NUEVO — quién lo crea, se vuelve su ADMIN
    name: v.string(),
    coverTitle: v.string(),
    coverImageUrl: v.optional(v.string()),
    startDate: v.string(),
    endDate: v.string(),
    skinId: v.optional(v.id("skins")), // ver "Pregunta abierta: skin por defecto"
    creationKey: v.string(),
  },
  handler: async (ctx, args) => {
    // Idempotencia: si ya existe un Calendar con esta creationKey, se
    // devuelve tal cual — pero ¿y si la membership de ESE calendario para
    // ESTE userId no existe todavía (reintento de una llamada que creó el
    // calendario pero falló antes de la membership, en una versión previa
    // sin esto atómico)? Con todo en una sola mutation transaccional esto
    // no debería poder pasar nunca — anotado para que quien implemente lo
    // tenga en cuenta si en algún momento se separa en dos pasos por error.
    const existing = await ctx.db
      .query("calendars")
      .withIndex("by_creation_key", (q) => q.eq("creationKey", args.creationKey))
      .unique();
    if (existing) return existing._id;

    const skinId = args.skinId ?? (await resolveDefaultSkinId(ctx));
    const skin = await ctx.db.get(skinId);
    if (!skin) throw new Error("El skin indicado no existe.");

    assertValidCalendarDate(args.startDate);
    assertValidCalendarDate(args.endDate);
    assertRangeNotInverted(args.startDate, args.endDate);

    const calendarId = await ctx.db.insert("calendars", {
      name: args.name, coverTitle: args.coverTitle, coverImageUrl: args.coverImageUrl,
      startDate: args.startDate, endDate: args.endDate, skinId, creationKey: args.creationKey,
      updatedAt: Date.now(),
    });
    await ctx.db.insert("calendarMemberships", { calendarId, userId: args.userId, role: "ADMIN" });
    return calendarId;
  },
});
```

**Pregunta abierta: ¿dónde vive "pine" es el skin por defecto?** La
versión Prisma lo resuelve dentro de `defaultSkin()` (parte de la propia
capa de datos, el llamador no necesita saberlo). El `createCalendar` de
TAL-9 exige `skinId` como argumento obligatorio — asume que quien llama
ya lo resolvió. Para que la Server Action de creación siga siendo tan
simple como hoy (un único botón "+ Nuevo calendario", sin selector de
skin en ese paso), lo natural es mantener la resolución de default
DENTRO de Convex (`resolveDefaultSkinId`, arriba, pseudocódigo — busca
por índice `by_key` la clave `"pine"`, si no existe cae a la primera fila
de `skins`), no en Next.js — mismo criterio que el resto del dominio de
fechas/validación ya vive en `convex/dates.ts` y no en la Server Action.
No es una decisión cerrada, solo la que encaja mejor con dónde TAL-9 ya
puso el resto de estas reglas.

### `updateCalendar` — no existe todavía; `updateCalendarRange` (TAL-9) solo cubre la mitad

`updateCalendarAction` (Prisma) actualiza `name`, `coverTitle`,
`startDate`, `endDate`, `skinId`, `coverImageUrl` **de una vez**, en un
único envío del formulario de edición. `updateCalendarRange` (TAL-9) solo
toca `startDate`/`endDate` — no existe ninguna mutation Convex para el
resto de campos todavía. Dos formas de resolverlo:

- (a) Dos mutations separadas desde Next.js (una para detalles, otra para
  rango) — más cerca de lo que ya existe, pero dos escrituras separadas
  para lo que la UI presenta como un solo "Guardar cambios": si la
  primera tiene éxito y la segunda falla (o el proceso de servidor muere
  entre medias), el calendario queda en un estado a medio guardar que el
  usuario nunca pidió — no rompe ninguna invariante de las que ya se
  protegen, pero sí es una superficie de inconsistencia nueva que hoy
  (Prisma, todo en un solo `update`) no existe.
- (b) **Recomendado**: una sola mutation `updateCalendar` que reciba
  todos los campos (igual que hace `updateCalendarAction` hoy) y por
  dentro reutilice la lógica de validación de rango que ya escribió TAL-9
  — factorizándola en una función interna compartida en vez de
  duplicarla:

```ts
// convex/calendars.ts — nuevo, reutiliza la lógica ya escrita
async function assertNoDayOutsideRange(ctx, calendarId, startDate, endDate) {
  // Exactamente el cuerpo que ya tiene updateCalendarRange (TAL-9) para
  // las dos consultas acotadas por índice — factorizar en vez de copiar,
  // para no arriesgar que las dos copias diverjan con el tiempo.
  const beforeNewRange = await ctx.db.query("days")
    .withIndex("by_calendar_and_date", q => q.eq("calendarId", calendarId).lt("date", startDate)).first();
  const afterNewRange = await ctx.db.query("days")
    .withIndex("by_calendar_and_date", q => q.eq("calendarId", calendarId).gt("date", endDate)).first();
  if (beforeNewRange || afterNewRange) {
    throw new Error("No se puede cambiar el rango: hay al menos un día con vídeo asignado que quedaría fuera del rango nuevo.");
  }
}

export const updateCalendar = internalMutation({
  args: {
    calendarId: v.id("calendars"), name: v.string(), coverTitle: v.string(),
    coverImageUrl: v.optional(v.string()), startDate: v.string(), endDate: v.string(),
    skinId: v.id("skins"),
  },
  handler: async (ctx, args) => {
    const calendar = await ctx.db.get(args.calendarId);
    if (!calendar) throw new Error("El calendario ya no existe.");

    const skin = await ctx.db.get(args.skinId);           // integridad referencial, igual que createCalendar
    if (!skin) throw new Error("El skin indicado no existe.");

    assertValidCalendarDate(args.startDate);
    assertValidCalendarDate(args.endDate);
    assertRangeNotInverted(args.startDate, args.endDate);
    await assertNoDayOutsideRange(ctx, args.calendarId, args.startDate, args.endDate);

    // coverImageUrl: la validación de esquema (solo https:) es de UI/entrada
    // (hallazgo TAL-5 ronda 1) — igual que hoy en Prisma, decidir si vive en
    // la Server Action de Next.js (antes de llamar) o aquí dentro también,
    // como segunda barrera — no cambia con la migración, mismo argumento de
    // "nunca confiar en que el cliente mandó algo válido" de src/lib
    // aplicaría igual a "nunca confiar en que Next.js mandó algo válido" si
    // en algún momento otra función de Convex también pudiera llamar a esta.

    await ctx.db.patch(args.calendarId, {
      name: args.name, coverTitle: args.coverTitle, coverImageUrl: args.coverImageUrl,
      startDate: args.startDate, endDate: args.endDate, skinId: args.skinId,
      updatedAt: Date.now(),
    });
  },
});
```

  Con esto, `updateCalendarRange` (TAL-9) queda como un caso particular
  (cambiar solo fechas) que ya no hace falta que la app llame
  directamente — decidir en TAL-12 si se retira o se deja como función
  interna de soporte para otros flujos futuros (p. ej. un posible ajuste
  de rango automático que no pase por el formulario de edición completo).

### `deleteCalendar` — no existe todavía; sin cascade automático (hallazgo ya anotado por TAL-9)

`deleteCalendarAction` (Prisma) confía en `onDelete: Cascade` del schema
— un `prisma.calendar.delete()` se lleva por delante `Day`, `Invitation`,
`CalendarMembership` (y, transitivamente, `DayView` de esos `Day`, por su
propio cascade) sin que el código de aplicación tenga que acordarse.
Convex no tiene equivalente declarativo — TAL-9 ya lo dejó anotado
explícitamente como pendiente para "quien escriba la primera mutation de
borrar calendario". Pseudocódigo, borrado explícito de todo en una sola
mutation transaccional (para que un borrado a medias no pueda quedar a
mitad camino):

```ts
export const deleteCalendar = internalMutation({
  args: { calendarId: v.id("calendars") },
  handler: async (ctx, args) => {
    const calendar = await ctx.db.get(args.calendarId);
    if (!calendar) return; // idempotente — mismo criterio que el P2025 de Prisma: reenvío de un borrado ya hecho no es un error

    const days = await ctx.db.query("days")
      .withIndex("by_calendar_and_date", q => q.eq("calendarId", args.calendarId)).collect();
    for (const day of days) {
      const views = await ctx.db.query("dayViews")
        .withIndex("by_day_and_user", q => q.eq("dayId", day._id)).collect(); // ver nota de índice abajo
      for (const view of views) await ctx.db.delete(view._id);
      await ctx.db.delete(day._id);
    }

    const memberships = await ctx.db.query("calendarMemberships")
      .withIndex("by_calendar_and_user", q => q.eq("calendarId", args.calendarId)).collect();
    for (const m of memberships) await ctx.db.delete(m._id);

    const invitations = await ctx.db.query("invitations")
      .withIndex("by_calendar_and_email", q => q.eq("calendarId", args.calendarId)).collect();
    for (const inv of invitations) await ctx.db.delete(inv._id);

    await ctx.db.delete(args.calendarId);
  },
});
```

**Nota de índice, no bloqueante pero real**: `by_day_and_user` en
`dayViews` (`convex/schema.ts`) está indexado por `(dayId, userId)`, así
que consultar "todos los `dayView` de este `dayId`" (sin fijar `userId`)
sí funciona como prefijo del índice — pero conviene que quien implemente
lo confirme contra el deployment real antes de darlo por bueno (no lo he
probado yo, es lectura del schema).

**Coste de rendimiento a tener en cuenta**: para un calendario con muchos
días/vistas, este borrado hace bastantes escrituras dentro de una sola
mutation. Convex tiene límites documentados de tamaño de transacción
(número de escrituras/tiempo de ejecución) — a la escala de "24 días como
mucho por calendario" (brief del producto: es un calendario de adviento)
esto no debería ser un problema real, pero si en algún momento se admiten
calendarios con muchos más días o con muchos invitados/vistas, valdría la
pena revisarlo. Anotado, no bloqueante para TAL-12 tal como está acotado
el producto hoy.

### `listCalendarsForUser` (equivalente a `listAdminCalendars`) — sin `include`, resuelto en dos pasos

Prisma usa un `include`/filtro relacional en una sola consulta. Convex no
tiene joins — se resuelve consultando primero las membresías del usuario,
luego cada calendario por separado (patrón N+1 explícito, no un `include`
implícito — es el patrón idiomático de Convex, no un rodeo):

```ts
export const listCalendarsForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const memberships = await ctx.db.query("calendarMemberships")
      .withIndex("by_user", q => q.eq("userId", args.userId))
      .filter(q => q.eq(q.field("role"), "ADMIN"))
      .collect();

    const calendars = await Promise.all(
      memberships.map(async (m) => {
        const calendar = await ctx.db.get(m.calendarId);
        if (!calendar) return null; // referencia rota (calendario borrado sin limpiar esta membership) — no debería pasar si deleteCalendar (arriba) se implementa bien, pero defensivo
        const skin = await ctx.db.get(calendar.skinId);
        return { ...calendar, skin };
      })
    );

    // orderBy: createdAt "desc" en Prisma → _creationTime aquí (ver
    // docs/convex-modelo-de-datos.md, calendars no tiene createdAt propio),
    // ordenado en código de aplicación, no por índice — no hay un índice
    // de Convex por _creationTime out of the box para esto.
    return calendars.filter((c) => c !== null).sort((a, b) => b._creationTime - a._creationTime);
  },
});
```

### `parseUtcDateOnly`/`defaultCalendarDateRange`/`formatCalendarDate` — no se traducen 1:1

- `parseUtcDateOnly` → ya cubierto por `assertValidCalendarDate`
  (`convex/dates.ts`, TAL-9) del lado de Convex. Del lado de Next.js
  seguirá haciendo falta algo parecido para validar el formulario ANTES
  de llamar a Convex (igual que hoy valida antes de llamar a Prisma) —
  mismo motivo de siempre: nunca confiar en que el cliente mandó un
  formato válido, sea cual sea la capa de datos detrás.
- `defaultCalendarDateRange` — lógica de presentación (qué proponer en el
  formulario de "+ Nuevo calendario" antes de que el Admin lo cambie), no
  de dominio — se queda en Next.js/TypeScript normal, no necesita vivir
  en Convex.
- `formatCalendarDate` — puramente de presentación, se queda en Next.js
  tal cual, no depende de qué capa de datos haya detrás.

## Resumen para quien implemente TAL-12

Antes de escribir código de verdad:

1. **Resolver el bloqueante crítico** (arriba): cómo llama Next.js a
   funciones `internal*` de Convex — probablemente decisión de TAL-11,
   no de TAL-12, pero TAL-12 no puede terminar sin que esté resuelta.
2. Confirmar si `createCalendar` se extiende con `userId`+membership
   atómica (recomendado, para no reabrir la ventana de carrera que costó
   2 rondas en TAL-7) o si se maneja de otra forma.
3. Decidir `updateCalendar` como mutation única (recomendado) vs. dos
   mutations separadas — y si `updateCalendarRange` (TAL-9) se retira o
   se queda como función interna de soporte.
4. Escribir `deleteCalendar` con el borrado en cascada manual completo
   (días, dayViews, memberships, invitations) — TAL-9 ya avisó de este
   hueco, aquí queda el primer intento de pseudocódigo concreto.
5. Decidir dónde vive la resolución del skin por defecto ("pine") —
   dentro de Convex (recomendado, sugerido arriba) o resuelta por Next.js
   antes de llamar.
6. Verificar contra el deployment real, antes de dar nada por bueno, lo
   que aquí es solo lectura de código + razonamiento: el índice
   `by_day_and_user` como prefijo por `dayId` solo, y el coste de
   transacción del borrado en cascada si el producto llega a admitir
   calendarios más grandes de lo que el brief actual contempla.

Nada de este documento es una decisión tomada — es la traducción más
directa que veo desde el código Prisma actual y desde lo que TAL-9 ya
construyó, con los huecos y preguntas abiertas señalados explícitamente
en vez de rellenados a ciegas.
