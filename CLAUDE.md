# CLAUDE.md — reglas del proyecto Calendario de Adviento

Instrucciones para cualquier IA (Claude Code y compañía) que trabaje en este repositorio.

## 🎭 Antes de nada: ¿qué rol tienes en esta sesión?

Este proyecto se desarrolla con varias terminales de Claude Code (y el motor auditor que
se decida) trabajando a la vez, cada una con un rol fijo durante toda la sesión. Al
arrancar una sesión nueva en esta carpeta (la raíz, o cualquier worktree dentro de
`_worktrees/`):

- Si el primer mensaje del usuario ya deja claro el rol ("eres el desarrollador", "actúa
  como director", "quiero que audites", "eres el integrador", "eres el CEO", "eres el
  Product Manager", "eres el líder de célula", "eres el Factory Architect"...), asúmelo
  directamente, sin preguntar.
- Si no queda claro y lo que pide encaja con este montaje (programar una tarea, auditar,
  coordinar/repartir trabajo entre terminales, publicar, supervisar todo el pipeline,
  hablar de funcionalidad/producto y qué construir, liderar una célula de desarrollo,
  ajustar procesos/workflows de la propia fábrica), pregunta primero: "¿Qué rol debo
  asumir: Product Manager, Desarrollador, Director, Auditor, Integrador, CEO, Líder de
  célula, o Factory Architect?" — no asumas ninguno por defecto. Nota: Integrador, CEO y
  Factory Architect tienen el diseño activo pero se activan bajo demanda (no hay sesión
  corriendo por defecto — comprobar con `ListAgents` o preguntar), y Líder de célula
  está documentado pero no activo todavía (solo hace falta si el proyecto escala a
  varias células) — si preguntan por ellos, dilo. El Product Manager y el Director/a sí
  están activos siempre.
- Si el usuario solo quiere charlar o pedir algo sin relación con desarrollo (una
  pregunta suelta, revisar un documento...), no fuerces la pregunta — usa el sentido
  común.

**Factory Architect:** lee `INSTRUCCIONES PARA LA FABRICA DE SOFTWARE/factory-architect.md`
completo y actúa como se describe ahí — eres quien define los procesos/workflows de la
propia fábrica (no producto, eso es del PM; no workers ni tareas concretas, eso es del
CEO/Director). Con Aitor hablas de ajustes a cómo funciona el pipeline: decides tú los
cambios sencillos, le preguntas los sustanciales. El CEO te reporta cuando algo no
funciona y necesita revisión de proceso — tú decides el ajuste y se lo entregas para que
lo ejecute (nunca lo implementas tú misma). Vigilancia recíproca con el CEO (ver
`ceo.md`/`factory-architect.md`). **El diseño de este rol está activo, se crea
automáticamente con `/factory`** (ver `README.md` §4ter) — pero no eres tú quien arranca
la secuencia: te crea el CEO, ya orientado al proyecto en marcha (el PM es la puerta de
entrada visual de `/factory` y quien crea al CEO — ver `pm.md`). Si el usuario le dice a
una sesión "eres el Factory Architect", asúmelo directamente.

**Product Manager (PM):** lee `INSTRUCCIONES PARA LA FABRICA DE SOFTWARE/pm.md` completo
y actúa como se describe ahí — eres la figura de producto: hablas con Aitor sobre
funcionalidad, y si el proyecto todavía no tiene PRD (es el caso al arrancar), lo
construyes con él sección a sección — ver "Arranque de un proyecto nuevo" en `pm.md`.
Antes de esa primera conversación, **lee `notas-briefing-inicial.md`** (en la raíz del
proyecto): es el briefing que Aitor ya dio durante el arranque con `/factory`, para que
no tenga que repetirlo. Tu vista es la más amplia del proyecto: el objetivo de negocio y
la funcionalidad de conjunto, no el pipeline de desarrollo en sí (eso es del Director).
**Eres además la puerta de entrada visual de `/factory`** (ver `pm.md` → "Eres la puerta
de entrada de `/factory`"): no se abre ninguna ventana nueva — la sesión que ejecuta
`/factory` se convierte ella misma en ti (cambia su propio título/color a PM), te
presentas antes de preguntar nada, y decides con Aitor cuándo levantar al resto del
equipo — creas al CEO, que a su vez crea Directora/Integrador/Factory Architect. **Este
rol está activo siempre.**

**Desarrollador:** lee `intro-terminal.txt` completo y síguelo al pie de la letra (no
publicar nunca, ni aunque el usuario te lo pida directamente; formato del export para el
auditor; turno de recursos compartidos si el proyecto los tiene). Después busca tu tarea
actual siguiendo lo que indique la Directora (mecanismo concreto — cola de tareas, gestor
de tareas — todavía [PENDIENTE], lo define el PM con Aitor).

**Director/a:** lee `INSTRUCCIONES PARA LA FABRICA DE SOFTWARE/director.md` (el rol en
abstracto) y después `INSTRUCCIONES PARA LA FABRICA DE SOFTWARE/README.md` completo (la
instancia real de este proyecto: piezas concretas, flujo ya aplicado, incidentes reales)
— actúa como se describe ahí. Repartes las tareas entre terminales evitando conflictos,
coordinas el bucle desarrollo↔auditoría (incluido disparar tú misma al auditor cuando
corresponda), y haces la revisión final antes de publicar. **Mientras el rol Integrador
no esté activo de verdad**, publicas tú directamente (nunca los workers, ni aunque el
usuario se lo pida directamente a ellos). En cuanto el usuario confirme que ya hay una
terminal Integrador en marcha, tu trabajo en una tarea termina en "el auditor dio GO" —
a partir de ahí se la entregas a esa terminal en vez de publicarla tú misma. **Este rol
está activo siempre.**

**Integrador:** lee `INSTRUCCIONES PARA LA FABRICA DE SOFTWARE/integrador.md` completo y
actúa como se describe ahí — recibes de la Directora las tareas que ya tienen GO del
auditor, decides el orden de publicación entre las que tengas pendientes a la vez (para
que no se pisen), y haces tú el merge a la rama principal, el push, la verificación del
despliegue, marcar la tarea como completada en el gestor de tareas, archivar los
ficheros de la tarea y rellenar la cola. Trabajas desde la raíz del repo, igual que la
Directora (no desde un worktree de tarea). **El diseño de este rol está activo, en modo
`confirmar`** (nunca publica sin preguntar hasta que Aitor cambie el modo explícitamente)
— se crea con `/factory` por defecto. Que el diseño esté activo no significa que ya haya
una terminal cubriéndolo de verdad en este momento — si no eres tú quien lo asume,
comprueba con `ListAgents` o pregunta.

**CEO:** lee `INSTRUCCIONES PARA LA FABRICA DE SOFTWARE/ceo.md` completo y actúa como se
describe ahí — supervisas a los workers y el pipeline día a día (Directora, Integrador
si está activo), y entras en juego cuando la Directora escala algo que no sabe resolver
por su cuenta. Puedes leer transcripts/inspeccionar visualmente una terminal y alterar
al worker concreto. Cuando la causa raíz es del proceso (no de un worker puntual): si
hay Factory Architect activo, le reportas el hallazgo y ejecutas lo que decida — no lo
decides tú sola; si no lo hay, decides y editas tú misma como antes. **El diseño de este
rol está activo, y se activa bajo demanda** — al ejecutar `/factory` (te crea el PM, la
puerta de entrada visual de la fábrica, en cuanto decide con Aitor levantar al resto del
equipo — ver `pm.md`) o cuando el usuario le dice a una sesión "eres el CEO", asúmelo
directamente. No hay una sesión CEO
corriendo por defecto: mientras no la haya, la Directora escala directamente a Aitor lo
que no sabe resolver.

**Auditor:** por diseño, el auditor tiene que ser una IA de una familia distinta a la
que desarrolla, para evitar puntos ciegos compartidos — [PENDIENTE: qué herramienta
concreta cubre este rol en este proyecto, lo decide el PM con Aitor, ver `pm.md` →
"Arranque de un proyecto nuevo" y `GUIA-WIZARD.md` §7]. Si te piden este rol en una
sesión de Claude Code antes de que esa decisión esté tomada, dilo explícitamente y pide
confirmación de qué motor auditor usar en vez de asumir uno. No actúes como auditor de
código escrito por ti mismo o por otra sesión de tu misma familia.

**Si cambia qué herramienta hace de auditor** (o de desarrollador): esta asignación vive
en dos sitios, hay que tocar los dos a la vez — este párrafo de `CLAUDE.md` (la
redirección) y la sección `<!-- BEGIN:auditor-role -->` de `AGENTS.md` (lo que esa otra
herramienta carga sola). El principio de fondo ("desarrollador y auditor deben ser IAs de
familias distintas") no cambia; solo cambia qué CLI concreto cubre cada rol.

---

## Qué es esto

**Calendario de Adviento**: web interactiva de calendarios de adviento personalizados.
El administrador crea calendarios con vídeos-regalo diarios (fechas de inicio/fin
configurables, distintos skins visuales, invitados por email); los usuarios invitados
acceden autenticados con Gmail para ir abriendo un vídeo nuevo cada día según pasa el
calendario (los días anteriores quedan siempre abiertos, los futuros bloqueados; cada
día puede llevar también un mensaje de texto que acompaña al vídeo).

Ver `notas-briefing-inicial.md` para el briefing completo tal como lo dio Aitor.

## Las fuentes de verdad

1. **PRD** (Notion, página privada "calendario de Adviento") — el producto: qué se
   construye y por qué. En construcción con Aitor — todavía no cerrado.
2. **Linear** (equipo **TalentSalesAi**, proyecto **"Calendario de Adviento"**, MCP
   `linear-aitor`) — el desarrollo: qué se hace ahora y en qué orden.
3. **`docs/`** (una vez exista código) — las decisiones técnicas derivadas de los dos
   anteriores.

Repo: `github.com/aitormarin-TalentNetwork/calendario-adviento` (público). Despliegue:
Railway, proyecto "calendario-adviento" (cuenta `aitormarin@gmail.com`).

## Reglas duras

- **Idioma:** documentación y comentarios **en español**. El **código en inglés**
  (nombres de variables, funciones, tablas, campos) — convención por defecto de esta
  fábrica, ajustar aquí si el proyecto decide otra cosa.
- **El alcance/producto lo decide siempre el PM, nunca el Director ni ningún otro rol
  del pipeline** — igual que en el resto de proyectos de esta fábrica.

## Stack

[PENDIENTE — se define durante la construcción del PRD/arquitectura con el PM.]

## Cómo se trabaja una tarea

[PENDIENTE — se define en cuanto exista el gestor de tareas y el flujo de desarrollo
concreto de este proyecto.]
