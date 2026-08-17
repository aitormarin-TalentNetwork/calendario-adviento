# Autenticación y control de acceso (TAL-2)

> **Nota TAL-11**: este documento describe el diseño de TAL-2 (Auth.js v5,
> JWT, Google), que sigue siendo la decisión vigente en cuanto a por qué
> JWT y no sesión en BD, middleware vs. página, etc. Lo que SÍ cambió: el
> `upsert` de `User`/lectura de `isSuperAdmin`/resolución de
> `CalendarMembership` que este documento describe contra Prisma (TAL-10 los
> dejó lanzando `DataLayerUnavailableError`, sin BD real detrás) vuelven a
> funcionar de verdad en TAL-11, ahora contra Convex — ver la sección nueva
> "Autenticación sobre Convex (TAL-11)" más abajo para el diseño actual, y
> `src/lib/auth.ts`/`src/lib/current-user.ts`/`src/lib/roles.ts` para el
> código. Las secciones de abajo sobre las correcciones de auditoría de
> TAL-2 (por qué `isSuperAdmin` no vive en el JWT, búsqueda por id no por
> email, invitación idempotente, normalización de email) siguen siendo la
> razón de fondo de cada decisión — solo cambió el almacén de datos que las
> implementa, no el razonamiento.

## Librería elegida

**Auth.js v5** (`next-auth@beta`), con proveedor de **Google** — ya apuntado
como plan en `docs/stack.md` (TAL-1). Se confirma aquí. Se descartó
`@auth/prisma-adapter` (sesiones en base de datos): habría añadido tablas
(`Account`, `Session`, `VerificationToken`) al schema compartido con TAL-3
justo mientras T1 seguía desarrollándolo en paralelo, para un beneficio que
no hace falta en el MVP. En su lugar:

- **Sesión con estrategia `jwt`** (cookie firmada, sin tabla de sesión),
  `maxAge` de 30 días → cumple "sesión persistente" sin tocar el schema de
  TAL-3.
- El `User` de nuestro propio modelo (`prisma/schema.prisma`) se crea/actualiza
  con un `upsert` por email dentro del callback `jwt`, la primera vez que
  alguien inicia sesión — no se usa el adapter de Prisma para esto, solo
  Prisma directamente.

## Middleware vs. página: por qué se reparte así

`src/proxy.ts` (el "middleware" de Next.js — renombrado a `proxy.ts` en la
convención de ficheros de Next 16) corre en el runtime Edge y por eso usa una instancia
"ligera" de Auth.js (`src/lib/auth.config.ts`, sin nada que dependa de
`@prisma/adapter-pg`/`pg`, que son librerías de Node y no funcionan en Edge).
Ese middleware solo comprueba **si hay sesión** para las rutas protegidas
(`/superadmin`, `/admin/*`, `/c/*`) y redirige a `/login?callbackUrl=...` si
no la hay.

La resolución de **rol concreto** (Super Admin / Admin de este calendario /
Invitado de este calendario) pasa siempre por `src/lib/roles.ts` dentro de la
página (runtime Node, con acceso a Prisma):

- Super Admin: `User.isSuperAdmin` (flag global), leído siempre en fresco de
  BD vía `src/lib/current-user.ts::getAuthorizedUser()` — **nunca** del JWT
  (ver "Por qué isSuperAdmin no vive en el JWT" más abajo).
- Admin/Invitado: `CalendarMembership` para ese `calendarId` concreto.
- Si no hay `CalendarMembership` pero sí una `Invitation` para el email de la
  sesión en ese calendario, se resuelve ahí mismo: se crea la
  `CalendarMembership` como `GUEST` (así se "acepta" una invitación, tal
  como lo describe `docs/modelo-de-datos.md` — la Invitation no tiene campo
  de estado a propósito).
- Si no hay ni membership ni invitación → `/unauthorized`.

Esto evita bakear la lista de calendarios/roles de cada usuario en el JWT
(no escala bien si alguien tiene muchos calendarios) a cambio de una consulta
a Prisma por página protegida — asumible en este MVP.

## Por qué `isSuperAdmin` no vive en el JWT (corrección de auditoría, ronda 1)

La ronda 1 guardaba `isSuperAdmin` en el JWT en el momento del login y lo
reutilizaba en cada petición sin volver a consultar la BD. Con sesión de 30
días, eso significa que revocar (o conceder) Super Admin en la base de datos
no surtía efecto hasta que esa sesión concreta expirase o se cerrase sesión a
mano — una ventana de hasta 30 días con el privilegio equivocado.

