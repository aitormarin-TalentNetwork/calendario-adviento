# Panel Super Admin (TAL-4, reconectado sobre Convex en TAL-15)

## Qué hace

`/superadmin` (protegida por `isSuperAdmin`, ver `docs/auth.md`): listado
global de todos los calendarios con stats básicas, y gestión de cuentas
Admin (alta/baja). Lógica en `src/lib/superadmin.ts`; UI y server actions en
`src/app/superadmin/page.tsx`.

## Decisiones de alcance

- **Stat "vistos"**: conectada a `DayView` (TAL-8, hallazgo de auditoría —
  la tabla ya existía pero `listCalendarsWithStats` seguía sin consultarla).
  Es el total de aperturas registradas del calendario (suma de `DayView`
  por cada `Day`), no "número de invitados que han visto algo" — una misma
  persona viendo varios días suma varias veces, de ahí que pueda superar
  `invitedCount`.
- **Promoción a Super Admin**: fuera de esta tarea. El brief de Linear y el
  mockup de Super Admin solo hablan de gestión de Admin por calendario (rol
  `CalendarMembership`), no de tocar el flag global `User.isSuperAdmin`. Un
  comentario de TAL-2 en `src/lib/auth.ts`/`docs/auth.md` da a entender que
  esto "es cosa del panel (TAL-4)", pero es una suposición hacia adelante
  de esa tarea, no alcance real de TAL-4 — confirmado con la Directora. La
  única vía para un segundo Super Admin sigue siendo `SUPER_ADMIN_EMAILS` o
  tocar la fila a mano; si hace falta una UI para esto, es candidata a
  tarea aparte.
- **"+ Nuevo Admin" pide un calendario concreto**: el rol Admin es por
  calendario, no global (ver `docs/modelo-de-datos.md`), así que dar de
  alta un Admin siempre requiere elegir a cuál. Si el email no tiene `User`
  todavía, se crea (mismo patrón que aceptar una `Invitation`).
- **"Quitar" de la tabla Admins es una fila por persona** (así lo pinta el
  mockup), no por calendario — quita el rol ADMIN de esa persona en TODOS
  los calendarios donde lo tuviera. Por cada uno: si todavía existe una
  `Invitation` suya para ese calendario, se degrada a GUEST en vez de
  borrar la membership (sigue siendo un invitado legítimo); si no hay
  invitación (se le dio Admin directamente), se borra la membership entera.
  Probado en vivo contra la BD de dev: promover a un Guest ya invitado y
  luego quitarle el Admin lo deja como GUEST, no lo expulsa del calendario;
  promover a alguien sin invitación previa y quitarle el Admin borra la
  membership por completo.
- **Columna "Creado" de la tabla Admins** usa `User.createdAt` (cuándo se
  creó la cuenta), no "cuándo se le dio el rol de Admin" — esa fecha no se
  guarda aparte, no hay caso de uso todavía que la necesite.

## Colisión de cookies de sesión entre dev servers en `localhost` (gotcha de entorno, no de producto)

Al probar esta tarea con `AUTH_DEV_LOGIN=true` en el navegador, la sesión se
invalidaba de forma intermitente con `JWTSessionError: no matching
decryption secret` en el servidor. Causa: los navegadores **no particionan
cookies por puerto** — solo por esquema+host. Si dos terminales corren cada
una su propio `next dev` en un puerto distinto de `localhost` (p. ej. T1 en
3010, T2 en 3001), ambas usan next-auth con el mismo nombre de cookie de
sesión sobre el mismo dominio `localhost`, pero cada una con su propio
`AUTH_SECRET` (`.env` no versionado, uno por worktree). El último login de
cualquiera de las dos pisa la cookie de la otra, y la siguiente petición a
la otra falla al descifrarla con su propio secreto.

No es un bug de la app — es un artefacto de probar varias instancias de
next-auth a la vez en el mismo perfil de navegador. Mitigación usada:
coordinarse por mensaje directo con la otra terminal para no solapar
sesiones de prueba a la vez. (Se probó `127.0.0.1` en vez de `localhost`
para aislar cookies por host — no sirve: Next.js bloquea por defecto los
recursos de dev de un origen distinto al configurado, ver
`allowedDevOrigins`, y rompe la hidratación.) Si esto sigue mordiendo según
crezca el número de terminales trabajando en paralelo, una solución de
fondo sería un nombre de cookie de sesión distinto por entorno de
desarrollo (`cookies.sessionToken.name` en la config de next-auth) — no se
ha aplicado porque afecta a `src/lib/auth.config.ts`/`auth.ts` (TAL-2,
compartido con TAL-5 en paralelo), y no era parte del alcance de esta
tarea.

## Reconexión sobre Convex (TAL-15)

