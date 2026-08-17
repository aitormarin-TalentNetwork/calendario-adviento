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

**Etiqueta junto al campo, no apilada (ajuste 2026-08-17, pedido explícito de Aitor):**
en desktop, la etiqueta va **a la izquierda del input**, en la misma línea — no encima.
Ancho de etiqueta fijo (`~150px`), alineada a la derecha; el input ocupa el resto del
ancho disponible. Reemplaza el patrón anterior (etiqueta encima del campo) en toda
pantalla de edición de datos. En mobile (`<640px`) esta regla tiene una excepción — ver
"Responsive / Mobile" más abajo, ahí sí se apila.

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
  `--gold` — **más destacado que el resto de estados** (ajuste 2026-08-17: aumentar
  grosor de borde y/o añadir un fondo sutil en `--gold`/10% opacidad, no solo el
  punteado — que se note claramente de un vistazo, no solo al fijarse).
- **Bloqueado** (día futuro, dentro del rango del calendario): casilla atenuada
  (`opacity: 0.4`), número más pequeño, icono de candado 🔒 en la esquina inferior
  derecha. **No abre nada al pinchar** (sigue sin desbloquear el vídeo), pero desde
  2026-08-17 (pedido explícito de Aitor) el clic sí tiene reacción — ver "Efecto de
  impaciencia" justo debajo.
- **Abierto, sin ver**: fondo `--paper-2` (claro) / `--pine-2` (oscuro), número grande
  normal, click habilitado.
- **Visto**: fondo = fotograma del vídeo (o color de relleno si no hay miniatura real
  todavía), número se reduce y baja a la esquina inferior derecha, en una píldora
  semitransparente sobre el fotograma — clic reabre el vídeo.
