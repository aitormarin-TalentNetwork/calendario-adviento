# Stack técnico

Decisión tomada como parte de TAL-1 (setup del proyecto y despliegue).

## Elección

- **Framework**: [Next.js](https://nextjs.org/) 16 (App Router) + TypeScript, con
  `src/`.
- **Runtime**: Node.js (>=20.9.0, mínimo exigido por `next@16.3.1`; en desarrollo
  se ha usado Node 26).
- **Gestor de paquetes**: npm (el que trae el runtime, sin añadir dependencias extra
  de tooling).
- **Estilos**: CSS plano con variables (custom properties), siguiendo la misma
  paleta de tokens que `design/mockup-mvp.html` (pine/paper/gold). Sin framework de
  CSS de terceros por ahora — el mockup no lo necesita y mantiene el bundle ligero.
- **Lint**: ESLint (`eslint-config-next`), ya configurado por el scaffold.
- **Despliegue**: Railway, proyecto "calendario-adviento", servicio conectado al
  repo de GitHub (`aitormarin-TalentNetwork/calendario-adviento`, rama `main`) para
  auto-deploy en cada push.

## Por qué

El PRD y el briefing inicial piden: autenticación con Gmail, roles (Super
Admin/Admin/Invitado), subida/reproducción de vídeo, envío de invitaciones por
email, y varios calendarios con distintos skins — todo detrás de una única
interfaz web. Next.js cubre frontend y backend (API routes / server actions) en un
solo framework y un solo servicio desplegable, lo que encaja bien con Railway (un
solo servicio Node, auto-deploy por push, sin infraestructura propia que mantener)
y evita separar en dos repos/servicios para un MVP de este tamaño.

Quedan **pendientes de decisión en tareas posteriores** (no bloquean TAL-1):

- **Auth**: Auth.js (NextAuth) con proveedor Google, para cubrir el login con
  Gmail tanto de Admin como de Invitado — se define en detalle en TAL-2
  (Autenticación con Gmail).
- **Base de datos**: ver "Migración a Convex" más abajo — Postgres+Prisma
  (TAL-3) fue la elección del MVP, sustituida por Convex a partir de TAL-9/10.
- **Almacenamiento de vídeo**: el PRD permite subir vídeo o enlazarlo. Qué backend
  de almacenamiento usar para los uploads (Railway volume, S3-compatible, etc.) se
  decide cuando se aborde esa funcionalidad — no era necesario para el "hola
  mundo" de este ticket.

## Migración a Convex (TAL-9/TAL-10)

Decisión de Aitor (confirmada por el PM en alcance/timeline) de migrar de
Prisma+PostgreSQL a Convex — bloqueante para el resto de features de
producto hasta cerrar el milestone completo (TAL-9 a TAL-1x). Motivo de
fondo: no era una limitación técnica de Postgres/Prisma en sí (el modelo de
datos del MVP, TAL-3 a TAL-8, quedó cerrado y auditado sin incidentes de
ese tipo) — es una decisión de plataforma de Aitor para el proyecto.

**Qué backend de Convex**: Convex Cloud gestionado (`*.convex.cloud`), no
autoalojado. Investigado a fondo antes de decidir —
`docs/convex-despliegue-investigacion-tal10.md` en el worktree de T2 tiene
el análisis completo comparando ambas opciones; resumen de la
recomendación, verificada contra el estado real antes de construir sobre
ella (no dada por hecha):

- Convex **no aloja el propio Next.js** — la app sigue en Railway en
  cualquiera de los dos casos, el backend de Convex vive aparte.
- Gestionado: sin responsabilidad operativa nueva (réplicas/backups/uptime
  los lleva Convex Inc.), consultas co-localizadas (~1ms), soporte
  oficial. Autoalojado: correría en un solo nodo sin soporte oficial,
  trasladando a nosotros toda la responsabilidad de uptime/backups/réplicas
  — carga operativa que hoy no existe en ningún otro componente del stack:
  el plugin de Postgres de Railway (sí llegó a provisionarse y a usarse en
  producción durante el MVP, `railway status` confirma un servicio
  "Postgres" online en el proyecto real — corrección respecto a una
  afirmación anterior de este documento, que decía lo contrario sin
  haberlo comprobado) también es gestionado por la plataforma, no
  autoalojado por nosotros. Autoalojar Convex sería la primera vez que
  este proyecto asume esa carga operativa en cualquier componente del
  stack.
- Ningún requisito real del proyecto (residencia de datos, cumplimiento
  normativo, presupuesto ajustadísimo) pide autoalojamiento — el propio
  motivo que Convex da para recomendarlo no aplica a este proyecto.
- Reversible más adelante si apareciera un motivo real: mismo
  schema/funciones, solo cambiaría dónde vive el backend.

Proyecto Convex: **`calendario-adviento`**, team **`aitor-marin-6a254`**
(cuenta personal de Aitor). Dos deployments:

- **Desarrollo**: `aitor-marin-6a254:calendario-adviento:dev`
  (`beloved-barracuda-617.convex.cloud`) — el que usa `npx convex dev` en
  local. Ver `docs/convex-modelo-de-datos.md` para cómo se creó y cómo
  desarrollar contra él.
- **Producción**: `aitor-marin-6a254:calendario-adviento:production`
  (`abundant-badger-144.convex.cloud`) — se autocreó junto al proyecto
  (TAL-9) y recibió el primer `npx convex deploy` en TAL-10 (mismo
  schema/funciones que dev, cero datos todavía — no hay tráfico real
  dependiendo de él, porque el servicio de Next.js en producción sigue
  apuntando a Postgres hasta que se ejecute el paso pendiente de más
  abajo; a diferencia de lo que decía una versión anterior de este
  documento, Postgres de producción sí está provisionado y en uso real
  ahora mismo, `railway status` lo confirma).

**Qué cambia en el despliegue de Railway** (Next.js sigue ahí, sin cambio
de plataforma):

- Se quitan las variables de Postgres (`DATABASE_URL`) del servicio.
- Se añaden `NEXT_PUBLIC_CONVEX_URL`/`NEXT_PUBLIC_CONVEX_SITE_URL`
  (`abundant-badger-144.convex.cloud`/`.convex.site`, el deployment de
  producción) como variables del servicio.
- Recomendación de T2 (y la que sigue esta tarea) para que cada deploy de
  Next.js lleve consigo el schema/funciones de Convex al día: build
  command del servicio → `npx convex deploy --cmd 'npm run build'`, con
  `CONVEX_DEPLOY_KEY` (deployment de producción) como variable de entorno
  de build — mismo patrón "auto-deploy en cada push a main" que Railway ya
  usa para Next.js, sin fricción añadida.
- **Pendiente de ejecutar contra el servicio de producción real**: crear
  el `CONVEX_DEPLOY_KEY` (`npx convex deployment token create <nombre>
  --prod`) y aplicar estos cambios de variables/build command al servicio
  de Railway en vivo — bloqueado por el clasificador de permisos de esta
  terminal al intentarlo (creación de credenciales de infraestructura), y
  consistente con el precedente ya documentado en `docs/despliegue.md`
  (TAL-1): tocar infraestructura/cuentas externas de producción real lo
  ejecuta el CEO, no una terminal de trabajo. Verificado en su lugar,
  desde esta terminal: `npx convex deploy` contra el deployment de
  producción (sin `CONVEX_DEPLOY_KEY`, usando la CLI ya autenticada de la
  máquina) — deployó limpio, confirma que el schema/funciones son válidos
  contra ese deployment real, no solo contra el de dev.

**Prisma/Postgres retirados del código** (TAL-10): dependencias
(`@prisma/client`, `@prisma/adapter-pg`, `pg`, `prisma`), el cliente
generado (`src/generated/prisma`, no trackeado), el `postinstall` que lo
regeneraba, `prisma.config.ts` y los scripts que asumían Postgres
(`prisma/seed.ts`, `scripts/dev-seed-fixtures.ts`). Se conserva
`prisma/schema.prisma` y `prisma/migrations/` sin tocar, como referencia
histórica del modelo de datos del MVP — inertes (nada del proyecto los
ejecuta ya), citados desde `docs/modelo-de-datos.md`/`docs/dias.md`/etc.

`src/lib/*.ts` que hacía consultas reales con Prisma Client (`calendars.ts`,
`current-user.ts`, `guest-calendar.ts`, `guests.ts`, `roles.ts`,
`superadmin.ts`) quedó convertido a stubs explícitos por esta tarea, NO
reescrito contra Convex todavía (eso es TAL-12+, fuera de alcance de
TAL-10): cada función devuelve la degradación segura ya contemplada por su
propio tipo de retorno cuando existe una razonable (lista vacía,
`null`/`{ok:false,...}` con el motivo más honesto disponible), o falla
explícitamente cuando no la hay (escrituras sin representación de "vacío",
donde fingir éxito sería peor que un error claro) — nunca inventa datos ni
falla en silencio. El resultado, verificado en local (build limpio, y en
tiempo de ejecución: `/login`, `/admin`, `/superadmin`, `/c/{id}`
devuelven 200/307 sin ningún 500, con y sin sesión real): la app entera se
comporta como "todo el mundo sin autorizar" — cualquier página protegida
redirige a `/login`, que sigue renderizando perfectamente (incluida la
portada personalizada por calendario, que cae a la genérica en vez de
romperse). Es una degradación deliberada y temporal, ya aceptada por el
milestone completo ("se pausa cualquier feature nueva de producto hasta
cerrar todo el milestone", ver brief de TAL-9), no un descuido — cada
stub documenta en el propio fichero por qué esa degradación en concreto es
la correcta y qué haría falta en TAL-12+ para dejar de serlo.

Añadido en su lugar: cliente de Convex en el árbol de la app
(`src/components/convex-client-provider.tsx`, montado en el layout raíz) —
sin `useQuery`/`useMutation` en ningún componente todavía, solo el
`ConvexProvider` en su sitio para que TAL-12+ no tenga que añadirlo.

## Estructura del repo

El esqueleto de la app vive en la raíz del repo, al lado de la documentación de
proceso de la fábrica (`CLAUDE.md`, `AGENTS.md`, `INSTRUCCIONES PARA LA FABRICA DE
SOFTWARE/`, etc.) y de `design/mockup-mvp.html`, sin tocar ninguno de esos
ficheros:

```
src/app/       — App Router de Next.js (páginas, layout, estilos globales)
public/        — estáticos servidos tal cual
docs/          — este documento y futuras decisiones técnicas
```
