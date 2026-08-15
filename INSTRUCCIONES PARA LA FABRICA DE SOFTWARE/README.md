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
| **Mensajería directa** | `SendMessage` / `ListAgents` | Cómo se hablan los roles entre sí. |
| **PRD** | Notion, página privada "calendario de Adviento" (raíz del espacio de Aitor) | Documento de producto — lo redacta el PM tras el acuerdo con Aitor. |
| **Gestor de tareas** | Linear, equipo **TalentSalesAi**, proyecto **"Calendario de Adviento"** (MCP `linear-aitor`) | Fuente de verdad de qué se hace y en qué orden. |
| **Recurso(s) compartido(s)** | [PENDIENTE — todavía no hay stack/backend decidido; se define al construir el PRD] | Ver §3bis si necesita migración a aislado por terminal. |
| **Repo** | `github.com/aitormarin-TalentNetwork/calendario-adviento` (público) | La Directora mergea a `main` y hace push aquí. |
| **Despliegue** | Railway, proyecto **"calendario-adviento"** (cuenta `aitormarin@gmail.com`, carpeta del proyecto ya enlazada con `railway init`) | Auto-despliega en cada push a `main` una vez conectado el servicio. |

---

## 2. El flujo de trabajo, de punta a punta

Sigue el flujo genérico de `director.md` — documenta aquí las particularidades reales
de este proyecto en cuanto aparezcan (comandos exactos de build/despliegue, cómo se
dispara el auditor, qué verificar antes de publicar).

## 2bis. Automatización y cuándo parar a preguntar

Ver `director.md` ("Cuándo resolver tú misma y cuándo escalar") y `ceo.md`
("Vigilancia en malla, no en pirámide") — los mismos disparadores de escalado aplican
aquí. Añade los específicos de este proyecto según se descubran.

---

## 3. Reglas que la sesión directora tiene que respetar

Reglas base (ver `director.md` para el detalle de cada una — no las dupliques aquí
salvo que este proyecto las particularice):
- No crear nada fuera de la carpeta del proyecto sin confirmación explícita.
- Mantener la cola de tareas con 2-3 listas, siempre.
- Barrido periódico proactivo de todas las terminales.
- No paralelizar tareas que toquen el mismo archivo.
- Actualizar `docs/` en el mismo cambio que se toma una decisión técnica.

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

### Identificación visual — color de fondo + título, por rol

| Rol | Color de fondo (RGB Terminal.app, 0–65535) | Título |
|---|---|---|
| Factory Architect | violeta oscuro `{16000, 0, 20000}` | `Factory Architect` |
| CEO | rojo oscuro `{20000, 0, 0}` | `CEO` |
| PM | verde oscuro `{0, 20000, 0}` | `PM` |
| Directora | azul oscuro `{0, 0, 20000}` | `Directora` |
| Integrador | ámbar oscuro `{20000, 12000, 0}` | `Integrador` |
| Desarrollador (`T<n>`) | por defecto (negro) | `T<n> - Desarrollador` |
| Auditor (`T<n>`) | por defecto (negro) | `T<n> - Auditor` |

**El color de fondo es el identificador fiable de cada rol pasado el arranque
inicial** — el título personalizado se sobrescribe en cuanto Claude Code arranca de
verdad (pone su propio título con indicador de estado en vivo, un símbolo tipo
`✳`/spinner al principio seguido de la tarea actual). No uses el título para
identificar una ventana por rol una vez arrancada la sesión, solo el color de fondo
(consultable por AppleScript, `background color of window`).

### Receta: abrir una ventana nueva con rol, color y título

```bash
osascript <<APPLESCRIPT
tell application "Terminal"
    activate
    set t to do script "cd '<ruta-worktree-o-raíz>' && claude --permission-mode auto"
    set w to front window
    set index of w to 1
    delay 0.3
    set custom title of t to "<Título>"
    set background color of t to {R, G, B}
end tell
APPLESCRIPT
```
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

Para roles de raíz (PM, Directora, Integrador, CEO — `CLAUDE.md` no los distingue solo
por carpeta, a diferencia de un Desarrollador en su worktree): no hace falta pasar el
rol como argumento de arranque — espera a que la sesión aparezca en `ListAgents` y
mándale el rol por `SendMessage` ("eres el Product Manager, lee `pm.md` completo").
Mientras no exista repo/worktrees, todos arrancan `cd` a la raíz del proyecto:
`/Users/aitor/Documents/curro + proyectos/Talent Land/Sistemas/Factory/calendario-adviento`.

### Disposición en pantalla — árbol horizontal

PM solo arriba del todo — es la primera ventana que abre `/factory`, y la única que no
crea ningún otro rol antes de existir ella misma; debajo, una fila con CEO/Factory
Architect/Integrador (los crea el CEO, en cuanto el PM decide levantar al equipo);
debajo de esa fila, la Directora a la izquierda con sus parejas `T<n>` (Desarrollador +
Auditor) extendiéndose a la derecha en cuanto existan. Constantes de layout: `W=480`,
`H=320`, `GAP=20`, origen `X0=40, Y0=40`. PM en `Y = Y0 - H - GAP`; fila central en `Y0`
(`CEO` en `X0`, `Factory Architect` en `X0+(W+GAP)`, `Integrador` en `X0+2*(W+GAP)`);
Directora se coloca — y recoloca — al final, centrada verticalmente sobre su lista de
parejas, una vez sabe cuántas tiene (nunca antes). Detalle completo y receta de `bounds`
en el README del proyecto piloto (`Sistemas/CRM curso Vibe Coding/Sorfware Factory/
INSTRUCCIONES PARA LA FABRICA DE SOFTWARE/README.md` §4ter) si hace falta el paso a paso
exacto.

### Modo de publicación del Integrador

`_modo-publicacion.txt` (en `.gitignore` en cuanto exista repo; se crea con
`confirmar` la primera vez): mientras diga `confirmar`, el Integrador pregunta a Aitor
antes de cada publicación concreta. Aitor cambia el modo diciéndoselo a cualquier rol
("publica sin preguntar" / "vuelve a preguntarme") — detalle en `integrador.md`.

---

## 6. Estado del reparto (última foto — mirar el gestor de tareas real)

Sin tareas repartidas todavía — proyecto recién creado.