- **Fuera de rango** (fecha anterior a `startDate` o posterior a `endDate` del
  calendario — ajuste 2026-08-17, pedido explícito de Aitor): **se muestra el mes
  completo siempre**, nunca casillas en blanco al principio o al final. Los días fuera
  del rango configurado numeran igual que el resto (1, 2, 3... del mes), pero con el
  número grande en estilo "marca de agua" — muy atenuado (opacity baja, p. ej. `0.15`),
  sin candado, sin fondo de estado, sin click. Antes de este ajuste, esos días
  aparecían como casillas vacías al principio/final del calendario, lo cual quedaba
  raro visualmente — ya no. (TAL-31, implementado en la vista de Invitado — el relleno
  de alineación de semana fuera del propio mes sigue en blanco sin numerar, sin
  cambios; el editor de Admin no cambia de comportamiento, ver `docs/dias.md` § "Mes
  completo sin huecos".)
- Modal de vídeo: `<iframe>` de YouTube/Vimeo/Drive centrado, mensaje del día debajo —
  sin cambios respecto al MVP shippeado, esta parte no se toca.

**Efecto de "primera apertura"** (pedido explícito de Aitor, 2026-08-17): al pinchar una
casilla "Abierto, sin ver" para verla por primera vez, antes de abrir el reproductor:

- La casilla hace un **pop** (rebote de escala + destello dorado, ~0.6s).
- **Confeti** por toda la pantalla (no solo dentro de la casilla) — piñata que explota,
  colores del sistema (`--gold`, `--gold-2`, `--berry`, `--paper`, `--pine-2`).
- **Sonido de premio**: un "crac" corto seguido de un arpegio ascendente tipo "logro
  desbloqueado" — sintetizado con Web Audio API, no un fichero de audio externo.
- Al terminar (~0.6-0.7s), se abre el reproductor normalmente.
- Ver `design/propuesta-grid-calendario.html` — pincha cualquier casilla clara para
  probarlo.

**Efecto de "impaciencia"** (pedido explícito de Aitor, 2026-08-17): al pinchar una
casilla **bloqueada** (día futuro, sin abrir todavía):

- La casilla hace un **pulso corto** (encoge/estira con destello en `--berry`, no en
  `--gold` — para que se note claramente que es un "todavía no", distinto del pop dorado
  de "primera apertura"). No abre nada, el vídeo sigue bloqueado.
- Aparece un **letrero centrado en la pantalla** (overlay, se desvanece solo a los
  ~2.5s o al pinchar fuera): *"Calma tu ansiedad. Te quedan **{X}** días para abrir este
  regalo"* — X = días naturales que faltan hasta la fecha de esa casilla concreta
  (singular "día" cuando X=1). Tono cercano/con humor, no un error.
- Ver `design/propuesta-grid-calendario.html` — pincha cualquier casilla con candado
  para probarlo.

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

**Selector de skin en el editor (TAL-37):** galería de **cuadrados** de color (radio
`~5-8px`, no círculos — ajuste 2026-08-17, tercera vuelta), no un `<select>` de texto —
cada cuadrado lleva el color/degradado real del skin, con un anillo `--gold` en el
seleccionado. **Ajuste 2026-08-17 (segunda vuelta), pedido explícito de Aitor:** el
nombre del skin NO va siempre visible junto al cuadrado (primer intento, descartado) —
solo aparece como `title` al hacer hover (tooltip nativo del navegador), igual que el
resto de swatches del sistema. **Matriz que envuelve fila a fila** ocupando el mismo
ancho que los inputs de texto de la misma columna (no todo el ancho de la columna, ni
una sola fila) — con 22+ filas la galería crece hacia abajo, envolviendo en varias filas
(`flex-wrap`), sin forzar una sola fila ni alargar el resto del formulario.

**Skin #23 — "Tira Cómica"** (pedido 2026-08-17): colores compatibles con una imagen
que Aitor va a subir él mismo como foto de portada (personaje de cómic con derechos de
autor — Aitor sube su propio asset con licencia/derecho para ello, nosotros no lo
generamos ni lo nombramos por la IP). Sigue la misma regla dura de marcas: el skin en sí
se llama y describe de forma genérica, sin mencionar la obra o personaje de origen.

- **Fondo:** blanco/crema limpio (`#fdf8ec` → `#ffffff`, degradado muy sutil) — para que
  una imagen de personaje con fondo claro combine bien encima.
- **Acentos** (rotan igual que el resto de skins entre puertas/estados del grid): rojo
  vivo `#e63946`, azul cielo `#2fa8e0`, amarillo sol `#ffd23f` — trío de color primario
  clásico de tira cómica, con contorno negro grueso (`2-3px solid #1a1a1a`) en vez de
  sombra, mismo lenguaje gráfico que "Historieta" pero sobre fondo claro en vez de
  patrón de tramado.
- Nombre: **"Tira Cómica"**. Descripción sugerida: *"Colores vivos de cómic clásico —
  rojo, azul y amarillo con contorno negro, sobre fondo claro. Pensado para combinar con
  una foto de portada propia."*

### Imagen de fondo del calendario (nuevo campo, distinto de "Foto de portada")

**Pedido explícito de Aitor, 2026-08-17.** Hoy `coverImageUrl` ("Foto de portada") solo
se pinta en la pantalla de login (`src/app/login/page.tsx`) — no llega al grid de días
ni al modal de vídeo. Aitor quiere subir una imagen propia (p. ej. un personaje, para
combinar con el skin "Tira Cómica") que se vea en **todo el calendario**, no solo en el
login — mismo alcance que un skin.

- **Campo nuevo:** `backgroundImageUrl` (o nombre equivalente), opcional, en el
  calendario — independiente de `coverImageUrl` (que se queda como está, solo portada) y
  del `skinId` (que se mantiene obligatorio siempre, incluso con imagen de fondo puesta).
- **Alcance — las 3 superficies reales donde ya aplica un skin** (corrección
  2026-08-17, hallazgo de T2 durante TAL-39: "portada" tiene dos significados en este
  proyecto y no son intercambiables): la portada/cuenta atrás del Invitado **ya
  autenticado** (`/c/[calendarId]`), el grid de días (Invitado y editor de Admin) y el
  modal de vídeo. **`/login` (portada pública, sin autenticar) queda fuera a
  propósito** — tiene una lista blanca deliberadamente mínima en Convex por seguridad
  (solo `coverTitle`/`coverIcon`/`coverImageUrl`, ver TAL-25) y no se amplía para esto,
  mismo criterio que ya aplica de facto a `skinId` (tampoco llega a `/login`).
- **Cómo convive con el skin:** la imagen sustituye el fondo de color/degradado del skin
  como base visual; el **color de acento del skin sigue gobernando** puertas/casillas,
  bordes, estado "hoy", píldoras, etc. — la imagen no reemplaza al skin, lo complementa
  (el skin sigue siendo obligatorio). Igual que ya hace el estado "Visto" del grid con el
  fotograma del vídeo, se aplica una capa de degradado oscuro sutil
  (`linear-gradient(to top, rgba(10,16,12,0.5), transparent 55%)` o similar) encima de la
  imagen para que el texto/iconos sigan siendo legibles.
- **Editor:** campo "Imagen de fondo (URL, opcional)" en el editor de calendario, junto
  al campo de skin (columna derecha de "Datos del calendario" — ver sección "Editor de
  calendario" más abajo).
- Misma validación que `coverImageUrl` ya tiene hoy (solo URL https, sin subida de
  archivo real — fuera de alcance del MVP, ver TAL-6).

### Selector de icono de portada (Admin)

**Validado con Aitor, 2026-08-16; forma de mostrarlo ajustada 2026-08-17.** Fuente:
`design/propuesta-skins.html` (contenido de la galería) +
`design/propuesta-editor-calendario.html` (dónde vive la galería). Sustituye el icono
fijo en código (🎄) por un selector real en el editor de calendario.

**Ajuste 2026-08-17, pedido explícito de Aitor — la galería ya NO va siempre visible en
la página:** en la pantalla de configuración del calendario solo se muestra el **icono
ya seleccionado** (casilla `44-52px`, fondo `--paper-2`/`--pine-2`) — esta parte
reemplaza al "TAL-23 shippeado" original, que la mostraba siempre desplegada inline en la
página. Al pulsar la propia casilla del icono se abre un **diálogo** (modal) con la
galería completa.

**Ajuste 2026-08-17 (segunda vuelta), pedido explícito de Aitor:** ya NO hay un botón de
texto "Cambiar icono" aparte — **el propio icono ES el botón**, clicable directamente
(cursor pointer, borde `--gold` al hover/focus). **Ajuste 2026-08-17 (tercera vuelta):**
la casilla del icono ya NO lleva fondo relleno (`--paper-2`/`--pine-2`) — fondo
**transparente**, solo el borde (`--border`, pasa a `--gold` en hover/focus) indica que
es un elemento clicable. **Ajuste 2026-08-17 (cuarta vuelta):** etiqueta del campo
renombrada de "Icono de portada" a "Selecciona un icono" y después, acortada de nuevo, a
simplemente **"Icono"**.

Contenido del diálogo (sin cambios respecto a lo ya validado):
- Buscador arriba (`🔍 Buscar icono…`).
- Galería organizada en **categorías**: Navidad, Fiesta, Cariño, Naturaleza y cielo,
  Animales y fantasía — ~45 emoji en total, incluye 🦄, 🌈 y ❤️ explícitamente pedidos.
- Icono seleccionado con borde `--gold` + fondo `--paper-2`.
- Mismo patrón de "catálogo sin límite fijo" que los skins — la lista de iconos puede
  crecer sin tocar código si en algún momento se decide.
- Al elegir un icono, el diálogo se cierra y el icono elegido pasa a mostrarse en la
  casilla de la página (no hace falta un botón "Guardar" aparte dentro del diálogo).

### Indicador de sesión

**TAL-28.** Sustituye el texto plano "Sesión: email (ROL)" + botón "Cerrar sesión" en
las 4 pantallas autenticadas (Admin, editor de calendario, Super Admin, Invitado) por un
indicador fijo en la esquina superior derecha:
- Foto de perfil de Gmail del usuario (viene del perfil OAuth de Google — se guarda en
  `users.image`, Convex, y se refresca en cada login si cambia). Si no hay foto (login de
  desarrollo, o el usuario todavía no tiene una guardada): círculo `--pine-2` con la
  inicial del email en `--paper`, tipografía `--font-display`.
- Botón de cerrar sesión SOLO icono, sin texto visible — evita palabras en un idioma
  concreto. **Ajuste 2026-08-17, feedback de Aitor:** el emoji de puerta ("🚪") no
  convence, resulta demasiado literal/skeuomórfico para el resto del sistema. Sustituir
  por un icono de línea minimalista tipo "log-out" (Heroicons/Feather outline: flecha
  saliendo de un rectángulo/marco abierto por un lado), trazo fino (`stroke-width`
  ~1.5-2px), sin relleno, heredando `currentColor` — mismo lenguaje visual que el resto
  de iconografía de línea de la app, no un emoji.
- El email (y el rol, si aplica) sigue disponible como `title`/`aria-label` del avatar —
  no se pierde la información, solo deja de ocupar espacio permanente en pantalla.
- Componente compartido `SessionIndicator` (`src/components/session-indicator.tsx`),
  `position: fixed`, mismo patrón en las 4 pantallas.

### Editor de calendario (pantalla de configuración del Admin)

**Validado con Aitor, 2026-08-17.** Fuente: `design/propuesta-editor-calendario.html`.
Reestructura la pantalla de configuración de un calendario (creada en TAL-5/TAL-32,
shippeada) — no toca el mockup del MVP a nivel de campos/datos, solo su disposición y el
comportamiento de algunos componentes.

- **Sección "Datos del calendario" en dos columnas** (orden ajustado 2026-08-17,
  pedido de Aitor tras ver el mockup):
  - **Izquierda:** nombre del calendario (primero), fecha de inicio, fecha de fin —
    apilados uno encima de otro.
  - **Derecha:** vista previa en vivo (primero — ver sección propia justo debajo),
    título de portada, icono de portada (ver "Selector de icono de portada" arriba),
    skin, marcador de cuenta atrás, imagen de fondo — apilados uno encima de otro.
  - Cada campo sigue la regla general de "Formularios": etiqueta a la izquierda del
    input, no encima.
  - **Etiqueta del campo "marcador de cuenta atrás" (TAL-27) renombrada a "Fecha
    objetivo"** (ajuste 2026-08-17, pedido explícito de Aitor, confirmado tras avisarle
    de la posible confusión). **Ojo:** sigue siendo un campo de **texto libre**
    (`type="text"`, ej. "la Navidad", "el cumpleaños de Juan"), NO un selector de fecha
    — la fecha real que gobierna la cuenta atrás sigue siendo "Fecha de fin". Solo
    cambia la etiqueta visible, no el tipo de campo ni su comportamiento.

### Vista previa en vivo (TAL-29)

**Validado con Aitor, 2026-08-17.** Fuente: `design/propuesta-editor-calendario.html`.
Primer campo de la columna derecha de "Datos del calendario" — réplica en miniatura de
la portada real que ve el Invitado ya autenticado (`/c/[calendarId]`), que se actualiza
**al momento** con los cambios de título, icono, skin, marcador de cuenta atrás e imagen
de fondo. Sustituye por completo el texto suelto "Vista previa: Faltan X días" que había
junto al marcador de cuenta atrás.

- **Es una fila de campo más, no un bloque aparte:** etiqueta "Vista previa" a la
  izquierda (mismo estilo que cualquier otra etiqueta), miniatura clicable del mismo
  ancho que ocupa un input a la derecha — **no** una tarjeta grande en columna propia
  (primer intento, descartado: el texto no cabía legible en una columna estrecha).
- **La miniatura SÍ lleva contenido real** (icono, título, cuenta atrás con la misma
  fórmula de `formatCountdownMessage` — ver `src/lib/countdown.ts`), aunque la letra
  salga pequeña/apretada — pedido explícito de Aitor: mejor una réplica real aunque no
  se lea bien, que un icono suelto sin contexto. Proporción `16:9`, radio `12px`.
- **Clic en la miniatura abre un diálogo** con el mismo contenido a tamaño de
  producción (icono `84px`, título `1.9rem` con `--font-display`, cuenta atrás en
  píldora) — ahí es donde se lee bien. Proporción `3:4`, ancho máx. `420px`.
- **Fondo** (miniatura y diálogo, mismo criterio): imagen de fondo si está puesta (con
  degradado oscuro encima para legibilidad, ver "Imagen de fondo del calendario") o si
  no, el color/degradado del skin elegido.
- **Grid de días:** reutiliza el patrón de "Grid de días — invitado y editor de Admin"
  de más arriba (7 columnas, calendario de pared real) — no es un componente nuevo,
  solo se confirma que el editor lo usa igual que la vista de Invitado. Añade:
  - Texto explicativo encima del grid: *"Selecciona el día para subir el vídeo."*
    (ajuste 2026-08-17: acortado — el resto era autoexplicativo, sobraba).
  - Días con vídeo ya cargado muestran el fotograma de fondo (mismo tratamiento visual
    que el estado "Visto" del Invitado), no un simple número.
  - **Clic en un día abre un diálogo** (modal) con URL del vídeo (o subir archivo),
    mensaje del día opcional, y botones "Guardar día" / "Quitar vídeo" — sustituye el
    panel inline que se abría antes debajo del grid.
- **Zona de peligro:** el botón pasa a ser **rojo** (`--berry`, relleno, no solo texto),
  colocado **al final de la pantalla**, separado del resto por un separador
  (`border-top`) — antes estaba en la cabecera de la pantalla junto al título, como botón
  fantasma de solo texto. **Ajuste 2026-08-17 (segunda vuelta), pedido de Aitor:**
  - Etiqueta renombrada de "Borrar calendario" a **"Eliminar calendario"**.
  - **Requiere confirmación en un diálogo** antes de borrar de verdad — hoy no la pide.
    El diálogo nombra el calendario concreto ("¿Eliminar '{nombre}'?"), avisa de que se
    borran también días/vídeos/invitados y que no se puede deshacer, con dos acciones:
    "Sí, eliminar calendario" (rojo) y "Cancelar" (ghost). Ver
    `design/propuesta-editor-calendario.html`.

### Invitados — link de invitación único

**Validado con Aitor, 2026-08-17.** Fuente: `design/propuesta-editor-calendario.html`.
Ajusta la sección "Invitados" del editor de calendario (TAL-7, shippeado):

- **Un único "Link de invitación" por calendario** (no uno distinto por invitado),
  mostrado en un campo de solo lectura con icono de copiar al lado — el link no lleva
  un token personal.
- **Por qué basta con uno solo:** el control de acceso real no lo hace el link, lo hace
  el login con Google **contra la lista de invitados de ese calendario** — si el email
  autenticado no está en la lista, no entra aunque tenga el link. El link solo es un
  atajo a la pantalla de login de ese calendario en concreto.
- La fila de cada invitado en la tabla pierde su botón/icono de copiar individual (ya
  no aplica) — mantiene solo la acción de quitarlo del calendario.
- **Icono de copiar** (el del link general): icono de línea minimalista (dos
  rectángulos superpuestos, estilo "copy"), sin texto — mismo criterio que el resto de
  botones solo-icono del sistema (ver "Indicador de sesión"). Al pulsarlo, confirmación
  breve tipo toast ("Link copiado"), no un `alert()`.

## Responsive / Mobile

**Requisito transversal, pedido explícito de Aitor (2026-08-17): todo el Design System
tiene que funcionar en mobile, no solo en desktop.** Ninguna pantalla se da por cerrada
sin comprobar cómo se ve por debajo del breakpoint.

- **Breakpoint estándar:** `640px`.
- **Layouts de 2 columnas** (formularios, "Datos del calendario", etc.) colapsan a **1
  columna** por debajo del breakpoint.
- **Campo con etiqueta a la izquierda del input** (regla general en desktop, ver
  "Formularios" más arriba): en mobile pasa a **apilarse** (etiqueta arriba, campo
  abajo) — única excepción documentada a esa regla, por falta de espacio horizontal en
  pantallas estrechas.
- **Grid de días de calendario**: mantiene siempre **7 columnas** en cualquier ancho —
  es la esencia del patrón (calendario de pared real), nunca colapsa a menos columnas.
  Lo que se reduce es tipografía/padding de cada casilla, no la estructura.
- **Tablas** (invitados, admins de Super Admin, etc.): contenedor con `overflow-x: auto`
  propio en vez de romper el layout de la página — la página nunca scrollea en
  horizontal, solo la tabla dentro de su contenedor.
- **Botones de acción a ancho completo** cuando quedan solos al final de una pantalla en
  mobile (p. ej. "Borrar calendario") — mejor objetivo táctil que un botón pequeño
  flotando a la derecha.
- Ver `design/propuesta-editor-calendario.html` como referencia — primera pantalla con
  el comportamiento mobile ya resuelto siguiendo estas reglas.

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
