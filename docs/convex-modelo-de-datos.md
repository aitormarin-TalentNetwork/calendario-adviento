# Modelo de datos en Convex (TAL-9)

Primera tarea del milestone "Migración a Convex" (decisión de Aitor, confirmada
por el PM en alcance/timeline — ver brief de la tarea). Esta tarea es **solo**
el schema y sus invariantes, en paralelo al Prisma+Postgres existente (que
sigue siendo lo que corre en producción). El código de aplicación
(`src/lib/*.ts`, server actions) sigue hablando con Prisma hasta TAL-10 — no
se ha tocado nada de eso aquí.

## Capa de persistencia

Convex, proyecto **`calendario-adviento`** en el team **`aitor-marin-6a254`**
(cuenta personal de Aitor — la CLI ya estaba autenticada en esta máquina,
`~/.convex/config.json`, así que no hizo falta ningún flujo de login nuevo).
Deployment de desarrollo: `aitor-marin-6a254:calendario-adviento:dev`
(`beloved-barracuda-617.convex.cloud`), creado con:

```
npx convex dev --once --configure=existing --team aitor-marin-6a254 --project calendario-adviento
```

Esto genera `.env.local` (no versionado, mismo criterio que `.env` de Prisma)
con `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL` y
`NEXT_PUBLIC_CONVEX_SITE_URL`. Para desarrollar: `npx convex dev` (deja el
proceso corriendo, sincroniza `convex/*.ts` con el deployment en cada guardado
y regenera `convex/_generated/`, que **no se trackea** — mismo criterio que
`/src/generated/prisma`, ver `.gitignore`).

Dashboard del deployment:
`https://dashboard.convex.dev/t/aitor-marin-6a254/calendario-adviento/beloved-barracuda-617`.

**Gotcha tras una instalación limpia** (`rm -rf node_modules && npm
install`): a diferencia de Prisma (`postinstall: prisma generate`, ver
`package.json`), Convex no tiene un hook de `postinstall` que regenere
`convex/_generated/` — hace falta correr `npx convex dev --once` (o `npx
convex codegen`) explícitamente después de reinstalar dependencias, o
`tsc`/`next build` fallan porque `convex/*.ts` importa de
`./_generated/server`, que no existe todavía. Mismo principio que la regla de
"instalación limpia de verdad" del proceso de auditoría — anotado aquí para
que quien retome esto en TAL-10 no se sorprenda.

## Entidades y relaciones

Mismas 7 entidades que `prisma/schema.prisma` (`docs/modelo-de-datos.md`),
mismas relaciones. Diferencias de traducción, tabla por tabla:

- **users** — `email`/`name`/`isSuperAdmin` igual. Sin `createdAt` propio: el
  campo de sistema `_creationTime` (todo documento de Convex lo tiene) cubre
  exactamente el mismo dato, así que añadir uno propio sería redundante.
- **calendars** — `name`/`coverTitle`/`coverImageUrl`/`creationKey` igual.
  `startDate`/`endDate` como `v.string()` en formato `"YYYY-MM-DD"`, no un
  timestamp — ver "Fechas como día natural" más abajo. `skinId` es
  `v.id("skins")`, el tipo nativo de Convex para una referencia a otro
  documento — más fuerte que el `String skinId + @relation` de Prisma, porque
  el propio sistema de tipos de Convex garantiza que apunta a un documento
  real de esa tabla. `updatedAt` sí es un campo propio (`v.number()`,
  epoch-ms) — a diferencia de `@updatedAt` en Prisma, Convex **no** actualiza
  ningún campo automáticamente al hacer `patch`/`replace`; cualquier mutation
  que modifique un `calendar` tiene que poner `updatedAt: Date.now()` a mano
  (ver `updateCalendarRange` en `convex/calendars.ts`).
- **calendarMemberships** — `role` como `v.union(v.literal("ADMIN"),
  v.literal("GUEST"))`: Convex no tiene un tipo enum nativo, esto es el
  equivalente idiomático. `calendarId`/`userId` como `v.id(...)`. Sin
  `createdAt` propio, mismo motivo que `users`.
- **days** — `date` como `"YYYY-MM-DD"`, mismo criterio que
  `Calendar.startDate/endDate`. `videoUrl`/`message` igual.
- **dayViews** — sin `viewedAt` propio: igual que `users.createdAt`,
  `_creationTime` ya es exactamente "cuándo se creó esta fila", y una
  `DayView` nunca se actualiza tras crearse (el `upsert` de la versión Prisma
  tampoco tocaba nada en su rama `update`, ver `src/lib/guest-calendar.ts`).
