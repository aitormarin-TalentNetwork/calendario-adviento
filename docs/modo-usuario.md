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
- Portada: estilo del skin resuelto con el catálogo 2026 (`resolveSkinStyle`; la fila
  solo trae `skin._id` desde TAL-72), con respaldo Alegre si el skin no existe o está
  fuera del catálogo.
- **TAL-85 — foto de portada** (`src/app/c/calendar-card-cover.tsx`): con
  `coverImageUrl` (lo trae la fila de Convex desde TAL-85; ausente en un Convex anterior),
  la foto va encima de la portada de siempre, invisible hasta que carga de verdad
  (`useImageStatus`). Al cargar: degradado inferior y píldora "En marcha" / "Próximo"
  (`.status-pill`) arriba a la izquierda; terminado, sin píldora. Si no carga, o no hay
  foto, la portada exactamente como antes: `backgroundImageUrl` (con su capa oscura) si
  existe y, si no, el color del skin con el icono (decisión del PM, 2026-10-14). Con foto
  la portada mide 130 px desde el principio (sin salto al cargar); sin ella, 110 px.
  La foto va con `loading="lazy"`: fuera de pantalla no se pide hasta acercarse (mientras,
  la capa base; `useImageStatus` no lo toma por error porque aún no hay `currentSrc`).

## Aterrizaje

- El destino por defecto del login sin `callbackUrl` sigue siendo `/admin`.
- `/admin` redirige a `/c` a quien no es Super Admin ni Admin de ningún
  calendario (`src/app/admin/page.tsx`, justo tras `listAdminCalendars`), antes
  de pintar nada de administración. Admin y Super Admin se quedan en `/admin`.
- El link de invitación (`/c/<id>` → `/login?callbackUrl=/c/<id>` → `/c/<id>`)
  no cambia: `callbackUrl` manda sobre el destino por defecto.
- Sin bucles: `/c` nunca redirige a `/admin`; `/c/<id>` sin acceso →
  `/unauthorized`.
