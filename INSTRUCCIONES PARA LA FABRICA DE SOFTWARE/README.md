# La fábrica de software de Calendario de Adviento

> Este documento es la **configuración de este proyecto** para el rol Director/a — la
> parte genérica del rol (reutilizable en cualquier proyecto) está en `director.md`, en
> esta misma carpeta. Este README es la instancia real: las piezas concretas de este
> proyecto, el flujo tal como se aplique aquí, y los incidentes reales que se vayan
> encontrando (empieza casi vacío — se llena solo, con el tiempo, igual que le pasó al
> proyecto piloto de esta plantilla).

Esto documenta el montaje para desarrollar **Calendario de Adviento** con varias terminales
de Claude Code en paralelo, cada una con su propio auditor externo, coordinadas por una
sesión "Directora".

Si la máquina se reinicia, se pierde contexto, o simplemente abres una sesión nueva y no
sabes por dónde seguir: **lee este documento entero antes de tocar nada**.

---

## 1. Las piezas del sistema

| Pieza | Dónde | Para qué |
|---|---|---|
| **Worktrees** | `_worktrees/T1`, `T2`, ... (en `.gitignore`) | Copia de trabajo aislada por terminal — cada una en su propia rama. Nombre fijo por terminal, no por tarea. |
| **Ramas** | `<AUTOR>/<slug-de-la-tarea>` (una por issue de Linear) | Historial de cada tarea, limpio y separado del de las demás. |
| **Tablero de tareas** | `codigo para auditar/T<n>_...txt` (en `.gitignore`) | Brief de la tarea que tiene asignada cada terminal AHORA MISMO. |
| **Intro genérica** | `intro-terminal.txt` | Se autocarga vía `CLAUDE.md` al arrancar una terminal en su worktree. |
| **Export de auditoría** | `codigo para auditar/T<n>_<id>_<slug>_loop<N>-para-auditor.txt` (en `.gitignore`) | Un solo fichero activo por tarea, con código completo + evidencias. |
| **Cola de tareas** | `codigo para auditar/cola/SIGUIENTE-<seq>_...txt` (en `.gitignore`) | Tareas ya vetadas, listas para que una terminal libre las reclame. |
| **Archivo histórico** | `codigo para auditar/Subido a GitHub/` (en `.gitignore`) | Ficheros de tareas ya publicadas. |
| **Prompt del auditor** | `auditor_prompt.txt` y `AGENTS.md`, sección `<!-- BEGIN:auditor-role -->` | Mismo texto en los dos sitios — si se edita uno, editar el otro. |
| **Rol Director/a** | `director.md` (parte genérica) + este README (configuración) | Coordina el pipeline entero. |
| **Rol Product Manager (PM)** | `pm.md` | Con quien se habla de producto/funcionalidad. |
| **Rol Integrador** | `integrador.md` | Publica una vez hay GO — ver estado real en Configuración más abajo. |
| **Rol CEO** | `ceo.md` | Supervisión de todo el pipeline — ver estado real en Configuración. |
| **Rol Inspector** | `inspector.md` | Vigila al CEO (cierra el bucle: el CEO controla a todos, el Inspector al CEO) y barre todas las terminales buscando peticiones de intervención humana sin resolver. Resuelve lo mecánico, nunca lo sustantivo. |
| **Mensajería directa** | `SendMessage` / `ListAgents` | Cómo se hablan los roles entre sí. |
| **PRD** | Notion, página privada "calendario de Adviento" (raíz del espacio de Aitor) | Documento de producto — lo redacta el PM tras el acuerdo con Aitor. |
| **Gestor de tareas** | Linear, equipo **TalentSalesAi**, proyecto **"Calendario de Adviento"** (MCP `linear-aitor`) | Fuente de verdad de qué se hace y en qué orden. |
| **Recurso(s) compartido(s)** | **Chrome** (una sola instancia, para pruebas manuales de UI de T1/T2) — cerrojo autoservicio en `.chrome-lock/` (raíz, en `.gitignore`). **Deployment de desarrollo de Convex** (`beloved-barracuda-617`, compartido por T1/T2/T3 mientras TAL-12/13/15/16 no estén mergeadas) — cerrojo en `.convex-dev-lock/` + sincronización obligatoria antes de desplegar. | Ver §3bis y §3ter. |
| **Repo** | `github.com/aitormarin-TalentNetwork/calendario-adviento` (público) | La Directora mergea a `main` y hace push aquí. |
| **Despliegue** | Railway, proyecto **"calendario-adviento"** (cuenta `aitormarin@gmail.com`, carpeta del proyecto ya enlazada con `railway init`) | Auto-despliega en cada push a `main` una vez conectado el servicio. |

---

## 2. El flujo de trabajo, de punta a punta

Sigue el flujo genérico de `director.md` — documenta aquí las particularidades reales
de este proyecto en cuanto aparezcan (comandos exactos de build/despliegue, cómo se
dispara el auditor, qué verificar antes de publicar).

## 2bis. Automatización y cuándo parar a preguntar

**Aitor nunca está en el camino crítico del desarrollo** (confirmado por Aitor en
persona al CEO, 2026-10-01, a propuesta del Factory Architect). Aitor valida producto,
UX y mockups; el proceso de desarrollo, incluida la publicación, no pasa por él (el
Integrador publica en modo `autonomo` con `scripts/publish.sh`). Lo que de verdad necesite
su mano (cambios de configuración de producción como variables de Railway, validar
producto/UX o mockups) va a una única cola "pendiente de Aitor", y nadie se queda
esperando: cada terminal coge la siguiente tarea que no dependa de él. El PM mantiene una
ola de mockups validados por delante para que nunca falte trabajo. Solo se avisa a Aitor
si toda la fábrica se queda sin nada que hacer.