- **invitations** — `email`/`calendarId` igual.
- **skins** — `key`/`name`/`description` igual.

Ninguna entidad ni relación nueva ni omitida respecto a Prisma.

## Índices en vez de `@@unique`/`@unique`

Convex no tiene restricciones de unicidad declarativas a nivel de schema (no
existe un `@unique`/`@@unique` que la plataforma haga cumplir sola). Cada
índice que en Prisma era `@unique`/`@@unique` se traduce aquí a un **índice
normal** (`by_email`, `by_creation_key`, `by_calendar_and_user`,
`by_calendar_and_date`, `by_day_and_user`, `by_calendar_and_email`, `by_key`)
usado para una consulta de "¿ya existe?" **dentro de la mutation que escribe**,
antes de insertar. La unicidad, por tanto, no vive en el schema — vive en el
código de cada mutation (`convex/*.ts`), y depende de que todo el código que
inserte en esa tabla pase por esa comprobación. Es una garantía de convención,
no de plataforma — ver "Qué se pierde al no haber `@unique`" más abajo.

## Email insensible a mayúsculas

En Postgres se resolvió con `citext` (`docs/modelo-de-datos.md`) — un tipo de
columna que hace la comparación/unicidad insensible a mayúsculas a nivel de
BD, sin que el código de aplicación tenga que acordarse de normalizar nada.
Convex no tiene un tipo de columna equivalente (los `v.string()` son
sensibles a mayúsculas en índices/consultas). La traducción:

1. **Normalizar a minúsculas en cada mutation que escribe** `users.email` o
   `invitations.email` (`.trim().toLowerCase()`) — nunca se guarda tal cual
   llegó del cliente.
2. **El índice (`by_email`, `by_calendar_and_email`) se consulta también ya
   normalizado** — tanto para el check-then-insert de unicidad como para
   cualquier lookup (`getByEmail`).

A diferencia de `citext`, esto es una garantía de convención (toda mutation
que toque estos campos tiene que normalizar) en vez de una garantía de tipo —
mismo patrón de "se pierde la imposición automática de la plataforma, se gana
en su lugar una regla de código explícita" que el resto de este documento.
Verificado contra el deployment real: `createUser("Foo.Bar@Example.COM")`
seguido de `createUser("foo.bar@example.com")` resuelven al mismo `_id`, y
`getByEmail("FOO.BAR@EXAMPLE.COM")` encuentra ese usuario (ver
"Evidencia").

## Fechas como día natural

`Day.date`/`Calendar.startDate`/`endDate` necesitan ser "un día natural, sin
hora ni zona horaria" — el mismo cuidado que llevó a `@db.Date` en Postgres
(TAL-3 ronda 1: con `DateTime` completo, `2026-12-01T00:00` y
`2026-12-01T12:00` pasaban la unicidad como si fueran días distintos) y que
más tarde TAL-8 tuvo que reforzar en la capa de aplicación (`todayInTimeZone`,
zona horaria del cliente en vez de un instante UTC crudo).

Convex no tiene un tipo `DATE` nativo como Postgres — solo `v.number()`
(epoch-ms, un instante) o `v.string()`. Se decide **`v.string()` en formato
`"YYYY-MM-DD"`**, no un timestamp numérico, y es una decisión deliberada, no
solo "lo más simple":

- Un timestamp numérico reintroduce exactamente la ambigüedad que causó los
  bugs de TAL-3/TAL-8 — sigue siendo un instante, hay que decidir "medianoche
  en qué zona horaria" para construirlo y para compararlo, y ese cuidado hay
  que repetirlo correctamente en cada sitio que lo toque.
- Un string `"YYYY-MM-DD"` no es un instante en absoluto — es un identificador
  de día natural, con orden lexicográfico == orden cronológico (`"2026-12-01"
  < "2026-12-10"` compara igual que las fechas que representan), así que
  `date < calendar.startDate` (ver `days.ts`) funciona sin conversión ninguna.
  No hay zona horaria que decidir al guardar: la resuelve quien construye el
  string (TAL-10, capa de aplicación — mismo `todayInTimeZone` ya existente
  puede producir directamente este formato en vez de un `Date` de medianoche
  UTC).

Esto es, de hecho, una representación **más correcta** que la de Postgres para
este caso de uso, no un compromiso — Postgres `DATE` sigue siendo, por debajo,
un valor con una zona horaria de sesión implícita en algunas operaciones; un
string de calendario no tiene ninguna.

## Invariante de rango Calendar/Day

