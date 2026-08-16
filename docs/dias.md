# Gestión de Días (TAL-6)

## Qué hace

Dentro de `/admin/[calendarId]` (protegida ya por TAL-5: solo Admin de ese
calendario o Super Admin), una sección "Días del calendario" con un
formulario por cada fecha entre `startDate` y `endDate` (ambas incluidas)
para asignar vídeo + mensaje opcional. Lógica en
`src/app/admin/[calendarId]/days-actions.ts`; UI en
`src/app/admin/[calendarId]/days-section.tsx`, importada desde `page.tsx`.

## Decisiones de alcance

- **Solo link externo, no subida de archivo real** — decisión técnica que
  pedía explícitamente el brief. `docs/stack.md` deja pendiente qué backend
  de almacenamiento usar para subidas (Railway volume, S3-compatible...);
  decidirlo como parte de esta tarea habría sido resolver una decisión de
  infraestructura no cerrada solo para desbloquear esta ronda. El campo
  `videoUrl` del schema (TAL-3) ya vale igual para un enlace externo que
  para la ruta de un archivo subido — cuando se decida el backend de
  subidas, la subida de archivo se puede añadir sin tocar el modelo de
  datos, solo la UI/acción de guardado.
- **Sin la rejilla+panel lateral del mockup**: el mockup muestra una
  rejilla de días numerados que, al pinchar uno, abre un panel lateral con
  el editor — eso necesita estado en cliente (qué día está seleccionado).
  Se simplificó a una lista de formularios siempre visibles, uno por
  fecha — mismo patrón "server-rendered, sin estado de cliente más allá de
  los componentes ya existentes" que el resto de la app (ver
  `SubmitButton`/`ConfirmSubmitButton` de TAL-5). Funcionalmente
  equivalente (mismos campos, mismas acciones), solo cambia la
  interacción visual.
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
