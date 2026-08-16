# Panel Super Admin (TAL-4)

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
