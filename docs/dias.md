# Gestión de Días (TAL-6)

## Qué hace

Dentro de `/admin/[calendarId]` (protegida ya por TAL-5: solo Admin de ese
calendario o Super Admin), una sección "Días del calendario" con una
rejilla de fechas entre `startDate` y `endDate` (ambas incluidas) y un
panel de edición (vídeo + mensaje opcional) para la fecha seleccionada.
Lógica en `src/app/admin/[calendarId]/days-actions.ts`; UI en
`src/app/admin/[calendarId]/days-section.tsx` (server component: calcula
las fechas, aplica el límite de la ronda 1) y
`src/app/admin/[calendarId]/days-grid-editor.tsx` (client component: la
rejilla + el panel de la fecha seleccionada, ronda 2).

## Decisiones de alcance

- **Solo link externo, no subida de archivo real** — decisión técnica que
  pedía explícitamente el brief. `docs/stack.md` deja pendiente qué backend
  de almacenamiento usar para subidas (Railway volume, S3-compatible...);
  decidirlo como parte de esta tarea habría sido resolver una decisión de
  infraestructura no cerrada solo para desbloquear esta ronda. El campo
  `videoUrl` del schema (TAL-3) ya vale igual para un enlace externo que
  para la ruta de un archivo subido — cuando se decida el backend de
  subidas, la subida de archivo se puede añadir sin tocar el modelo de
  datos, solo la UI/acción de guardado. **Actualización ronda 2**: el PM
  confirma que el PRD sí pide ambos modos para el MVP, pero como implica
  elegir un servicio de almacenamiento, lo traslada a Aitor antes de
  confirmar del todo — esta terminal no toca la subida de archivo hasta
  que la Directora lo indique.
- **Rejilla + panel de edición, como el mockup** (ronda 2, a petición del
  PM): la ronda 1 simplificaba esto a una lista de formularios siempre
  visibles, uno por fecha, para evitar estado de cliente. El PM pidió
  acercarse al mockup — ahora hay un componente cliente
  (`days-grid-editor.tsx`) con una rejilla de celdas (una por fecha,
  resaltada si ya tiene vídeo) y, debajo, un único formulario montado a la
  vez para la fecha seleccionada. Efecto colateral bueno: al montar un
  solo formulario en vez de uno por fecha, reduce el trabajo de render por
  petición — parte de la respuesta al hallazgo de DoS de la ronda 1 (ver
  más abajo).
- **Un día = una fecha, no un número "Día N"**: se itera `startDate` a
  `endDate` construyendo cada fecha real, no un contador 1..24 — así
  encaja exactamente con lo que `Day.date` puede guardar (`@db.Date`,
  único por `(calendarId, date)`, TAL-3) y con cualquier rango de fechas
  que el Admin haya puesto (no todos los calendarios tienen por qué ser de
  24 días).
- **Sin `Day` = sin vídeo asignado**: sencillamente no existe fila. No hace
  falta un campo de "vacío"/estado — "Quitar vídeo" borra la fila entera
  (con manejo de reenvío/doble clic vía P2025, mismo patrón que
  `deleteCalendarAction` de TAL-5); "Guardar día" hace upsert por
  `(calendarId, date)`.
- **Validación de URL del vídeo**: mismo criterio que `coverImageUrl` en
  `src/app/admin/actions.ts` (TAL-5) — solo `https:`, para no aceptar
  `javascript:`/`data:`/etc. Sin comprobación HTTP de que la URL sirve un
  vídeo de verdad (evita abrir un vector de SSRF a cambio de una
  validación no determinante). Probado en vivo: una URL `javascript:...`
  se rechaza en servidor y no llega a crear ninguna fila `Day`.