Corrección: el JWT/sesión solo llevan `userId` (un identificador, no cambia
de significado con el tiempo). Toda comprobación de privilegio pasa por
`getAuthorizedUser()`, que relee `User.isSuperAdmin` de Postgres en cada
petición a una página protegida. Cuesta una consulta extra por página, pero
así una revocación surte efecto en la siguiente petición, no en la siguiente
sesión.

### `getAuthorizedUser()` busca por id, no por email (corrección de auditoría, ronda 2)

La primera versión de `getAuthorizedUser()` releía `User` por
`session.user.email` en vez de por el `userId` que ya viaja en el JWT. Eso
rompe la vinculación sesión↔identidad: si se borra ese `User` y luego se crea
otro con el mismo email (una persona que se da de baja y se vuelve a invitar,
o cualquier operación de administración futura en TAL-4), la sesión antigua
—válida hasta 30 días— pasaba a resolver como el usuario nuevo y heredaba sus
privilegios, `isSuperAdmin` incluido.

Corrección: `prisma.user.findUnique({ where: { id: session.user.id } })`.
Probado simulando el escenario exacto: usuario A con `isSuperAdmin: true`
inicia sesión y accede a `/superadmin` (200); se borra el `User` de A y se
crea un `User` B nuevo con el mismo email (`isSuperAdmin: false`); la MISMA
cookie de sesión de A vuelve a pedir `/superadmin` → ya no cuela como B, sino
que `getAuthorizedUser()` no encuentra ningún `User` con ese id y la sesión
se trata como inválida (redirige a `/login`, código 307 confirmado en los
logs del servidor) — falla cerrado en vez de reengancharse a una identidad
distinta.

## Aceptar una invitación es idempotente (corrección de auditoría, ronda 1)

La ronda 1 resolvía una `Invitation` con `findUnique` (¿existe membership?)
seguido de `create` (si no existe, créala). Con dos peticiones concurrentes
para el mismo usuario+calendario (doble pestaña, doble clic, un retry de
red) ambas podían ver "no existe" y la segunda `create` chocaba con el índice
único `(calendarId, userId)` y fallaba.

Corrección: `src/lib/roles.ts` usa `calendarMembership.upsert(...)` con
`update: {}` — un no-op si la membership ya existe (la crease quien la
creara, y con el rol que tuviera; nunca se degrada un `ADMIN` a `GUEST` por
esta vía). Además, la búsqueda de la `Invitation` pasó de `findUnique` a
`findFirst` con `email: { equals, mode: "insensitive" }` (ver siguiente
sección) — `findUnique` exige coincidencia exacta del índice único, y ya no
podíamos garantizar mayúsculas/minúsculas exactas.

Probado con peticiones HTTP realmente concurrentes (8 en paralelo con
`curl`, mismo usuario/calendario, sin membership previa): el `upsert` de
Prisma sobre este conector **no es atómico** — dos `upsert` simultáneos
pueden intentar ambos el `create` interno y uno de los dos revienta con
`P2002` (violación del índice único) en vez de resolverse solo como un
`update`. Por eso el `upsert` va envuelto en un `try/catch` que atrapa
específicamente `P2002` y, si salta, relee la fila con `findUniqueOrThrow` —
quien "pierde la carrera" solo necesita la fila que ya creó el otro, no es un
error real. Repetido el mismo test tras esto: 8/8 peticiones en 200, una sola
fila de membership creada.

> **TAL-11**: el mecanismo concreto de arriba (`P2002`/`findUniqueOrThrow`)
> es específico de Prisma/Postgres y ya no corre. La versión Convex
> (`convex/access.ts::resolveMemberAccessHandler`) resuelve la misma carrera
> de otra forma: una mutation de Convex ya se ejecuta con aislamiento
> serializable y reintento automático ante conflicto (mismo mecanismo
> verificado con concurrencia real en TAL-9 para altas idempotentes), así
> que el check-then-insert de esa función es seguro sin necesitar ningún
> try/catch de índice único — ver la sección nueva más abajo.

## Bootstrap del primer Super Admin

No hay UI todavía para promover a alguien a Super Admin (llega con TAL-4). El
primer Super Admin se resuelve con la variable de entorno
`SUPER_ADMIN_EMAILS` (lista separada por comas): si el email coincide **al
crear** el `User` (primer login de esa persona), se marca `isSuperAdmin:
true`. Deliberadamente no se re-evalúa en logins siguientes ni sobre un
`User` ya existente — una vez creado, promover/degradar Super Admin es cosa
del panel (TAL-4) o de tocar la fila directamente, no de esta variable.

