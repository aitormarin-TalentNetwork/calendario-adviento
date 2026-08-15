# Stack técnico

Decisión tomada como parte de TAL-1 (setup del proyecto y despliegue).

## Elección

- **Framework**: [Next.js](https://nextjs.org/) 16 (App Router) + TypeScript, con
  `src/`.
- **Runtime**: Node.js (v20+; en desarrollo se ha usado Node 26).
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
- **Base de datos**: PostgreSQL (plugin gestionado de Railway) + Prisma como ORM —
  se define en detalle en TAL-3 (Modelo de datos base). Ninguna de las dos está
  todavía provisionada ni instalada; no hay recurso compartido que reclamar por
  ahora (ver `intro-terminal.txt`, sección Configuración de este proyecto).
- **Almacenamiento de vídeo**: el PRD permite subir vídeo o enlazarlo. Qué backend
  de almacenamiento usar para los uploads (Railway volume, S3-compatible, etc.) se
  decide cuando se aborde esa funcionalidad — no era necesario para el "hola
  mundo" de este ticket.

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
