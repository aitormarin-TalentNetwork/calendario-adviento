# Gestión de Días (TAL-6, reconectada sobre Convex en TAL-13)

## Qué hace

Dentro de `/admin/[calendarId]` (protegida ya por TAL-5: solo Admin de ese
calendario o Super Admin), una sección "Días del calendario" con una
rejilla de fechas entre `startDate` y `endDate` (ambas incluidas) y un
panel de edición (vídeo + mensaje opcional) para la fecha seleccionada.
Lógica en `src/app/admin/[calendarId]/days-actions.ts`; UI en
`src/app/admin/[calendarId]/days-section.tsx` (server component: calcula
las fechas, aplica el límite de la ronda 1) y
`src/app/admin/[calendarId]/days-grid-editor.tsx` (client component: la
rejilla + el panel de la fecha seleccionada, ronda 2).

## Decisiones de alcance

- **Solo link externo, no subida de archivo real — decisión de producto,
  cerrada.** Arrancó como decisión técnica de esta terminal (el brief
  invitaba a decidirlo, y `docs/stack.md` no tenía cerrado qué backend de
  almacenamiento usar para subidas — Railway volume, S3-compatible...). En
  la ronda 2 el PM aclaró que el PRD sí pide ambos modos para el MVP, pero
  como implica elegir un servicio de almacenamiento lo trasladó a Aitor
  antes de confirmar. **Decisión final de Aitor**: solo link externo para
  esta onda — la subida de archivo real queda para una tarea/onda
  posterior, cuando se decida el backend de almacenamiento. El campo
  `videoUrl` del schema (TAL-3) ya vale igual para un enlace externo que
  para la ruta de un archivo subido, así que esa tarea futura no necesita
  tocar el modelo de datos, solo añadir la UI/acción de subida.
- **Rejilla + panel de edición, como el mockup** (ronda 2, a petición del
  PM): la ronda 1 simplificaba esto a una lista de formularios siempre
  visibles, uno por fecha, para evitar estado de cliente. El PM pidió
  acercarse al mockup — ahora hay un componente cliente
  (`days-grid-editor.tsx`) con una rejilla de celdas (una por fecha,
  resaltada si ya tiene vídeo) y, debajo, un único formulario montado a la
  vez para la fecha seleccionada. Efecto colateral bueno: al montar un
  solo formulario en vez de uno por fecha, reduce el trabajo de render por
  petición — parte de la respuesta al hallazgo de DoS de la ronda 1 (ver
  más abajo).
- **Un día = una fecha, no un número "Día N"**: se itera `startDate` a
  `endDate` construyendo cada fecha real, no un contador 1..24 — así
  encaja exactamente con lo que `Day.date` puede guardar (`@db.Date`,
  único por `(calendarId, date)`, TAL-3) y con cualquier rango de fechas
  que el Admin haya puesto (no todos los calendarios tienen por qué ser de
  24 días).
- **Sin `Day` = sin vídeo asignado**: sencillamente no existe fila. No hace
  falta un campo de "vacío"/estado — "Quitar vídeo" borra la fila entera
  (con manejo de reenvío/doble clic vía P2025, mismo patrón que
  `deleteCalendarAction` de TAL-5); "Guardar día" hace upsert por
  `(calendarId, date)`.
- **Validación de URL del vídeo**: mismo criterio que `coverImageUrl` en
  `src/app/admin/actions.ts` (TAL-5) — solo `https:`, para no aceptar
  `javascript:`/`data:`/etc. Sin comprobación HTTP de que la URL sirve un
  vídeo de verdad (evita abrir un vector de SSRF a cambio de una
  validación no determinante). Probado en vivo: una URL `javascript:...`
  se rechaza en servidor y no llega a crear ninguna fila `Day`.
- **`requireCalendarAdmin` duplicado, no importado**: la misma
  comprobación ya existe en `src/app/admin/actions.ts` (TAL-5), pero ese
  fichero lo está tocando T2 en paralelo para TAL-7 — duplicar 6 líneas es
  más barato que arriesgar un conflicto de fichero compartido entre dos
  terminales a la vez. Candidato a extraer a un helper común
  (`src/lib/auth-guards.ts` o similar) si aparece un tercer sitio que lo
  necesite.

