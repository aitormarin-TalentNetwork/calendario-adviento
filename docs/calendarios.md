# CRUD de calendario — Admin (TAL-5)

> **Nota TAL-12**: este documento describe el diseño de TAL-5 sobre Prisma,
> que sigue siendo la decisión vigente en cuanto a comportamiento observable
> (valores por defecto, validación, idempotencia). Lo que cambió es la capa
> de datos: TAL-10 retiró Prisma/Postgres (dejando estas funciones lanzando
> `DataLayerUnavailableError`) y TAL-12 las reconecta contra Convex, vía la
> frontera pública de secreto compartido de TAL-11
> (`convex/calendars.ts`/`convex/skins.ts`, `docs/convex-diseno-tal12-crud-calendario.md`
> para el diseño previo, `docs/convex-modelo-de-datos.md` para el resto del
> modelo). Las menciones a transacciones `SERIALIZABLE`/`P2002`/`onDelete:
> Cascade` de Postgres de abajo son ya solo históricas — ver las notas
> puntuales añadidas en cada sección para el mecanismo actual.

## Cómo se llega a ser Admin de un calendario

No hay un paso previo de aprovisionamiento: cualquier usuario autenticado que
visita `/admin` puede pulsar "+ Nuevo calendario", y eso crea el `Calendar`
**y** su `CalendarMembership` como `ADMIN` en la misma transacción (ver
`src/lib/calendars.ts::createCalendarForAdmin`, que ahora llama a
`calendars.createCalendarPublic` → `convex/calendars.ts::createCalendarHandler`
— sigue siendo una única mutation, decisión ya cerrada por la Directora al
diseñar TAL-12 precisamente para no reabrir la ventana de carrera "calendario
sin ningún Admin todavía" que TAL-7 tardó 2 rondas en cerrar). Es la propia
creación la que
"da de alta" al Admin, no al revés — coherente con el brief de TAL-5 ("crear
un calendario implica también crear la CalendarMembership del creador como
Admin") y con que TAL-5 no está bloqueada por TAL-4 (Panel Super Admin): un
Admin puede gestionar sus calendarios sin que exista todavía ningún flujo de
"alta de Admin" centralizado.

`/admin` (listado) muestra solo los calendarios donde el usuario en sesión
es `ADMIN` — no es la vista global de Super Admin (esa es `/superadmin`,
TAL-4). Un Super Admin que visite `/admin/[calendarId]` directamente sí
puede editar/borrar cualquier calendario (mismo override ya establecido en
TAL-2 para el resto de rutas protegidas), aunque no aparezca en su propio
listado si no es su Admin.

## Valores por defecto al crear

Salvo el nombre (ver TAL-26 más abajo), sin formulario de creación aparte —
se crea con valores de partida y se edita todo después, igual que sugiere
el mockup (botón "+ Nuevo calendario" sin diálogo intermedio):

- Fechas: 1–24 de diciembre del próximo diciembre que llegue
  (`defaultCalendarDateRange` — si ya se pasó el 24 de diciembre de este
  año, usa el año siguiente).
- Skin: `pino` (coincide con el comentario "skin por defecto" de
  `prisma/seed.ts`); si por lo que sea no existe, cae al primero que haya en
  vez de bloquear la creación. **TAL-12**: esta resolución vive ahora dentro
  de Convex (`resolveDefaultSkinId`, `convex/calendars.ts`) — la Server
  Action de creación no manda ningún `skinId`, igual que antes con Prisma.

### Pedir nombre al crear (TAL-26)

**Antes**: "+ Nuevo calendario" creaba directamente con `name: "Nuevo
calendario"` fijo y navegaba al editor — con varios calendarios a la vez
(caso ya real, pedido explícito de Aitor), no se podía identificar cuál
era cuál sin entrar uno a uno a renombrarlo.

**Ahora**: el botón "+ Nuevo calendario" (`src/components/new-calendar-submit.tsx`)
lleva un `<input>` de nombre, obligatorio, en el MISMO formulario que ya
mandaba `creationKey` — no hace falta un modal ni un paso posterior
separado: el nombre se pide (y se manda) antes de que exista el registro,
en la misma petición atómica. Se descartó la alternativa (crear con
nombre vacío/placeholder + paso obligatorio inmediato después) porque deja
una ventana real en la que puede quedar un calendario "sin nombre" a medio
crear si el Admin abandona ese paso — el enfoque elegido no tiene ese
estado intermedio en absoluto.

`name` ya existía como campo (TAL-9) — esta tarea no crea ninguno nuevo,
solo empieza a pedirlo de verdad. Validación (no vacío, cota de 100
caracteres — sin precedente similar que reutilizar: ni `name` ni
`coverTitle` tenían hasta ahora ninguna cota de longitud, así que se elige
una nueva, defensiva, no de producto, mismo criterio que
`MAX_COVER_ICON_LENGTH`/`MAX_VIDEO_URL_LENGTH`) vive por partida doble,
mismo criterio que el resto de este documento:
- Convex (`convex/calendars.ts::assertValidCalendarName`, aplicada en
  `createCalendarHandler`) — la comprobación real y definitiva, imposible
  de saltarse aunque alguien llame a `createCalendarPublic` sin pasar por
  la Server Action.
- `src/app/admin/actions.ts::createCalendarAction` — comprobación rápida
  para el caso común (campo vacío/demasiado largo) sin ida y vuelta a
  Convex; ahora usa `useActionState` (mismo patrón que
  `updateCalendarAction`, TAL-20) para pintar el error como texto normal
  del formulario en vez de una excepción sin capturar.

Constante compartida `MAX_CALENDAR_NAME_LENGTH` en
`convex/calendarNameConstants.ts` (mismo patrón que
`convex/coverIconConstants.ts`/`convex/calendarErrorMessages.ts`) —
importable tanto desde Convex como desde Next.js sin arrastrar ningún
grafo de módulos de más.

**Deliberadamente NO se valida en `updateCalendarHandler`** (edición) —
el brief acota el trabajo a "pedir nombre AL CREAR"; el formulario de
edición ya exigía "no vacío" del lado de Next.js desde TAL-5, pero nunca
tuvo cota de longitud ni la re-verifica en Convex. Inconsistencia real y
menor, documentada aquí a propósito en vez de ampliar el alcance de esta
tarea sin que nadie lo pidiera.

`creationKey` sigue viviendo exactamente igual que en TAL-19 — generado
en cliente tras montar (`useEffect`, nunca en el render/SSR), como campo
oculto CONTROLADO por React (no `defaultValue`), así que el `<input>` de
nombre y el `creationKey` sobreviven intactos a un envío fallido por
validación: un reintento tras un error usa la MISMA clave, no una nueva —
la idempotencia de "+ Nuevo calendario" sigue intacta.

**Evidencia**: verificado en navegador real (dev-login) — nombre escrito
antes de crear, aparece correcto en `/admin` sin renombrar. Validación de
servidor comprobada de forma independiente al navegador, con `npx convex
run calendars:createCalendar` directo (saltándose la Server Action y el
`required` del HTML por completo): nombre vacío → rechazado; nombre solo
espacios → rechazado (recortado antes de validar); nombre de 101
caracteres → rechazado con el mensaje de longitud; 100 exactos → aceptado
(cota, no límite estricto por debajo). Idempotencia de `creationKey`
reconfirmada con dos llamadas reales idénticas → mismo `_id`, una sola
fila en Convex. `npx next build`/`npx eslint .` limpios; `npx convex dev
--once --typecheck=enable` limpio; `AGENTS.md` intacto.

## Validación en las server actions, no solo en la UI

`src/app/admin/actions.ts` repite la comprobación de rol dentro de cada
action (`requireCalendarAdmin`), no solo en la página: una server action es
un endpoint invocable directamente, no algo que quede protegido con que el
botón esté oculto en el HTML.

Para editar: nombre/título obligatorios, fechas parseables con
`startDate <= endDate`, y el `skinId` se valida contra la tabla `Skin` en
servidor (el `<select>` ya limita las opciones en la UI, pero eso no basta —
nunca hay que confiar en que el cliente mandó un id real). No hay subida de
ficheros: el backend de almacenamiento sigue sin decidir (`docs/stack.md`),
así que de momento la portada es solo una URL externa, igual que ya se hizo
con `Day.videoUrl` en el modelo de datos.

### Foto de portada: solo `https://` (corrección de auditoría, ronda 1)

La ronda 1 solo comprobaba que `new URL(...)` no lanzara — eso valida
sintaxis, no esquema: `javascript:alert(1)`, `data:text/html,...` o `file:`
son URLs sintácticamente válidas. Si esa cadena se acaba renderizando tal
cual en algún sitio (un `<a href>`, o un futuro `<img src>` mal saneado),
`javascript:`/`data:` pueden ejecutar contenido activo — riesgo real de XSS
almacenado a través de un campo pensado para ser "solo una foto".

Corrección: `updateCalendarAction` exige `parsed.protocol === "https:"`
explícitamente tras el `new URL(...)`, rechazando cualquier otro esquema
(incluido `http:` — no hay motivo para servir la portada sin cifrar).
Probado en el navegador: `javascript:alert(1)` y `http://…` rechazados con
error del servidor; `https://…` aceptado y guardado.

> **TAL-12** (sugerencia de auditoría, ronda 1, no bloqueante): esta
> validación solo vivía en la Server Action — un futuro llamador directo de
> `calendars.createCalendarPublic`/`updateCalendarPublic` (con el secreto
> compartido, saltándose la UI) podía guardar un esquema peligroso.
> `assertSafeCoverImageUrl` (`convex/calendars.ts`) repite exactamente la
> misma comprobación dentro de las dos mutations, como invariante de
> escritura real — no solo de UI, mismo criterio que el resto de
> invariantes del fichero. Verificado contra el deployment real: un
> `coverImageUrl: "javascript:alert(1)"` mandado directamente a
> `createCalendarPublic` (sin pasar por la Server Action) se rechaza igual.

Deliberadamente **no** se hace una petición HTTP desde el servidor para
comprobar que la URL sirve de verdad una imagen (`content-type: image/*`):
eso convertiría el propio backend en un proxy que pide lo que sea que le
mande cualquier usuario autenticado — un vector de SSRF (podría usarse para
sondear `localhost`, la red interna de Railway, metadatos de la nube, etc.),
un riesgo mayor que el que se está mitigando. Una URL `https:` que no sirva
una imagen de verdad simplemente no se verá cuando se renderice como
`<img>` (TAL-6/TAL-7) — un fallo visible y de bajo riesgo, no de seguridad.

### Fechas: formato estricto, no `new Date(loQueSea)` (corrección de auditoría, ronda 1)

La ronda 1 aceptaba cualquier cadena que `new Date(...)` supiera parsear,
aunque el contrato real es "YYYY-MM-DD a medianoche UTC" (lo que manda el
`<input type="date">`). `new Date(...)` también acepta timestamps ISO
completos con hora y zona horaria — un valor como
`"2026-12-01T00:00:00-05:00"` se interpreta con esa zona horaria, no como
UTC, y puede desplazar el día guardado.

Corrección: `parseUtcDateOnly` en `src/lib/calendars.ts` exige el patrón
exacto `/^\d{4}-\d{2}-\d{2}$/` y construye la fecha con `Date.UTC(...)`
explícitamente — nunca deja que el parser de `Date` adivine el formato.
También rechaza fechas que no existen (`Date.UTC` "arrastra" un 30 de
febrero a marzo en vez de fallar; se comprueba que año/mes/día del resultado
coinciden exactamente con lo pedido). Probado: un timestamp con zona horaria
y un `"2026-02-30"` rechazados con error del servidor; una fecha válida
sigue guardándose con normalidad.

El auditor sugirió considerar `@db.Date` para estos campos, como ya se hizo
con `Day.date` en TAL-3. No se ha cambiado el schema en esta ronda: el
riesgo que señalaba (interpretación incorrecta del valor de entrada) ya
queda cerrado a nivel de aplicación con `parseUtcDateOnly`, y tocar el tipo
de columna es un cambio de modelo de datos más amplio que excede el alcance
de esta corrección — se deja anotado como posible mejora de TAL-3/TAL-6 si
hiciera falta más adelante, no una corrección bloqueante de TAL-5.

### Creación idempotente ante doble clic o reenvío (corrección de auditoría, ronda 1)

La ronda 1 no tenía ninguna protección: cada envío del formulario "+ Nuevo
calendario" creaba una fila nueva sin más, así que un doble clic o un
reenvío (botón "atrás" del navegador, reintento de red) duplicaba
calendario y membership.

Corrección con dos capas:

- **UI**: `src/components/submit-button.tsx` (`SubmitButton`, usa
  `useFormStatus`) deshabilita el botón mientras el envío está en curso —
  evita el caso más común (doble clic) sin necesidad de JavaScript a medida.
- **Servidor, la garantía real**: `/admin` genera una `creationKey`
  (`crypto.randomUUID()`) una vez por render, como campo oculto del
  formulario — mientras no se recargue la página, cualquier reenvío manda la
  MISMA clave. `Calendar.creationKey` es única en BD (migración
  `20260816031031_calendar_creation_key`); `createCalendarForAdmin`
  comprueba primero si ya existe un calendario con esa clave y lo devuelve
  tal cual, y si dos intentos llegan a la vez (comprobar-y-crear tiene
  ventana de carrera, ya visto con la aceptación de invitaciones en TAL-2),
  atrapa el choque del índice único (P2002) y relee la fila que ganó en vez
  de fallar o duplicar.

Probado con concurrencia real, no solo en teoría: un script aparte llamó a
`createCalendarForAdmin` dos veces en paralelo (`Promise.all`) con la misma
`creationKey` → devolvió el mismo `id` en ambas, una sola fila en BD con esa
clave.

`deleteCalendarAction` recibió de paso la misma robustez frente a reenvío:
si el calendario ya no existe (P2025, "record not found" — un segundo
envío del mismo borrado), se trata como éxito en vez de fallar; el estado
que pedía el usuario (que el calendario no exista) ya se cumple.

> **TAL-12**: el mecanismo concreto de arriba (índice único +
> `try/catch(P2002)`) es específico de Prisma/Postgres. La versión Convex
> (`convex/calendars.ts::createCalendarHandler`) no lo necesita: una
> mutation de Convex ya corre con aislamiento serializable y reintento
> automático ante conflicto (mismo mecanismo verificado con concurrencia
> real en TAL-9), así que el check-then-insert por `creationKey` es seguro
> tal cual. Igual con el borrado: `deleteCalendarHandler` trata un
> `calendarId` que ya no existe como no-op (`if (!calendar) return;`),
> mismo comportamiento observable que el `P2025` de Prisma.
>
> **Hallazgo de auditoría, TAL-12 ronda 1**: que la mutation en sí sea
> idempotente no bastaba — `deleteCalendarAction` (Next.js) comprobaba rol
> vía `requireCalendarAdmin`/`resolveCalendarAccess` ANTES de llamar a la
> mutation, y esa comprobación consulta la `calendarMembership` del
> usuario. Un reenvío llega después de que el primer borrado ya se llevó
> esa membership por delante (cascade) — sin membership que consultar,
> `resolveCalendarAccess` devuelve `null` y el reenvío caía en
> `/unauthorized` en vez de tratarse como éxito, nunca llegaba a invocar la
> mutation (que sí lo habría manejado bien). Corrección: se comprueba
> primero si el calendario TODAVÍA existe (mismo orden que ya usaba la
> versión Prisma de `admin/[calendarId]/page.tsx`, TAL-5 — existencia antes
> que rol); si ya no existe, no hay membership que pudiera demostrar rol de
> todas formas, así que se trata como éxito sin volver a exigirlo — sin
> debilitar nada para un calendario que SÍ existe, donde la comprobación de
> rol sigue siendo obligatoria y real. Verificado contra el deployment real
> con un Admin normal (no Super Admin, cuyo atajo habría ocultado el
> hallazgo): borrar dos veces seguidas el mismo calendario redirige a
> `/admin` las dos veces; un tercero sin relación con un calendario que SÍ
> existe sigue recibiendo `/unauthorized`.
>
> **Hallazgo de auditoría, TAL-12 ronda 2**: la corrección de la ronda 1
> seguía resolviendo existencia, autorización y borrado como TRES
> operaciones Convex independientes desde Next.js — el reenvío secuencial
> quedaba bien cubierto, pero dos peticiones REALMENTE solapadas (no una
> detrás de otra) podían las dos ver el calendario existir antes de que la
> primera lo borrara; la segunda entonces sí llegaba a comprobar
> membership, ya no la encontraba y caía en `/unauthorized`. Mismo patrón
> que TAL-11 ya resolvió para `resolveMemberAccess` (docs/convex-auth-investigacion-tal11.md
> § "Gotcha 3"): repartir en varias llamadas desde Next.js una lógica que
> depende de un estado que otra operación puede cambiar mientras tanto
> reabre la ventana, sin importar cuántas comprobaciones se añadan
> alrededor. Corrección definitiva:
> `calendars.deleteCalendarAsUserHandler` resuelve existencia +
> autorización (`isSuperAdmin`, ya resuelto en Next.js sin tocar Convex —
> o membership `ADMIN`, comprobada aquí) + borrado en UNA sola mutation
> serializable — ya no existe ninguna versión pública de "borrar sin
> comprobar autorización" a la que se le pueda anteponer nada por
> separado. Verificado con concurrencia REAL entre procesos del sistema
> operativo (no solo `Promise.all` dentro de un mismo proceso Node — mismo
> rigor que TAL-9): 8 rondas de 6 llamadas `npx convex run` verdaderamente
> simultáneas contra el mismo calendario recién creado, mismo Admin real
> — en las 8 rondas, exactamente 1 `"deleted"` y el resto `"already-gone"`,
> CERO `"unauthorized"`. Repetido con dos peticiones HTTP reales lanzadas
> en paralelo contra la Server Action (protocolo real de Server Actions de
> Next.js) — las dos redirigen a `/admin`, ninguna a `/unauthorized`. Un
> stranger sin membership contra un calendario de control que SÍ existe
> sigue recibiendo `"unauthorized"` sin afectar al calendario.

## Fechas: por qué hay un `formatCalendarDate` en vez de `toLocaleDateString` a secas

`Calendar.startDate`/`endDate` se guardan a medianoche UTC. Formatear con
`date.toLocaleDateString("es-ES")` sin más convierte primero a la hora local
del proceso de Node — en cualquier huso horario por detrás de UTC (la
mayoría de América, por ejemplo) eso enseña el día anterior en el listado de
`/admin` (encontrado probando: `2026-12-01` se mostraba como "30/11/2026").
El formulario de edición no lo sufre porque usa `.toISOString().slice(0,10)`
(siempre UTC), pero el listado si formatea "bonito" hay que fijar
`timeZone: "UTC"` explícitamente — de ahí `formatCalendarDate` en
`src/lib/calendars.ts`, para no repetir el mismo fallo en cualquier otro
sitio que necesite mostrar estas fechas (TAL-6/TAL-7 probablemente).

## Borrar calendario

`onDelete: Cascade` en el schema de Prisma (ya definido en TAL-3) se llevaba
por delante `Day`, `Invitation` y `CalendarMembership` de ese calendario —
no hacía falta borrarlos a mano. La UI pide confirmación con un diálogo
nativo del navegador (`src/components/confirm-submit-button.tsx`, único
componente cliente del proyecto hasta ahora) antes de enviar el formulario;
es solo una salvaguarda de UX, la autorización real la comprueba la server
action, no el diálogo.

> **TAL-12**: Convex no tiene cascade declarativo (ya lo dejó anotado TAL-9
> como pendiente). `convex/calendars.ts::deleteCalendarHandler` hace el
> borrado en cascada A MANO, completo, dentro de UNA sola mutation
> transaccional: días del calendario → `dayViews` de esos días (consultados
> por el índice `by_day_and_user` de `dayViews` usando solo `dayId` como
> prefijo — confirmado que funciona así contra el deployment real, la duda
> que dejó abierta el diseño de TAL-12) → `calendarMemberships` → `invitations`
> → el propio `calendars`. Verificado con datos reales (días + vistas
> creados de verdad, no solo razonado): tras borrar, ni el calendario ni
> nada de lo anterior sigue existiendo. Coste de transacción: a la escala
> del producto (un calendario de adviento, ~24 días como mucho) no es un
> problema — anotado como posible revisión futura solo si el producto
> llegara a admitir calendarios mucho más grandes.

## Nota: desfase de checksum en el historial de migraciones

Al añadir la migración de `creationKey`, `prisma migrate dev` detectó que el
fichero de la migración `20260816003752_day_date_and_citext_email` (TAL-3,
ronda 2 de auditoría) ya no coincide en checksum con lo que quedó grabado
como aplicado en `_prisma_migrations` — y quería resetear toda la BD
compartida para "arreglarlo". No se ha hecho: habría borrado datos de otras
terminales. En su lugar, la migración nueva se escribió y aplicó a mano
(`psql` + `prisma migrate resolve --applied`), sin tocar nada existente.
`prisma migrate status` seguía diciendo "up to date" en todo momento — el
desfase es solo del check más estricto de `migrate dev`, no de un problema
real de esquema. Queda anotado por si alguien vuelve a toparse con el mismo
aviso: no ejecutar `migrate reset` sin coordinar antes, el mismo desfase
seguirá ahí (viene de antes de esta tarea) y resetear no lo "arregla" de
verdad, solo destruye datos compartidos.

## Icono de portada (TAL-23) — primera tarea de UI bajo el Design System

**Antes**: el 🎄 iba incrustado a mano dentro del texto por defecto de
`coverTitle` ("¡Feliz cuenta atrás, equipo! 🎄") — ni campo propio ni
seleccionable, el Admin solo podía cambiarlo escribiendo/borrando el
emoji dentro del texto del título.

**Ahora**: `coverIcon` es un campo propio del calendario
(`convex/schema.ts`, `v.optional(v.string())`), con un selector real en
el editor (`src/app/admin/[calendarId]/cover-icon-picker.tsx`) — buscador
+ galería categorizada (Navidad, Fiesta, Cariño, Naturaleza y cielo,
Animales y fantasía; 45 emoji en total, catálogo en
`src/lib/cover-icons.ts`), siguiendo `design/design-system.md` §
"Selector de icono de portada (Admin)" (fuente:
`design/propuesta-skins.html`). Icono seleccionado con borde/fondo
distintivos (colores exactos del Design System — ver nota de tokens más
abajo).

**Catálogo sin límite fijo en la lógica** (brief de TAL-23, mismo
criterio que la validación de email en `inviteGuest`, TAL-16): ni Convex
(`assertValidCoverIcon`, `convex/calendars.ts`) ni la Server Action
(`updateCalendarAction`) validan contra la lista exacta de 45 — solo una
cota de longitud defensiva (`MAX_COVER_ICON_LENGTH = 16`, igual de
criterio que `MAX_VIDEO_URL_LENGTH`/`MAX_MESSAGE_LENGTH`, TAL-6/13).
Ampliar el catálogo más adelante es añadir entradas a
`COVER_ICON_CATEGORIES` (`src/lib/cover-icons.ts`), no tocar lógica de
validación en ningún sitio.

**Buscador con términos en español, no del mockup** (`design/propuesta-skins.html`
es un `<div>` estático con placeholder "🔍 Buscar icono…", sin JS real
que defina cómo debería filtrar) — decisión de implementación, no de
fidelidad visual: cada emoji lleva un `searchTerms` corto en español
(`"unicornio"`, `"árbol de navidad"`, etc.), filtrado por substring
insensible a mayúsculas.

**Migración de datos — calendarios creados antes de TAL-23, hallazgo de
auditoría rondas 1 y 2, corregido**: `coverIcon` es `v.optional()` a
propósito, y cada sitio que LEE este campo aplica un respaldo
(`DEFAULT_COVER_ICON = "🎄"`, `src/lib/cover-icons.ts`) si el calendario
todavía no lo tiene — pero la primera versión de esta tarea se quedaba
corta: los calendarios creados ANTES de TAL-23 ya llevaban el 🎄
incrustado a mano dentro del propio texto de `coverTitle` (único
mecanismo AUTOMÁTICO que existía — `createCalendarForAdmin` generaba
siempre `"... 🎄"`). Con solo el respaldo de lectura, esos calendarios
mostraban el emoji DOS VECES ("🎄 ¡Feliz cuenta atrás, equipo! 🎄" — el
respaldo nuevo, más el que ya estaba dentro del texto), y si alguien
editaba y guardaba ese calendario después, `coverIcon` se persistía pero
el 🎄 seguía dentro de `coverTitle` sin limpiar: dejaba de ser un
problema transitorio del respaldo y se quedaba así para siempre (el
formulario de edición nunca reescribe `coverTitle` por su cuenta).

Corrección: `convex/calendars.ts::backfillEmbeddedCoverIcon`, un
backfill real (Convex no tiene mecanismo de migración declarativo, mismo
tema de `docs/convex-modelo-de-datos.md`) — recorre `calendars`, y para
cada fila con `coverIcon` todavía sin fijar cuyo `coverTitle` coincide
**EXACTAMENTE** con el literal histórico completo
(`"¡Feliz cuenta atrás, equipo! 🎄"`), retira el sufijo `" 🎄"` del texto
y fija `coverIcon: "🎄"`. Idempotente — una fila ya migrada deja de
cumplir la condición, así que reejecutar es un no-op seguro (verificado:
segunda pasada `migrated: 0`). Se invoca a mano, una sola vez por
deployment, vía el canal de administrador de la CLI: `npx convex run
calendars:backfillEmbeddedCoverIcon '{}'` — mismo canal ya usado en
TAL-9/12/16 para operaciones de este tipo, nunca desde código de
aplicación.

**Hallazgo de auditoría, ronda 2**: la primera versión de este backfill
detectaba cualquier `coverTitle` que TERMINARA en `" 🎄"`, no solo el
literal exacto — un error real, porque `updateCalendarAction` (desde
TAL-5) siempre permitió editar `coverTitle` como texto completamente
libre. Un Admin pudo haber escrito de verdad un título propio que
termine en ese mismo emoji ("Navidad en familia 🎄"), sin ninguna
relación con el mecanismo viejo; la heurística por sufijo se lo habría
comido igual, quitándole al Admin un texto elegido por él de forma
efectivamente irreversible. Corregido a comparación por literal exacto
(ver arriba) — solo se migra automáticamente lo que con certeza vino del
mecanismo viejo, nunca algo que solo coincide "por casualidad". La
afirmación original de "no hay otra vía por la que pudiera llegar un
emoji embebido" tampoco era cierta — el formulario de edición libre
siempre lo permitió; corregida esta ronda.

Riesgo residual documentado y aceptado: un calendario legado cuyo título
fue editado DESPUÉS de creado (p. ej. le cambiaron el nombre pero
dejaron el 🎄 al final) ya no coincide con el literal exacto y queda
fuera de este backfill — se resuelve bien igualmente por el respaldo de
lectura (sin duplicar nada, porque el título ya no es el literal
conocido), aunque conserve el emoji suelto dentro del texto hasta que
alguien lo edite a mano. Calendarios sin ningún emoji embebido (título
totalmente libre) tampoco se tocan — ya funcionan bien con el respaldo
de lectura, sin nada que limpiar.

Verificado contra mi deployment aislado, en dos rondas. Ronda 1: dos
filas simuladas ("... 🎄" sin `coverIcon`, y un título libre sin emoji
sin `coverIcon`) más las filas reales ya existentes — primera pasada
`{migrated: 1, skippedAlreadySet: 1, skippedNoMatch: 3}`, segunda pasada
(idempotencia) `{migrated: 0, skippedAlreadySet: 2, skippedNoMatch: 3}`.
Ronda 2, tras acotar a literal exacto: una fila con el literal histórico
EXACTO (migró, `coverTitle: "¡Feliz cuenta atrás, equipo!"` +
`coverIcon: "🎄"`) y una fila con un título propio que solo coincide en
el sufijo ("Navidad en familia 🎄", NO migró, quedó intacta) — confirmado
leyendo los documentos reales (`npx convex data calendars --format
jsonLines`); idempotencia reconfirmada tras la corrección (`migrated: 0`
en la segunda pasada).

**Centralización de `MAX_COVER_ICON_LENGTH`** (sugerencia no bloqueante
de auditoría, ronda 1): vivía duplicado a mano en `convex/calendars.ts`
y `src/lib/cover-icons.ts`. Movido a `convex/coverIconConstants.ts`
—fichero sin dependencias de runtime de Convex a propósito, mismo patrón
que `convex/calendarErrorMessages.ts` (TAL-20)— e importado desde los dos
sitios; `src/lib/cover-icons.ts` lo reexporta para no romper a quien ya
lo importaba de ahí (`src/app/admin/actions.ts`).

**Sitio NO reconectado, hallazgo de esta tarea, trackeado aparte
(TAL-25)**: `src/app/login/page.tsx` nunca llegó a mostrar el calendario
real de un `callbackUrl` — sigue siendo un `null` fijo desde que TAL-10
retiró Prisma, ninguna tarea posterior lo reconectó. El tipo/JSX de esa
página ya están preparados para pintar `coverIcon` en cuanto TAL-25
resuelva esa búsqueda (página pública sin autenticar, con su propia
superficie de seguridad — no algo que decidir dentro de este ticket) —
hasta entonces, esa página sigue mostrando solo la portada genérica
(🎄 + texto sin el emoji dentro), igual que antes de esta tarea.

**Tokens del Design System — hallazgo de esta tarea, ya resuelto**:
`design/design-system.md` es normativo (`--gold`, `--paper-2`, etc.),
pero `src/app/globals.css` todavía solo tenía el esquema viejo del MVP
(`--accent`/`--background`/`--foreground`) cuando se detectó esto —
ninguna página de la app usaba los tokens nuevos todavía. Consultado
con el PM (factory-e9): el set completo tiene que acabar en
`globals.css` tal cual, pero coordinar quién lo añade primero (para no
chocar con TAL-21, mismo Design System, en paralelo) era decisión de
la Directora — se lo asignó a T3 como paso aparte. Mientras tanto,
`cover-icon-picker.tsx` usó temporalmente los valores hex exactos de
la tabla de tokens (`#c99a3d` gold, `#efe7d4` paper-2), sin depender de
variables CSS que todavía no existían. T3 publicó la migración completa
a `main` (commit `f345950`); tras traer `main` a esta rama,
`cover-icon-picker.tsx` quedó actualizado para usar `var(--gold)`/
`var(--paper-2)` de verdad — ya no quedan hex hardcodeados en este
componente.

### Evidencia (TAL-23)

Verificado en navegador real (`npx next dev -p 3001`, dev-login), dos
veces — primero con los valores hex temporales, y de nuevo tras el
cambio a `var(--gold)`/`var(--paper-2)` reales (T3 ya había publicado la
migración de tokens): selector con las 5 categorías y 45 iconos exactos
del mockup; buscador filtrando por término en español (`"unicornio"` →
solo 🦄, en su categoría); selección visual correcta (borde dorado +
fondo `--paper-2` en el icono elegido, tanto en la rejilla como en la
vista previa de "Icono de portada"); icono elegido persiste al guardar
(confirmado también contra el dato real en Convex, `npx convex data
calendars --format jsonLines`, no solo la UI) y se ve en la portada real
de invitado (`/c/[calendarId]`, "🦄 ¡Feliz cuenta atrás, equipo!");
editar un calendario existente para cambiar el icono, confirmado que el
valor nuevo persiste tras recargar.

`npx next build`/`npx eslint .` limpios (ambas rondas); `npx convex dev
--typecheck=enable` limpio; `AGENTS.md` intacto.

## Fuera de alcance de esta tarea

- "Días del calendario" e "Invitados" (secciones del mockup en la misma
  vista Admin) — TAL-6 y TAL-7 respectivamente, bloqueadas por TAL-5. No hay
  ni placeholder aquí a propósito.
- Subida real de la foto de portada (solo URL por ahora) — depende de que
  se decida el backend de almacenamiento (`docs/stack.md`).
- (TAL-23) El grid de días (TAL-21) y el catálogo de skins (TAL-22) —
  dominios de otras tareas en paralelo bajo el mismo Design System.