> **TAL-11**: `SUPER_ADMIN_EMAILS` sigue viviendo solo en Next.js/Railway
> (nunca en el deployment de Convex) — la comprobación de la allowlist
> (`isBootstrapSuperAdmin`, `src/lib/auth.ts`) se sigue haciendo en Next.js,
> igual que con Prisma, y su resultado (`true`/`false`) se manda como
> argumento `isSuperAdminOnCreate` a la mutation de Convex
> (`users.upsertUserOnLoginPublic`), que solo lo aplica si de verdad está
> creando el `User` por primera vez — ver `convex/users.ts::createUserHandler`.
> Verificado contra el deployment real de desarrollo: un email de la
> allowlist crea el usuario con `isSuperAdmin: true` desde el primer login.

## Login real vs. simulado

- **Real**: proveedor Google de Auth.js (`GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET`). Requiere un proyecto de Google Cloud con la
  pantalla de consentimiento OAuth configurada — **no se ha creado en esta
  tarea** (no hay credenciales de Google Cloud disponibles en este entorno de
  desarrollo); queda como env vars sin rellenar, listas para cuando se
  provisionen (ver "Pendiente" más abajo).
- **Simulado** (`AUTH_DEV_LOGIN=true`, y siempre bloqueado si
  `NODE_ENV=production` aunque la variable esté puesta): añade un proveedor
  `Credentials` sin contraseña — basta un email para "entrar como" ese
  usuario. Es la vía usada para la evidencia de esta tarea (ver export al
  auditor) y para desarrollo local de TAL-4/TAL-5 sin depender de Google. El
  botón solo aparece en `/login` si la variable está activa.

## Normalización de email entre Gmail e Invitation (corrección de auditoría, ronda 1)

El email de la sesión se guarda siempre en minúsculas (`user.email.toLowerCase()`
en `auth.ts`), pero una `Invitation` (creada a mano hoy, o desde el futuro
panel de TAL-5) podía guardarse con otra capitalización — `Persona@Gmail.com`
no habría hecho match exacto con `persona@gmail.com`.

Corrección a nivel de aplicación: `resolveCalendarAccess` compara con
`findFirst({ where: { email: { equals, mode: "insensitive" } } })` en vez de
`findUnique` por igualdad exacta. Es independiente de cómo esté tipada la
columna en BD.

Nota para cuando se rebase sobre `main`: T1 añadió `@db.Citext` a
`Invitation.email` (y a `User.email`) en TAL-3, como corrección de su propia
ronda de auditoría — eso resuelve el mismo problema a nivel de base de datos
(unicidad e igualdad insensibles a mayúsculas garantizadas por Postgres). Una
vez el rebase traiga esa migración, la comprobación `mode: "insensitive"` de
aquí pasa a ser redundante (no dañina, solo ya no imprescindible) — no hace
falta quitarla, pero no hace falta añadir nada más tampoco.

## Autenticación sobre Convex (TAL-11)

TAL-9 volvió `internal*` todas las funciones de Convex (hallazgo de
auditoría, ronda 1: cualquiera con la URL pública del deployment podía
llamarlas sin control de acceso alguno). Eso resolvió ese hallazgo, pero
creó uno nuevo para esta tarea: una función `internal*` **no es alcanzable
en absoluto** desde `fetchQuery`/`fetchMutation`/`ConvexHttpClient`
(verificado contra el deployment real — `Could not find public function`),
así que Next.js no puede llamarlas tal cual para reconectar
`getAuthorizedUser`/`resolveCalendarAccess`.

Investigación completa (dos patrones de Auth.js↔Convex considerados y
descartados, con sus motivos) en `docs/convex-auth-investigacion-tal11.md`
— aquí solo la decisión cerrada y cómo quedó implementada.

### Frontera pública: secreto compartido, no JWT/JWKS

Se descartó el puente "oficial" de Convex (JWT asimétrico firmado por
Next.js + endpoint JWKS + `ctx.auth.getUserIdentity()` dentro de Convex,
`type: "customJwt"`) por dos motivos concretos: la propia documentación de
Convex avisa textualmente que "the Convex team does not guarantee the
security of this setup" para ese puente específico, y habría significado
generar/rotar un par de claves asimétrico y mantener un endpoint JWKS
propio — infraestructura real que este proyecto no necesita para lo que
hace falta (que un servidor de confianza pueda invocar funciones hoy
internas).