## Correcciones de la ronda 2 (hallazgos de auditoría)

- **Límite de duración gestionable (`MAX_MANAGEABLE_DAYS = 366`,
  `days-section.tsx`)**: nada en el CRUD de calendario (TAL-5) impide un
  rango de fechas de años o siglos. Sin límite, esta sección generaría un
  día por cada fecha del rango en cada render — memoria/CPU sin cota con
  una sola petición autenticada (DoS). Por encima del límite se muestra un
  aviso pidiendo acortar el rango, en vez de intentar renderizar la
  rejilla. 366 cubre cualquier calendario real con margen (incluido uno
  que abarque un año entero). No se tocó `src/app/admin/actions.ts`
  (TAL-5, de T2) para añadir el límite también ahí — la corrección de
  fondo (impedir guardar un rango tan largo desde el CRUD) le corresponde
  a esa tarea, no a esta; aquí solo se blinda esta sección para que un
  rango así no la tumbe.
- **Guardar un día es atómico con la comprobación de rango
  (`saveDayAction`)**: antes se leía el rango del calendario y, aparte, se
  hacía el upsert del `Day` — ventana entre medias en la que
  `updateCalendarAction` (TAL-5) podía reducir el rango del calendario, y
  el `Day` quedaba guardado fuera del rango nuevo (oculto en la rejilla,
  pero reapareciendo si el rango se ampliaba después). Ahora todo va en
  una única `prisma.$transaction` con `SELECT ... FOR UPDATE` sobre la
  fila del `Calendar` — bloquea esa fila hasta que termina la transacción,
  así que un `calendar.update()` concurrente sobre el mismo calendario
  espera en vez de intercalarse.
  **Corrección de la ronda 3**: ese `FOR UPDATE` solo serializa frente a
  OTRO `saveDayAction` concurrente — no impide que, una vez liberado el
  lock, alguien llame a `updateCalendarAction` y reduzca el rango sin
  comprobar los días ya guardados (el mismo problema, en otro orden:
  guardar-y-luego-reducir en vez de reducir-a-mitad-de-guardar). En vez de
  meter `updateCalendarAction` (`src/app/admin/actions.ts`, TAL-5, en
  manos de T2 en paralelo) en el mismo protocolo de aplicación, la
  invariante "todo `Day` está dentro del rango de su `Calendar`" se hace
  cumplir a nivel de base de datos: un trigger `BEFORE UPDATE ON
  "Calendar"` (migración
  `20260816040000_calendar_range_day_guard`) que rechaza cualquier cambio
  de `startDate`/`endDate` que dejaría algún `Day` existente fuera del
  rango nuevo — venga de `saveDayAction`, de `updateCalendarAction`, o de
  cualquier otro código futuro que actualice `Calendar` directamente. Más
  fuerte que un acuerdo entre trozos de aplicación (no depende de que cada
  sitio que toque `Calendar` recuerde comprobar los días), y no necesita
  coordinación entre terminales para seguir siendo correcto según crezca
  el código. Probado con el Prisma Client real: guardar un día, y luego
  llamar a `prisma.calendar.update()` (la misma llamada que hace
  `updateCalendarAction`) reduciendo el rango para dejarlo fuera → el
  `UPDATE` es rechazado por Postgres (`P0001`) y el rango del calendario
  queda sin tocar.
- **`formNoValidate` en "Quitar vídeo"**: al compartir el mismo `<form>`
  que "Guardar día", el `required`/`type="url"` del campo de vídeo
  bloqueaba el envío del formulario aunque se pulsara "Quitar vídeo" si
  ese campo estaba vacío o no era una URL válida en ese momento — borrar
  no depende de que el campo tenga un valor válido. Probado en vivo:
  vaciar el campo de vídeo y pulsar "Quitar vídeo" sigue borrando la fila.
- **Límites de longitud** (`MAX_VIDEO_URL_LENGTH`/`MAX_MESSAGE_LENGTH`,
  2000 caracteres cada uno, en `days-actions.ts`, más `maxLength` en los
  inputs como ayuda de UI): defensivo, no de producto — nadie necesita más
  para un vídeo-regalo del calendario.