- **`requireCalendarAdmin` duplicado, no importado**: la misma
  comprobación ya existe en `src/app/admin/actions.ts` (TAL-5), pero ese
  fichero lo está tocando T2 en paralelo para TAL-7 — duplicar 6 líneas es
  más barato que arriesgar un conflicto de fichero compartido entre dos
  terminales a la vez. Candidato a extraer a un helper común
  (`src/lib/auth-guards.ts` o similar) si aparece un tercer sitio que lo
  necesite.

## Correcciones de la ronda 2 (hallazgos de auditoría)

- **Límite de duración gestionable (`MAX_MANAGEABLE_DAYS = 366`,
  `days-section.tsx`)**: nada en el CRUD de calendario (TAL-5) impide un
  rango de fechas de años o siglos. Sin límite, esta sección generaría un
  día por cada fecha del rango en cada render — memoria/CPU sin cota con
  una sola petición autenticada (DoS). Por encima del límite se muestra un
  aviso pidiendo acortar el rango, en vez de intentar renderizar la
  rejilla. 366 cubre cualquier calendario real con margen (incluido uno
  que abarque un año entero). No se tocó `src/app/admin/actions.ts`
  (TAL-5, de T2) para añadir el límite también ahí — la corrección de
  fondo (impedir guardar un rango tan largo desde el CRUD) le corresponde
  a esa tarea, no a esta; aquí solo se blinda esta sección para que un
  rango así no la tumbe.
- **Guardar un día es atómico con la comprobación de rango
  (`saveDayAction`)**: antes se leía el rango del calendario y, aparte, se
  hacía el upsert del `Day` — ventana entre medias en la que
  `updateCalendarAction` (TAL-5) podía reducir el rango del calendario, y
  el `Day` quedaba guardado fuera del rango nuevo (oculto en la rejilla,
  pero reapareciendo si el rango se ampliaba después). Ahora todo va en
  una única `prisma.$transaction` con `SELECT ... FOR UPDATE` sobre la
  fila del `Calendar` — bloquea esa fila hasta que termina la transacción,
  así que un `calendar.update()` concurrente sobre el mismo calendario
  espera en vez de intercalarse.
- **`formNoValidate` en "Quitar vídeo"**: al compartir el mismo `<form>`
  que "Guardar día", el `required`/`type="url"` del campo de vídeo
  bloqueaba el envío del formulario aunque se pulsara "Quitar vídeo" si
  ese campo estaba vacío o no era una URL válida en ese momento — borrar
  no depende de que el campo tenga un valor válido. Probado en vivo:
  vaciar el campo de vídeo y pulsar "Quitar vídeo" sigue borrando la fila.
- **Límites de longitud** (`MAX_VIDEO_URL_LENGTH`/`MAX_MESSAGE_LENGTH`,
  2000 caracteres cada uno, en `days-actions.ts`, más `maxLength` en los
  inputs como ayuda de UI): defensivo, no de producto — nadie necesita más
  para un vídeo-regalo del calendario.

## Coordinación con T2 (TAL-7, en paralelo)

Mismo dominio de página (`src/app/admin/[calendarId]/page.tsx`, ambas
tareas añaden una sección ahí — "Días" y "Invitados" en el mockup), pero
dominios de datos distintos (`Day` vs `Invitation`). Acordado por mensaje
directo antes de implementar: cada terminal en su propio
`*-section.tsx`/`*-actions.ts` (`days-section.tsx`/`days-actions.ts` aquí,
`guests-section.tsx`/`guests-actions.ts` en T2), y en `page.tsx` cada una
añade solo su import + su línea de JSX, en huecos distintos (Días antes
que Invitados, mismo orden que el mockup) — pensado para que el merge de
quien llegue segunda a publicar sea un conflicto textual trivial (líneas
de import/JSX adyacentes), no de diseño.

## Gotcha de sesión (heredado de TAL-4, reproducido también aquí)

Mismo problema de colisión de cookies de next-auth entre dev servers en
`localhost` documentado en `docs/superadmin.md` — coordinado con T2 por
mensaje directo antes de cada sesión de pruebas en el navegador.
