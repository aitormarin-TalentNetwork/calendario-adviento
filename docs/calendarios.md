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

Sin formulario de creación aparte — se crea con valores de partida y se
edita todo después, igual que sugiere el mockup (botón "+ Nuevo calendario"
sin diálogo intermedio):

- Fechas: 1–24 de diciembre del próximo diciembre que llegue
  (`defaultCalendarDateRange` — si ya se pasó el 24 de diciembre de este
  año, usa el año siguiente).
- Skin: `pine` (coincide con el comentario "skin por defecto" de
  `prisma/seed.ts`); si por lo que sea no existe, cae al primero que haya en
  vez de bloquear la creación. **TAL-12**: esta resolución vive ahora dentro
  de Convex (`resolveDefaultSkinId`, `convex/calendars.ts`) — la Server
  Action de creación no manda ningún `skinId`, igual que antes con Prisma.

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

## Fuera de alcance de esta tarea

- "Días del calendario" e "Invitados" (secciones del mockup en la misma
  vista Admin) — TAL-6 y TAL-7 respectivamente, bloqueadas por TAL-5. No hay
  ni placeholder aquí a propósito.
- Subida real de la foto de portada (solo URL por ahora) — depende de que
  se decida el backend de almacenamiento (`docs/stack.md`).