## Coordinación con T2 (TAL-7, en paralelo)

Mismo dominio de página (`src/app/admin/[calendarId]/page.tsx`, ambas
tareas añaden una sección ahí — "Días" y "Invitados" en el mockup), pero
dominios de datos distintos (`Day` vs `Invitation`). Acordado por mensaje
directo antes de implementar: cada terminal en su propio
`*-section.tsx`/`*-actions.ts` (`days-section.tsx`/`days-actions.ts` aquí,
`guests-section.tsx`/`guests-actions.ts` en T2), y en `page.tsx` cada una
añade solo su import + su línea de JSX, en huecos distintos (Días antes
que Invitados, mismo orden que el mockup) — pensado para que el merge de
quien llegue segunda a publicar sea un conflicto textual trivial (líneas
de import/JSX adyacentes), no de diseño.

## Gotcha de sesión (heredado de TAL-4, reproducido también aquí)

Mismo problema de colisión de cookies de next-auth entre dev servers en
`localhost` documentado en `docs/superadmin.md` — coordinado con T2 por
mensaje directo antes de cada sesión de pruebas en el navegador.

## Reconexión sobre Convex (TAL-13)

TAL-10 retiró Prisma/Postgres de la infraestructura y dejó
`saveDayAction`/`deleteDayAction`/`DaysSection` lanzando
`DataLayerUnavailableError` en vez de fingir un guardado o una rejilla
vacía (hallazgo de auditoría, TAL-10 ronda 1). TAL-13 los reconecta contra
Convex. Traducción, sección por sección de este documento:

- **"Un día = una fecha, no un número 'Día N'"**, **"Sin `Day` = sin vídeo
  asignado"**, **"Validación de URL del vídeo"**, **"Límites de
  longitud"**: sin cambios de comportamiento — mismas reglas, ahora
  aplicadas dos veces (Next.js, como siempre; y también dentro de
  `convex/days.ts::upsertDayHandler`, defensa en profundidad — el secreto
  compartido de TAL-11 prueba "esta llamada viene de nuestro servidor", no
  "nuestro servidor validó todo correctamente", son cosas distintas, ver
  `docs/convex-auth-investigacion-tal11.md`).
