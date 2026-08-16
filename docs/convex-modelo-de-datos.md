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
  documento — valida que el string tiene el formato correcto Y que
  pertenece a la tabla `skins` (no vale un id real de otra tabla), pero NO
  que el documento sigue existiendo — ver "Integridad referencial" más
  abajo, es una garantía más débil de lo que este párrafo daba a entender
  en la ronda 1 (hallazgo de auditoría). `updatedAt` sí es un campo propio
  (`v.number()`,
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

## Integridad referencial

`v.id("skins")`, `v.id("calendars")`, etc. en los `args` de una mutation
validan dos cosas: que el string tiene el formato de id de Convex, y que
pertenece a la tabla indicada (probado: pasar el id real de un `User` donde
se espera un `v.id("skins")` se rechaza con
`ArgumentValidationError: ... which does not match the table name in
validator`). **Lo que NO validan es que el documento referenciado siga
existiendo** — un id con formato y tabla correctos de un documento ya
borrado pasa la validación del tipo igual (hallazgo de auditoría, ronda 1;
la documentación de la ronda 1 afirmaba lo contrario para `skinId`, error
corregido aquí). A diferencia de una FK real de Postgres (que Prisma
traduce a `@relation`, con la garantía de la BD detrás), Convex no impide
insertar una referencia rota.

Corregido añadiendo `ctx.db.get(id)` + comprobación explícita de `null`
al principio de cada mutation que recibe una referencia de otra tabla,
antes de escribir: `createCalendar` (`skinId`), `addMembership`
(`calendarId` y `userId`), `inviteGuest` (`calendarId`), `markViewed`
(`dayId` y `userId`). `upsertDay` ya lo hacía de antes para `calendarId`
(necesitaba leer el `Calendar` de todas formas para la invariante de
rango). Verificado contra el deployment real con un caso que la validación
de tipo por sí sola NO detecta: crear un `Skin`, borrarlo (mutation
temporal solo para esta prueba), e intentar `createCalendar` con ese
`skinId` — formato y tabla correctos, documento ya no existe → rechazado
por el `ctx.db.get` nuevo, con "El skin indicado no existe."

**Sigue sin haber cascade automático al borrar** (parte del mismo
hallazgo): `onDelete: Cascade` en Prisma garantizaba, a nivel de schema,
que borrar un `Calendar` se llevaba por delante sus `Day`,
`CalendarMembership` e `Invitation` — sin que ninguna mutation de
aplicación tuviera que acordarse de hacerlo a mano. Convex no tiene un
equivalente declarativo. Esta tarea no incluye ninguna mutation de borrado
todavía (fuera de alcance de TAL-9), así que no hay código que corregir
hoy — pero queda anotado para quien escriba la primera mutation de
"borrar calendario" (TAL-10+): tendrá que borrar explícitamente, en la
misma mutation (Convex es transaccional, así que un borrado parcial a
medias no puede quedar a mitad camino), todos los `Day`,
`CalendarMembership`, `Invitation` y — transitivamente — `DayView` de los
`Day` borrados. Sin esto, borrar un `Calendar` dejaría huérfanos exactamente
del tipo que este documento lleva describiendo: referencias con formato y
tabla correctos, apuntando a nada.

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

**El `v.string()` del schema no impone el formato** (hallazgo de segunda
opinión, T2, antes de exportar la ronda 1): toda la garantía de "orden
lexicográfico == orden cronológico" de arriba depende de que el valor sea
SIEMPRE `"YYYY-MM-DD"` exacto — nada en `v.string()` lo comprueba, así que un
valor mal formado (o una fecha que no existe, tipo `"2026-02-30"`) rompía la
comparación en silencio en cualquier mutation que lo usara. Corregido con
`assertValidCalendarDate` (`convex/dates.ts`) — mismo criterio que
`parseUtcDateOnly` en `src/lib/calendars.ts` (versión Prisma): exige el
formato exacto y rechaza fechas que `Date.UTC` "arrastraría" al mes siguiente
en vez de fallar. Se llama al principio de `createCalendar`,
`updateCalendarRange` y `upsertDay` — cualquier mutation futura que reciba una
de estas fechas del cliente (TAL-10+) debe llamarla también.

**Tampoco se comprobaba que `startDate <= endDate`** (hallazgo de
auditoría, ronda 1): `createCalendar("2026-12-25", "2026-12-01")` (rango
invertido) se insertaba tal cual — la versión Prisma lo evitaba solo de
forma implícita (`defaultCalendarDateRange` siempre genera un rango
válido, y el formulario de edición no permite mandar uno invertido), sin
una comprobación explícita equivalente. Corregido con
`assertRangeNotInverted` (`convex/calendars.ts`), llamada en
`createCalendar` y `updateCalendarRange` después de validar que ambas
fechas son reales. Verificado contra el deployment real: rango invertido
rechazado tanto al crear como al actualizar; rango válido sin cambios de
comportamiento.

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

**El Dashboard de Convex es otro punto donde esta garantía de convención no
alcanza** (hallazgo de segunda opinión, T2): el argumento de arriba ("toda
escritura pasa por una mutation definida en código") es cierto para la app,
pero el Dashboard de Convex (`https://dashboard.convex.dev`) permite editar,
crear o borrar cualquier documento a mano, sin pasar por ninguna mutation ni
por `updateCalendarRange`/`upsertDay` — y Aitor va a tener acceso a ese
Dashboard. Es una limitación conocida, no algo que este schema pueda cerrar
por sí solo (ninguna plataforma evita que quien tiene acceso de administrador
edite datos a mano); se documenta aquí para que quede explícito, mismo
espíritu que el resto de esta sección: mejor una garantía más débil declarada
a las claras que una asumida sin comprobar.

**Verificado como carrera real, no solo mutation por mutation** (hallazgo de
segunda opinión, T2 — mismo tipo de fallo que costó 2 rondas en TAL-7,
`docs/invitados.md`: razonar cada mitad de una invariante por separado no
basta cuando lo que importa es qué pasa si las dos escrituras concurren de
verdad). La evidencia inicial de esta invariante probaba `upsertDay` y
`updateCalendarRange` cada una por su cuenta; no bastaba. Se añadió una
prueba de la CARRERA entre las dos sobre el mismo calendario: encoger el
rango (`updateCalendarRange`) justo hasta dejar fuera una fecha, mientras a
la vez se guarda un `Day` en esa fecha exacta (`upsertDay`), repetido 25
veces con calendarios frescos en cada intento (ver "Evidencia" — 10/25
"ganó" `upsertDay`, 15/25 "ganó" `updateCalendarRange`, 0/25 con las dos
triunfando a la vez, 0/25 violaciones de la invariante). El resultado
confirma que el OCC de Convex sí serializa correctamente estas dos mutations
distintas cuando sus rangos de lectura/escritura se solapan (la lectura de
`updateCalendarRange` sobre el índice `by_calendar_and_date` de ese
calendario conflictúa con la escritura de `upsertDay` sobre ese mismo rango),
tal como predice la teoría — pero es la prueba, no el razonamiento por sí
solo, lo que lo confirma.

**Una advertencia para TAL-10+, todavía no aplica hoy** (hallazgo de segunda
opinión, T2): el reintento OCC funciona reejecutando el CUERPO de la mutation
desde el principio si detecta un conflicto — inofensivo mientras la mutation
solo lea/escriba en la base de datos de Convex (que es transaccional), pero
peligroso si algún día una mutation dispara además un efecto externo NO
idempotente (por ejemplo, el envío real de email de invitación, todavía
pendiente de decidir proveedor — `docs/invitados.md` § "Envío real por email:
pendiente"): un reintento silencioso podría reenviar ese email dos veces sin
que nadie lo pidiera. Ninguna mutation de este schema dispara un efecto así
todavía. Cuando TAL-10+ conecte un envío de email real, esa lógica debe vivir
en una **action** de Convex (no en una mutation) — las actions no tienen la
garantía transaccional/de reintento automático de las mutations, precisamente
para que el código con efectos externos no idempotentes decida su propia
estrategia de reintento en vez de heredar la de la base de datos.

## Sin autenticación/autorización todavía — deliberado, temporal

Hasta esta ronda, `calendars.ts`, `calendarMemberships.ts`,
`invitations.ts`, `days.ts`, `dayViews.ts`, `users.ts` y `skins.ts`
exportaban `mutation`/`query` — funciones **públicas**, invocables por
cualquiera con la URL del deployment (`NEXT_PUBLIC_CONVEX_URL`), sin que
ninguna comprobara sesión ni rol. Cualquiera podía crear calendarios,
usuarios, invitaciones o membresías `ADMIN` arbitrarias (hallazgo de
auditoría, ronda 1). Confirmado y cerrado esta ronda, no dejado como "hueco
temporal" implícito:

**Todas las funciones de `convex/*.ts` pasan a ser `internalMutation`/
`internalQuery`.** Una función interna de Convex no es alcanzable desde el
cliente público (`ConvexHttpClient`, o el SDK de React) bajo ninguna
circunstancia — es una barrera que impone el propio servidor de Convex, no
una convención de código que dependa de que nadie la salte por error.
Verificado contra el deployment real: llamar a `internal.users.createUser`
con `ConvexHttpClient` (el mismo cliente que usan las pruebas de este
documento) devuelve `Could not find public function for
'users:createUser'.` — rechazado de raíz, el servidor ni siquiera la
reconoce como invocable desde ahí. Solo son alcanzables desde dentro de
otra función de Convex (`ctx.runMutation(internal.foo.bar, args)`) o desde
la CLI ya autenticada como administrador (`npx convex run`, el mismo canal
que usan las pruebas de concurrencia de este documento — ver "Evidencia").

**Por qué no añadir `ctx.auth`/comprobación de rol dentro de cada función
en su lugar** (que sería la alternativa obvia): T2 investigó en paralelo
cómo conectar Auth.js/NextAuth con Convex para TAL-11
(`docs/convex-auth-investigacion-tal11.md`, en su worktree) y encontró dos
patrones "oficiales" de Convex con gotchas reales — uno que el propio
Convex no garantiza como seguro sin piezas adicionales, otro que puede
reintroducir el mismo tipo de carrera que costó 2 rondas en TAL-7 si la
autorización se trocea en varias llamadas en vez de una sola. Su
recomendación, que se sigue aquí en vez de decidir algo distinto sin
haberla visto: NextAuth sigue siendo la única fuente de sesión,
`resolveCalendarAccess` (Next.js) sigue siendo el único punto que decide
"quién puede hacer qué", y llama a Convex vía una única mutation por
operación — ninguna función de Convex necesita `ctx.auth` para este
proyecto. Diseñar eso en detalle es TAL-11, no esta tarea; aquí solo se
cierra el hueco de "ahora mismo es una API pública sin ningún control" con
la herramienta correcta (funciones internas), sin adelantar una decisión
de arquitectura de autenticación que no corresponde a TAL-9.

**Esto sigue siendo aceptable solo por el estado actual del proyecto, no
en general**: este deployment no tiene datos de producción (el milestone
completo de Convex parte de cero, ver "Qué no toca esta tarea"), y
`convex/*.ts` no está conectado a la app Next.js todavía. En cuanto TAL-10
empiece a conectar la app de verdad, la autorización real (quién puede
llamar a qué, sea vía `ctx.auth` en casos concretos o vía el único punto
de decisión en Next.js que recomienda T2) tiene que estar resuelta antes
de exponer esto de verdad — no basta con que las funciones sean internas
para siempre si en algún momento una `action` pública de Convex necesita
invocarlas en nombre de un usuario real.

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
(`beloved-barracuda-617.convex.cloud`).

**Cambio de mecanismo de invocación en esta ronda**: desde que todo pasó a
`internalMutation`/`internalQuery` (hallazgo #3, ver arriba), ya no son
alcanzables con `ConvexHttpClient` (el cliente público que usaban las
pruebas de la ronda 1) — verificado: intentarlo devuelve `Could not find
public function for '<módulo>:<función>'`. Las pruebas de esta ronda usan
`npx convex run <función> '<json>'` (CLI ya autenticada como
administrador) en su lugar. Para las pruebas de concurrencia, cada llamada
es un **proceso `npx convex run` independiente** lanzado con
`Promise.all`/sin `await` entre medias — más representativo aún de
"pestañas/clientes reales e independientes" que instancias de un cliente
HTTP en el mismo proceso Node, porque cada una es un proceso del SO
separado.

1. **Email insensible a mayúsculas**: `createUser("Foo.Bar@Example.COM")`
   seguido de `createUser("foo.bar@example.com")` devuelven el mismo `_id`.
2. **Integridad referencial** (hallazgo #1, esta ronda): `v.id("skins")`
   por sí solo NO detecta un documento borrado — probado creando un
   `Skin`, borrándolo (mutation temporal solo para esta prueba, eliminada
   después) y llamando a `createCalendar` con ese `skinId` (formato y
   tabla correctos, documento ya no existe) → rechazado por el
   `ctx.db.get` nuevo con "El skin indicado no existe." Confirma que la
   corrección hace algo que la validación de tipo de Convex por sí sola no
   hacía (distinto de pasar un id de la tabla equivocada, que Convex ya
   rechazaba solo — probado también: `ArgumentValidationError ... which
   does not match the table name in validator`).
3. **Rango invertido rechazado** (hallazgo #2, esta ronda):
   `createCalendar(startDate="2026-12-25", endDate="2026-12-01")` →
   rechazado. `updateCalendarRange` con el mismo patrón sobre un
   calendario ya existente → también rechazado. Rango válido → sin cambio
   de comportamiento.
4. **Funciones internas, no públicas** (hallazgo #3, esta ronda):
   `ConvexHttpClient` intentando `internal.users.createUser` → rechazado
   por el propio servidor (`Could not find public function`), no por
   ningún filtro del lado del cliente.
5. **Idempotencia de `creationKey` bajo concurrencia real**: 5
   `createCalendar` (5 procesos `npx convex run` a la vez) con la misma
   `creationKey` → 1 solo `_id` único entre las 5 respuestas.
6. **Invariante de rango, mitad "guardar día"**: `upsertDay` con una fecha
   anterior a `startDate` → rechazado. Con una fecha dentro de rango →
   aceptado.
7. **Invariante de rango, mitad "cambiar rango del calendario"**: con un
   `Day` ya guardado dentro del rango, `updateCalendarRange` a un rango
   que lo dejaría fuera → rechazado. A un rango que lo mantiene dentro →
   aceptado.
8. **Invariante de rango, la CARRERA real entre las dos mitades** (T2,
   ronda 1 de auditoría) — repetida esta ronda tras cambiar `collect()`
   por las dos consultas acotadas por índice (sugerencia no bloqueante):
   `updateCalendarRange` (encogiendo para dejar fuera una fecha) y
   `upsertDay` (guardando esa fecha exacta) a la vez sobre el mismo
   calendario, 15 repeticiones con calendarios frescos en cada una → **0
   violaciones** en las 15, reparto real de quién "gana" (5/15
   `upsertDay`, 10/15 `updateCalendarRange`, 0/15 ambas a la vez) —
   confirma que la consulta acotada por índice sigue leyendo exactamente
   el rango donde puede estar el día conflictivo, tal como se razonaba en
   la ronda 1, y sigue siendo correcta bajo la carrera real tras el
   cambio.
9. **Validación de formato de fecha** (T2, ronda 1 de auditoría):
   `assertValidCalendarDate` rechaza `"2026-13-01"` (mes inválido),
   `"2026-02-30"` (día que no existe ese mes) y `"01-12-2026"` (formato
   distinto); acepta fechas reales bien formadas sin cambios.
10. **DayView, idempotencia bajo concurrencia real** (el caso exacto de
    P2002 en TAL-8 ronda 1): 5 `markViewed` (5 procesos a la vez) para el
    mismo `(dayId, userId)` → 1 solo `_id` único.
11. **Control negativo** (verificación honesta, mismo criterio que
    `docs/invitados.md`; corrido en la ronda 1, no repetido esta ronda
    porque el mecanismo que prueba — `insert` directo sin
    check-then-insert — no cambió): una mutation deliberadamente rota
    sometida a 10 llamadas concurrentes reales para el mismo `(dayId,
    userId)` → **10 filas duplicadas**. Confirma que el arnés de prueba
    detecta el fallo real cuando la protección no está.
12. **CalendarMembership**, único por `(calendarId, userId)` bajo
    concurrencia real (5 procesos): 1 solo `_id`.
13. **Invitation**, único por `(calendarId, email normalizado)` bajo
    concurrencia real (5 procesos), con mayúsculas mezcladas entre
    llamadas: 1 solo `_id`.
14. `npx convex dev --once` (build/typecheck real del schema y todas las
    mutations/queries contra el deployment): limpio, sin errores.

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

## Actualización — reconexión de la app (posterior a esta tarea)

Esta sección describe el estado de TAL-9 tal como se cerró — se deja
intacta como registro histórico en vez de reescribirla. Para el estado
real de la reconexión app↔Convex, ver la documentación de cada tarea que
la fue cerrando en su propio dominio: `docs/auth.md` (TAL-11, autenticación
y el secreto compartido de `convex/serverAuth.ts`) y `docs/dias.md`
(TAL-13, `convex/days.ts` — extendido con validación de `videoUrl`/
`message` y con `deleteDay`/`getCalendarDays` nuevas). El resto de
dominios (`convex/calendars.ts` TAL-12, `convex/guests.ts`/`invitations.ts`
TAL-16) siguen su propio ciclo en paralelo.