La invariante "todo `Day` está dentro del rango de su `Calendar`" se hizo
cumplir en Postgres con dos capas (TAL-6, `docs/dias.md`):

1. La transacción de aplicación que guarda un `Day` comprueba el rango en ese
   momento (`SELECT ... FOR UPDATE` sobre el `Calendar`).
2. Un trigger `BEFORE UPDATE ON "Calendar"` que rechaza CUALQUIER cambio de
   `startDate`/`endDate` que dejaría algún `Day` existente fuera del rango
   nuevo — sin importar qué código de aplicación dispare ese `UPDATE` (código
   actual o futuro).

Convex no tiene triggers de base de datos. La traducción:

1. `upsertDay` (`convex/days.ts`) reproduce la capa 1: lee el `Calendar`,
   comprueba que `date` está dentro de `[startDate, endDate]`, y solo entonces
   escribe — dentro de la misma mutation, que Convex ejecuta de forma
   transaccional (ver "Concurrencia" más abajo, no hace falta un `FOR UPDATE`
   explícito).
2. `updateCalendarRange` (`convex/calendars.ts`) reproduce la capa 2:
   antes de aplicar un cambio de `startDate`/`endDate`, consulta todos los
   `Day` de ese calendario y rechaza el cambio si alguno quedaría fuera del
   rango nuevo.

**Lo que se pierde al no haber trigger** — hay que decirlo explícito, es la
parte que el brief pedía no dejar implícita: el trigger de Postgres protegía
la invariante sin importar qué código tocara `Calendar`, incluida cualquier
consulta SQL escrita a mano o cualquier mutation futura que alguien añadiera
sin saber que esta invariante existe. En Convex, la única forma de escribir
datos es a través de una mutation definida en `convex/*.ts` (no hay una
"consola SQL" con acceso de escritura sin pasar por código) — eso ya es una
garantía más fuerte que en un RDBMS clásico, pero **sigue dependiendo de que
cualquier mutation futura que cambie `calendars.startDate`/`endDate` llame a
`updateCalendarRange` (o repita su comprobación)** en vez de hacer
`ctx.db.patch` directamente. Es una garantía de convención — se puede saltar
por error humano, a diferencia del trigger, que ninguna transacción de
Postgres podía evitar. Decisión para TAL-10: cuando se escriba la mutation
real de "editar calendario" (equivalente a `updateCalendarAction`, TAL-5), su
código de cambio de rango tiene que ser literalmente una llamada a
`updateCalendarRange` (o vivir dentro de ella), nunca un `ctx.db.patch` propio
que la esquive — dejarlo anotado aquí para que quien haga TAL-10 no lo
reintroduzca sin darse cuenta.

## Concurrencia

El brief pedía explícitamente no asumir cómo se comporta Convex bajo
escrituras concurrentes, sino verificarlo. Resultado, verificado contra el
deployment real (ver "Evidencia"):

**Las mutations de Convex son transaccionales y serializables por defecto**,
con reintento automático del lado del servidor ante un conflicto de
lectura/escritura detectado entre dos mutations concurrentes (OCC —
optimistic concurrency control: Convex ejecuta la mutation especulativamente
y, si al confirmar detecta que otra mutation concurrente ya escribió algo que
esta leyó, la reintenta desde el principio). Esto es la razón de que **ningún
código Convex de este schema necesite el patrón `try { upsert } catch
(P2002) { ... }`** que sí hizo falta en varios sitios de la versión Prisma:

- `markDayViewed` (TAL-8, ronda 1): el `upsert` de Prisma no era atómico a
  nivel de BD para el conector `@prisma/adapter-pg` — dos llamadas
  simultáneas podían intentar ambas el `create` interno y una recibía P2002
  sin capturar. El equivalente Convex (`dayViews.ts::markViewed`) es un
  check-then-insert liso, sin ningún manejo de error especial, y se comporta
  correctamente bajo concurrencia real (ver evidencia).
- `createCalendarForAdmin`/idempotencia por `creationKey` (TAL-5): en Prisma
  hacía falta el mismo patrón de captura de P2002. En Convex,
  `calendars.ts::createCalendar` tampoco lo necesita.
- Aceptación de invitación vs. expulsión concurrente (TAL-7): en Prisma hizo
  falta aislamiento `SERIALIZABLE` explícito + reintento manual
  (`withSerializableRetry`, `src/lib/db-retry.ts`) porque el aislamiento por
  defecto de Postgres (READ COMMITTED) no bastaba. En Convex, SERIALIZABLE
  (o su equivalente vía OCC) **es el único modo que existe** — no hay un
  nivel de aislamiento más débil que elegir por accidente.