En su lugar: cada función que Next.js necesita invocar gana una versión
pública "delgada" (`convex/users.ts::getByIdPublic`/`upsertUserOnLoginPublic`,
`convex/access.ts::resolveMemberAccessPublic`) que exige un argumento
`serverSecret: v.string()` y lo compara — en tiempo constante, no `===`,
ver `convex/serverAuth.ts::requireServerSecret` — contra
`CONVEX_APP_SERVER_SECRET`, una variable de entorno **de este deployment de
Convex** (`npx convex env set`). El mismo valor vive, por separado, como
variable de **servidor** en Next.js/Railway (nunca `NEXT_PUBLIC_*`) — ver
`.env.example`. Las dos variables son independientes; nada las sincroniza
salvo ponerlas iguales a mano en cada sitio (rotarlo significa cambiar las
dos).

El secreto no dice "quién eres" — sigue sin haber ningún concepto de
identidad dentro de Convex, ninguna función usa `ctx.auth`. Dice "esta
llamada viene de nuestro servidor de confianza, no de un navegador
cualquiera con la URL pública del deployment". La identidad de quién actúa
(`userId`, `isSuperAdmin`, rol) se sigue resolviendo enteramente en
Next.js, con el mismo modelo de confianza que con Prisma: `userId`/`email`
viajan como argumentos explícitos, nunca se infieren dentro de Convex.

**Riesgo que esto NO resuelve, a propósito**: si `CONVEX_APP_SERVER_SECRET`
se filtra, cualquiera puede llamar a las funciones delgadas saltándose
Next.js — mismo perfil de riesgo que cualquier secreto compartido de este
tipo (comparable a un webhook secret, o a `AUTH_SECRET`), sin mitigación
especial más allá de la disciplina habitual de gestión de secretos
(Railway como único sitio que lo conoce del lado de Next.js).

### `resolveCalendarAccess`: una sola mutation, no varias llamadas sueltas

La documentación de Convex avisa que `fetchQuery`/`preloadQuery` (el
cliente HTTP que usa `convex/nextjs` desde Server Components/Actions) **no
da consistencia garantizada entre dos llamadas separadas** — a diferencia
de `ConvexReactClient`, que sí la da. Si la lógica de "leer membership, leer
invitación, crear si falta" (la misma que en Prisma necesitaba una
transacción `SERIALIZABLE` con reintento, TAL-7 ronda 1, para que "aceptar
invitación" no se entrelazara con "quitar invitado" dejando con acceso a
alguien ya expulsado) se hubiera partido en varias llamadas de
`fetchQuery`/`fetchMutation` desde `src/lib/roles.ts`, se habría reabierto
exactamente ese hueco.

En su lugar, TODA esa lógica vive dentro de **una única** mutation de
Convex (`convex/access.ts::resolveMemberAccessHandler`), invocada una sola
vez desde `resolveCalendarAccess` vía `fetchMutation`. Una mutation de
Convex ya corre con aislamiento serializable y reintento automático ante
conflicto (mismo mecanismo que TAL-9 verificó con concurrencia real) — el
check-then-insert de esa función es seguro sin necesitar ningún nivel de
aislamiento explícito.

El atajo de Super Admin (`user.isSuperAdmin`) sigue resuelto enteramente en
Next.js, sin tocar Convex — igual que nunca tocó Prisma.

### Fail-closed sin excepción, verificado en runtime real

`getAuthorizedUser()`/`resolveCalendarAccess()` atrapan CUALQUIER error de
la llamada a Convex (secreto no configurado, deployment inalcanzable,
secreto no coincide, id con forma inválida) y devuelven `null` — postura ya
confirmada por el auditor en TAL-10 rondas 1-2 (`docs/modelo-de-datos.md`),
sin cambios de criterio, solo de dónde vive el dato que puede fallar.

Verificado contra el deployment real de desarrollo
(`beloved-barracuda-617`), no solo razonado:
- Secreto incorrecto en `getByIdPublic`/`resolveMemberAccessPublic` →
  rechazado, sin tocar la base de datos.
- Login de desarrollo real (flujo HTTP completo con cookies, `csrfToken`
  incluido) con un email de `SUPER_ADMIN_EMAILS` → `getAuthorizedUser()`
  resuelve `isSuperAdmin: true` desde Convex; `/superadmin` responde 200.
- Login con un email cualquiera (no Super Admin) → `/superadmin` redirige a
  `/unauthorized` (307).
- **Revocación en caliente**: con una sesión de Super Admin ya abierta
  (misma cookie, sin volver a iniciar sesión), se puso `isSuperAdmin: false`
  directamente en Convex → la SIGUIENTE petición a `/superadmin` con esa
  misma cookie ya redirige a `/unauthorized` — confirma que
  `getAuthorizedUser()` relee Convex en fresco en cada petición, nunca
  confía en el JWT para privilegios (mismo principio de TAL-2, ahora
  verificado contra el almacén de datos real).
