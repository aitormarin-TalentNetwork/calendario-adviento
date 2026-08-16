# Gestión de invitados (TAL-7)

> **Nota TAL-16**: este documento describe el diseño original sobre
> Prisma/Postgres (TAL-7), que sigue siendo la razón de fondo de cada regla
> ("por qué borra las dos filas", "por qué el efecto global exige
> pertenencia real", etc.) — solo cambió el almacén de datos que las
> implementa. Ver la sección nueva "Gestión de invitados sobre Convex
> (TAL-16)" al final para el diseño y la evidencia actuales; el resto del
> documento queda como referencia histórica del razonamiento.

## Qué es un "invitado" en este modelo

No hay una tabla propia de "invitado" — es la unión de dos fuentes, ya
existentes desde TAL-3/TAL-2 (ver `docs/modelo-de-datos.md`):

- `Invitation(calendarId, email)`: la persona fue invitada, todavía no ha
  entrado con Gmail.
- `CalendarMembership(calendarId, userId, role: GUEST)`: ya entró y se le
  resolvió el acceso (`src/lib/roles.ts::resolveCalendarAccess`, TAL-2).

`src/lib/guests.ts::listCalendarGuests` calcula la tabla que ve el Admin
juntando las dos por email: si hay membership GUEST, el estado es "Ha
entrado"; si solo hay Invitation, "Invitado". Se excluyen explícitamente los
emails que ya son `ADMIN` de este calendario — puede quedar una Invitation
suya de antes de que se le diera Admin (ver `removeAdminEverywhere` en
`src/lib/superadmin.ts`, TAL-4), pero mostrarlo en la tabla de invitados
sería confuso.

## "Quitar del calendario" borra las DOS filas, no solo la membership

Si solo se borrara la `CalendarMembership`, la `Invitation` que queda
volvería a resolver el acceso sola la próxima vez que esa persona visite
`/c/<calendarId>` (es justo el mecanismo que TAL-2 construyó a propósito) —
la "expulsión" quedaría deshecha en el siguiente login sin que nadie lo
pidiera. `removeGuestFromCalendar` borra Invitation y CalendarMembership(GUEST)
de ese calendario en la misma transacción. Probado en vivo: quitar a alguien,
comprobar que ambas filas desaparecen, y que esa persona ya no puede volver
a entrar (login + visita a `/c/<calendarId>` → `/unauthorized`).

## "Borrar por completo" es deliberadamente global

El brief de TAL-7 lo especifica así explícitamente ("borrar por completo
afecta a todas las relaciones del usuario en todos sus calendarios"), no es
una inferencia de esta terminal. `removeGuestEverywhere` borra todas las
`Invitation` de ese email (cualquier calendario) y todas sus
`CalendarMembership` con `role: GUEST` (cualquier calendario) — aunque el
Admin que dispara la acción solo administre el calendario desde cuya tabla
se llamó. La autorización se sigue comprobando sobre ESE calendario (tiene
que ser Admin de al menos uno de sus calendarios para llegar a la tabla),
no sobre todos los que se ven afectados — así lo pide el brief.

Deliberadamente NO toca:
- Membership con `role: ADMIN` en ningún calendario — esto es gestión de
  invitados, no de Admins (eso es TAL-4, `src/lib/superadmin.ts`).
- El `User` en sí — es la identidad de la persona, no algo que esta pantalla
  deba poder borrar; sin `User`, perdería también cualquier rol Admin que
  tuviera en otros calendarios sin que nadie lo pidiera explícitamente.

Probado: mismo email invitado a dos calendarios distintos del mismo Admin →
"Borrar por completo" desde uno de ellos → verificado en BD que desapareció
de los dos.

### El efecto global exige que el objetivo sea de verdad invitado del calendario autorizado (corrección de auditoría, ronda 1)

La ronda 1 comprobaba que quien llama administra `calendarId`, pero no que
`email` tuviera ninguna relación con ESE calendario — ambos parámetros
llegan del cliente (`removeGuestEverywhereAction(calendarId, email)`). Un
Admin de cualquier calendario propio podía invocar la action con el email de
alguien que conociera de cualquier otro sitio y borrarlo por completo de
calendarios ajenos que no administra — el "efecto global" del hallazgo
anterior, sin el permiso que se supone que lo acota.

Corrección: `isCalendarGuest(calendarId, email)` (`src/lib/guests.ts`)
comprueba que ese email es de verdad invitado (o ya GUEST) del calendario
que se acaba de verificar que administra quien llama, antes de disparar el
borrado global — si no lo es, `/unauthorized`. Super Admin queda exceptuado
a propósito: ya tiene autoridad global sobre cualquier calendario (mismo
criterio que el resto de rutas protegidas desde TAL-2), exigirle además una
relación previa con este calendario en particular no aportaría nada.

Verificado con `isCalendarGuest` directamente (no fue posible reproducir el
ataque disparando una petición HTTP real forjada a mano: el protocolo de
Server Actions de Next.js serializa los argumentos ligados con `.bind()`
dentro de una referencia de acción, no como campos de formulario sueltos —
reproducirlo a mano habría exigido invertir ese formato interno, un coste
desproporcionado frente a probar el primitivo de autorización en sí):
un email invitado al calendario A da `true` en A y `false` en B; un email no
invitado en ningún sitio da `false`. El cableado en
`removeGuestEverywhereAction` (cinco líneas de control de flujo trivial) se
verificó también por revisión de código. El caso legítimo (mismo email
invitado a dos calendarios del mismo Admin, "Borrar por completo" desde
cualquiera de los dos) se probó de extremo a extremo en navegador y sigue
funcionando igual que en la ronda 1.

## Invitar: idempotente, sin re-enviar nada especial

`inviteGuest` hace `upsert` sobre `Invitation` (única por `(calendarId,
email)`) — invitar dos veces al mismo email al mismo calendario no es un
error, es un no-op. Validación de email: mismo patrón que TAL-4
(`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), duplicado en vez de importado — son
módulos de features distintas desarrolladas en paralelo (T1/TAL-6 en el
mismo directorio al mismo tiempo), no vale la pena acoplarlos por una
línea de regex.

## Expulsión frente a aceptación concurrente (corrección de auditoría, ronda 1)

La ronda 1 borraba `Invitation` y `CalendarMembership` en su propia
transacción, y `resolveCalendarAccess` (TAL-2) leía la invitación y creaba
la membership en la suya — bajo el aislamiento por defecto de Postgres
(READ COMMITTED), las dos transacciones podían entrelazarse: si
`resolveCalendarAccess` leía la `Invitation` justo antes de que el borrado
la eliminara, y creaba la `CalendarMembership` justo después de que el
borrado ya hubiera pasado por ahí, la persona expulsada se quedaba con
acceso — la expulsión quedaba anulada por una aceptación que llegó a mitad.

Corrección: tanto `resolveCalendarAccess` (`src/lib/roles.ts`) como
`removeGuestFromCalendar`/`removeGuestEverywhere` (`src/lib/guests.ts`)
corren ahora en transacciones con aislamiento **SERIALIZABLE**, envueltas
con reintento (`src/lib/db-retry.ts::withSerializableRetry`). Con
SERIALIZABLE, Postgres garantiza que el resultado final es equivalente a
algún orden serie de las dos transacciones — y en CUALQUIER orden serie
posible, el resultado es correcto: expulsión-primero deja a la persona sin
invitación ni membership; aceptación-primero crea la membership pero la
expulsión que llega después se la lleva igual. Lo que SERIALIZABLE evita es
justo el entrelazado que no corresponde a ningún orden serie válido —
Postgres aborta una de las dos transacciones en conflicto (SQLSTATE 40001)
y `withSerializableRetry` la repite.

Detalle de implementación: con el conector `@prisma/adapter-pg` de Prisma 7,
este conflicto no llega como `Prisma.PrismaClientKnownRequestError` con
código P2034 (el mapeo "clásico" de Prisma) — llega como `DriverAdapterError`
con el SQLSTATE real (`40001`) en `err.cause.originalCode`. Se comprueban
las dos formas en `isSerializationFailure` (ver `src/lib/db-retry.ts`) — la
clásica por si acaso, y la del driver adapter actual, que es la que de
verdad se dispara hoy (comprobado disparando la condición de carrera real
antes de arreglar la detección: el conflicto SÍ saltaba, pero el `catch`
no lo reconocía y lo dejaba propagarse sin reintentar).

**Probado con concurrencia real**, no solo argumentado — `Promise.all`
disparando "quitar del calendario" y "aceptar invitación" a la vez, sin
ningún `await` entre medias, repetido 15 veces con datos frescos en cada
intento:
- Con la corrección: 0/15 casos con la persona expulsada conservando acceso.
- **Control negativo** (misma prueba, pero con la lógica tal como estaba en
  la ronda 1 — sin SERIALIZABLE, sin transacción conjunta): 1/15 casos
  explotados, confirmando que el arnés de prueba detecta el fallo real
  cuando no está corregido, no que da "OK" pase lo que pase. Las
  condiciones de carrera dependen del *timing* exacto, así que no se
  reproducen en el 100% de los intentos incluso sin la corrección — de ahí
  repetir la prueba varias veces en vez de una sola.

### Releer dentro de una transacción ya abortada por P2002 (corrección de auditoría, ronda 2)

La ronda 2 metía la recuperación de `P2002` (dos aceptaciones concurrentes
de la MISMA invitación, ambas intentando crear la membership) dentro del
propio `tx`: si el `create` chocaba con el índice único, el `catch`
intentaba releer la fila ganadora con `findUniqueOrThrow` **en esa misma
transacción**. Postgres no lo permite: una violación de restricción deja la
transacción en estado abortado, y cualquier consulta posterior dentro de
ELLA falla con "current transaction is aborted" en vez de ejecutarse — la
"recuperación" en sí no podía funcionar nunca.

Corrección: se quita el `try/catch` de dentro de la transacción. Si el
`create` choca (con `P2002`, o con el conflicto de serialización que
Postgres puede levantar directamente sobre el propio `INSERT`), el error se
deja propagar tal cual — `withSerializableRetry` ahora también trata `P2002`
como reintentable (parámetro `alsoRetryOn`, ver `src/lib/db-retry.ts`) y
repite la transacción ENTERA desde cero. En el reintento, el `findUnique`
del principio ya encuentra la fila que ganó la carrera y sale por la vía
normal — no hace falta ningún caso especial de "recuperación" en absoluto.
`alsoRetryOn` es explícito y solo para este llamador a propósito: en otros
contextos un `P2002` inesperado sería un error real de la aplicación, no
una carrera benigna, y tragárselo siempre por defecto en el helper
compartido podría enmascararlo.

**Verificación honesta** — dos escenarios probados con concurrencia real
(dos llamadas a `resolveCalendarAccess` para la MISMA invitación, disparadas
con `Promise.all`, 20 y 30 repeticiones respectivamente):
- Con el código corregido de esta ronda: 0/20 fallos (ninguna promesa
  rechazada, ambas llamadas devuelven la misma membership GUEST, una sola
  fila en BD).
- Reproduciendo el patrón exacto de "releer dentro del mismo `tx`" de forma
  aislada (sin el `withSerializableRetry` exterior alrededor): sí falla,
  20/20 — confirma que ese patrón concreto es insostenible cuando se
  alcanza.
- Reproduciendo el código EXACTO de la ronda 2 (con su `withSerializableRetry`
  exterior ya existente, tal como corría en producción): **0/30 fallos**.
  En este entorno concreto (Postgres 16 + `@prisma/adapter-pg`), el
  conflicto de dos `INSERT` simultáneos sobre la misma fila bajo
  SERIALIZABLE se clasifica como conflicto de serialización (40001)
  directamente sobre el propio `create`, no como `P2002` — así que el
  `withSerializableRetry` que YA existía en la ronda 2 alcanzaba a
  reintender la transacción entera antes de que el código llegase a la
  rama de recuperación defectuosa. No se ha conseguido reproducir en este
  entorno el fallo exacto que describía el auditor (el `catch` de `P2002`
  disparándose y fallando al releer) — pero el razonamiento sobre el estado
  de la transacción es correcto y está documentado (el comportamiento de
  Postgres tras abortar una transacción no depende del timing, es
  determinista), así que la corrección se aplica igual: es la forma
  correcta de escribirlo según la semántica de Postgres, no algo que deba
  depender de qué tan a menudo se manifieste en pruebas.

## El "link de invitación" no lleva token — es el mismo para cualquiera

El acceso de un invitado se resuelve por **email**, no por un secreto en la
URL (así lo construyó TAL-2: `resolveCalendarAccess` mira si el email de la
sesión tiene una `Invitation` para ese calendario). Eso significa que no
hay "un link único por persona invitada" que generar — el link siempre es
`https://<host>/c/<calendarId>`, el mismo para todo el mundo. Invitar a
alguien es, en la práctica, dos pasos independientes: (1) añadir su email
a la lista de invitados de este calendario (lo que hace el formulario
"Invitar ahora"), y (2) que esa persona sepa la URL del calendario para
entrar — de ahí que la sección muestre el link de forma permanente (con un
botón de copiar, `src/components/copy-link-button.tsx`), no como algo que
"se genera" al invitar a alguien en concreto.

### No confiar en el header `Host` a secas (sugerencia de auditoría, ronda 1, no bloqueante)

La ronda 1 construía el origen del link directamente del header `Host` de la
petición. Si el proxy/plataforma delante de la app llegara a aceptar hosts
arbitrarios (una petición con un `Host` que no es el dominio real), la
página mostraría/copiaría un link hacia ESE dominio en vez del real — un
Admin podría acabar pegándole a un invitado un link que en realidad apunta a
un sitio controlado por un atacante.

Corrección: `resolveInvitationLink` (`src/lib/invitation-link.ts`, lógica
separada de `headers()`/`process.env` a propósito, para poder probarla sola)
prioriza una variable de entorno `APP_URL` (origen canónico, a configurar en
Railway) y solo cae al header `Host` si no está definida — y en ese caso,
únicamente si el host es reconociblemente `localhost`/`127.0.0.1`. Con
cualquier otro host y sin `APP_URL`, no se muestra ningún link (en vez de
uno potencialmente falso); el resto de la página no depende de esto.

Probado directamente sobre `resolveInvitationLink` (intentar reproducirlo
con una petición HTTP real con `Host` falsificado no fue posible: Auth.js
rechaza la sesión antes de llegar a esta página en cuanto el `Host` no
coincide con el de la cookie, lo cual es en sí una capa de protección extra,
pero impedía ejercitar este código concreto por esa vía):
`localhost:3001`/`127.0.0.1:3001` sin `APP_URL` → link normal;
`dominio-atacante.com` sin `APP_URL` → `null` (no se muestra link);
`dominio-atacante.com` CON `APP_URL` configurado → usa `APP_URL`, ignora el
host de la petición por completo.

## Envío real por email: pendiente, documentado en vez de fingido

El brief permite explícitamente empezar por "generar y mostrar/copiar el
link" si el envío real depende de un proveedor sin decidir — es el caso: no
hay proveedor de email elegido (`docs/stack.md` no lo cubre todavía). No se
ha simulado un "email enviado ✓" falso en ningún sitio — el botón "Copiar
link" hace justo lo que dice, y es responsabilidad del Admin pegar ese link
donde quiera (email personal, Slack…) hasta que se decida el envío
automático. Queda como pendiente explícito, no como algo ya resuelto a
medias.

## Autorización duplicada entre `admin/actions.ts` y `guests-actions.ts`

`requireCalendarAdmin` (comprobar que quien llama es Admin de ESTE
calendario o Super Admin) está duplicado literal entre
`src/app/admin/actions.ts` (TAL-5) y
`src/app/admin/[calendarId]/guests-actions.ts` (esta tarea) — no se ha
centralizado a propósito: TAL-6 (T1) está tocando el mismo directorio en
paralelo y una función compartida nueva habría sido un punto más de
posible colisión de merge sin necesidad real (son seis líneas idénticas,
no seis líneas con lógica que pueda divergir por error). Queda anotado
como refactor de seguimiento razonable una vez no haya trabajo concurrente
en esta zona del código, no como algo urgente.

## Fuera de alcance de esta tarea

- Envío real de invitación por email — depende de un proveedor sin decidir.
- Reenviar/recordar una invitación pendiente ("Invitado" desde hace tiempo)
  — no lo pide el brief; con el link permanente visible, el Admin puede
  reenviarlo manualmente cuando quiera sin que haga falta un botón aparte.
- Nota del auditor (ronda 2, no bloqueante): los scripts de la prueba de
  concurrencia no se comprometieron al repo (mismo criterio que TAL-2/
  TAL-5 — el proyecto no tiene test runner elegido todavía, y crear uno
  solo para esto no es una decisión que corresponda tomar unilateralmente
  dentro de una corrección de NO-GO). Los resultados numéricos sí quedan
  documentados aquí. Si el proyecto adopta un test runner más adelante,
  estos escenarios (doble aceptación concurrente, expulsión vs. aceptación)
  son buenos candidatos para convertirse en pruebas automatizadas
  permanentes.

## Gestión de invitados sobre Convex (TAL-16)

Migración del contenido de este documento a Convex — mismas reglas de
negocio de arriba (unión Invitation/CalendarMembership, borrado de las dos
filas al "quitar del calendario", efecto global de "borrar por completo"
acotado a pertenencia real), traducidas al modelo de TAL-9/TAL-11. Diseño
de partida en `docs/convex-diseno-tal16-gestion-invitados.md` (T2, pseudocódigo).

### Qué cambió respecto a Prisma

- **`convex/invitations.ts::inviteGuest`** (ya existente desde TAL-9,
  integridad referencial) se **extendió** con la validación de formato de
  email que le faltaba (`EMAIL_PATTERN`, mismo patrón que TAL-4/TAL-7) —
  antes solo la comprobaba `src/lib/guests.ts` del lado de Next.js; ahora
  también la mutation de Convex, como defensa en profundidad. No se creó
  una función paralela (a diferencia de la disyuntiva `addAdmin`/
  `addMembership` de TAL-15): es una adición de comprobación, no un cambio
  de comportamiento para quien ya la llama con un email bien formado.
- **`convex/guests.ts`** (nuevo): `isCalendarGuest`, `removeGuestFromCalendar`,
  `removeGuestEverywhere`, `listCalendarGuests` — equivalentes directos de
  las funciones del mismo nombre en la versión Prisma de este documento,
  mismo patrón de unión Invitation/CalendarMembership en código de
  aplicación (nunca un `include` relacional real, tampoco lo era en
  Prisma). Cada una con su envoltorio público delgado
  (`*Public`, secreto compartido de TAL-11, `convex/serverAuth.ts`).
- **Índice `by_email` en `invitations`** (`convex/schema.ts`): usado por
  `removeGuestEverywhere` para no hacer `collect()` + filtro en JS sobre
  toda la tabla — a diferencia de scans similares de esta serie
  (`listAdmins`, TAL-15), esta operación se dispara desde una acción de
  usuario frecuente del panel de invitados, no una operación rara de
  administración global, así que el diseño la marcó con más urgencia.
- **`src/lib/guests.ts`** reconectado contra Convex de verdad — ya no lanza
  `DataLayerUnavailableError` en ninguna de sus cinco funciones. Un fallo
  real de Convex en una escritura (`inviteGuest`, `removeGuestFromCalendar`,
  `removeGuestEverywhere`) se deja propagar tal cual, mismo criterio que
  el resto de escrituras de este proyecto. `listCalendarGuests` (lectura)
  se atrapa en el llamador (`guests-section.tsx`) y se degrada a "no
  disponible ahora mismo" — mismo criterio honesto que TAL-10 dejó
  establecido (no fingir `[]`), solo que ya no vía la clase
  `DataLayerUnavailableError` (esa quedó ligada a "Prisma retirado,
  pendiente de reescribir", que dejó de ser cierto para esta lectura).
  `isCalendarGuest` sigue fallando cerrado (`false`) ante cualquier error,
  mismo criterio que `getAuthorizedUser`/`resolveCalendarAccess`
  (`src/lib/current-user.ts`/`roles.ts`, TAL-11): es una comprobación de
  autorización, no un dato de negocio.
- `src/app/admin/[calendarId]/guests-actions.ts`/`guests-section.tsx`
  actualizados en consecuencia (comentarios desactualizados de la era
  TAL-10, y la lectura ya no pasa por `tryDataLayer`/`DataLayerUnavailableError`
  de `not-migrated.ts`, que ya no representa correctamente por qué podría
  fallar esta lectura).

### Punto crítico: la carrera expulsión-vs-aceptación, verificada contra el deployment real

El diseño de T2 dejaba explícito qué tenía que cumplir la mutation de
expulsión para que el conflicto se detectase (leer/borrar `invitations`
por la clave EXACTA de índice `(calendarId, email)`, la misma que
`resolveMemberAccessHandler` de TAL-11 (`convex/access.ts`) ya lee para
aceptar) — razonado, pero explícitamente no verificado con concurrencia
real por T2 (la mutation de aceptación no existía todavía cuando escribió
el diseño). Con TAL-11 ya mergeada, esta tarea probó la carrera de verdad,
mismo formato que TAL-9/TAL-7: procesos `npx convex run` independientes,
sin `await` entre medias.

**Procedimiento**: por cada repetición, se resetea el estado (se quita al
invitado si quedó de la ronda anterior), se invita de nuevo, y se lanzan a
la vez `guests:removeGuestFromCalendar` (expulsión) y
`access:resolveMemberAccess` (aceptación) para la misma invitación. Tras
resolverse las dos, se comprueba con `guests:isCalendarGuest` si quedó
acceso colgante — el único resultado incorrecto posible, ya que en
CUALQUIER orden serie válido el resultado final es "sin invitación ni
membership" (expulsión-primero: nunca llega a crearse nada que expulsar;
aceptación-primero: crea la membership, pero la expulsión que llega
después se la lleva igual, porque sigue viendo la fila de `invitations`
hasta que la propia expulsión la borra).

**Resultado — 25/25 repeticiones sin acceso colgante**, con reparto real de
quién "ganó" cada ronda (14/25 la aceptación llegó a crear la membership
antes de que la expulsión borrara la invitación, 11/25 la expulsión borró
la invitación antes de que la aceptación la viera) — confirma que el
solapamiento de índice sí se está ejerciendo bajo la carrera real, no que
un lado sistemáticamente gana y el otro nunca se ejecuta. 0 errores de
llamada, 0 casos de "las dos ganan". Corrido contra un deployment de
desarrollo propio y aislado (`calendario-adviento-t3`/`combative-vole-47`
— ver nota de proceso más abajo), no contra el compartido de T1
(`beloved-barracuda-617`).

### Verificación manual de extremo a extremo (HTTP real, con sesión autenticada)

Sin navegador disponible en este entorno (extensión Chrome no conectada),
la verificación de `guests-actions.ts`/`guests-section.tsx` se hizo con
peticiones HTTP reales contra el servidor de Next.js en dev (`next dev -p
3002`), usando el protocolo real de Server Actions de Next.js (formularios
`multipart/form-data` con los campos `$ACTION_REF_n`/`$ACTION_n:0`/
`$ACTION_n:1` que Next genera para el fallback sin JS) y una sesión de
`dev-login` real con cookies — no una llamada directa a las funciones de
Convex saltándose Next.js. La página real
(`admin/[calendarId]/page.tsx`) todavía no renderiza `GuestsSection`
porque `getCalendarForAdminPage` sigue siendo de TAL-12 (no mergeada en
este worktree) y corta antes de llegar ahí — se usó una ruta temporal
(`src/app/tal16-guest-test/page.tsx`, renderizando `<GuestsSection
calendarId={...} />` directamente) solo para esta verificación, no
comprometida al repo (mismo criterio que los scripts de prueba de
concurrencia de este documento).

Probado, con datos reales en el deployment de desarrollo propio:
- **Invitar**: formulario "Invitar ahora" → aparece en la tabla como
  "Invitado", confirmado también consultando `guests:listCalendarGuests`
  directamente.
- **Email inválido**: mismo formulario con `no-es-un-email` → rechazado
  (`Introduce un email válido.`), nada escrito.
- **Quitar del calendario**: desaparece de la tabla y de `invitations`.
- **Borrar por completo**, caso feliz (Super Admin): desaparece de la
  tabla.
- **Borrar por completo, la comprobación de autorización de TAL-7 ronda 1**
  (acotar el efecto global a alguien con relación real con el calendario)
  — repetida aquí contra el código de Convex, no solo revisión de código
  como en TAL-7: Admin de un calendario B (no Super Admin) intenta
  `removeGuestEverywhereAction` con el `calendarId` de B pero el email de
  alguien invitado solo al calendario A (petición forjada directamente,
  sin pasar por el botón de la UI, que no ofrece esa combinación) → la
  operación falla, el email sigue invitado en A intacto. Se invita ese
  mismo email también a B y se repite la misma llamada → esta vez sí es un
  guest real de B → se borra de los dos calendarios (A y B), confirmando
  que el efecto global sigue siendo deliberadamente global una vez la
  autorización lo permite (mismo comportamiento que TAL-7 documentó). Esta
  verificación se hizo con la ronda 1 de TAL-16 (`isCalendarGuest` como
  comprobación aparte antes del borrado) — ver la sección siguiente para
  la corrección de ronda 1 de auditoría de TAL-16 sobre esta misma
  comprobación y su nueva evidencia de concurrencia.

### Corrección de auditoría, ronda 1 (TAL-16): ventana TOCTOU en "Borrar por completo"

La ronda 1 de esta tarea comprobaba la autorización de "Borrar por
completo" con una llamada aparte antes del borrado:
`isCalendarGuest(calendarId, email)` (`fetchQuery`) y, si devolvía
`true`, `removeGuestEverywhere(email)` (`fetchMutation`) — dos peticiones
independientes a Convex desde `removeGuestEverywhereAction`
(`guests-actions.ts`). Además, `removeGuestEverywhere` ni siquiera recibía
`calendarId`: borraba directamente TODAS las invitaciones/memberships
`GUEST` de ese email, en cualquier calendario.

Esto deja una ventana TOCTOU (time-of-check-to-time-of-use) real: entre la
comprobación y el borrado, la invitación o membership que justificaba la
autorización puede desaparecer (por ejemplo, un segundo Admin ejecuta
"quitar del calendario" para ese mismo invitado justo en ese hueco) — y el
borrado global se ejecuta igual, porque ya pasó una comprobación que quedó
obsoleta. Al no recibir `calendarId`, el borrado se lleva por delante las
invitaciones/memberships de TODOS los demás calendarios de ese email
aunque su pertenencia al calendario que en teoría autorizaba la operación
ya no fuera cierta en el instante real del borrado.

**Corrección**: `removeGuestEverywhere` (`convex/guests.ts`) pasa a recibir
`requireGuestOfCalendarId: Id<"calendars"> | null`, y la comprobación de
pertenencia (reutilizando `isCalendarGuestHandler`, la misma función)
ocurre DENTRO de la propia mutation, inmediatamente antes del borrado —
comprobación y efecto son ahora una sola transacción atómica, no dos
llamadas sueltas. Si la comprobación falla, la mutation lanza sin escribir
nada. `null` es el caso de Super Admin (autorización global resuelta en
Next.js, sin necesidad de atarla a un calendario concreto).
`removeGuestEverywhereAction` ya no llama a `isCalendarGuest` por
separado — ese wrapper público se retiró (`convex/guests.ts` mantiene
`isCalendarGuest`/`isCalendarGuestHandler` como `internalQuery`, sigue en
uso, ahora solo internamente).

**Probado con concurrencia real** (mismo formato que el resto de este
documento, no solo razonamiento): email E invitado a la vez a un
calendario A y a un calendario B sin relación. Se lanzan a la vez, sin
`await` entre medias, `guests:removeGuestFromCalendar` sobre A (simula que
otro Admin expulsa a E de A justo en ese instante) y
`guests:removeGuestEverywhere` con `requireGuestOfCalendarId: A` (el
borrado global, autorizado por la relación con A). Se repite 25 veces con
calendarios/invitaciones frescos en cada intento, comprobando la
invariante: si el borrado global TIENE éxito, B también debe quedar
borrado (la autorización era válida en el instante atómico de la
comprobación); si el borrado global FALLA (ya no es guest de A en ese
instante), B debe quedar completamente intacto.

**Resultado — 25/25 sin violaciones**, con las dos ramas realmente
ejercidas (6/25 el borrado global tuvo éxito y se llevó A y B por delante;
19/25 falló por "ya no autorizado" y B quedó intacto — el reparto no es
50/50 porque `removeGuestFromCalendar` es una escritura más simple y
rápida que `removeGuestEverywhere`, así que gana la carrera más a menudo,
pero lo que importa es que las dos ramas se ejercitan de verdad y ninguna
produce una violación) — confirma que la atomicidad se respeta en ambos
sentidos, no que un lado gana siempre. Corrido contra el deployment de
desarrollo propio (`calendario-adviento-t3`/`combative-vole-47`).

### Corrección de auditoría, ronda 2 (TAL-16): ventana TOCTOU sobre el ROL DEL ACTOR

La corrección de ronda 1 (arriba) cerró la ventana TOCTOU sobre la
pertenencia del OBJETIVO (¿el email a borrar sigue siendo invitado del
calendario que autoriza la operación?), pero seguía dejando la
autorización del ACTOR como un hecho ya resuelto en Next.js:
`requireCalendarAdmin` (`guests-actions.ts`) comprobaba que quien llama
sigue siendo Admin/Super Admin, y el resultado ya calculado se pasaba a
`removeGuestEverywhere` como `requireGuestOfCalendarId: calendarId | null`
(`null` para Super Admin) — una llamada aparte, con el mismo tipo de hueco:
si el rol de quien llama se revoca entre esa comprobación y la mutation
(le quitan la membership `ADMIN` de ese calendario, o Super Admin deja de
serlo), el borrado global se ejecutaba igual con una autorización ya
obsoleta. Mismo tipo de hallazgo que TAL-12 (T1) encontró en su propia
ronda 3, aplicado aquí al rol del actor en vez de a la pertenencia del
objetivo.

**Corrección**: `removeGuestEverywhere` deja de aceptar cualquier
rol/booleano ya calculado — recibe `actorUserId` (un identificador puro) y
`calendarId`, y `removeGuestEverywhereHandler` (`convex/guests.ts`) relee
DENTRO de la misma transacción, en este orden: (1) `users.isSuperAdmin`
del actor; si no lo es, (2) su `calendarMemberships` para
`(calendarId, actorUserId)` — debe ser `ADMIN`; y solo entonces (3) la
pertenencia del objetivo (`isCalendarGuestHandler`, la comprobación de
ronda 1). Las tres lecturas y el borrado son ahora una sola transacción
atómica. `guests-actions.ts::requireCalendarAdmin` sigue existiendo, pero
pasa a ser solo la puerta de entrada rápida (redirect de UX para "ni
siquiera eres admin de esto") — ya no es la autorización final para esta
acción en concreto.

**Regla de fondo para el resto de esta serie de tareas** (TAL-12/13/15 y
las que vengan): cualquier función que autoriza y actúa debe resolver la
identidad del actor dentro de sí misma (por `userId`, releyendo su rol en
fresco), nunca aceptarla como argumento afirmado desde Next.js — ni
siquiera el caso "ya sé que es Super Admin" es una excepción segura.

**Resultado tipado en vez de excepción** (nota no bloqueante de
auditoría, ronda 2): `removeGuestEverywhereHandler` devuelve
`{ok:false, error:"not-authorized"}` en vez de lanzar cuando falla
cualquiera de las comprobaciones de arriba — una carrera legítima (el rol
o la pertenencia cambiaron de verdad entre medias, sin que nadie esté
atacando nada) no debería reventar como un error crudo sin manejar.
`removeGuestEverywhereAction` lo traduce a `redirect("/unauthorized")`,
mismo criterio que el resto de rutas protegidas de la app (antes de esta
corrección, el rechazo del hallazgo de ronda 1 sí llegaba como un HTTP 500
crudo — confirmado no explotable por el auditor, pero peor experiencia
que un redirect limpio ante una carrera real).

**Probado con concurrencia real**: actor con membership `ADMIN` en un
calendario A; email E invitado a la vez a A (pertenencia del objetivo
válida) y a un calendario B sin relación. Se lanzan a la vez, sin `await`
entre medias, "revocar la membership `ADMIN` del actor en A" (simula que
otro Super Admin le quita el rol justo en ese instante — mutation temporal
solo para esta prueba, no comprometida al repo, mismo criterio que el
resto de scripts de concurrencia de este documento) y
`guests:removeGuestEverywhere` actuando como ese actor, autorizado por A.
25 repeticiones con calendarios/actor/invitaciones frescos en cada
intento, misma invariante que la prueba de ronda 1 (si el borrado global
tiene éxito, B debe quedar borrado; si falla, B debe quedar intacto).

**Resultado — 25/25 sin violaciones**, con las dos ramas ejercidas (4/25
el borrado global tuvo éxito y se llevó A y B por delante; 21/25 falló
porque la revocación ganó la carrera y B quedó intacto — reparto todavía
más desequilibrado que el de la prueba de ronda 1 porque revocar una
membership es una escritura más simple aún que `removeGuestFromCalendar`,
pero de nuevo lo relevante es que las dos ramas se ejercitan de verdad sin
ninguna violación) — confirma que releer el rol del actor dentro de la
misma transacción cierra también esta ventana. Corrido contra el
deployment de desarrollo propio, con una mutation interna temporal
(`convex/_scratch_toctou_test.ts::deleteAdminMembership`) creada solo para
poder disparar la revocación desde `npx convex run` — borrada y
redesplegada antes de esta exportación, mismo criterio que TAL-9 con su
mutation temporal de borrado de skin.

### Nota de proceso: un deployment de Convex por terminal mientras TAL-12/13/16 convivan

Durante esta tarea se detectó (primero como un índice borrado, después
como el problema real y más general) que `npx convex dev`/`deploy` no es
aditivo entre worktrees: sincroniza el deployment de Convex al conjunto
EXACTO de schema + funciones de quien despliega, así que dos terminales
con ramas distintas sin mergear que despliegan sobre el MISMO deployment
de desarrollo se borran mutuamente el trabajo (schema, índices, funciones
públicas) sin ningún aviso de la plataforma. La Directora decidió que,
mientras TAL-12 (T1)/TAL-13 (T2)/TAL-16 (esta tarea) convivan sin mergear,
cada terminal use su propio deployment de desarrollo — T1 se queda en el
compartido `beloved-barracuda-617` (ya avanzado con TAL-9/10/11), esta
tarea se desplegó contra uno propio (`calendario-adviento-t3`/
`combative-vole-47`, mismo team `aitor-marin-6a254`). No afecta al
resultado de esta tarea (el schema/funciones son idénticos salvo por el
código que no toca cada terminal), pero si quien retome trabajo en TAL-16
más adelante encuentra `CONVEX_DEPLOYMENT` apuntando a un proyecto
distinto del compartido, es la razón.