Esto no es un detalle menor: una parte no trivial de la complejidad y de las
rondas de auditoría del MVP en Prisma (TAL-7 rondas 1-2, TAL-8 ronda 1) fue
precisamente lidiar con los huecos de atomicidad de `upsert` y con el nivel de
aislamiento por defecto de Postgres. Ese problema, tal como está planteado
aquí, no debería reaparecer en TAL-10+ para estos mismos flujos — aunque cada
mutation nueva que se escriba debe seguir siendo cuidadosa con qué lee y qué
escribe dentro de sí misma (el conflicto se detecta sobre rangos de lectura
reales, no es magia que cubra cualquier bug de lógica).

## Evidencia

Todas las pruebas corrieron contra el deployment real de desarrollo
(`beloved-barracuda-617.convex.cloud`), vía `ConvexHttpClient` (uno **nuevo
por llamada** en las pruebas de concurrencia — simula pestañas/clientes
independientes de verdad, evitando la cola de mutations interna que un mismo
`ConvexHttpClient` aplica por defecto, que habría serializado las llamadas
del lado del cliente y falseado la prueba):

1. **Email insensible a mayúsculas**: `createUser("Foo.Bar@Example.COM")`
   seguido de `createUser("foo.bar@example.com")` devuelven el mismo `_id`;
   `getByEmail("FOO.BAR@EXAMPLE.COM")` encuentra ese usuario.
2. **Idempotencia de `creationKey` bajo concurrencia real**: 5
   `createCalendar` disparados a la vez (`Promise.all`, 5 clientes
   independientes) con la misma `creationKey` → 1 solo `_id` único entre las
   5 respuestas.
3. **Invariante de rango, mitad "guardar día"**: `upsertDay` con una fecha
   anterior a `startDate` → rechazado. Con una fecha dentro de rango →
   aceptado.
4. **Invariante de rango, mitad "cambiar rango del calendario"**: con un
   `Day` ya guardado dentro del rango, `updateCalendarRange` a un rango que
   lo dejaría fuera → rechazado con mensaje explícito. A un rango que lo
   mantiene dentro → aceptado, `Calendar` actualizado.
5. **DayView, idempotencia bajo concurrencia real** (el caso exacto de P2002
   en TAL-8 ronda 1): 5 `markViewed` disparados a la vez para el mismo
   `(dayId, userId)` → 1 solo `_id` único entre las 5 respuestas.
6. **Control negativo** (verificación honesta, mismo criterio que
   `docs/invitados.md`): una mutation deliberadamente rota
   (`insert` directo, sin comprobar si ya existe) sometida a 10 llamadas
   concurrentes reales para el mismo `(dayId, userId)` → **10 filas
   duplicadas** (10 `_id` distintos). Confirma que el arnés de prueba
   detecta el fallo real cuando la protección no está — no que "da OK pase lo
   que pase". Ese fichero de control negativo era temporal, no forma parte
   del schema final (se borró y se redesplegó tras la prueba).
7. **CalendarMembership**, único por `(calendarId, userId)` bajo
   concurrencia: 5 `addMembership` concurrentes → 1 solo `_id`.
8. **Invitation**, único por `(calendarId, email normalizado)` bajo
   concurrencia, con mayúsculas mezcladas entre llamadas → 1 solo `_id`.
9. `npx convex dev --once` (build/typecheck real del schema + todas las
   mutations/queries contra el deployment): limpio, sin errores — Convex
   valida el schema y regenera `convex/_generated/` en cada push.

Scripts de prueba no comprometidos al repo (mismo criterio que TAL-2/TAL-5/
TAL-7 — el proyecto no tiene test runner elegido todavía); los resultados
numéricos quedan documentados aquí.

## Qué no toca esta tarea

- El código de aplicación (`src/lib/*.ts`, server actions, páginas) sigue
  hablando con Prisma+Postgres — es lo que corre en producción hasta que el
  milestone completo esté listo. `convex/*.ts` no está conectado a la app
  Next.js todavía (sin `ConvexProvider`, sin `useQuery`/`useMutation` en
  ningún componente).
- Migración de los datos ya existentes en Postgres a Convex — no hay datos de
  producción todavía (`docs/despliegue.md`: la BD de producción real nunca se
  llegó a provisionar durante el MVP), así que no hace falta un script de
  migración de datos para esta tarea.
- Quitar Prisma del proyecto (`prisma/`, dependencias, `.env` de Postgres) —
  eso es TAL-10, junto con conectar la app de verdad a Convex.
