# Modo Usuario — "Tus calendarios" y aterrizaje tras el login (TAL-58)

Diseño: `design/design-system.md` § "Tus calendarios" — lista del modo Usuario
(mockup `design/propuesta-selector-modo.html`). El selector Usuario | Admin y el
menú del avatar son de TAL-59, no de esta tarea.

## Ruta: `/c`

`src/app/c/page.tsx`. `/c` es el índice natural de `/c/<id>` y ya lo protege
`src/proxy.ts` (`matcher` `/c/:path*` también coincide con `/c`).

- 0 calendarios → "Todavía no tienes ningún calendario. Cuando alguien te
  invite, aparecerá aquí." (texto aprobado por el PM).
- 1 → `redirect("/c/<id>")`, sin pasar por la lista.
- Varios → tarjetas; cada una lleva a `/c/<id>`.

## Qué calendarios salen

`convex/calendars.ts::listUserModeCalendarsHandler` (pública:
`listUserModeCalendarsPublic`, con el secreto de servidor de siempre):

1. Memberships del usuario (`by_user`), ADMIN y GUEST.
2. Invitaciones **pendientes** por su email (`invitations.by_email`): un
   invitado que todavía no abrió su link no tiene membership — se crea al
   aceptar en `/c/<id>` (`access.ts::resolveMemberAccessHandler`). Esta query
   no acepta nada ni crea memberships.

El email se deriva del usuario cargado por `userId`, nunca llega como argumento.
Deduplicado defensivo por `calendarId` (`by_calendar_and_user` no es único en
Convex; lo garantizan las mutations): una tarjeta por calendario, ADMIN gana a
GUEST. Un Super Admin ve solo los calendarios donde tiene membership o
invitación — su acceso global no los hace "suyos".

## Tarjetas

`src/lib/user-mode-calendars.ts` (funciones puras, probadas directamente):

- Título: `coverTitle`, con `name` de respaldo (decisión del PM).
- Línea secundaria: "Lo administras tú" si es Admin; si no, rango corto de
  fechas — "1 dic – 24 dic 2026", "28 dic 2026 – 6 ene 2027" (meses fijos en
  español, no `Intl`, que da "dic." y depende de ICU).
- Etiqueta "Admin" en los que administra.
- Portada: fondo del skin (`skinBackgroundStyle`) con respaldo
  `DEFAULT_SKIN_APPEARANCE` si el skin no existe o le faltan campos.

## Aterrizaje

- El destino por defecto del login sin `callbackUrl` sigue siendo `/admin`.
- `/admin` redirige a `/c` a quien no es Super Admin ni Admin de ningún
  calendario (`src/app/admin/page.tsx`, justo tras `listAdminCalendars`), antes
  de pintar nada de administración. Admin y Super Admin se quedan en `/admin`.
- El link de invitación (`/c/<id>` → `/login?callbackUrl=/c/<id>` → `/c/<id>`)
  no cambia: `callbackUrl` manda sobre el destino por defecto.
- Sin bucles: `/c` nunca redirige a `/admin`; `/c/<id>` sin acceso →
  `/unauthorized`.
