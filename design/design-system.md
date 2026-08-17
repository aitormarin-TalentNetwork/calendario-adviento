# Design System — Calendario de Adviento

> **Documento normativo, no una sugerencia.** Cualquier pantalla o componente nuevo
> sigue esto a rajatabla. Si una tarea necesita desviarse por un motivo de ingeniería
> real (estado de cliente, rendimiento, lo que sea), se consulta con el PM **antes** de
> implementarlo — nunca se decide en silencio quien construye la tarea.
>
> Fuente: `design/mockup-mvp.html` (validado 2026-08-15) + `design/propuesta-skins.html`
> (skins + selector de icono, validado 2026-08-16) + `design/propuesta-grid-calendario.html`
> (grid de calendario, validado 2026-08-16). Las tres piezas están cerradas — este
> documento ya no tiene secciones provisionales.

## Tokens

### Color

| Token | Hex | Uso |
|---|---|---|
| `--pine` | `#1b3a2f` | Fondo principal (nav, portadas, fondo oscuro) |
| `--pine-2` | `#234a3b` | Variante más clara de pine (avatares, degradados) |
| `--paper` | `#f6f1e4` | Fondo claro / texto sobre fondo oscuro |
| `--paper-2` | `#efe7d4` | Superficie hundida sobre fondo claro |
| `--gold` | `#c99a3d` | Acento primario (CTA, foco, "hoy") |
| `--gold-2` | `#e3bb63` | Variante de gold para dark mode / hover |
| `--berry` | `#8c2f39` | Acento secundario, uso puntual (alertas, un segundo color en skins, número de fin de semana en el grid — modo claro) |
| `--berry-2` | `#e08a92` | Variante de berry para dark mode (mismo criterio que `--gold`/`--gold-2`) — usar en dark mode donde el diseño pida `--berry`, para mantener contraste suficiente sobre fondo oscuro |
| `--ink` | `#16211c` | Texto sobre fondo claro |
| `--mist` / `--border` | `#d9e0d6` (claro) / `#ded3ba` | Bordes, divisores |

**Modo claro/oscuro:** el fondo por defecto es `--paper` (claro); en `prefers-color-scheme: dark` o `data-theme="dark"`, el fondo pasa a un pine casi negro (`#0f1e17`) con `--gold-2` como acento — ver `mockup-mvp.html` para los valores exactos de cada token en dark mode.

### Tipografía

| Rol | Stack | Uso |
|---|---|---|
| Display | `"Iowan Old Style", "Palatino Linotype", Palatino, "URW Palladio L", Georgia, serif` | Títulos, nombres de calendario, número de día grande |
| Body | `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` | Texto de interfaz, formularios, botones |
| Mono | `ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono", Consolas, monospace` | Fechas, contadores, datos tabulares (`font-variant-numeric: tabular-nums`) |

### Espaciado y forma

- Radio de borde: `8px` (inputs/botones pequeños), `10-14px` (tarjetas/paneles), `999px` (píldoras/botones redondeados).
- Sombra estándar: `0 1px 2px rgba(20,30,20,0.06), 0 8px 24px rgba(20,30,20,0.08)` (modo claro) — más intensa en dark mode.
- Layout: flex/grid con `gap`, nunca márgenes sueltos entre hermanos.

## Componentes

### Botones

- **Primario** (`btn-primary`): fondo `--gold`, texto oscuro, negrita — acciones principales (guardar, crear, invitar).
- **Secundario/ghost**: fondo transparente o `--bg-raised`, borde `--border` — acciones secundarias.
- **Peligro**: texto `--berry`, sin fondo — borrar/quitar.
- Todos con `:focus-visible` marcado (outline de `--gold`).

### Tarjetas (`card`)

Fondo `--bg-raised`, borde `1px solid var(--border)`, radio `10-14px`, sombra estándar. Usadas para: tarjetas de calendario (panel Super Admin), paneles de contenido.

### Formularios

Inputs con borde `--border`, fondo `--bg`, radio `8px`. Labels en mayúsculas pequeñas (`0.76rem`, `letter-spacing: 0.05em`, color `--text-dim`).

### Grid de días — invitado y editor de Admin (reemplaza el patrón del MVP shippeado)

**Validado con Aitor, 2026-08-16 — sustituye por completo el grid plano de N columnas
del MVP original.** Fuente: `design/propuesta-grid-calendario.html`.

- **Calendario de pared real**: filas de 7 días, **lunes a domingo**, agrupados por mes.
- **Cabecera de mes fija** (sticky) al hacer scroll — el contenedor tiene scroll vertical
  cuando hay más de un mes de días que mostrar.
- Fila de iniciales de día de la semana (L M X J V S D) encima de cada mes.
- **Número de día grande, en negrita, sans-serif** (family `--font-body`, no
  `--font-display` — decisión explícita de Aitor, los números NO llevan serifa),
  centrado en la casilla por defecto.
- **Sábado y domingo en `--berry`** (rojo), igual que un calendario de pared impreso
  clásico — el resto de los días en `--text`.
- **"Hoy"**: borde punteado en `--gold` alrededor de la casilla, número también en
  `--gold`.
