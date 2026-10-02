# Menú de la cuenta y modo Usuario | Admin (TAL-59)

Diseño: `design/design-system.md` § "Menú de la cuenta (avatar)" y el mockup
`design/propuesta-selector-modo.html`. Este documento recoge las decisiones
técnicas.

## Qué hay en pantalla

En la esquina superior derecha de todas las pantallas autenticadas solo queda
la foto de Google (`users.image`; la inicial sobre `--pine-2` como respaldo).
Al pulsarla se abre el menú:

1. El email (solo referencia).
2. **Modo**: "Usuario" / "Admin". Solo para quien puede usar el modo Admin.
3. La lista de calendarios para saltar, solo si hay más de uno en el modo
   actual: en modo Admin, los que administra (`/admin/<id>`); en modo
   Usuario, los de "Tus calendarios" (`/c/<id>`, TAL-58). El actual va
   marcado (`aria-current="page"`).
4. "Cerrar sesión" (icono + texto). Sustituye al botón suelto de TAL-28.

## Piezas

- `src/components/session-indicator.tsx` — Server Component. Recibe el
  usuario, el modo de la pantalla y el calendario actual; carga los datos del
  menú (`listAdminCalendars` o `listUserModeCalendars`) y pinta el menú.
  `/admin` le pasa la lista que ya cargó (prop `adminCalendars`) para no
  repetir la consulta.
- `src/components/account-menu.tsx` — Client Component, patrón WAI-ARIA
  "menu button" sin librerías: teclado (Enter/Espacio/↓/↑, Home/End,
  Escape devuelve el foco al avatar, Tab cierra), cierre al pulsar fuera y al
  navegar. El icono de cada fila se pinta en un único sitio
  (`CalendarRowIcon`), pensando en TAL-60 (iconos Lucide).
- `src/app/account-actions.ts` — Server Actions `switchModeAction` (cambia y
  recuerda el modo) y `signOutAction`.
- `src/app/start/page.tsx` — aterrizaje tras el login.
- `src/lib/roles.ts::canUseAdminMode(user, administeredCount)` — la única
  definición de "puede usar el modo Admin" (Super Admin, o Admin de al menos
  un calendario). Pura: cada llamador le pasa los datos que ya tiene. La usan
  `/start`, el redirect de `/admin` (TAL-58), el menú y `switchModeAction`.

## Decisiones

- **El modo actual es la ruta**, no un estado aparte: `/admin*` y
  `/superadmin` son modo Admin; `/c*` es modo Usuario. Cada página le pasa
  su `mode` al indicador, así que el modo marcado siempre corresponde a la
  pantalla.
- **"Recordar el último modo" = la última elección explícita en el menú**,
  guardada en Convex (`users.preferredMode`, opcional), no en una cookie:
  sobrevive al logout, a borrar cookies y entre dispositivos, y no obliga a
  escribir nada en cada render. Abrir un link de invitación (`/c/<id>`) no
  cuenta como cambiar de modo.
- **`/start` como destino por defecto del login** (`src/app/login/page.tsx`):
  un invitado puro va siempre a `/c`; un Admin/Super Admin, a su
  `preferredMode` (Admin si nunca eligió). Va en una ruta propia y no en
  `/admin` para que elegir "Admin" o entrar a `/admin` a mano no rebote según
  el modo recordado. Con `callbackUrl` (link de invitación) el login no pasa
  por `/start`.
- **`switchModeAction` re-autoriza en el servidor**: valida el modo recibido
  y, para "admin", vuelve a aplicar `canUseAdminMode`. Quien no puede usarlo
  acaba en `/c` sin que se guarde nada (probado reenviando la petición real
  con la sesión de un invitado puro).
- `listAdminCalendars` devuelve también `coverIcon`, con el respaldo
  `DEFAULT_COVER_ICON` resuelto ahí (Convex ya mandaba el documento entero).

## Tests

`e2e/tal59-account-menu.spec.ts` (ver `docs/e2e.md`): menú y contenido por
rol, iconos y respaldo, teclado, pulsar fuera, cambio de modo, recordar el
modo tras logout/login, prioridad de `callbackUrl`, invitado puro forzando el
modo Admin, y 375px (avatar ≥ 44×44, menú dentro de pantalla, filas ≥ 44px).

## TAL-64 — el Super Admin administra todos los calendarios

- `convex/calendars.ts::listCalendarsForUserHandler` (detrás de
  `listAdminCalendars`) carga el usuario por `userId` y lee `isSuperAdmin` en
  fresco en la misma query: el Super Admin recibe **todos** los calendarios, el
  resto solo los que administra por membership ADMIN. Nunca se acepta un
  booleano del cliente.
