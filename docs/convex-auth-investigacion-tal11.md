# Investigación — Auth.js sobre Convex (para TAL-11)

Fichero propio, no toca nada del worktree de T1. Investigación de cara a
TAL-11 (Auth sobre Convex), la tarea siguiente a TAL-10. Basado en
documentación oficial de Convex (`docs.convex.dev`) y en su blog técnico
(`stack.convex.dev`) — citado en cada punto, con fecha de agosto de 2026.
**Nada de esto está probado contra un deployment real** — es un resumen de
lo que dice la documentación aplicado al código actual de este proyecto
(`src/lib/auth.ts`, `src/lib/current-user.ts`, `src/lib/roles.ts`, TAL-2),
no una implementación verificada. Marco claramente qué es cita de fuente y
qué es razonamiento propio aplicado a nuestro caso.

## Qué hay que resolver, en términos de nuestro código actual

Hoy (`src/lib/auth.ts`): NextAuth con sesión JWT (cookie firmada por
NextAuth, sin tabla de sesiones en BD), un callback `jwt()` que hace
`prisma.user.upsert` en el primer login y guarda `dbUser.id` en el token,
y `src/lib/current-user.ts::getAuthorizedUser()` que **siempre relee
`isSuperAdmin` en fresco de Prisma** por `id` (nunca confía en el JWT para
privilegios — hallazgo de auditoría TAL-2 ronda 1) buscando por
`session.user.id`, nunca por email (hallazgo TAL-2 ronda 2). Todo esto
corre en código de servidor de Next.js (Server Components/Server Actions),
nunca en el cliente. La pregunta para TAL-11 es cómo se traduce este mismo
modelo de confianza cuando la BD deja de ser Prisma/Postgres y pasa a ser
Convex (TAL-9/TAL-10).

## Dos patrones de integración distintos — no son lo mismo

La documentación de Convex describe dos formas de conectar Auth.js con
Convex, con arquitecturas y garantías bastante distintas entre sí. Vale la
pena no mezclarlas al decidir TAL-11.

### Patrón A — Convex como adaptador de base de datos de Auth.js

Auth.js delega en Convex el almacenamiter completo de su modelo estándar:
tablas `users`, `sessions`, `accounts`, `verificationTokens`,
`authenticators` (con sus índices), todas gestionadas por el propio
Auth.js a través del adaptador. Es el patrón que
`stack.convex.dev/nextauth-adapter` describe como "el camino recomendado
oficialmente" por Convex, con plantilla de repo incluida — pero con un
matiz importante: el paquete "actualmente no está empaquetado dentro de
Auth.js" — hay que copiar código a mano en `convex/` y en `app/`, no es un
`npm install` de un paquete mantenido de forma independiente. Esto usa
sesiones de servidor (Auth.js gestiona la sesión vía Convex, con un
secreto compartido `CONVEX_AUTH_ADAPTER_SECRET`), no JWT autofirmado por
Next.js.

**Tensión concreta con lo que ya construyó T1 en TAL-9**: la tabla
`users` que este patrón espera tiene la forma estándar de Auth.js
(incluye campos como `emailVerified`/`image` que Auth.js gestiona él
mismo). La tabla `users` que TAL-9 ya definió en `convex/schema.ts` es
distinta a propósito — forma de dominio de esta app
(`email`/`name`/`isSuperAdmin`, sin `emailVerified`/`image`, sin
`createdAt` propio por `_creationTime`). Adoptar el Patrón A tal cual
significaría o bien reconciliar las dos formas de tabla `users` en una
sola (con el riesgo de que Auth.js gestione campos que hoy son
responsabilidad exclusiva del panel de Super Admin, TAL-4), o bien
mantener dos tablas de usuario separadas (una de Auth.js, otra de
dominio, vinculadas por email o por id) — ninguna de las dos opciones es
gratis, y ninguna está decidida ni descartada aquí; queda para que TAL-11
la decida con este dato ya sobre la mesa.

### Patrón B — Auth.js sigue siendo la única fuente de sesión; Convex solo verifica un JWT que Next.js le emite