- Aceptación de invitación de extremo a extremo: usuario sin membership +
  invitación existente para su email → `resolveMemberAccessPublic` crea la
  `calendarMembership` como `GUEST` y la devuelve; una segunda llamada
  idéntica es idempotente (misma membership, no crea una segunda); un
  usuario sin invitación en ese calendario recibe `null` (sin acceso).

## Portada personalizada de `/login` (TAL-25)

`src/app/login/page.tsx` había quedado como stub (`calendar = null` fijo)
desde que TAL-10 retiró Prisma — la portada de login SIEMPRE mostraba el
genérico, sin importar qué `callbackUrl` trajera (hallazgo propio,
encontrado durante TAL-23). Reconectada contra Convex.

**Alcance — solo `/c/[calendarId]` (Invitado), no `/admin/[calendarId]`**:
decisión documentada según pedía el brief ("usa tu criterio"). `/admin`
es una ruta de Admin, no de Invitado — nadie llega ahí siguiendo un link
de invitación por email, así que no había sentido de producto en
resolver también esa forma, y ampliar la superficie que esta página sin
autenticar puede resolver sin necesidad real no compensaba.

**Seguridad — página pública SIN autenticar, qué se expone**: nueva
consulta `calendars.getPublicCoverInfoForLogin` (`convex/calendars.ts`),
DELIBERADAMENTE distinta de `calendars.getPublic` (que devuelve el
documento entero y ya usan `admin/[calendarId]/page.tsx`/
`c/[calendarId]/page.tsx`, ambas páginas que exigen sesión + acceso
verificado antes de llegar ahí). La nueva consulta es una lista blanca
explícita: solo `coverTitle`/`coverIcon`/`coverImageUrl` — el nombre
bonito, el icono y la foto, nada que no sea ya visible en la propia
invitación por email (nada de fechas, `skinId`, ni cualquier dato de
invitados/admins). La restricción vive en la propia consulta de Convex,
no en que el código de Next.js recuerde no reenviar el resto del
documento al cliente.

**No dar pistas de si un `calendarId` existe** (brief, punto 4):
`calendarId` con formato inválido (Convex rechaza el argumento antes de
que el handler compruebe si existe), calendario bien formado pero
inexistente, y cualquier fallo genuino de Convex caen los tres al mismo
`null` (portada genérica) — capturados con un único `try/catch` en
`getCalendarCoverForLogin`, sin distinguir entre ellos ni dejar escapar
ninguna excepción cruda (mismo criterio ya establecido en esta página
desde TAL-10 para cualquier fallo de la capa de datos).

**Verificación** — vía `curl` contra `npx next dev -p 3001` (evita
contender por el cerrojo compartido de Chrome para una comprobación que
no necesita interacción visual real):
- Sin `callbackUrl`: portada genérica ("🎄 ¡Feliz cuenta atrás, equipo!").
- `callbackUrl=/c/{id real}` (con `coverTitle`/`coverIcon`/`coverImageUrl`
  puestos a propósito): título/icono/foto reales, HTTP 200.
- `callbackUrl=/c/{id con formato inválido}`: portada genérica, HTTP 200,
  sin excepción visible ni traza en consola cerca de esa petición.
- `callbackUrl=/c/{id bien formado pero inexistente}`: portada genérica,
  HTTP 200 — respuesta indistinguible de la anterior (mismo texto exacto,
  mismo código HTTP), tal como pide el brief.
- `callbackUrl=/admin/{id real}`: portada genérica — confirma que la
  ruta de Admin no se personaliza, tal como se decidió arriba.

## Pendiente (fuera de alcance de TAL-2)

- Crear el proyecto de Google Cloud + pantalla de consentimiento OAuth y
  rellenar `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (en Railway para
  producción, y opcionalmente en local) — requiere acceso a una cuenta de
  Google Cloud del proyecto, decisión/credencial que no corresponde a esta
  terminal.
- Panel para que un Super Admin gestione Admins (TAL-4) y CRUD de calendario
  (TAL-5) — las páginas `/superadmin`, `/admin/[calendarId]` y
  `/c/[calendarId]` de esta tarea son solo el esqueleto protegido por rol,
  sin el contenido real.

## Variables de entorno relevantes

Ver `.env.example`. En local, `.env`/`.env.local` (no versionados) necesitan
al menos `AUTH_SECRET`, `NEXT_PUBLIC_CONVEX_URL` (la genera `npx convex
dev`) y `CONVEX_APP_SERVER_SECRET` (TAL-11 — debe coincidir con la misma
variable puesta en el deployment de Convex vía `npx convex env set`);
`AUTH_DEV_LOGIN=true` para el login simulado.
