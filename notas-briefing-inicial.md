# Briefing inicial de Aitor — Calendario de Adviento

> Recogido tal cual durante el arranque con `/factory` (2026-08-15), antes de que
> existiera el rol PM. El PM lo usa como punto de partida de la conversación de
> producto — no sustituye la disciplina normal de "discutir a fondo primero, redactar
> solo después del acuerdo" (ver `pm.md`), pero evita que Aitor tenga que repetir todo
> esto desde cero.

Se trata de crear una web interactiva que sea un calendario de adviento. Se define una
fecha de inicio y de fin para el calendario y se crea un calendario bonito. Cada día, se
libera el acceso al contenido del día del calendario (los días anteriores quedan todos
abiertos) — en cada día hay un regalo para el usuario. El regalo es un vídeo que el
usuario puede ver. NO se pueden ver los vídeos de días futuros, se abre un vídeo nuevo
cada día, siguiendo el calendario.

El sistema necesita tener un usuario del calendario y un administrador, ambos entran
autenticados con Gmail. El usuario solo ve el calendario y puede ir abriendo los
días/vídeos conforme pasan los días. El administrador define cómo funciona el
calendario: quiénes son los usuarios que lo pueden ver (definidos por el email), las
fechas de inicio/fin del calendario, y la carga de los vídeos, que pueden ser un upload
o un link.

El calendario tiene que tener diferentes skins. El administrador puede crear diversos
calendarios: le pone el nombre al calendario, lo configura, sube los vídeos y manda las
invitaciones. La ficha del usuario tiene que incluir un botón ("invitar ahora") que
manda un link de invitación.

Para entrar y ver el calendario/vídeos, el usuario necesita autenticarse con Gmail. En
la portada de la web (autenticación) tiene que haber un título alegre y una foto
(también configurable por calendario). La idea es que sea algo alegre y divertido, que
las personas amen ver.

El player de vídeo tiene los controles normales de un reproductor. Cada día puede tener
también un mensaje en texto que acompaña al vídeo.
