# Gestión de invitados (TAL-7)

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