Ver `director.md` ("Cuándo resolver tú misma y cuándo escalar") y `ceo.md`
("A ti tampoco te vigila nadie por encima") — los mismos disparadores de escalado
aplican aquí. Añade los específicos de este proyecto según se descubran.

---

## 3. Reglas que la sesión directora tiene que respetar

Reglas base (ver `director.md` para el detalle de cada una — no las dupliques aquí
salvo que este proyecto las particularice):
- No crear nada fuera de la carpeta del proyecto sin confirmación explícita.
- Mantener la cola de tareas con 2-3 listas, siempre.
- Barrido periódico proactivo de todas las terminales.
- No paralelizar tareas que toquen el mismo archivo.
- Actualizar `docs/` en el mismo cambio que se toma una decisión técnica.

## 3bis. Recurso compartido: Chrome (cerrojo autoservicio)

T1 y T2 comparten una sola instancia de Chrome para pruebas manuales de UI — no hay
navegador aislado por terminal. Cerrojo autoservicio (decidido 2026-08-16, tras un
incidente real: t2-ac esperó ~7 min "a que T1 liberara Chrome" por coordinación
informal de mensaje, que quedó desactualizada en cuanto T1 terminó — nadie podía
comprobar por sí mismo si el recurso estaba libre de verdad):

- **Reclamar:** `mkdir .chrome-lock` en la raíz del repo (en `.gitignore`) antes de
  empezar a usar Chrome para una prueba manual — `mkdir` falla solo si ya existe, sin
  ventana de carrera (mismo patrón que `director.md` § "Recursos compartidos entre
  terminales"), y escribir dentro el `owner` en el formato de abajo.
- **Liberar:** `rm -rf .chrome-lock` en cuanto termines de usar el navegador —
  inmediatamente, no al final de toda la tarea.
- **Antes de reclamarlo:** comprueba si `.chrome-lock/` ya existe. Si existe, no esperes
  a que alguien te avise — coordina directo con quien lo tiene (mensaje directo,
  pregúntale si sigue en uso de verdad) en vez de asumir por un mensaje anterior que
  puede haber quedado desactualizado.
- Un cerrojo abandonado (nadie lo tiene pero sigue el directorio) es el mismo tipo de
  problema que una terminal parada — la Directora y el CEO lo comprueban en su barrido
  periódico, no solo cuando alguien se queja de estar esperando.

**La máquina entera también es compartida: ningún worker mata procesos por patrón**
(`pkill -f`, `killall`…), solo por su puerto propio (T1 3000, T2 3001, T3 3002, con
`lsof -ti:<puerto>`) o por PID después de comprobar que su cwd está en su propio worktree.
Toda ejecución de Playwright lleva `E2E_PORT` explícito (decidido por el Factory
Architect, 2026-10-11: un `pkill -f "playwright test"` de T2 mató las pasadas de
evidencia de T1 y T3). Detalle en `intro-terminal.txt`.

**Cerrojo de suites E2E completas: `.e2e-suite-lock`** (decidido por el Factory
Architect, 2026-10-11). Tres suites completas de Playwright a la vez subieron la carga
de la máquina a ~65: T2 tardó 54 min en vez de 8 y tuvo 5 fallos de infraestructura.
Mismo protocolo que Chrome:
- **Suite completa** (`E2E_PORT=<tu puerto> npx playwright test`, ~350 tests; es la
  evidencia obligatoria de CADA tarea): el cerrojo se coge **a mano, siempre**.
  `mkdir .e2e-suite-lock` en la raíz, se lanza la suite en segundo plano y en seguida
  se escribe el `owner` con su pid (p. ej. `pid=$!`) en el formato de abajo; el lanzador
  de regresión da 5 s de gracia a un owner sin pid. Al terminar se libera, también si
  falla.
- **Batería de regresión** (`npm run test:e2e:regresion`, los ~23 tests `@regresion`,
  `scripts/e2e-regresion.mjs`, TAL-71): el lanzador coge y suelta el cerrojo él solo,
  con su propio pid. No se toca a mano.
- **Nunca anidadas:** no lances la batería dentro de tu cerrojo manual; se quedaría
  esperándose a sí misma.
- **La batería NO sustituye a la suite completa** en la evidencia de una tarea, salvo
  que el brief diga lo contrario.
- **Si ya existe:** mira quién lo tiene y espera, o coordínate con esa terminal
  directamente. No lances tu suite en paralelo.
- **Liberar:** `rm -rf .e2e-suite-lock` en cuanto termine la pasada, **también si
  falla**.
- **Huérfano:** lo comprueban la Directora y el CEO en su barrido, como el de Chrome.
- Los specs sueltos (`playwright test e2e/<fichero>`) no necesitan cerrojo.

**Formato del fichero `owner` de los dos cerrojos (Chrome y suites E2E): `key=valor`,
una por línea, con al menos `terminal=`, `tarea=`, `desde=` y `pid=`** (decidido por el
Factory Architect, 2026-10-12). `pid=` es el del proceso que usa el recurso de verdad
(la suite o el navegador), no el de la shell: el lanzador de TAL-71 da por "posiblemente
huérfano" cualquier owner sin `pid=` vivo, y el CEO y la Directora lo comprueban igual
en su barrido (`ps -p <pid>`). Ejemplo:
```
terminal=T2 (E2E_PORT 3001)
tarea=TAL-73 evidencia
desde=2026-10-12T02:17:00Z
pid=12345
```


Detalles finos de integración en el flujo real de pruebas de este proyecto (dónde
exactamente se reclama/libera dentro de cada verificación) los define la Directora,
que conoce el flujo real.

## 3ter. Recurso compartido: deployment de desarrollo de Convex (cerrojo + sincronización obligatoria)

T1/T2/T3 comparten un único deployment de desarrollo de Convex (`beloved-barracuda-617`)
para `npx convex dev`/`deploy` mientras trabajan en paralelo sobre TAL-12/13/15/16 sin
tenerlas mergeadas todavía. Es un recurso compartido de un tipo distinto al de Chrome —
no basta con evitar que dos lo usen a la vez: `convex dev`/`deploy` sincroniza el schema
del deployment al estado EXACTO del `schema.ts` LOCAL de quien lo ejecuta, así que
incluso en serie, desplegar con un schema local desactualizado borra sin aviso lo que
otra rama ya haya añadido ahí (decidido 2026-08-16, caso real: T1 corrió `convex dev`
desde su rama, sin el índice `by_email` que T3 acababa de añadir para TAL-16, y se lo
borró del deployment compartido sin ningún aviso explícito de "esto va a eliminar algo
fuera de tu diff" — solo se detectó porque T1 leyó el log de salida con atención; T3
redesplegó y quedó recuperado, sin daño real). Dos mecanismos, no uno solo — el cerrojo
por sí solo no basta:

1. **Cerrojo autoservicio** (mismo patrón que Chrome, §3bis): `mkdir .convex-dev-lock` en
   la raíz del repo (en `.gitignore`) antes de cualquier `npx convex dev`/`deploy` contra
   el deployment COMPARTIDO — `rmdir .convex-dev-lock` en cuanto termines, no al final de
   toda la tarea. Sustituye el aviso informal entre T1/T2/T3 aplicado como parche
   inmediato el mismo día del incidente — un aviso hablado se queda desactualizado, un
   cerrojo comprobable no.
2. **Sincronización obligatoria antes de desplegar** (esto es lo que el cerrojo NO
   cubre): antes de correr `convex dev`/`deploy` contra el deployment compartido, trae
   primero a tu rama los cambios de `schema.ts` más recientes ya integrados (de `main`, o
   de lo que sea la fuente de verdad del estado actual del deployment compartido en ese
   momento) — para que tu despliegue incluya lo de los demás, no solo tu propio diff. Sin
   este paso, aunque nadie despliegue a la vez que tú, el último en desplegar sigue
   pudiendo borrar el trabajo de otro sin darse cuenta.

Detalles finos de integración en el flujo real de este proyecto (cómo se avisa del
schema más reciente a sincronizar, cuándo deja de hacer falta este recurso porque
TAL-12/13/15/16 ya mergearon) los define la Directora, que conoce el flujo real.

## 4. Cómo reinstaurar el entorno tras un reinicio

```bash
cd "/Users/aitor/Documents/curro + proyectos/Talent Land/Sistemas/Factory/calendario-adviento"
git worktree list
# recrear los que falten con la rama que tuvieran asignada — nunca -b si ya existe
```

## 4bis. Arranque automático por rol

`CLAUDE.md` en la raíz (y cada worktree) trae el selector de rol — ver
`Sorfware Factory`/`director.md` del proyecto piloto (SuperCRM) para el patrón completo
de `permissions.additionalDirectories` si las terminales necesitan leer fuera de su
propio worktree.

## 4ter. Arranque de la fábrica con `/factory`

`/factory` (definido en `.claude/commands/factory.md`, en la raíz de este proyecto)
convierte la sesión que lo ejecutó directamente en **PM** — sin abrir ninguna ventana
nueva (decidido 2026-08-15, segunda iteración: primero se probó con el Factory
Architect recoloreando su propia sesión, luego con el PM abriendo una ventana nueva
aparte; ambos diseños se descartaron — no hace falta ninguna ventana extra al arrancar,
la misma sesión que ejecutó `/factory` se autoidentifica como PM, cambiando su propio
título y color, y sigue esa misma conversación con Aitor sin saltos). El primer salto
visible de "terminal normal" a "fábrica de software" es esa misma ventana pasando a
verde y presentándose, antes de preguntar nada.

El PM se presenta primero, y decide con Aitor cuándo levantar al resto del equipo: crea
entonces al **CEO** (orientado ya al proyecto en marcha); el CEO crea **Directora**,
**Integrador** y **Factory Architect**, cada uno orientado igual; la Directora, una vez
arriba, crea las terminales de desarrollo que el backlog sostenga **en cuanto exista un
backlog real** — al arrancar el proyecto todavía no hay repo ni tareas, así que no se
crea ninguna terminal de desarrollo hasta que el PM cierre el PRD y las tareas con
Aitor.

**El Integrador se crea automáticamente en modo `confirmar`**: existir la sesión no
activa por sí sola autoridad de publicar sin supervisión — cada publicación sigue
necesitando el visto bueno de Aitor hasta que él mismo decida pasar a modo autónomo.

**Todo son ventanas separadas — nunca pestañas** (mecánica probada en el proyecto
piloto, SuperCRM: crear pestañas por script no es fiable en este entorno). En vez de
pestañas: **título + color + posición en pantalla** identifican y agrupan visualmente lo
que va junto.

### Identificación visual — color de fondo + posición, por rol

**El título NO sirve para identificar una ventana por rol, por diseño de la
herramienta, no por descuido nuestro** (investigado y confirmado 2026-08-15): Claude
Code reescribe el `custom title` de la pestaña vía secuencia de escape ANSI en cuanto
arranca de verdad (pone su propio indicador de estado en vivo, un símbolo tipo
`✳`/spinner al principio seguido de la tarea actual) — no hay flag de arranque, variable
de entorno ni ajuste de `settings.json` que lo evite. No pierdas tiempo intentando
"arreglar" el título; los dos identificadores que sí persisten, y que hay que usar
juntos, son:

| Rol | Color de fondo (RGB Terminal.app, 0–65535) | Posición en pantalla (`bounds`, esquina superior-izq. `{X1,Y1}` a inferior-dcha. `{X2,Y2}`) |
|---|---|---|
| PM | oliva oscuro `{14000, 16000, 0}` | fila 1, col 1 — `{20, 40, 445, 560}` |
| CEO | vino oscuro `{16000, 0, 8000}` | fila 1, col 2 — `{465, 40, 890, 560}` |
| Factory Architect | teal oscuro `{0, 16000, 14000}` | fila 1, col 3 — `{910, 40, 1335, 560}` |
| Inspector | azul acero `{2000, 10000, 18000}` | fila 1, col 4 — `{1355, 40, 1780, 560}` |
| Integrador | naranja quemado `{18000, 6000, 2000}` | fila 2, col 1 — `{20, 580, 445, 1100}` |
| Directora | índigo `{6000, 0, 18000}` | fila 2, col 2 — `{465, 580, 890, 1100}` |
| Desarrollador (`T<n>`) | por defecto (negro) | fila 3 en adelante, mismo tamaño de celda (`T1` en col 1, `T2` en col 2…); si no caben en pantalla, pueden solaparse |

El auditor no tiene ventana: lo lanza la Directora en modo no interactivo (ver §"Disparar al auditor").

Rejilla fija de **2×4** (ampliada desde 2×3 el 2026-08-16 al añadir el rol Inspector —
si otros roles nuevos vuelven a llenar la rejilla, amplíala de nuevo en vez de reutilizar
celdas) sobre la pantalla principal (`1800×1169`, confirmado vía `osascript -l
JavaScript` con `NSScreen.mainScreen`, 2026-08-15 — si la resolución real cambia,
recalcular las celdas antes de reutilizar estos números a ciegas), celda `425×520` con
margen `20`. Paleta deliberadamente distinta (ningún RGB coincide) de la del proyecto
piloto (SuperCRM) — evita que dos fábricas corriendo a la vez confundan sus ventanas si
comparten el mismo rol con el mismo color.

Consulta ambos por AppleScript: `background color of window` y `bounds of window`.

### Receta: abrir una ventana nueva con rol, color y título

```bash
osascript <<APPLESCRIPT
tell application "Terminal"
    activate
    set t to do script "cd '<ruta-worktree-o-raíz>' && tmux new-session -e ROLE_NAME='<Rol>' -s '<nombre-sesión>' 'claude --permission-mode auto'"
    set w to front window
    set index of w to 1
    delay 0.3
    set custom title of t to "<Título>"
    set background color of t to {R, G, B}
    set bounds of w to {X1, Y1, X2, Y2}
end tell
APPLESCRIPT
```
`{R, G, B}` y `{X1, Y1, X2, Y2}` son los de la fila de ese rol en la tabla de
"Identificación visual" de arriba — no los inventes por ventana, son fijos por rol. El
`custom title` se pone igualmente (ayuda en el primer instante, antes de que Claude Code
lo sobrescriba), pero no cuentes con él pasado el arranque.

`ROLE_NAME='<Rol>'` (decidido por el Factory Architect, 2026-08-17) es el mismo nombre
legible de rol que ya usas para el título — Director, CEO, Integrador, PM, Inspector,
Desarrollador, Auditor... — no lo inventes de nuevo. Lo lee la línea de estado de Claude
Code a nivel de proyecto (`.claude/settings.json` + `.claude/statusline-command.sh`) para
mostrar el rol de la sesión de forma persistente (a diferencia del `custom title`, esto
no se pierde cuando Claude Code sobrescribe la pestaña). Si `ROLE_NAME` no está definida,
la línea de estado muestra "sin rol" sin romperse — exportarla es una mejora, no un
requisito estricto para que la sesión funcione.

**Pásala con `tmux new-session -e`, nunca con `export` antes de `tmux`** (corregido por
el CEO, 2026-10-01). Si ya hay un servidor tmux corriendo, cada `new-session` nuevo
arranca dentro de ese servidor y hereda el entorno de quien lo creó, no el del shell
que lanza el comando. Caso real: el servidor lo arrancó la sesión del CEO, y Directora,
T1, T2 y PM acabaron todas con `ROLE_NAME=CEO` en la línea de estado. La Directora no
reconocía al PM porque su línea de estado decía "[CEO]".

**Nombre persistente de verdad — vía `tmux`, no el título de la ventana** (decidido con
Aitor, 2026-08-15: quería poder identificar cada ventana con certeza, y color+posición
no bastaba por sí solos). Cada sesión se lanza envuelta en `tmux new-session -s
'<nombre-sesión>'`, con `<nombre-sesión>` = `<slug-proyecto>-<rol>` fijo, ej.:
`advcal-pm`, `advcal-ceo`, `advcal-director`, `advcal-integrador`, `advcal-fa`,
`advcal-t1-dev`, `advcal-t1-audit` (el prefijo `advcal-` evita colisión visual si otra
fábrica corre a la vez, mismo motivo que la paleta de color separada del piloto). El
nombre vive en la barra de estado de tmux, dentro del contenido de la terminal —
Claude Code nunca la toca, a diferencia del título de la pestaña (que sigue
sobrescribiéndose igual que siempre, eso no cambia).

Requiere `tmux` instalado (`brew install tmux`, una vez por máquina) y
`~/.tmux.conf` con esta config global (una vez, vale para todas las sesiones —
`automatic-rename off` + `allow-rename off` es lo que evita que tmux reescriba el
nombre según el comando en marcha, el mismo problema que tenía el título de
Terminal.app):
```
set -g status on
set -g status-position bottom
set -g automatic-rename off
set -g allow-rename off
set -g status-left-length 40
set -g status-left "#[bold]#S "
```

**Bonus para recuperación** (ver §4, "Cómo reinstaurar el entorno"): al vivir tmux como
proceso servidor independiente de Terminal.app, si se cierra la ventana pero la sesión
de tmux no ha muerto, se recupera con `tmux attach -t '<nombre-sesión>'` en una ventana
nueva en vez de perder el hilo — más robusto que "cierra y abre una nueva" a secas.
**Todas las ventanas arrancan con `claude --permission-mode auto`** (decidido con
Aitor, 2026-08-15) — sin el flag, la primera vez que `claude` corre en una carpeta
nueva puede mostrar el asistente interactivo "Set up auto mode for your environment?",
que bloquea esa ventana hasta que alguien responde a mano con el teclado (los demás
roles no pueden resolverlo por `SendMessage`, es un menú de la propia CLI, no de la
conversación). Pasar el modo por flag lo evita del todo. Aplica a los cinco roles
centrales y a las terminales de Desarrollador/Auditor por igual.
El `set index of w to 1` fuerza a la ventana objetivo a ser la ventana frontal de
verdad antes de que Claude Code arranque — sin foco real, escribir al pty con `do
script` puede no ser fiable. Incidente real que motivó este paso: al reintentar un
`do script "cd ... && claude" in t` sobre una ventana que no tenía foco (la del PM,
tras un primer intento fallido), el comando llegó corrupto al shell — texto random
insertado antes del `cd` (`eucd ...`, y en un segundo reintento `cuancd ...`) — dejando
esa ventana en bash puro sin llegar a lanzar `claude`. Se resolvió localizando la
ventana por color, haciendo `activate` + `set index of w to 1` para forzar el foco
real, y entonces sí el `do script` llegó limpio. Aplica el mismo paso (`activate` +
`set index of <window> to 1` sobre la ventana objetivo) antes de cualquier `do script`
de arranque o de recuperación, no solo en la creación inicial.

### Regla general: nunca direccionar una ventana de Terminal.app por índice

Dos incidentes reales distintos (el de arriba, al arrancar el PM, y otro al reenviar la
ronda 2 de auditoría de TAL-1 a la ventana de Codex — texto acabó en la ventana del
Factory Architect en vez de en la del auditor) son la MISMA clase de bug con síntomas
distintos: el índice de ventana (`window N`/`tab N`) no es estable si hay más de una
ventana abierta y cambia entre que lo compruebas y que lo usas. El fix de `activate` +
`set index of w to 1` de arriba solo resuelve el robo de foco al escribir — no resuelve
identificar mal cuál es la ventana objetivo en primer lugar.

**Identifica siempre la ventana objetivo por una propiedad estable, en el mismo momento
de usarla — nunca por índice numérico, y nunca reutilices un índice que determinaste en
un paso anterior:**
- `tty` del proceso (la mejor opción — estable durante toda la vida de la sesión):
  saca la tty con `ps -eo pid,tty,command | grep <proceso>`, luego en Terminal.app
  `repeat with w in windows / if (tty of w) is "/dev/ttysXXX" then ...`.
- **Si la ventana se lanzó con `tmux new-session`** (la receta estándar de este
  documento): hay DOS tty distintas — la del proceso `claude` interior (la que aparece
  si buscas ese proceso en `ps`) y la del proceso `tmux new-session -s <nombre>`
  exterior. Terminal.app solo conoce la exterior — busca siempre `ps -eo
  pid,tty,command | grep "tmux new-session -s <nombre-sesión>"`, nunca la del `claude`
  interior (incidente real 2026-08-16: usar la interior hace que ninguna ventana
  coincida nunca, sin error visible).
- Si no hay proceso claro que buscar por tty, usa `custom title`/color de fondo en su
  lugar.

Aplica a cualquier rol que envíe algo a una ventana ajena (CEO, Directora, Integrador),
no solo al lanzar/recuperar sesiones.

**Nunca captures una referencia a una ventana y la reutilices después de `activate`**
— reordena la colección `windows`, así que una referencia anterior puede dejar de
apuntar a la misma ventana física. Resuelve por `tty` de nuevo justo antes de cada
operación que module la ventana (índice, color), ver receta de parpadeo más abajo para
el patrón completo.

**Verificación de entrega obligatoria tras cualquier relay a una ventana que no es una
sesión Claude** (el auditor, o cualquier otra herramienta con su propia ventana): una
sesión Claude confirma recepción sola (aparece en su propio transcript/respuesta); una
ventana de otra herramienta no — un `do script`/tecleo ahí es "dispara y reza", sin
confirmación integrada. Además, `do script` deja el texto escrito en la caja de entrada
pero no siempre lo envía — algunas TUIs (Codex incluido) necesitan un `tell application
"System Events" to keystroke return` aparte para confirmar el envío, no basta con el
`\n` que añade `do script`. Después de reenviar algo importante a una ventana no-Claude:
lee su contenido de vuelta (`contents of window`, identificando la ventana por `tty`
como arriba) y confirma que lo enviado aparece de verdad como recibido/en proceso, no
solo como texto sentado en la caja de entrada. Si no coincide con lo que creías haber
enviado, no está enviado — no lo asumas y sigas adelante.

### Disparar al auditor: modo no interactivo, nunca una ventana

**El motor auditor** es hoy Gemini CLI. Antes fue Codex, hasta el 2026-10-14, cuando se
quedó sin cuota y Aitor decidió no pagar más a OpenAI. Esta sección es **el único sitio
donde vive el comando concreto**: el resto de documentos dicen «el motor auditor» y
remiten aquí. Si vuelve a cambiar el motor, se cambia esta sección, el párrafo Auditor de
`CLAUDE.md` y la sección `auditor-role` de `AGENTS.md`. El principio no cambia: el auditor
tiene que ser de una familia distinta a Claude.

Un tercer incidente (2026-08-15, reenvío de la ronda 1 de TAL-3) confirmó que ni
siquiera verificando el `tty` justo antes de escribir es fiable del todo — un
`keystroke` de System Events puede aterrizar en una ventana distinta a la comprobada.
**Conclusión: no escribas ni teclees en ninguna ventana de terminal ajena, en ningún
caso — ni con `do script` ni con `keystroke`.** Leer (`contents of window`) sigue siendo
seguro y es la única forma sancionada de inspeccionar una ventana ajena.

Las rondas de auditoría se disparan siempre en modo no interactivo, directamente desde tu
propia sesión y sin tocar la ventana de nadie. **Son dos pasos y el primero es
obligatorio:**

```bash
cd _worktrees/T<n>
EXPORT='/ruta/completa/hasta/calendario-adviento/codigo para auditar/T<n>_<TAL-X>_..._loopN-para-auditor.txt'

# 1 · OBLIGATORIO: grep de secretos sobre el export y sobre el diff. Si sale cualquier
#     coincidencia, NO se lanza: se avisa al CEO. Los valores nunca se imprimen.
( set +x
  vals=$(for f in .env .env.local; do [ -f "$f" ] && sed -nE 's/^[A-Z0-9_]*(SECRET|KEY|TOKEN)[A-Z0-9_]*=["'\'']?([^"'\'']{8,}).*/\2/p' "$f"; done)
  [ -z "$vals" ] && { echo "secretos: 0 valores en .env*"; exit 0; }
  n=$({ cat "$EXPORT"; git diff main...HEAD; } | grep -cF -- "$vals")
  echo "secretos: $n coincidencias"; [ "$n" = 0 ] ) || exit 1

# 2 · Auditoría, en solo lectura
gemini --approval-mode plan \
  --include-directories "/ruta/completa/hasta/calendario-adviento/codigo para auditar" \
  -p "Revisa la tarea <TAL-X> de la terminal T<n>. El fichero de exportación de esta ronda
está en la ruta ABSOLUTA '$EXPORT'. Da tu veredicto GO/NO-GO siguiendo el rol de auditor
cargado desde AGENTS.md."
```

- **Solo lectura, siempre:** `--approval-mode plan`. Nunca `--yolo` ni `auto_edit`.
- **`--include-directories`** da acceso a la carpeta «codigo para auditar» de la raíz,
  donde están los planes y los veredictos anteriores, aunque se lance desde un worktree.
- **Fichero de contexto:** Gemini lee `AGENTS.md` porque así lo fija
  `.gemini/settings.json` (`context.fileName`). No hay `GEMINI.md`: `AGENTS.md` es la
  única fuente.
- **Secretos, doble barrera** (en el nivel gratuito, Google puede usar lo que se le
  envía): el grep del paso 1, y `.geminiignore`, versionado, que impide que el auditor
  lea `.env*` y `*.pem` aunque se lo pidan. Recordatorio de TAL-82: nunca hacer `source`
  de un `.env` con `set -x`.
- **Si el motor auditor se queda sin cuota,** las auditorías esperan y la Directora lo
  apunta en la cola «pendiente de Aitor». **Nunca se audita con Claude**, porque es la
  misma familia que quien desarrolla.

**Usa siempre ruta absoluta al fichero de export, nunca relativa.** Un incidente real
(2026-08-15, ronda 2 de TAL-3): la instrucción decía "subiendo un nivel desde este
worktree", pero un worktree vive en `_worktrees/T<n>` — son DOS niveles hasta la raíz
del repo, no uno. El auditor tomó la instrucción al pie de la letra, no encontró el fichero
en esa ruta relativa incorrecta, y devolvió NO-GO por "no puedo verificar nada" — un
fallo de instrucción de quien dispara la auditoría, no un hallazgo real. La ruta
absoluta elimina esta clase de error por completo.

El resultado llega como salida de comando normal, con el veredicto completo, así que no
hay ambigüedad sobre si «se envió» o no. Si alguien abre la ventana interactiva del motor
auditor, solo puede escribir en ella Aitor, a mano. Ningún rol lo hace.

Para roles de raíz (PM, Directora, Integrador, CEO — `CLAUDE.md` no los distingue solo
por carpeta, a diferencia de un Desarrollador en su worktree): no hace falta pasar el
rol como argumento de arranque — espera a que la sesión aparezca en `ListAgents` y
mándale el rol por `SendMessage` ("eres el Product Manager, lee `pm.md` completo").
Mientras no exista repo/worktrees, todos arrancan `cd` a la raíz del proyecto:
`/Users/aitor/Documents/curro + proyectos/Talent Land/Sistemas/Factory/calendario-adviento`.

### Modo de publicación del Integrador

`_modo-publicacion.txt` (en `.gitignore` en cuanto exista repo; se crea con
`confirmar` la primera vez): mientras diga `confirmar`, el Integrador pregunta a Aitor
antes de cada publicación concreta. Aitor cambia el modo diciéndoselo a cualquier rol
("publica sin preguntar" / "vuelve a preguntarme") — detalle en `integrador.md`. Con
`autonomo`, publica sin preguntar y lo cuenta después.

**Estado actual: `autonomo`** (Aitor se lo confirmó en persona al CEO el 2026-10-01).
**Cómo se publica:** siempre con `scripts/publish.sh <rama>[::<título>] ...`, que está
versionado, nunca con scripts sueltos por tarea. Hace un merge `--no-ff` por rama con
"merge: TAL-X — <título>" y un solo push; si algún merge choca, devuelve `main` a donde
estaba y no hace push. Solo lo lanza el Integrador. Ojo: la regla de permiso que deja
lanzarlo está en los settings del proyecto, así que técnicamente cubre a cualquier sesión
abierta en la raíz. Que solo publique el Integrador es una regla de proceso, no un límite
técnico: ningún otro rol lo lanza aunque pueda.

### Alerta visible "necesito tu atención ya" — modal + parpadeo rojo/blanco

`display alert ... as critical` (modal) sigue siendo el mecanismo garantizado — úsalo
siempre que necesites asegurar que el aviso llega. El parpadeo rojo/blanco es un extra
visual en paralelo, ya fiable (fix confirmado 2026-08-16, verificado por AppleScript en
vivo, no solo por captura de pantalla).

**Usa la receta de abajo tal cual, no la resumas sobre la marcha bajo presión** —
la captura de `originalColor` es el paso que más fácil se salta al improvisar una
versión reducida, y es justo el que rompe todo si falta: sin él acabas restaurando un
color fijo asumido (p. ej. blanco) en vez del real, lo que puede dejar fondo y texto
del mismo color — ventana ilegible (incidente real, 2026-08-16: el CEO improvisó un
script reducido con blanco hardcodeado en vez de capturar/restaurar el color original,
y Aitor se quedó sin poder leer su propia ventana).

**Nunca captures una referencia a una ventana (`set targetWindow to w`) y la
reutilices después de `activate`** — `activate` puede reordenar la colección `windows`
de Terminal.app, y una referencia posicional capturada antes deja de apuntar con
certeza a la misma ventana física. Resuelve la ventana por `tty` de nuevo, justo antes
de cada operación que la modifique (mover el índice, cambiar el color), no una sola vez
al principio. Esto aplica a cualquier operación de reposicionar/recolorear una ventana,
no solo al parpadeo.

Si la ventana se lanzó con `tmux new-session`, direcciona por la tty del proceso `tmux
new-session -s <nombre>` (exterior), nunca la del `claude` interior — ver regla general
de arriba.

```bash
osascript <<APPLESCRIPT
tell application "Terminal"
    activate
    repeat with w in windows
        try
            if (tty of w) is "/dev/ttysXXX" then set index of w to 1
        end try
    end repeat
    set originalColor to missing value
    repeat with w in windows
        try
            if (tty of w) is "/dev/ttysXXX" then set originalColor to background color of w
        end try
    end repeat
    if originalColor is missing value then return "not found"
    repeat 30 times
        repeat with w in windows
            try
                if (tty of w) is "/dev/ttysXXX" then set background color of w to {65535, 0, 0}
            end try
        end repeat
        delay 0.3
        repeat with w in windows
            try
                if (tty of w) is "/dev/ttysXXX" then set background color of w to {65535, 65535, 65535}
            end try
        end repeat
        delay 0.3
    end repeat
    repeat with w in windows
        try
            if (tty of w) is "/dev/ttysXXX" then set background color of w to originalColor
        end try
    end repeat
end tell
APPLESCRIPT
```
`repeat 30 times` a 0.3s por medio ciclo ≈ 18s. Verifica el color final **por AppleScript
(consulta de solo lectura), no mirando una captura de pantalla** — un color oscuro
asignado a un rol (p. ej. el vino oscuro del CEO) puede confundirse con rojo a simple
vista en una imagen pequeña o comprimida; la única confirmación fiable es leer el valor
RGB real.

---

## 4quater. Los cambios de proceso viven en `main`, no en la raíz

Un cambio de proceso no está terminado hasta que está en `main` (decidido por el Factory
Architect, 2026-10-11; detalle en `factory-architect.md` § "De la decisión al proceso
en marcha", punto 5). Los cambios de proceso o de diseño que solo tocan documentación
se pueden commitear en `main` local, en la raíz, y llegan a origin con el siguiente
`scripts/publish.sh`. Si un cambio de proceso es urgente para los workers antes de esa
publicación, la Directora se lo transmite por mensaje mientras tanto. Lo decidió el
Factory Architect el 2026-10-14 y sustituye a la rama de proceso propia. Lo que nunca
puede pasar es dejarlos sin commitear. Motivo: con lo de proceso
apilado sin commitear, los worktrees leían copias desfasadas, cada regla dependía de
que alguien la transmitiera a mano, y `scripts/publish.sh` abortaba en cuanto una tarea
tocaba uno de esos ficheros.

## 5. Reanudar tras un corte (sesiones duplicadas)

Decidido por el Factory Architect, 2026-10-01. Caso real: tras el corte de cuota de las
18:41, la conversación de la Directora acabó corriendo en tres procesos a la vez: su
tmux, un `claude` abierto a mano y la antigua ventana del PM, que aún tenía el color del
PM. Mientras tanto, la conversación del PM se quedó sin ningún proceso. Hubo una
auditoría duplicada, se comunicó un GO desde la copia equivocada y Aitor le escribió a
la ventana equivocada pensando que era el PM.

1. **Toda sesión que se reanude** (corte de cuota, reinicio, `claude --resume`) hace
   `ListAgents` ANTES de actuar. Si otra sesión ya cubre su mismo rol o su misma tarea,
   para: no publica, no audita, no comunica GO ni NO-GO, y avisa al CEO.
2. **Desempate:** sigue la sesión que está en su tmux de rol (`advcal-<rol>`). Las demás
   se cierran. El CEO decide y ejecuta el cierre; Aitor solo interviene si el CEO no
   puede.
3. **Color de la ventana:** tras reanudar, cada sesión comprueba que el color de fondo
   de su ventana es el de su rol según la tabla de §4ter. Si no coincide, lo corrige, o
   avisa al CEO si no puede.
4. **La Directora solo acepta un GO o NO-GO de una auditoría que haya lanzado ella misma**
   desde su propia sesión. Si aparece un veredicto que no recuerda haber pedido, lo trata
   como un duplicado y no lo usa.
5. **El barrido del CEO**, después de cualquier corte, busca roles duplicados en
   `ListAgents`.
6. **Estado de la fábrica:** antes de actuar, toda sesión que se reanude o arranque lee
   `_estado-fabrica.txt` en la raíz. Si dice `halt`, no hace nada salvo responder y espera
   a que se levante. Ver «HALT y su levantamiento» más abajo.

### HALT y su levantamiento

Lo decidió el Factory Architect el 2026-10-14. Caso real: Aitor ordenó "HALT THE FACTORY"
el 2026-10-12 y la orden se difundió a todos. Al levantarse la parada el 2026-10-14, al
Integrador sí le llegó el aviso, pero al FA no. El FA siguió en pausa hasta que el
vigilante de silencio del CEO lo detectó.

1. **El estado vive en un fichero**, igual que el modo de publicación:
   `_estado-fabrica.txt` en la raíz, fuera de git (está en `.gitignore`). Contiene una
   sola línea: `activo` o `halt`, seguido de la fecha y el motivo. Por ejemplo:
   `halt 2026-10-12 — incidente de secreto en TAL-82, orden de Aitor`. Quien reciba la
   orden de Aitor lo actualiza en ese mismo momento.
2. **La difusión es del CEO**, sea quien sea el que reciba la orden: avisa de la parada y
   de su levantamiento a TODOS los roles vivos que salgan en `ListAgents` (FA, Inspector,
   Integrador, PM y Directora). A los workers les llega a través de la Directora. Si no
   hay CEO activo, difunde quien haya recibido la orden.
3. **En cada barrido, el CEO comprueba** que todos los roles vivos actúan según ese
   fichero: nadie trabajando con `halt` y nadie en pausa con `activo`.

## 6. Estado del reparto (última foto — mirar el gestor de tareas real)

Backlog de "Onda 1 · MVP" (8 tareas) repartido y en marcha desde el 2026-08-15/16 — no
lo actualices aquí a mano en cada cambio, esto es solo un histórico de arranque. Mira
siempre el gestor de tareas real (Linear) para el estado vigente.

## 7. Formato estándar de reporte de estado

Cuando reportes estado (a petición de Aitor, o cuando tu barrido encuentre algo que de
verdad merezca decírselo — no en cada ciclo silencioso), muéstralo como árbol
jerárquico, verificable de un vistazo: rol, sesión, estado (activo/idle/esperando),
tarea en mano, y un comentario breve cuando aporte algo (p. ej. "esperando confirmación
desde hace 12 min"). Nunca un simple "todo en orden" sin más — no se puede verificar por
fuera; el árbol con datos concretos sí, y es Aitor quien decide si de verdad está todo
bien, no tú por él (decidido 2026-08-16).

**Forma exacta (fijada por Aitor, 2026-08-16)** — el CEO en la raíz, con PM/Integrador/
Factory Architect/Inspector como hijos directos, y la Directora con sus propias parejas
Dev/Audit anidadas debajo de ella (no sueltas bajo el CEO):

```
CEO — activo (trabajando en "tal cosa")
├── Inspector — última verificación 00:00. Sin incidencias
├── PM — idle
├── Integrador — idle, TAL-8 publicada
├── Factory Architect — idle
└── Directora — busy, (haciendo tal cosa)
    ├── T1-Dev — busy, trabajando en TAL-8 (round 4)
    ├── T1-Audit — idle
    ├── T2-Dev — waiting ("parado por tal motivo")
    └── T2-Audit — idle
```

Notas de contenido: entre paréntesis, contexto concreto cuando aporte algo (qué tarea,
por qué está parado) — no solo el estado en seco. Para el Inspector, la hora de su
última verificación en vez de tiempo activo. Usa el nombre del rol, no el identificador
de sesión, salvo que haga falta desambiguar.

Aplica a cualquier rol que reporte estado del pipeline o de su propia rama de él (el CEO
sobre todo el pipeline; la Directora sobre sus terminales de desarrollo asignadas) —
mismo formato, mismo criterio de "solo cuando haga falta".