- **Bloqueado** (día futuro): casilla atenuada (`opacity: 0.4`), número más pequeño,
  icono de candado 🔒 en la esquina inferior derecha — sin click.
- **Abierto, sin ver**: fondo `--paper-2` (claro) / `--pine-2` (oscuro), número grande
  normal, click habilitado.
- **Visto**: fondo = fotograma del vídeo (o color de relleno si no hay miniatura real
  todavía), número se reduce y baja a la esquina inferior derecha, en una píldora
  semitransparente sobre el fotograma — clic reabre el vídeo.
- Modal de vídeo: `<iframe>` de YouTube/Vimeo/Drive centrado, mensaje del día debajo —
  sin cambios respecto al MVP shippeado, esta parte no se toca.

### Skins

**Validado con Aitor, 2026-08-16.** Fuente: `design/propuesta-skins.html`. Catálogo
inicial de **22 skins** (los 4 del MVP shippeado — Dorado/Grosella/Medianoche/Pino — más
18 nuevas: Nochebuena, Nieve, Confeti, Dorado Real, Bosque Nórdico, Neón Fiesta,
Historieta, Enamorados, Oficina, Superhéroe, Bebé, Adolescente, Memorias de Familia,
Amigas, K-pop, Gótico, Baloncesto, Fútbol). Cada skin es, como mínimo, un color/degradado
de fondo + un color de acento — aplicado consistentemente a portada, grid de días y
modal.

**Marcas registradas — regla dura:** cuando una skin pedida hace referencia a una IP con
copyright/marca (personajes, logos, nombres de club o liga, branding de una serie
concreta), se construye una versión **genérica** que capture el espíritu visual sin
reproducir el asset protegido — nunca el logo, nombre o personaje real. Ejemplos ya
resueltos así: "Historieta" (no "Turma da Mônica"), "Oficina" (no "The Office"),
"Baloncesto" (no NBA), "Fútbol" (colores azulgrana genéricos, no escudo/nombre del
Barça).

**Arquitectura — catálogo ilimitado (requisito explícito de Aitor):** los skins son
registros reales en una tabla de Convex (`skins`: key, name, description — ver
`convex/schema.ts`), listados dinámicamente (`skins.listAllPublic()`) — **cero
hardcodeo, cero enum fijo en frontend.** Añadir un skin nuevo (el #23, el #50) es
insertar un registro, no tocar código. Hoy el alta de un skin nuevo se hace por
script/CLI (no hay UI de gestión en la app todavía — Aitor confirmó que esto es
suficiente por ahora, no hace falta una pantalla de Super Admin para ello).

### Selector de icono de portada (Admin)

**Validado con Aitor, 2026-08-16.** Fuente: `design/propuesta-skins.html`. Sustituye el
icono fijo en código (🎄) por un selector real en el editor de calendario:
- Buscador arriba (`🔍 Buscar icono…`).
- Galería organizada en **categorías**: Navidad, Fiesta, Cariño, Naturaleza y cielo,
  Animales y fantasía — ~45 emoji en total, incluye 🦄, 🌈 y ❤️ explícitamente pedidos.
- Icono seleccionado con borde `--gold` + fondo `--paper-2`.
- Mismo patrón de "catálogo sin límite fijo" que los skins — la lista de iconos puede
  crecer sin tocar código si en algún momento se decide.

### Indicador de sesión

**TAL-28.** Sustituye el texto plano "Sesión: email (ROL)" + botón "Cerrar sesión" en
las 4 pantallas autenticadas (Admin, editor de calendario, Super Admin, Invitado) por un
indicador fijo en la esquina superior derecha:
- Foto de perfil de Gmail del usuario (viene del perfil OAuth de Google — se guarda en
  `users.image`, Convex, y se refresca en cada login si cambia). Si no hay foto (login de
  desarrollo, o el usuario todavía no tiene una guardada): círculo `--pine-2` con la
  inicial del email en `--paper`, tipografía `--font-display`.
- Botón de cerrar sesión SOLO icono ("🚪"), sin texto visible — evita palabras en un
  idioma concreto.
- El email (y el rol, si aplica) sigue disponible como `title`/`aria-label` del avatar —
  no se pierde la información, solo deja de ocupar espacio permanente en pantalla.
- Componente compartido `SessionIndicator` (`src/components/session-indicator.tsx`),
  `position: fixed`, mismo patrón en las 4 pantallas.

## Cómo se usa este documento

1. Toda tarea de Linear que toque UI enlaza a este fichero explícitamente en su
   descripción, con el texto "sigue el Design System (`design/design-system.md`) a
   rajatabla".
2. El PM (yo) verifica visualmente contra este documento antes de dar una pantalla por
   cerrada — no solo que funcione, que además cumpla el Design System (ver `pm.md`,
   "Lo entregado es tu responsabilidad").
3. Cualquier cambio de diseño (nuevo componente, nueva paleta, ajuste de un patrón
   existente) se valida primero con Aitor (mockup o vista previa), y **solo entonces**
   se actualiza este documento — nunca al revés.