TAL-10 retiró Prisma/Postgres y dejó las cinco funciones de
`src/lib/superadmin.ts` lanzando `DataLayerUnavailableError`. TAL-15 las
reconecta contra `convex/superadmin.ts`.

- **`viewedCount` calculado de verdad** (hallazgo del propio diseño,
  `docs/convex-diseno-tal15-panel-superadmin.md` — el comentario de este
  mismo documento, arriba, ya explicaba desde TAL-4 que debía ser la
  suma de `DayView` de todos los `Day` del calendario, pero el
  placeholder `0` de la versión Prisma nunca se actualizó tras TAL-8, así
  que el panel llevaba mostrando un dato falso en producción). Traducido
  literalmente: por cada calendario, por cada `Day`, se cuentan sus
  `dayViews` (índice `by_day_and_user` prefijado por `dayId`) y se suman
  — tercer nivel de N+1 (calendario → días → vistas), aceptable a la
  escala del producto (24 días como mucho por calendario).
- **`addAdmin` no reutiliza `calendarMemberships.ts::addMembership`
  (TAL-9)**, que deliberadamente nunca promociona un rol ya existente —
  decisión correcta para su propio caso de uso, pero no sirve para el
  ascenso GUEST→ADMIN que este panel necesita. `addAdmin` es una función
  propia, aislada, que no toca código de TAL-9 ya auditado (decisión
  cerrada en el diseño, confirmada en el brief de TAL-15).
- **Fechas como string, no `Date`**: `calendarStatus` compara
  `startDate`/`endDate`/`now` como strings `"YYYY-MM-DD"` (orden
  lexicográfico == orden cronológico, ver `docs/convex-modelo-de-datos.md`
  § "Fechas como día natural"), no objetos `Date` como en la versión
  Prisma. `src/lib/superadmin.ts` sigue exponiendo `Date` hacia
  `page.tsx` (sin cambios en la UI) — la conversión ocurre en la
  frontera, no se propaga el string más allá de esa capa.
- **Autorización del actor, no solo del objetivo** (hallazgo de
  auditoría en tareas hermanas, TAL-12/TAL-16 — ver comentario completo
  en `convex/superadmin.ts::requireSuperAdmin`): las cinco funciones
  reciben el `userId` de quien actúa (`actorUserId`) y vuelven a
  comprobar `isSuperAdmin` en fresco dentro de la propia función, en vez
  de confiar en que Next.js ya lo comprobó antes de llamar. Aplicado
  también a las tres lecturas, no solo a `addAdmin`/
  `removeAdminEverywhere` — el panel expone emails/roles de todo el
  sistema, información tan sensible como las propias escrituras.
- **`addAdmin`/`removeAdminEverywhere` en una sola mutation cada una**
  (mismo motivo que el punto anterior): comprobar existencia/rol y
  actuar siempre dentro de la misma función, nunca repartido en varias
  llamadas desde Next.js — evita la ventana de carrera (TOCTOU) que
  costó rondas de auditoría a TAL-12/TAL-16.

### Evidencia (TAL-15)

Verificado contra un deployment de desarrollo propio y aislado
(`wandering-goose-523.convex.cloud`, mismo criterio que TAL-13 mientras
TAL-12/TAL-16 no estén mergeadas), con un cliente externo real
(`ConvexHttpClient`, mismo mecanismo de base que `fetchQuery`/
`fetchMutation`):

1. **Las cinco funciones rechazan a un actor que no es Super Admin**
   (`requireSuperAdmin`) — probado con un usuario real sin el flag,
   las cinco devuelven "No autorizado."
2. **`listCalendarsWithStats`**: dos calendarios de prueba con rangos
   distintos → `status` correcto en los dos extremos (`upcoming` para
   uno que empieza en el futuro, `finished` para uno que ya terminó);
   `daysCount`/`invitedCount` correctos; `viewedCount` = 2 tras marcar 2
   vistas reales de 2 usuarios distintos sobre el mismo día (confirma la
   suma, no una deduplicación por usuario).
3. **`addAdmin`**: email inválido → `{ok:false, error:"invalid-email"}`;
   ascenso real de una persona ya GUEST (con invitación viva) a ADMIN →
   `{ok:true}`, confirmado releyendo `listAdmins`.
4. **`removeAdminEverywhere`**, los dos caminos reales: sobre alguien con
   invitación viva en ese calendario → degradado a GUEST (fila de
   `calendarMemberships` sigue existiendo, `role: "GUEST"`, confirmado
   con `npx convex data calendarMemberships`); sobre alguien sin
   invitación → la fila desaparece por completo. Los dos casos
   verificados en la misma pasada, no solo razonados por separado.

`npx next build`/`npx eslint .` limpios; `npx convex dev
--typecheck=enable` limpio; `AGENTS.md` intacto.

Scripts de prueba no comprometidos al repo (mismo criterio que el resto
del proyecto); los resultados quedan documentados aquí.