- Cada fila trae `isAdminMember` (membership ADMIN en ese calendario). En
  "Mis calendarios" (`/admin`), los del Super Admin sin membership llevan la
  etiqueta "Super Admin" (clase `.calendar-card-tag` de TAL-58).
- Como `/admin`, el menú ("Administrar") y `canUseAdminMode` comparten
  `listAdminCalendars`, el Super Admin ve todos en los tres sitios. El panel
  del menú tiene `max-height` y scroll propio.
- Las tarjetas de `/superadmin` son enlaces a `/admin/<id>`.
- El acceso al editor y a sus Server Actions ya aceptaba al Super Admin sin
  membership (`resolveCalendarAccess`, y en Convex `deleteCalendarAsUser` y
  `removeGuestEverywhere`); no se tocó autorización, se cubre con
  `e2e/tal64-superadmin-all-calendars.spec.ts`.
- **Escala:** listar todos es un `collect()` sin límite (como `/superadmin`,
  ver `docs/convex-diseno-tal15-panel-superadmin.md`), sin N+1 de días ni
  vistas. Si algún día hay cientos de calendarios: paginar con `.paginate()`
  e índice por creación, y en el menú mostrar los más recientes más un
  "Ver todos" hacia `/admin`.

## TAL-68 — modo «Super Admin»

- Quien es Super Admin ve una tercera opción en «Modo»: **Usuario | Admin |
  Super Admin**. «Super Admin» lleva a `/superadmin`, que pasa `mode="superadmin"`
  al indicador (la opción queda marcada). En ese modo el menú no lista
  calendarios: `/superadmin` ya los muestra todos.
- **Una sola regla**, pura, en `src/lib/account-modes.ts`:
  `allowedModes(user, administeredCount)` (menú), `isAllowedMode` (Server
  Action) y `landingPath` (`/start`). `canUseAdminMode` vive ahí y `roles.ts`
  la reexporta.
- **Recordar el modo**: `users.preferredMode` admite `"superadmin"`.
  - `switchModeAction` lo valida con `isAllowedMode` (con `isSuperAdmin` en
    fresco); un modo no permitido no guarda nada y redirige a `/start`.
  - **Convex lo vuelve a exigir** en `setPreferredModeHandler`, en la misma
    transacción que la escritura: «No autorizado.» si `isSuperAdmin !== true`
    (o con la congelación activa). La Server Action traduce ese rechazo a `/start`.
  - **Valor que ya no es válido**: si le quitan el rol a alguien que guardó
    `"superadmin"`, `landingPath` lo manda a `/admin` (si administra algo) o a
    `/c`, nunca a `/superadmin` ni a `/unauthorized`. Probado con
    `scripts/verify-tal68-stale-superadmin-mode.mjs` (patrón `_scratch_*`, solo
    en desarrollo; no hay ninguna vía desplegada para quitar el rol).

### Orden de despliegue

**Convex primero, Next después.** Next antiguo + Convex nuevo funciona (el
schema solo se amplía y el `/start` antiguo trata cualquier valor distinto de
`"user"` como `/admin`). Next nuevo + Convex antiguo no: guardar
`"superadmin"` fallaría en el validador.

### Rollback

La política es arreglar hacia delante. Revertir falla en `convex deploy` si
algún usuario tiene `preferredMode: "superadmin"` (el schema anterior no lo
acepta): es un fallo seguro, producción sigue como estaba. Si de verdad hay que
revertir, **lo ejecuta quien publica** (Integrador/CEO), nunca una terminal de
trabajo:

0. **Congelar**: `npx convex env set PREFERRED_MODE_SUPERADMIN_FROZEN 1 --prod`.
   `setPreferredModeHandler`, la única función que escribe `preferredMode`,
   rechaza entonces `"superadmin"` (incluso para un Super Admin): el Next
   nuevo no puede volver a escribirlo mientras se limpia.
1. **Limpiar por lotes** (pasa `"superadmin"` a `"admin"`), hasta `isDone: true`:
   ```sh
   cursor=null; while :; do
     out=$(npx convex run --prod users:downgradeSuperadminPreferredMode "{\"cursor\": $cursor}"); echo "$out"
     [ "$(echo "$out" | jq -r .isDone)" = true ] && break
     cursor=$(echo "$out" | jq .continueCursor)
   done
   ```
2. **Verificar** con el mismo bucle sobre `users:countSuperadminPreferredMode`:
   la suma de `withSuperadmin` de todas las páginas tiene que ser **0**. Si no,
   volver al paso 1.
3. **Desplegar el código anterior** (redeploy del commit previo en Railway).
   Ahora `convex deploy` acepta el schema viejo.
4. Quitar la congelación: `npx convex env remove PREFERRED_MODE_SUPERADMIN_FROZEN --prod`.
