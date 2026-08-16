# Modelo de datos base (TAL-3)

## Capa de persistencia

`docs/stack.md` (TAL-1) ya apuntaba PostgreSQL + Prisma como plan para esta
tarea, sin dejarlo cerrado del todo. Se confirma aquí: **PostgreSQL + Prisma
ORM 7**, con el adaptador `@prisma/adapter-pg` (Prisma 7 exige un driver
adapter explícito, ya no conecta solo con la `DATABASE_URL` del datasource).

En producción, la base de datos la provisiona el plugin gestionado de Postgres
de Railway — todavía no está creada; queda para cuando otra tarea la
necesite en despliegue real (esta tarea solo pedía "migraciones/schema inicial
aplicable" y evidencia de que corre limpio, no desplegar la BD). Para
desarrollar y verificar esta tarea se ha usado un Postgres 16 local (Homebrew,
`brew install postgresql@16`), con una base `calendario_adviento_dev` — ver
sección "Cómo levantar el entorno local" más abajo.

## Entidades y relaciones

- **User** — una persona autenticada con Gmail (login real llega en TAL-2).
  `isSuperAdmin` es un flag global, independiente de cualquier calendario
  concreto (gestiona todo el sistema). El rol Admin/Guest de un calendario
  concreto **no** es un campo de User — depende de la relación con ese
  calendario en particular (ver `CalendarMembership`), porque la misma
  persona puede ser Admin de un calendario e Invitado de otro.
- **Calendar** — un calendario de adviento. `name` es el nombre interno
  (solo lo ve quien administra); `coverTitle` y `coverImageUrl` son el título
  alegre y la foto de portada configurables que ve el invitado en el login
  (PRD + mockup, campo "Título de portada"/"Foto de portada" en la ficha de
  edición del Admin). `startDate`/`endDate` acotan el calendario. Referencia
  a un `Skin` fijo.
- **CalendarMembership** — tabla intermedia N:M entre `User` y `Calendar` con
  un `role` (`ADMIN` | `GUEST`) colgando de la relación, no del usuario. Único
  por `(calendarId, userId)`.
- **Day** — un día del calendario: `date`, `videoUrl` (vale tanto para un
  enlace externo como para la ruta de un vídeo subido — qué backend de
  almacenamiento se usa para las subidas sigue pendiente, ver
  `docs/stack.md`) y `message` opcional. Único por `(calendarId, date)`, para
  que no pueda haber dos "puertas" del mismo día en el mismo calendario.
- **Invitation** — email + calendario, **sin campo de estado** (así lo pide
  el brief de TAL-3): el Admin invita por email; cuando esa persona entra con
  Gmail se resuelve creando/vinculando su `User` y su `CalendarMembership`
  como `GUEST` — no hace falta rastrear "pendiente/aceptada" aparte. Único
  por `(calendarId, email)`, para no duplicar invitaciones a la misma
  persona.
- **Skin** — catálogo fijo de temas visuales. "Fijo" quiere decir que no lo
  crea el Admin desde la UI: se siembra con `prisma/seed.ts`
  (`npx prisma db seed`), idempotente (upsert por `key`). Añadir, renombrar o
  quitar un skin es solo tocar el seed, no el schema. Se han sembrado 4 —
  `pine`, `berry`, `midnight`, `gold` — a partir de los 4 swatches del
  selector de skin en `design/mockup-mvp.html` (`.skin-a`..`.skin-d`); los
  nombres/colores exactos son un detalle de producto que puede afinar el PM
  más adelante sin tocar el modelo.

## Migraciones

- `prisma/migrations/20260816001901_init/migration.sql` — migración inicial,
  crea las 6 tablas (`User`, `Calendar`, `CalendarMembership`, `Day`,
  `Invitation`, `Skin`), el enum `CalendarRole`, los índices únicos y las
  claves foráneas (con `onDelete: Cascade` en las relaciones que cuelgan de
  un `Calendar`, para que borrar un calendario borre también sus días,
  invitaciones y membresías).
- Para regenerar/aplicar en un entorno nuevo: `npx prisma migrate deploy`
  (producción/CI) o `npx prisma migrate dev` (desarrollo, crea+aplica si hay
  cambios de schema sin migración todavía).

## Cómo levantar el entorno local

1. Postgres 16 local: `brew install postgresql@16`, después
   `LC_ALL="en_US.UTF-8" pg_ctl -D /opt/homebrew/var/postgresql@16 -l /tmp/pg16.log start`
   (el `LC_ALL` hace falta en este Mac, si no falla el arranque).
2. `createdb calendario_adviento_dev`.
3. `.env` (no versionado): `DATABASE_URL="postgresql://<tu_usuario>@localhost:5432/calendario_adviento_dev?schema=public"`.
4. `npx prisma migrate dev` — aplica las migraciones.
5. `npx prisma db seed` — siembra el catálogo de Skin.

## Recurso compartido entre terminales — todavía no aplica

Esta tarea solo ha usado una base de datos **local** a esta máquina/worktree,
no compartida con nadie — no hay turno que reclamar. En cuanto haya que
provisionar una base de datos real compartida (Railway Postgres, para que
TAL-2/TAL-4/TAL-5 trabajen contra los mismos datos), eso sí será un recurso
compartido entre terminales y hay que documentarlo aquí y avisar a la
Directora para añadirlo a `intro-terminal.txt` antes de que haga falta un
segundo desarrollador tocándolo — todavía no ha llegado ese punto.