- **"Guardar un día es atómico con la comprobación de rango" y el trigger
  `BEFORE UPDATE ON "Calendar"` de la ronda 3**: Convex no tiene triggers
  de base de datos ni `SELECT ... FOR UPDATE`. La comprobación de rango
  vive ahora dentro de la propia mutation `upsertDay`
  (`convex/days.ts`) — lee el `Calendar` y compara `date` contra
  `[startDate, endDate]` en el mismo cuerpo transaccional que hace el
  upsert, sin necesitar ningún bloqueo explícito: una mutation de Convex
  ya corre con aislamiento serializable y reintento automático (ver
  `docs/convex-modelo-de-datos.md` § "Concurrencia"). El "trigger" que
  antes protegía la mitad de reducir el rango del calendario ahora vive en
  `updateCalendarRange` (`convex/calendars.ts`, TAL-9/TAL-12) — **la
  propia auditoría de TAL-9 ya verificó esto como CARRERA real entre las
  dos mutations** (`upsertDay` guardando justo cuando `updateCalendarRange`
  encoge el rango a la vez), no solo cada una por separado — 25
  repeticiones simultáneas, 0 violaciones de la invariante (detalle
  completo en `docs/convex-modelo-de-datos.md` § "Invariante de rango
  Calendar/Day"). TAL-13 no reabre esa verificación, solo confirma que
  sigue intacta tras extender `upsertDay` con las validaciones nuevas de
  esta ronda (ver "Evidencia" más abajo).
- **`P2025`/reenvío de borrado**: `deleteDayHandler` (`convex/days.ts`) es
  idempotente por construcción (si el día ya no existe, no hace nada) —
  no hace falta capturar ningún código de error específico de Prisma, era
  un detalle de ese conector, no una regla de producto.
- **Cascade de `DayView` al borrar un `Day`** (hueco nuevo, no existía en
  la versión Prisma como decisión explícita — `onDelete: Cascade` lo
  resolvía solo, sin que nadie tuviera que decidirlo): Convex no tiene
  cascade automático. **Decisión de producto de Aitor, cerrada** (ver
  brief de TAL-13, Linear): borrar un `Day` borra también las `DayView`
  asociadas — mismo comportamiento final que tenía Prisma, ahora explícito
  en `deleteDayHandler` en vez de implícito en el schema.
  **Corrección de la ronda 1 de auditoría**: la primera versión cargaba
  TODAS las `dayViews` de un día con `.collect()` y las borraba una a una
  en la MISMA transacción que el propio `Day` — sin ninguna cota. Convex
  limita cada transacción a 32.000 documentos escaneados, 16.000
  escritos, 16 MiB y 1 segundo
  (https://docs.convex.dev/production/state/limits); un día con
  suficientes vistas podía exceder ese límite y quedar sin poder borrarse
  NUNCA (la mutation entera se revierte si excede el límite — ni el `Day`
  ni sus `dayViews` se borrarían). Se descartó cerrar esto con un límite
  de producto nuevo (p. ej. "máximo N invitados por calendario") porque no
  existe ninguno hoy y añadir uno solo para esquivar un límite técnico de
  la plataforma sería una decisión de producto que no le corresponde a
  esta tarea (el alcance/producto lo decide el PM). En su lugar: el `Day`
  se borra de inmediato (el calendario deja de mostrarlo ya mismo), y la
  limpieza de sus `dayViews` se reprograma en segundo plano por lotes de
  200 (`convex/dayViews.ts::cleanupDayViewsBatch`, reprogramándose a sí
  misma vía `ctx.scheduler.runAfter` mientras queden más) — nunca depende
  de que quepan todas en una sola transacción. Verificado contra el
  deployment real con 210 `dayViews` en un mismo día (por encima del lote
  de 200, para forzar al menos una reprogramación) — tras `deleteDayPublic`,
  tanto `days` como `dayViews` quedan en 0 documentos (detalle en
  "Evidencia").
- **`MAX_MANAGEABLE_DAYS` (366)**: sigue siendo un límite de renderizado
  en Next.js (`days-section.tsx`), sin cambios — nunca vivió en la capa de
  datos, ni en Prisma ni ahora en Convex. Queda anotado (no resuelto por
  esta tarea, es dominio de TAL-12) que tampoco hay ninguna comprobación
  de este límite del lado de escritura (`updateCalendarRange`) — ver
  `docs/convex-diseno-tal13-gestion-dias.md` para el razonamiento
  completo.
- **Fechas como string, no `Date`**: `days-actions.ts` manda el string
  `"YYYY-MM-DD"` ya validado por `parseUtcDateOnly` directamente a Convex
  (no el `Date` que esa función devuelve) — Convex guarda fechas como día
  natural en ese formato (`docs/convex-modelo-de-datos.md` § "Fechas como
  día natural"). `days-section.tsx` hace el camino inverso al leer
  (`requireDate`, un `parseUtcDateOnly` que lanza si alguna vez recibiera
  un formato inválido de Convex — no debería poder pasar, `Convex/dates.ts`
  ya lo garantiza al guardar, pero se trata como el fallo real que sería
  si pasara, no como "sección no disponible").

## Evidencia (TAL-13)

**Cambio de plan respecto a lo previsto**: durante esta tarea, T1 (TAL-12)
desplegó por accidente su `schema.ts` local (sin un índice nuevo de T3,
TAL-16) contra el deployment de desarrollo COMPARTIDO
(`beloved-barracuda-617.convex.cloud`), borrando ese índice —
`npx convex dev`/`deploy` sincroniza el schema del deployment al estado
EXACTO del `schema.ts` local de quien despliega, no de forma aditiva. Con
tres ramas de schema en vuelo a la vez (TAL-12/13/16), cualquiera de las
tres corría el mismo riesgo. Decisión de la Directora: cada terminal
provisiona su propio deployment de desarrollo mientras las tres ramas no
estén mergeadas (patrón normal de Convex, no una solución de emergencia).
Esta tarea se verificó contra un deployment propio y aislado,
`wandering-goose-523.convex.cloud` (proyecto `calendario-adviento-t2`,
mismo team `aitor-marin-6a254`) — mismo schema/funciones que recibiría el
deployment compartido al fusionar, sin ningún riesgo de pisar a T1/T3
mientras tanto.

Verificado con un cliente externo real (`ConvexHttpClient`, el mismo
mecanismo de base que usa `fetchMutation`/`fetchQuery` de `convex/nextjs`
— no `npx convex run`, que usa el canal de administrador de la CLI, no el
público):

1. **Guardar un día válido dentro de rango** (`upsertDayPublic`) → éxito,
   `_id` devuelto.
2. **Fecha fuera de rango** → rechazado por el servidor (mismo mensaje que
   ya verificó TAL-9 para esta invariante — no reabierta, solo confirmada
   tras extender la función).
3. **Esquema no-https** (`javascript:alert(1)`) → rechazado (validación
   nueva de esta tarea).
4. **URL de más de 2000 caracteres** → rechazado (validación nueva).
5. **Mensaje de más de 2000 caracteres** → rechazado (validación nueva).
6. **Secreto de servidor incorrecto** → rechazado por
   `requireServerSecret` (TAL-11) — confirma que la frontera pública sigue
   exigiéndolo también en las funciones nuevas de esta tarea.
7. **Listar días de un calendario** (`getCalendarDaysPublic`) → devuelve
   exactamente el día guardado, con el rango del calendario.
8. **Actualizar el mismo día** (mismo `date`, distinto `videoUrl`) →
   sigue habiendo un solo día (upsert, no fila duplicada).
9. **Borrar un día que no existe** (`deleteDayPublic`) → no lanza,
   idempotente.
10. **Borrar un día real** → desaparece de la consulta posterior.
11. **Cascade de `dayViews` al borrar un `Day`** (decisión de producto
    cerrada, ver arriba): se creó un `Day`, se marcó como visto por un
    usuario real (`dayViews:markViewed`, vía CLI), se confirmó la fila con
    `npx convex data dayViews` — y tras `deleteDayPublic` sobre ese mismo
    día, tanto `days` como `dayViews` quedaron vacíos (`npx convex data
    dayViews`/`days`, 0 documentos). Confirma también, de paso, que la
    consulta `by_day_and_user` filtrada solo por `dayId` (sin fijar
    `userId`) funciona como prefijo de índice válido contra el deployment
    real — quedaba señalado como "a confirmar" en
    `docs/convex-diseno-tal16-gestion-invitados.md` para un índice
    análogo, ya confirmado aquí.
12. **Borrado por lotes a volumen real, por encima de un lote**
    (corrección de auditoría, ronda 1): con una mutation interna temporal
    de solo pruebas (borrada tras verificar), se sembraron 210 `dayViews`
    reales sobre un mismo `Day` (por encima del lote de 200 de
    `cleanupDayViewsBatch`, para forzar al menos una reprogramación vía
    `ctx.scheduler.runAfter`) → tras `deleteDayPublic`, tanto `days` como
    `dayViews` quedaron en 0 documentos — confirma que la reprogramación
    recursiva completa el borrado hasta el final, no solo el primer lote.
    También confirma, de paso, que referenciar
    `internal.dayViews.cleanupDayViewsBatch` desde DENTRO del propio
    `dayViews.ts` (auto-reprogramación) no dispara el problema de
    referencia circular de tipos que sí afecta a `ctx.runMutation` desde
    el mismo fichero (ver comentarios de `convex/users.ts`/`access.ts`,
    TAL-11) — `npx convex dev --typecheck=enable` compiló limpio con este
    patrón.

**Regresión de extremo a extremo, con la limitación real que tiene hoy**:
dev-login real (`AUTH_DEV_LOGIN=true`) contra el servidor Next.js real
(`npx next dev -p 3001`, apuntando al mismo deployment aislado vía
`.env.local`), sesión real, membership ADMIN real concedida sobre el
calendario de prueba (`calendarMemberships:addMembership`, vía CLI) →
`GET /admin/{calendarId}` responde `200` (no redirige a `/login` ni a
`/unauthorized`), confirmando que la cadena de autorización completa
(`getAuthorizedUser`/`resolveCalendarAccess`, TAL-11) reconoce
correctamente esa membership contra el deployment aislado. **No se pudo
probar `DaysSection`/`saveDayAction`/`deleteDayAction` a través de la
página real**: `AdminCalendarPage` (`page.tsx`) todavía depende de
`getCalendarForAdminPage`, que sigue lanzando `DataLayerUnavailableError`
(dominio de TAL-12, en curso en paralelo) — la página corta ahí mismo con
"Este calendario no está disponible ahora mismo" antes de llegar a
montar `DaysSection`. No es una limitación de esta verificación: es que
la página completa depende de una pieza que todavía no está — la
regresión de extremo a extremo real de `DaysSection` a través de la UI
queda pendiente de que TAL-12 conecte el resto de la página, momento en
el que valdría la pena repetirla.

`npx next build`/`npx eslint .` limpios; `AGENTS.md` intacto tras varios
arranques de `next dev`.

**Hallazgo incidental, no específico de esta tarea**: el proyecto no
tenía `convex/tsconfig.json` (nunca se generó/committeó desde TAL-9, que
se conectó a un proyecto YA existente en vez de crear uno nuevo) — sin él,
`npx convex dev`/`deploy` **salta en silencio** el typecheck propio de
Convex (mensaje: "Found no convex/tsconfig.json..., so skipping
typecheck"), en cualquier terminal, para cualquier tarea, no solo esta.
`npx next build`/`tsc` de la raíz sí cubre `convex/*.ts` (está dentro de
`include` en `tsconfig.json`), pero con las opciones del compilador de
Next.js, no las que Convex espera para su propio runtime (`target`,
`lib`, `module`, etc. — ver el fichero generado). Añadido aquí
(`convex/tsconfig.json`, generado con `npx convex codegen --init`,
estándar de Convex, no modificado a mano) porque hacía falta para que MI
propia verificación con `--typecheck=enable` fuera real y no un
"skipping" silencioso — es un fichero de configuración puramente
aditivo, no toca lógica de ningún dominio, así que no debería chocar con
TAL-12/TAL-16 en paralelo.

Scripts de prueba no comprometidos al repo (mismo criterio que el resto
del proyecto — sin test runner elegido todavía); los resultados quedan
documentados aquí.

## Experiencia del Invitado sobre Convex (TAL-14)

`src/lib/guest-calendar.ts` (`resolveDoors`/`markDayViewed`, TAL-8) y
`src/app/c/[calendarId]/page.tsx` (`getCalendarForGuestPage`) — TAL-10 los
dejó lanzando `DataLayerUnavailableError` (sin BD real detrás). TAL-14 los
reconecta contra Convex, con la frontera pública de secreto compartido de
TAL-11 (`convex/serverAuth.ts`).

### Lecturas vs. escrituras — mismo criterio ya establecido en TAL-12/16

**Lectura** (`resolveDoors` → `convex/guestCalendar.ts::resolveCalendarDaysForGuestPublic`,
nueva): calendario+días+estado de visto de un usuario, en una consulta.
Vive en fichero propio, no en `days.ts`/`dayViews.ts` (dominio de TAL-13,
T2) — solo lee esas tablas vía `ctx.db`, mismo criterio que
`calendars.ts::assertNoDayOutsideRange` ya lee `days` sin tocar
`days.ts`. No resuelve autorización dentro (a diferencia de la escritura
de abajo): quien llama (`getDoorsAction`/`page.tsx`) ya comprobó
`resolveCalendarAccess` (TAL-11) antes — una lectura no tiene la ventana
de carrera que sí tiene una escritura, mismo criterio ya confirmado por
el auditor en TAL-12 (`calendars.getPublic`).

**Escritura** (`markDayViewed` → `convex/dayViews.ts::markDayViewedAsUserPublic`,
nueva): resuelve autorización + validez del día (pertenece al calendario,
está desbloqueado) + marcar-como-visto en UNA sola mutation. Antes de
esta tarea, `markDayViewedAction` comprobaba `resolveCalendarAccess` por
su cuenta ANTES de llamar a `markDayViewed` — exactamente el patrón que
costó varias rondas de auditoría en TAL-12/TAL-16 (comprobar y actuar en
llamadas Convex independientes deja una ventana de carrera real). Nunca
llegó a exportarse así — se detectó el riesgo al diseñar esta tarea, antes
de la primera ronda de auditoría, aplicando la lección directamente.
`isSuperAdmin` se relee del documento `users` dentro de la mutation
(nunca como argumento); para el resto de casos, delega en
`access.resolveMemberAccess` (TAL-11, `ctx.runMutation` — llamada entre
ficheros, no la referencia circular que crearía delegar dentro del mismo
fichero) — incluye la aceptación de invitación pendiente, sin duplicar
esa lógica aquí.

### Zona horaria real del cliente — preservada, no relajada

`todayDate` (el "hoy" contra el que se compara `Day.date` para
bloqueado/desbloqueado) se sigue calculando en Next.js con
`todayInTimeZone` a partir de la zona horaria REAL del navegador (cookie
`tz`, o resuelta en cliente por `DoorGridLoader` en la primerísima visita
— hallazgo de auditoría, TAL-8 ronda 2, sigue intacto: nunca se resuelve
ninguna puerta con un valor por defecto tipo UTC antes de conocer la zona
horaria real). Se manda a Convex como un string `"YYYY-MM-DD"` ya
resuelto — un dato, no una conclusión de autorización, así que pasarlo
como argumento no es el mismo tipo de problema que pasar `isSuperAdmin`
(TAL-12 ronda 3): la mutation igual revalida su formato
(`assertValidCalendarDate`) y lo usa solo para comparar contra
`Day.date`, nunca para decidir quién es quién.

### Verificado contra el deployment real (dev, compartido, con cerrojo)

Bajo nivel (`ConvexHttpClient`/`npx convex run`, script temporal borrado
tras la verificación):
- `resolveDoors`: estados correctos (`locked`/`unseen`/`watched`) con
  datos reales, `dayId` presente solo en días desbloqueados.
- Invitado con invitación pendiente (sin membership todavía) SÍ puede
  marcar un día desbloqueado como visto — confirma que
  `access.resolveMemberAccess` (con aceptación de invitación) se invoca
  de verdad dentro de la mutation.
- Día todavía bloqueado (fecha futura respecto a `todayDate`) → `"locked"`,
  no marca nada.
- Stranger sin invitación ni membership, con un `dayId` real conocido →
  `"unauthorized"`, no marca nada.
- `dayId` de OTRO calendario → `"not-found"` (integridad referencial).
- Concurrencia real (6 llamadas `npx convex run` simultáneas, procesos de
  sistema operativo separados, mismo rigor que TAL-9/TAL-12): las 6
  devuelven `"marked"`, una sola fila de `dayViews` para (día, usuario) —
  idempotente de extremo a extremo, no solo en la mutation aislada
  (requisito explícito del brief de esta tarea).

HTTP real (servidor de desarrollo, login de invitado real vía invitación,
cookie `tz` real):
- Primera visita sin cookie `tz` → `"Cargando calendario…"` (vía
  `DoorGridLoader`, protección de TAL-8 ronda 2 intacta).
- Con cookie `tz` → rejilla resuelta en servidor con datos reales: el día
  con vídeo asignado en el pasado aparece `unseen` con su `dayId`; hoy
  aparece `isToday:true`, desbloqueado, sin vídeo (sigue "abierto" aunque
  el Admin no le asignara nada); los días futuros aparecen `locked`.
- Un stranger sin invitación que visita `/c/{calendarId}` → redirige a
  `/unauthorized` (307).
- Un `calendarId` con forma inválida → 500 (mismo comportamiento ya
  aceptado en TAL-12 para `admin/[calendarId]/page.tsx` con el mismo
  patrón — el validador de argumentos de Convex rechaza antes de llegar a
  ningún dato, un fallo genuino, no una mentira).

Scripts de prueba no comprometidos al repo (mismo criterio que el resto
del proyecto); los resultados quedan documentados aquí.
