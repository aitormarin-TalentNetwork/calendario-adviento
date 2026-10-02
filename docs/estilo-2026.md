# Estilo 2026 — estilo base de la app (TAL-61)

Normativo: `design/design-system.md` § "Estilo 2026" (Tipografía, Color,
Forma, y la tabla de tokens de texto con contraste AA). Mockup:
`design/propuesta-estilo-moderno.html`. Este documento recoge cómo está
implementado y la frontera con TAL-62 (skins).

## Tipografía

- **Plus Jakarta Sans** con `next/font/google` (`src/app/layout.tsx`): pesos
  400-800, `latin` + `latin-ext`. next/font la descarga en el build y la
  sirve desde `/_next/static/media/…`: no hay peticiones a Google en tiempo
  de ejecución.
- Un único token `--font`. Desaparecen `--font-display` (serifa),
  `--font-body` y `--font-mono` (monoespaciada) con todos sus usos, también
  dentro del calendario: un skin nunca cambia la fuente.
- Jerarquía por peso: `h1` 800 y `letter-spacing: -0.02em`; títulos de
  diálogo y de grid 800; etiquetas 600-700.
- Números y fechas con `tabular-nums`: clase `.num` (cuenta atrás, número de
  día, rangos de fechas, link de invitación) e `input[type="date"]`.
- `button, input, select, textarea, code` heredan solo la **familia**
  (`font-family: inherit`), no el tamaño: así no cambia la geometría de
  ningún control.

## Color — tokens "Alegre"

`src/app/globals.css`, en `:root` (claro) y en los dos bloques de oscuro
(`prefers-color-scheme` y `[data-theme="dark"]`). Cada token tiene un único
uso (decisión del PM, 2026-10-01):

| Token | Uso |
|---|---|
| `--bg`, `--surface`, `--surface-2` | Fondo de página, tarjetas/menús/diálogos, superficie hundida |
| `--ink`, `--ink-dim`, `--line` | Texto, texto secundario, bordes |
| `--primary`, `--coral` | **Solo superficies y acentos**, nunca texto sobre `--bg`/`--surface` |
| `--sun`, `--mint` | Foco/"hoy" y estados positivos |
| `--primary-soft`, `--coral-soft`, `--mint-soft` | Fondos pastel |
| `--primary-ink` | Texto y enlaces violetas |
| `--primary-btn` | Fondo del botón primario (texto blanco) |
| `--on-sun` | Todo texto sobre `--sun` |
| `--coral-ink` | Texto de peligro |
| `--coral-btn` | Fondo de los botones de peligro (texto blanco) |
| `--accent` | Acento que un skin puede sobrescribir dentro del calendario; fuera, `--primary` |
| `--icon-tile-bg`, `--icon-tile-fg` | Recuadro de icono de portada (acordado con TAL-60) |

Fuera la paleta anterior (pino, dorado, berry, papel, mist) y los tokens que
solo existían por ella (`--accent-ink`, `--nav-*`, `--door-*`, `--danger`,
`--day-open-bg`, `--weekend-text`, `--invite-link-bg`).

**Renombrado de tokens semánticos** (`--bg-raised→--surface`,
`--bg-sunken→--surface-2`, `--text→--ink`, `--text-dim→--ink-dim`,
`--border→--line`): `scripts/tal61-rename-tokens.mjs`, determinista e
idempotente. Al rebasar otra rama sobre TAL-61, pasarlo sobre sus ficheros
(`node scripts/tal61-rename-tokens.mjs`; `--check` para comprobar).

## Forma

- Radios: `--radius-xl` 28, `--radius-lg` 20, `--radius-md` 14 (inputs,
  recuadros de icono), `--radius-sm` 12 (casillas), `--radius-pill` 999.
- **Botones de texto OPT-IN**: `.btn` (secundario), `.btn-primary`,
  `.btn-danger` (texto `--coral-ink`), `.btn-danger-solid` (fondo
  `--coral-btn`). No hay ninguna regla sobre el elemento `button`.
- **Quedan fuera de `.btn` a propósito** (conservan su geometría; solo
  cambian los tokens de color): puertas del invitado, casillas del editor,
  cierres ✕ de los diálogos, segmentados URL/Subir, miniatura de la vista
  previa, muestras de skin, selector y rejilla de iconos, botón de copiar,
  botones del menú de la cuenta. Lo comprueba
  `e2e/tal61-estilo-base.spec.ts` (caso 5) contra medidas de referencia.
- **Campos**: estilo base solo para `input` de tipo text, email, url, date,
  search, password, number y tel, más `select` y `textarea`. Radios,
  checkboxes, hidden, file, color y range quedan fuera por construcción.
- `.card`: `--surface`, `--radius-lg`, `--shadow`.
- Aviso de vídeo no incrustable del editor de días (TAL-66,
  `.day-video-warning`): es un aviso, no un error, así que franja `--sun`
  (no `--coral`), fondo `--surface-2` y texto `--ink`.

## Frontera con TAL-62 (skins)

- **TAL-61:** tokens globales, tipografía en toda la app, formas y colores
  de la app fuera del calendario, y dentro del calendario solo el cambio
  mecánico de tokens (los viejos desaparecían): `door-grid.tsx`,
  `countdown-marker-loader.tsx`, `c/[calendarId]/page.tsx`,
  `calendar-cover-header.tsx`, `calendar-preview.tsx` y
  `DEFAULT_SKIN_APPEARANCE` (ahora el skin "Alegre": `--bg`/`--primary`/`--ink`).
  Sin tocar ninguna geometría.
- **TAL-62:** catálogo de 8 skins, cómo pinta cada skin la portada, la cuenta
  atrás y el grid (valores inline de la tabla `skins`: `background`,
  `--accent`, `textColor`, `textPill`), radios/forma de las casillas del
  invitado y migración de calendarios.