Auth.js sigue funcionando exactamente como hoy (sesión JWT en cookie,
gestionada íntegramente por Next.js). Además, en el callback `session()`
de Auth.js, el servidor de Next.js **firma un JWT propio, distinto de la
cookie de sesión**, con una clave privada, y lo entrega al cliente para
que lo use al hablar con Convex. Convex verifica ese JWT contra una clave
pública que el propio servidor de Next.js expone (`.well-known/jwks.json`
o similar) — configurado en `convex/auth.config.ts` con `type:
"customJwt"`, `issuer`, `jwks`, `algorithm` (**solo RS256 o ES256** —
importante, ver "Gotcha" más abajo) y opcionalmente `applicationID` (la
propia documentación de Convex advierte explícitamente: sin
`applicationID`, "un JWT pensado para otro servicio se puede usar para
suplantarlo en el tuyo" — recomendado no omitirlo). Dentro de las
funciones de Convex, `ctx.auth.getUserIdentity()` expone los campos del
JWT verificado (p. ej. `sub`, cualquier claim anidado vía notación de
punto).

## Gotcha 1 — la propia Convex avisa: "no garantizamos la seguridad de esto"

Cita textual extraída de `stack.convex.dev/nextauth` (Patrón B): *"The
Convex team does not guarantee the security of this setup."* No es una
frase de relleno — este patrón depende de que Next.js implemente
correctamente todo el ciclo de vida de un JWT asimétrico (firma, rotación
de claves, exposición de JWKS, expiración) sin la ayuda de una librería
first-party de Convex para esa parte concreta. Dado el historial de este
proyecto (TAL-2 pasó por 3 rondas de auditoría específicamente sobre el
manejo de JWT/privilegios), este aviso pesa: adoptar el Patrón B sin más
cuidado es repetir esa superficie de riesgo, esta vez con una pieza que ni
el propio fabricante garantiza.

## Gotcha 2 — el JWT de sesión de NextAuth no es directamente el JWT que Convex necesita

NextAuth, con `session: { strategy: "jwt" }` (lo que usamos hoy), no emite
un JWT firmado de forma asimétrica pensado para ser verificado por
terceros — es una cookie propia de NextAuth. El Patrón B **no reutiliza
esa cookie**: exige emitir un JWT *aparte*, firmado con una clave privada
propia del proyecto, específicamente para que Convex lo verifique
(algoritmo restringido a RS256/ES256, con su propio endpoint JWKS). Es
trabajo adicional real, no una casilla de configuración — hay que generar
y gestionar un par de claves nuevo, y mantener un endpoint que las sirva,
fuera de lo que NextAuth ya hace por nosotros hoy.

## Gotcha 3 — `fetchQuery`/`preloadQuery` desde Next.js no da consistencia entre llamadas

Convex expone `fetchQuery`/`fetchMutation`/`fetchAction` (paquete
`convex/nextjs`) para llamar a Convex desde Server Components/Server
Actions/Route Handlers — el equivalente directo de llamar a
`prisma.algo()` hoy. La propia documentación avisa: el cliente HTTP que
usan estas funciones **no da consistencia garantizada entre dos llamadas
separadas** (a diferencia de `ConvexReactClient`, que sí la da). Aplicado
a `resolveCalendarAccess()`: la versión Prisma de esta función hace
membership-check + invitation-check + create-si-falta **dentro de una
sola transacción SERIALIZABLE** (TAL-7 rondas 1-2, para cerrar
exactamente la carrera expulsión-vs-aceptación). Si en TAL-11 se traduce
esto a **varias llamadas separadas** de `fetchQuery`/`fetchMutation` desde
código de Next.js que luego combina los resultados en JavaScript, se
reintroduce el mismo hueco que costó dos rondas de auditoría en TAL-7 —
la fix correcta es que toda la lógica de "leer membership, leer
invitation, crear si falta" viva dentro de **una sola** mutation de
Convex (una única llamada desde Next.js), tal como T1 ya viene haciendo en
TAL-9 (`upsertDay`, `updateCalendarRange` son cada una una sola mutation
con toda su lógica dentro). Esto no es solo teoría de la documentación:
es directamente relevante para el hallazgo que ya dejé en
`docs/convex-segunda-opinion-tal9.md` sobre probar carreras reales entre
mutations, no solo secuencialmente.

## Cómo encajarían `getAuthorizedUser()`/`resolveCalendarAccess()` — sugerencia, no decisión

Con los tres gotchas de arriba sobre la mesa, la opción de menor riesgo
que veo (a decidir por quien lleve TAL-11, con más contexto de TAL-10 del
que tengo yo ahora) es **no tocar la arquitectura de autorización que ya
pasó auditoría en TAL-2/TAL-7**, solo cambiar el almacén de datos:

- NextAuth sigue siendo la única fuente de sesión, exactamente como hoy
  (Patrón B sin la mitad de `ctx.auth` — es decir, ni siquiera hace falta
  el JWT asimétrico ni el JWKS si Convex nunca necesita saber "quién eres"
  por sí mismo).
- El callback `jwt()` de `auth.ts`, en vez de `prisma.user.upsert(...)`,
  llama a una mutation de Convex equivalente (`fetchMutation` desde
  `convex/nextjs`, código de servidor, igual que hoy llama a Prisma) que
  hace el mismo upsert por email.
- `getAuthorizedUser()` sigue viviendo en Next.js, releyendo
  `isSuperAdmin` en fresco — pero con `fetchQuery` a Convex en vez de
  `prisma.user.findUnique`.
- `resolveCalendarAccess()` se traduce a **una única mutation de Convex**
  que reproduce exactamente su lógica actual (membership → invitation →
  crear si falta), llamada una sola vez por `fetchMutation` desde Next.js
  — nunca varias lecturas sueltas combinadas en Next.js (Gotcha 3).
- Ninguna función de Convex necesita `ctx.auth.getUserIdentity()` en
  absoluto: todas siguen confiando en argumentos explícitos que les pasa
  el código de servidor de Next.js, exactamente el mismo modelo de
  confianza que ya usan `guests.ts`/`roles.ts` hoy con Prisma, y el mismo
  que T1 ya adoptó de facto en las mutations de TAL-9 (ninguna usa
  `ctx.auth`). Esto evita por completo los Gotchas 1 y 2 — no hace falta
  el JWT asimétrico ni el endpoint JWKS si Convex nunca necesita saber
  "quién eres" por sí mismo, solo qué le pide un servidor en el que ya
  confiamos.

El coste de esta opción: no se aprovecha nada de la reactividad nativa de
Convex en el cliente para datos de sesión/rol (`useQuery` reaccionando en
vivo a cambios de `isSuperAdmin`, por ejemplo) — pero esta app ya no
dependía de eso hoy (todo pasa por Server Components/Server Actions, sin
lectura reactiva de roles en cliente), así que no sería una regresión
funcional, solo una oportunidad no tomada. Si TAL-11 sí quiere reactividad
de auth en cliente más adelante, el Patrón B completo (con `ctx.auth`)
seguiría disponible como paso posterior — no hace falta decidirlo ahora
ni descartarlo del todo.

## Recomendación cerrada (actualización tras TAL-9 ronda 1 y el bloqueante detectado en TAL-12)

Cuando escribí la sección anterior, la sugerencia de "Next.js llama a
Convex vía `fetchMutation`, sin que ninguna función de Convex necesite
`ctx.auth`" daba por hecho que esas funciones eran alcanzables así. TAL-9
ronda 1 las volvió `internalMutation`/`internalQuery` (corrección
correcta a su propio hallazgo: "cualquiera con la URL del deployment
podía crear calendarios arbitrarios") — y una función interna **no es
alcanzable en absoluto** desde `fetchMutation`/`fetchQuery`/
`ConvexHttpClient`, verificado por T1 contra el deployment real
(`Could not find public function`). Lo dejé señalado como bloqueante al
diseñar TAL-12 (`docs/convex-diseno-tal12-crud-calendario.md`) sin
resolverlo ahí porque es decisión de esta tarea, no de esa. Toca cerrarlo
aquí.

**Descarto la Opción 3 tal cual** (mutations públicas que confían en su
llamador sin ninguna pieza adicional) — es literalmente el estado que
TAL-9 ronda 1 declaró inaceptable, así que reabrirla sin más sería
repetir el mismo hallazgo de auditoría.

**Recomiendo una cuarta opción, más ligera que la Opción 1 (Patrón B
completo con `ctx.auth`) y que sí cierra el hueco sin las piezas más
frágiles de esa alternativa: un secreto compartido, verificado dentro de
Convex, no un JWT asimétrico.**

### Cómo funcionaría

- Cada operación de escritura/lectura que Next.js necesita invocar en
  Convex se expone como una función pública **delgada** (o se vuelve
  pública ella misma, sin necesitar una capa `internal` separada si no
  hay ninguna otra función de Convex que también la llame) que exige un
  argumento adicional, p. ej. `serverSecret: v.string()`, y lo compara
  contra una variable de entorno de Convex (`CONVEX_APP_SERVER_SECRET`
  o similar) antes de hacer nada — si no coincide, rechaza la llamada sin
  tocar la base de datos.
- El valor de ese secreto vive **solo** en dos sitios: la variable de
  entorno del servicio de Next.js en Railway (nunca en una variable
  `NEXT_PUBLIC_*`, que sí llega al navegador) y la variable de entorno del
  deployment de Convex (`npx convex env set`, documentado en
  `docs/convex-despliegue-investigacion-tal10.md` § fuentes). Next.js lo
  añade automáticamente en cada llamada de servidor (`fetchMutation`),
  nunca lo ve el cliente.
- La identidad de quién actúa (`userId`, rol) sigue sin vivir en Convex en
  absoluto — sigue siendo un argumento explícito más, resuelto y validado
  del lado de Next.js por `getAuthorizedUser()`/`resolveCalendarAccess()`
  exactamente como hoy con Prisma. El secreto no dice "quién eres", dice
  "esta llamada viene de nuestro propio servidor de confianza, no de un
  navegador cualquiera con la URL pública" — es un ámbito de garantía más
  estrecho y más ajustado al problema real que el hallazgo de TAL-9
  describía (un llamante anónimo cualquiera), no "un usuario legítimo
  saltándose su rol" (eso nunca fue responsabilidad de Convex en esta
  arquitectura, y seguir sin serlo es la decisión de fondo que ya tomé en
  la sección anterior).

### Por qué esto en vez de la Opción 1 (JWT asimétrico + JWKS, `ctx.auth`)

No es que la Opción 1 esté mal — es la vía "oficial" que documenta Convex
para este tipo de integración, y sigue disponible como paso posterior si
algún día hace falta reactividad de Convex en cliente con identidad
verificada. Pero para lo que este proyecto necesita ahora mismo (Next.js
como único punto de decisión de autorización, igual que hoy) es más
maquinaria de la que hace falta, con dos costes reales que la Opción 4 no
tiene:

1. **El aviso textual de la propia Convex sigue en pie**: *"the Convex
   team does not guarantee the security of this setup"* — para el puente
   JWT/JWKS específicamente, no para el mecanismo de variables de entorno
   secretas (que es el mismo patrón que su propio adaptador oficial de
   Auth.js usa para autenticar sus llamadas — `CONVEX_AUTH_ADAPTER_SECRET`,
   ver mi investigación de despliegue/TAL-11 anterior). Preferir el
   patrón que la propia Convex usa internamente para "servidor de
   confianza habla con Convex" en vez del que ellos mismos avisan que no
   garantizan.
2. **Generar y rotar un par de claves asimétrico, más un endpoint JWKS
   propio, es trabajo real de infraestructura** que este proyecto no
   necesita para conseguir lo que de verdad hace falta (que un servidor
   de confianza pueda invocar funciones que hoy son internas) — un
   secreto compartido en dos variables de entorno es la misma garantía
   práctica (solo el servidor legítimo puede llamar) con una superficie
   de implementación mucho menor.

### Lo que esta opción NO resuelve, honestamente

- **Riesgo de fuga del secreto**: si `CONVEX_APP_SERVER_SECRET` se filtra
  (log accidental, commit por error, variable expuesta por un bug),
  cualquiera puede llamar a las funciones "delgadas" saltándose Next.js
  por completo — mismo perfil de riesgo que cualquier secreto compartido
  de este tipo (comparable a un webhook secret), no un riesgo nuevo que
  esta app no tuviera ya en otro sitio (p. ej. `SUPER_ADMIN_EMAILS`,
  `APP_URL`). Mitigación estándar: no requiere nada especial de Convex,
  solo la disciplina habitual de gestión de secretos (Railway como único
  sitio que lo conoce del lado de Next.js, comparación en tiempo
  constante dentro de la función de Convex para evitar timing attacks
  triviales).
- **No da reactividad de Convex en el cliente con identidad verificada**
  — si en el futuro se quiere `useQuery` reaccionando en vivo a datos
  filtrados por el usuario autenticado de verdad (no solo Server
  Components), hará falta entonces sí resolver el puente de identidad
  (Opción 1) — pero esta app no lo necesita hoy (todo pasa por Server
  Components/Server Actions, sin lectura reactiva de datos con permisos
  en cliente).
- **Actualización — verificado contra el deployment real de desarrollo**
  (`beloved-barracuda-617.convex.cloud`, spike de solo lectura/limpieza,
  coordinado antes con T1 por estar en el mismo deployment): se desplegó
  una `mutation` pública temporal con un argumento `serverSecret: v.string()`
  que compara contra una variable de entorno puesta con
  `npx convex env set`, y se llamó desde un cliente externo real
  (`ConvexHttpClient`, el mismo mecanismo de base que usa `fetchMutation`
  de `convex/nextjs`, no `npx convex run`/CLI admin). Resultado: la
  variable de entorno SÍ se lee dentro de la función (`envVarWasSet:
  true`), y la comparación del secreto recibido como argumento normal
  funciona correctamente en los dos sentidos (`matches: true` con el
  secreto correcto, `matches: false` con uno incorrecto) — confirma el
  supuesto del que dependían TAL-11/TAL-12/TAL-15. Función, script y
  variable de entorno de prueba, todos temporales, borrados/deshechos
  tras la verificación — nada de esto queda en el deployment.

## Fuentes

- [Custom JWT Provider — Convex Developer Hub](https://docs.convex.dev/auth/advanced/custom-jwt)
- [Authentication — Convex Developer Hub](https://docs.convex.dev/auth)
- [Convex with Auth.js (NextAuth) — Convex Stack](https://stack.convex.dev/nextauth)
- [Convex Adapter for Auth.js (NextAuth) Setup Guide — Convex Stack](https://stack.convex.dev/nextauth-adapter)
- [Module: nextjs — Convex Developer Hub](https://docs.convex.dev/api/modules/nextjs)
- [Next.js Server Rendering — Convex Developer Hub](https://docs.convex.dev/client/nextjs/app-router/server-rendering)
- [Environment Variables — Convex Developer Hub](https://docs.convex.dev/production/environment-variables) (para la Opción 4 del secreto compartido)

## Qué no cubre esta investigación

- No cubre cómo se traduciría el login con Google en sí (el `Provider`
  de Google en `authConfig` no cambia con nada de esto — sigue siendo
  Auth.js hablando con Google, independientemente de dónde se guarden
  los datos).
- No cubre el login de desarrollo (`dev-login`, usado en las pruebas
  E2E de TAL-2/TAL-7) — habría que revisar aparte si sigue funcionando
  igual contra un backend Convex.
- No he probado nada de esto contra un deployment real — es la lectura
  de la documentación aplicada a nuestro código, no una implementación
  verificada. Antes de dar por buena la sugerencia de arriba, quien
  aborde TAL-11 debería al menos probar `fetchMutation`/`fetchQuery`
  desde un Server Action real contra el deployment de desarrollo.
