# Catálogo de skins (TAL-22)

Amplía la tabla `skins` de Convex (`key`/`name`/`description`, sin cambios
desde TAL-9) con los campos de color que exige el Design System
(`design/design-system.md` § "Skins": "cada skin es, como mínimo, un
color/degradado de fondo + un color de acento") y rellena las 22 filas
del catálogo. **Solo datos** — ningún componente de frontend lee todavía
`skin.background`/`skin.accent` (eso es TAL-24, bloqueada por esta tarea).

## Campos nuevos

- **`background`** (`v.string()`): el valor CSS completo de la propiedad
  `background` — color sólido, `linear-gradient(...)`,
  `conic-gradient(...)`, `radial-gradient(...)` o
  `repeating-linear-gradient(...)`, según necesite cada skin. No se
  modela por stops separados (colores/posiciones en filas o columnas
  aparte) — un string con el CSS real es suficiente para lo que consume
  TAL-24 (aplicarlo directo a un `style.background`), y evita inventar un
  esquema de datos más complejo sin un consumidor real todavía que lo
  necesite.
- **`accent`** (`v.string()`): un único color hex, para elementos que
  necesiten destacar sobre el fondo del skin (número de "hoy", CTA, etc.
  — decisión de TAL-24, no de esta tarea).

Los dos son **`v.optional`** — ver "Migración segura" más abajo para el
porqué (corrección de auditoría, ronda 1: no se pueden declarar
requeridos todavía sin arriesgar romper un deploy real).

## Fuente de los 18 skins nuevos

Valores CSS literales de `design/propuesta-skins.html` (prototipo
validado con Aitor, 2026-08-16) — `background` es el `background` real de
la clase `.p-<skin>` de ese fichero; `accent` se elige entre los colores
de puerta (`.door`)/acentos ya definidos ahí para cada skin (nunca un hex
inventado sin relación con el prototipo). Detalle por skin donde la
elección de `accent` no era obvia (el prototipo define varios colores de
puerta por skin, no un único "accent" con ese nombre):

| Skin | `accent` elegido | Por qué |
|---|---|---|
| Nochebuena | `#c99a3d` (oro) | Tagline explícita "Rojo profundo + **oro** + pino". |
| Nieve | `#4a7f9c` | El azul más saturado de las 4 puertas — el resto son casi el mismo tono que el fondo, sin contraste suficiente para un acento. |
| Confeti | `#f4c542` | Color del `.month-tag`, el único elemento de acento explícito del prototipo (no una puerta). |
| Dorado Real | `#e3bb63` | Extremo más claro del degradado de puerta (`linear-gradient(160deg, #e3bb63, #9c7a2e)`). |
| Bosque Nórdico | `#a9714a` (terracota) | Tagline "Salvia + **terracota** + crudo" — el salvia queda demasiado cerca del propio fondo. |
| Neón Fiesta | `#ff2e88` | Primera puerta, el neón más característico de la paleta. |
| Historieta | `#e63946` | Color del `.comic-badge`, el acento explícito del prototipo. |
| Enamorados | `#8c2f39` (berry) | Tagline "Rosa + **rojo**, romántico" — contrapunto al fondo rosa. |
| Oficina | `#a89b74` | Único color con más saturación que el fondo caqui/beige (el tono de la nota adhesiva es casi blanco, sin contraste). |
| Superhéroe | `#ffd23f` | El color de puerta con más contraste sobre el fondo azul oscuro. |
| Bebé | `#aed9e8` | Primera puerta (celeste), color primario de la paleta pastel. |
| Adolescente | `#f97316` | Extremo más vivo del degradado de fondo (ninguna puerta tiene color sólido, son overlays translúcidos). |
| Memorias de Familia | `#c9b78f` | Extremo más saturado del degradado de fondo (la puerta es casi blanca, sin contraste). |
| Amigas | `#c9a7f5` (lavanda) | Parada intermedia del degradado — distinta de los dos extremos que ya cubre el fondo. |
| K-pop | `#b19cff` | Parada intermedia del degradado (ninguna puerta tiene color sólido, son overlays translúcidos). |
| Gótico | `#8c2f39` (berry) | Color de borde de las puertas 2/4, el único acento con saturación real sobre el fondo casi negro. |
| Baloncesto | `#1a1a1a` | Color base de la puerta (negro), el tono definitorio del esquema naranja/negro/blanco. |
| Fútbol | `#8c2f39` (garnet) | Segunda franja de la raya del fondo, complementa la franja azul marino. |

**Regla dura de marca registrada** (brief, confirmada contra
`design/design-system.md` § "Skins" → "Marcas registradas"): Historieta
(no Turma da Mônica), Oficina (no The Office), Superhéroe/Baloncesto (no
NBA), Fútbol (colores azulgrana genéricos, no escudo/nombre del Barça) —
los cuatro ya vienen resueltos como genéricos en `propuesta-skins.html`;
esta tarea copia esos valores tal cual, sin añadir ningún logo, nombre o
personaje protegido.

## Fuente de los 4 skins originales del MVP

`Dorado`/`Grosella`/`Medianoche`/`Pino` no tienen valores de color en
ningún documento — ni en `design/propuesta-skins.html` (que solo cubre
los 18 nuevos), ni en `design/mockup-mvp.html`, ni en ningún seed/script
anterior (confirmado por búsqueda en todo el repo). El brief de esta
tarea lo confirma explícitamente ("dales sus valores de color reales
también, hoy no los tienen").

Sus propios nombres ya nombran directamente cuatro tokens del Design
System (`design/design-system.md` § "Tokens" → "Color"):

| Skin | Token que nombra | `background` | `accent` |
|---|---|---|---|
| Dorado | `--gold`/`--gold-2` | `linear-gradient(160deg, #c99a3d 0%, #e3bb63 100%)` | `#1b3a2f` (pine, para contraste) |
| Grosella | `--berry` | `linear-gradient(160deg, #8c2f39 0%, #4a1319 100%)` | `#c99a3d` (gold) |
| Medianoche | El "pine casi negro" que design-system.md ya documenta para dark mode (`#0f1e17`) | `linear-gradient(160deg, #0f1e17 0%, #1b3a2f 100%)` | `#e3bb63` (gold-2, mismo acento que usa el propio dark mode del Design System) |
| Pino | `--pine`/`--pine-2` | `linear-gradient(160deg, #234a3b 0%, #1b3a2f 100%)` | `#c99a3d` (gold) |

**Judgment call de esta tarea, documentado y no bloqueante**: son valores
derivados razonadamente de tokens ya existentes del Design System, no
inventados sin fuente — pero no están validados con Aitor como sí lo
están los 18 nuevos (esos vienen de un prototipo HTML que él aprobó
explícitamente). Como TAL-24 (la aplicación visual real) todavía no
existe, nadie ve estos colores todavía — si Aitor prefiere valores
distintos para estos 4 en concreto, es un cambio de datos de una fila
(`npx convex run skins:createSkin '{...}'` con el `key` correspondiente),
no un cambio de schema ni de lógica.

## Idempotencia — `createSkin` pasa a ser un upsert de verdad

`createSkin` (`convex/skins.ts`) antes solo insertaba si la `key` no
existía, e ignoraba la llamada entera si ya existía (ni siquiera
actualizaba `name`/`description`) — pese a que su propio comentario ya lo
llamaba "upsert" desde TAL-9. Para esta tarea hacía falta que sí
actualizara: los 4 skins originales pueden existir ya en algunos
deployments con el shape antiguo (sin `background`/`accent`), y con el
comportamiento de antes, volver a sembrar el catálogo nunca les habría
añadido el color.

Corregido: `createSkin` ahora inserta si la `key` no existe, o hace
`ctx.db.patch` con todos los campos (`name`/`description`/`background`/
`accent`) si ya existe — converge al mismo estado final sin importar el
punto de partida (fila inexistente, fila con el shape antiguo, o fila ya
correcta). Sin riesgo para otros llamadores: es una `internalMutation`
exclusiva de seed vía CLI, ningún código de aplicación la invoca.

`seedSkinCatalog` (nueva, sin argumentos) puebla o actualiza las 22 filas
de una sola llamada (`npx convex run skins:seedSkinCatalog '{}'`),
reutilizando la misma lógica de upsert (`upsertSkinHandler`) que
`createSkin`. El catálogo completo (los 22 skins con sus valores) vive
como un array TypeScript versionado dentro de `convex/skins.ts`
(`SKIN_CATALOG`) — no un script externo ni datos solo en memoria de una
sesión, para que cualquier deployment futuro (staging, producción) pueda
poblarse con el mismo comando.

## Migración segura — por qué `background`/`accent` son `v.optional` (corrección de auditoría, ronda 1)

La ronda 1 de esta tarea los declaraba requeridos (`v.string()`, no
`v.optional`), razonando que tras el backfill las 22 filas siempre los
tienen. **Hallazgo real del auditor**: Convex valida TODOS los documentos
existentes de una tabla contra el schema nuevo ANTES de aceptar un
`push`. Si el deployment real (compartido de desarrollo, o algún día
producción) ya tiene filas de `skins` de antes de esta tarea sin
`background`/`accent` — que es exactamente el caso de los 4 originales,
"hoy no los tienen" — desplegar con campos requeridos habría rechazado el
push ENTERO antes de que `seedSkinCatalog` pudiera ejecutarse nunca para
arreglarlas. La ronda 1 solo se había probado contra un deployment ya
limpio (sin esas filas legacy), lo que ocultaba el problema.

**Secuencia segura** para este tipo de cambio en Convex (y, en general,
cualquier migración de "columna NOT NULL" sobre datos existentes):

1. Campo `v.optional` — se puede desplegar en cualquier momento, sin
   importar qué filas existan ya.
2. Correr el backfill (`seedSkinCatalog`) y verificar que TODAS las filas
   relevantes ya tienen valor.
3. Solo ENTONCES, un segundo `push` de schema que los pase a requeridos.

**Esta tarea entrega los pasos 1 y 2**, verificados contra el deployment
de desarrollo de esta terminal. El paso 3 (pasar a requeridos) queda
como **seguimiento explícito, no ejecutado aquí** — depende del estado
del deployment compartido/producción, que esta terminal no gestiona ni
puede verificar de primera mano; quien lo aplique ahí debe confirmar
antes (con este mismo `seedSkinCatalog`, o consultando la tabla) que
todas las filas existentes ya están pobladas, y solo entonces tocar
`convex/schema.ts` para quitar los dos `v.optional`.

## Verificado contra el deployment real (con scripts versionados, re-ejecutables)

- **`scripts/verify-tal22-skin-schema-migration.mjs`** (salida real en
  `docs/evidence/tal22-skin-schema-migration-output.txt`): simula el
  escenario exacto del hallazgo — inserta una fila "legacy" de `skins`
  sin `background`/`accent` (mutation temporal que el propio script
  escribe y borra), confirma que el schema actual (con los dos campos
  opcionales) despliega limpio con esa fila presente, corre el backfill
  real, y verifica contra el deployment real que las 22 filas del
  catálogo (identificadas por `key`) tienen `background` Y `accent`
  poblados — mientras la fila legacy de prueba, fuera del catálogo, se
  deja intacta a propósito (confirma que el schema opcional convive sin
  error con datos reales sin esos campos). Limpieza automática al
  terminar (fila de prueba borrada, mutation temporal eliminada,
  deployment devuelto al mismo conjunto de funciones).
- **`scripts/verify-tal22-skin-seed-idempotency.mjs`** (salida real en
  `docs/evidence/tal22-skin-seed-idempotency-output.txt`): corrompe a
  propósito la fila real `dorado` (`createSkin` con `background:"red"`,
  `accent:"#000000"`, nombre/descripción de prueba) y confirma con el
  mismo `_id` de antes que, tras re-sembrar (`seedSkinCatalog`), recupera
  exactamente los valores canónicos del catálogo — `name`, `description`,
  `background` y `accent` comparados campo a campo contra los valores
  esperados, no solo "no lanzó error". Confirma también que el número
  total de filas no cambia (sin duplicar). Al terminar, `dorado` queda
  con sus valores canónicos correctos — mismo estado que antes de correr
  el script.
- `listAllPublic` (usada por TAL-12 para el `<select>` del editor, y la
  que usará TAL-24) sigue funcionando sin cambios de comportamiento —
  usada directamente por los dos scripts de arriba contra el deployment
  real, devuelve las filas con los campos nuevos incluidos (`undefined`
  en la fila legacy de prueba, poblados en las 22 del catálogo).
- `npx tsc --noEmit`/`npx eslint` limpios sobre `convex/schema.ts` y
  `convex/skins.ts`.

## Qué NO toca esta tarea

Ningún componente de frontend — el `<select>` de
`src/app/admin/[calendarId]/edit-calendar-form.tsx` sigue listando solo
`name`, exactamente igual que antes de esta tarea; no lee
`background`/`accent`. Aplicar estos colores de verdad a portada/grid de
días/modal es TAL-24, bloqueada por esta tarea, para otra terminal más
adelante.

## Actualización — TAL-24 (aplicación visual real)

TAL-24 ya consume `background`/`accent` en la portada de Invitado y en el
grid de días de las dos vistas — ver `src/lib/skin-appearance.ts` para el
respaldo (`DEFAULT_SKIN_APPEARANCE`, tokens `--pine`/`--gold`) que usa
cuando un skin referenciado no tiene esos campos, exactamente el caso que
esta tarea dejó como `v.optional` a propósito (§ "Migración segura" más
arriba). El `<select>` del editor de Admin sigue sin tocar (fuera de
alcance también de TAL-24, ver su propio brief).

Ronda 1 de TAL-24 tuvo un NO-GO de auditoría por contraste insuficiente
sobre skins claros (el caso límite es justo este catálogo: "Nieve" llega
a `#ffffff` puro) — corregido con una capa de oscurecimiento uniforme
(`coverBackgroundCss()`) antes de pintar el `background` del skin bajo
texto blanco; verificado en navegador real con "Nieve" y "Neón Fiesta".
Detalle completo del fix y de la verificación en `docs/dias.md` §
"Corrección de auditoría, ronda 1".

## Actualización — TAL-47 (`textColor`/`textPill`, reemplaza la capa oscura + `text-shadow`)

Tras probar en real, Aitor pidió reemplazar de raíz la capa de
oscurecimiento uniforme (`coverBackgroundCss`, TAL-24 arriba) — "apagaba
demasiado" los colores del skin al cubrir ahora toda la pantalla (TAL-47
núcleo), no solo la cabecera de portada. Decisión final: **color de texto
como campo nativo del skin**, decidido a mano al mismo tiempo que
`background`/`accent` (nunca calculado en tiempo real parseando el
`background`, que puede ser un `conic-gradient` de 6 paradas). Sin capa
oscura, sin `text-shadow`, para los skins donde un color plano basta.

**Campos nuevos** (mismo criterio `v.optional`/secuencia segura que
`background`/`accent`, ver "Migración segura" más arriba — aplica igual
aquí, un deployment con filas previas a esta tarea, incluida producción
sin re-sembrar tras TAL-43, no tiene `textColor` todavía):

- **`textColor`** (`v.string()`): color de texto del skin. En los 6 skins
  con `textPill: true`, es el color del texto QUE VA ENCIMA de la
  píldora, no un color plano directo sobre el degradado.
- **`textPill`** (`v.boolean()`, opcional, solo `true` en 6 de 24): marca
  los skins cuyo rango de degradado/rayas es demasiado amplio para que un
  único `textColor` plano garantice AA en todo el fondo — llevan una
  píldora de fondo semitransparente detrás del texto en vez de color
  plano directo. `rgba(15,24,18,0.7)` — **no 0.6** (la píldora de "visto"
  del grid, la referencia original del brief de Linear): ver "Hallazgo
  real" más abajo para el porqué del ajuste.

**18 skins — `textColor` plano**: valores validados por Aitor en Linear
(TAL-47), a partir de un cálculo mecánico de contraste que hizo la
Directora (peor parada del degradado contra blanco/`--ink` candidatos) —
re-verificados aquí contra el DEPLOYMENT REAL (no solo el código fuente)
con `scripts/verify-tal47-textcolor-wcag.mjs`, salida completa en
`docs/evidence/tal47-textcolor-wcag-output.txt`. Los 18: dorado→`#16211c`,
grosella→`#ffffff`, medianoche→`#ffffff`, pino→`#ffffff`, nieve→`#16211c`,
dorado-real→`#ffffff`, bosque-nordico→`#16211c`, neon-fiesta→`#ffffff`,
oficina→`#16211c`, superheroe→`#ffffff`, bebe→`#16211c`,
memorias-de-familia→`#16211c`, amigas→`#16211c`, kpop→`#16211c`,
gotico→`#ffffff`, baloncesto→`#ffffff`, futbol→`#ffffff`,
tira-comica→`#1a1a1a`.

**6 skins — píldora de fondo**: nochebuena, confeti, historieta,
enamorados, adolescente (degradados/overlays donde ninguna parada
plana cubre todo el rango con AA, según el mismo cálculo mecánico de la
Directora) y rojiblanco (TAL-48, rayas verticales — añadido después,
mismo motivo). Los 6 llevan `textColor: "#f6f1e4"` (el token `--paper`)
encima de la píldora.

**Hallazgo real durante la verificación** (no solo teórico —
`scripts/verify-tal47-textcolor-wcag.mjs` compone la píldora sobre CADA
parada real del `background`, no solo la asume "suficientemente oscura"):
con la píldora al 0.6 de opacidad (el valor original del brief, tomado de
la píldora de "visto" del grid), "rojiblanco" fallaba AA en su parada
blanca pura (`#ffffff`): el compuesto resultante es `rgb(111,116,113)`
—un gris medio, no lo bastante oscuro para que `#f6f1e4` alcance 4.5:1
encima (dio 4.20:1). Motivo: 0.6 de opacidad sobre NEGRO solo llega a
gris medio cuando el fondo de partida es blanco puro — muy distinto del
caso "visto" del grid, donde el fondo de partida siempre es un fotograma
de vídeo con brillo variable, nunca garantizado blanco puro. Subida la
opacidad de la píldora a **0.7** (probado contra los 6 skins con
píldora): "rojiblanco" pasa con margen (5.96:1 en su parada blanca) y los
otros 5 mejoran su margen igual (todos partían ya con margen de sobra a
0.6). `textColor` se mantiene igual (`#f6f1e4`) en los 6 — solo cambió la
opacidad de la píldora.

**Verificado** (`scripts/verify-tal47-textcolor-wcag.mjs`, salida
completa en `docs/evidence/tal47-textcolor-wcag-output.txt`): las 24
filas del catálogo, leídas del deployment real tras sembrar, pasan WCAG
AA (≥4.5:1) en el peor caso real de su degradado/rayas — plano contra
cada parada hex extraída del `background`, o píldora (composición alfa
real de `rgba(15,24,18,0.7)` sobre cada parada) para las 6 marcadas. El
script no necesita limpieza (solo lee tras sembrar, sin datos de prueba
que borrar). `npx tsc --noEmit`/`npx eslint` limpios.

**Qué NO toca esta ronda**: ningún componente de frontend todavía lee
`textColor`/`textPill` — la capa de oscurecimiento + `text-shadow` de
TAL-24 sigue aplicándose tal cual en portada/cabecera de mes/modal/fondo
de pantalla completa. Aplicar los campos nuevos de verdad (sustituyendo
esa capa) es la siguiente ronda de TAL-47, sobre este mismo catálogo ya
sembrado. Tampoco toca producción — mismo criterio que TAL-43: diseñado y
verificado contra el deployment de dev de esta terminal, la re-siembra
real de producción la decide y ejecuta la Directora con el CEO.
