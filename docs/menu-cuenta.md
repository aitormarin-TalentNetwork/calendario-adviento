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
