# Iconos Lucide y migración de `coverIcon` (TAL-60)

Design System: `design/design-system.md` § "Estilo 2026 → Iconos". Toda la interfaz usa
iconos de línea **Lucide** (`lucide-react@1.49.0`, licencia ISC): trazo `2px`, sin
relleno, `currentColor`. Ningún emoji en la UI (salvo el texto que escribe el Admin).

## Piezas

| Pieza | Fichero | Qué hace |
|---|---|---|
| Catálogo + compatibilidad | `convex/coverIconCatalog.ts` (neutral: lo importan Convex y Next) | 5 categorías con nombres Lucide (todos ≤ 16 caracteres) y términos de búsqueda en español; tabla de los 45 emojis antiguos → icono; `normalizeCoverIcon` (lectura, nunca falla); `coverIconForWrite` (escritura) |
| Componentes | `src/lib/cover-icons.ts` | Nombre → componente Lucide (`satisfies Record<CoverIconName, LucideIcon>`) |
| Render | `src/components/cover-icon.tsx` | `<CoverIcon value size box? accent?>` — normaliza y pinta, opcionalmente en el recuadro pastel `.cover-icon-box`. Marcador `data-cover-icon` |
| Color | `src/lib/cover-icon-colors.ts` | Accent del skin si da ≥ 3:1 contra el recuadro en cada tema; si no, token `--icon-tile-fg` |
| Migración | `convex/coverIconMigration.ts` + tabla `coverIconMigrationLog` | Lotes con log transaccional, auditoría acotada, restauración |

**Tokens** (contrato con TAL-61, solo cambian valores, nunca nombres): `--icon-tile-bg`
(provisional `#e6e0ff` / `#2a2645`, definitivo `var(--primary-soft)`) y `--icon-tile-fg`
(provisional la tinta del tema, definitivo `var(--primary)`). Si cambian, actualizar
`ICON_TILE_BG` en `cover-icon-colors.ts` y volver a pasar
`scripts/verify-tal60-icon-contrast.mjs`.

## Reglas de lectura y escritura

- **Lectura** (`normalizeCoverIcon`): nombre del catálogo → el mismo; emoji antiguo →
  su equivalente; ausente → `tree-pine`; cualquier otra cosa → `gift`. Por eso cualquier
  mezcla de datos se pinta bien, migrada o no.
- **Escritura** (`coverIconForWrite`, en Convex y en la Server Action): nombre del
  catálogo → se guarda; **emoji antiguo → se guarda TAL CUAL** (sin convertir); lo
  demás se rechaza. Así, mientras el Next anterior a TAL-60 siga sirviendo durante un
  despliegue, lo que escribe sigue siendo un emoji que él sabe pintar. El Next nuevo
  siempre manda nombres.
- Seguimiento posible (fuera de TAL-60): retirar la tolerancia a emojis antiguos de
  `coverIconForWrite` cuando producción esté migrada y verificada.

## Commits de TAL-60 (los necesita el rollback)

1. **Compatibilidad** — catálogo, `normalizeCoverIcon`/`coverIconForWrite`,
   `<CoverIcon>` en todos los sitios de lectura (portada, login, vista previa, `/c`,
   selector), validación tolerante, `lucide-react`. Funciona solo.
2. UI — candado y botones de cerrar.
3. Migración — tabla del log, `coverIconMigration.ts`, scripts y este runbook.
4. Tests.

`COMPAT_SHA` = SHA del commit 1 **tal como queda en main tras el merge** (lo apunta la
Directora/Integrador aquí y en TAL-60 al publicar): `[PENDIENTE — al publicar]`.

## Runbook de producción

Lo ejecutan la Directora y el CEO. Todos los comandos llevan `--prod` solo aquí; los
scripts del repo se niegan a correr fuera de un deployment `dev:`.

**(a) Convex compatible desplegado.** Merge a main → Railway ejecuta
`npx convex deploy --cmd 'npm run build'`: las funciones nuevas se despliegan durante
el build, mientras el Next **antiguo** sigue sirviendo (`docs/stack.md`). Esa ventana es
segura: el Next antiguo lee emojis (nada migrado) y, si guarda, manda emojis que se
guardan tal cual.

**(b) Comprobar que el Next nuevo sirve de verdad.** Railway muestra el deploy nuevo
como activo y, 3 veces seguidas:
```
curl -s https://<dominio>/login | grep -c 'data-cover-icon'    # > 0
```
**Punto de no retorno para Next** (ver Rollback).

**(c) Smoke** con un calendario de prueba del Super Admin (no de clientes): la portada y
`/c` de un calendario con emoji sin migrar se ven con su icono Lucide; cambiar su icono
a `dog` en el editor guarda `"dog"`; dejarlo como estaba. Apuntar
`ROLLBACK_DEPLOY_ID` / `ROLLBACK_SHA` (este deploy) aquí y en TAL-60.

**(d) Backup, auditoría y migración — solo entonces.**
```
npx convex export --prod --path backups/tal60-pre-migration-<fecha>.zip
unzip -l backups/tal60-pre-migration-<fecha>.zip | grep calendars/documents.jsonl
unzip -p backups/tal60-pre-migration-<fecha>.zip calendars/documents.jsonl | wc -l   # = total de la auditoría
npx convex run --prod coverIconMigration:auditCoverIcons '{}'                         # invalid > 0
npx convex run --prod coverIconMigration:runCoverIconMigration '{"migrationId":"tal60-prod-1"}'
npx convex run --prod coverIconMigration:auditCoverIcons '{}'                         # invalid: 0
npx convex run --prod coverIconMigration:runCoverIconMigration '{"migrationId":"tal60-prod-1-rerun"}'  # migrated: 0
```
Lote a lote en vez de la action, si se prefiere ver cada resultado:
`coverIconMigration:migrateCoverIconsBatch '{"migrationId":"tal60-prod-1","cursor":null}'`
y seguir con el `continueCursor` hasta `isDone`. **Fallo a mitad:** relanzar desde el
principio con el mismo `migrationId` — es idempotente (lo migrado ya es válido y no se
vuelve a registrar) y el log conserva cada `from → to` ya escrito. Revisar 2–3
calendarios del log en la UI:
`coverIconMigration:listMigrationLogPage '{"migrationId":"tal60-prod-1"}'`.

## Rollback — estrategia B: nunca a un Next anterior a TAL-60

- **Desde la fase (b)**, los Admins que guarden escriben nombres Lucide (también antes
  de migrar), y esas escrituras no pasan por el log. **No se vuelve a ningún build de
  Next anterior a TAL-60**, ni antes ni después de migrar.
- El rollback de Next es a un build que **contenga el commit de compatibilidad**, que
  pinta cualquier mezcla de emojis y nombres. Si falla otra parte de TAL-60, se revierten
  solo los commits de UI/migración en una rama de hotfix desde main, conservando el de
  compatibilidad, y se publica hacia delante por el pipeline normal.
- **"Redeploy" de un deploy anterior en Railway — se valida por commit, nunca por
  HTTP:**
  1. sacar el commit fuente del deploy candidato (el dashboard de Railway lo muestra en
     cada deploy; o la CLI de Railway si la versión instalada lo expone);
  2. ```
     git fetch origin main
     git merge-base --is-ancestor "$COMPAT_SHA" "$DEPLOY_SHA" && echo COMPATIBLE || echo "NO COMPATIBLE — PROHIBIDO REDEPLOY"
     ```
     Solo con `COMPATIBLE`. Si no se puede averiguar el SHA del candidato, no se usa.
  3. **Prohibido** validar un deploy histórico con `curl …/login | grep data-cover-icon`:
     ese marcador solo dice qué sirve **ahora**. Vale para la fase (b) y para confirmar
     después de un redeploy ya validado por commit.
- **Destinos de rollback preparados:**
  - Principal: el propio deploy de producción de TAL-60 (`ROLLBACK_DEPLOY_ID`, fase c).
  - Emergencia, si el problema es de TAL-60: rama `aitormarin/tal-60-rollback-compat` =
    main antes de TAL-60 + cherry-pick **solo** del commit de compatibilidad, construida
    y probada en dev. El cherry-pick cambia el SHA, así que se valida comparando su diff
    con el del commit de compatibilidad con `git patch-id --stable`; su SHA se apunta
    como `COMPAT_SHA_ALT` y un deploy desde esa rama se valida con
    `is-ancestor COMPAT_SHA_ALT`. Se publica por el pipeline normal, nunca con
    "Redeploy".
- **Rollback de Convex:** seguro en cualquier fase — todo nombre del catálogo tiene
  ≤ 16 caracteres, así que la validación anterior a TAL-60 lo acepta; el render lo decide
  el Next (≥ TAL-60). Solo se pierden temporalmente las funciones de migración.

## Corrección de datos tras migrar

Si la tabla de equivalencias resultara equivocada:
```
npx convex run --prod coverIconMigration:runCoverIconRestore '{"migrationId":"tal60-prod-1"}'
npx convex run --prod coverIconMigration:listMigrationLogPage '{"migrationId":"tal60-prod-1","onlyUnrestored":true}'
npx convex run --prod coverIconMigration:auditCoverIcons '{}'
```
Solo restaura los calendarios cuyo valor sigue siendo el que escribió la migración. Los
editados después salen como **`skippedEdited`**: se listan todos (segundo comando, con
su valor actual), se comprueba con la auditoría que ningún valor es inválido (por
construcción solo pueden ser nombres del catálogo o emojis antiguos) y se dejan tal
cual — nunca se pisa una elección del Admin. No se cierra la restauración hasta
completar esos tres pasos; si aparece algún inválido, se para y se escala. Después,
migración nueva con **otro** `migrationId` (reutilizar el de una migración restaurada se
rechaza).

## Restauración desde backup (último recurso, decisión del CEO)

Solo la tabla `calendars`, desde un ZIP que contiene únicamente esa tabla: el formato ZIP
conserva los `_id`, así que memberships, días e invitaciones siguen apuntando bien; las
demás tablas no se tocan. Pisa los cambios de `calendars` posteriores al backup.
```
mkdir -p restore/calendars
unzip -p backups/tal60-pre-migration-<fecha>.zip calendars/documents.jsonl > restore/calendars/documents.jsonl
wc -l restore/calendars/documents.jsonl
(cd restore && zip -r ../backups/tal60-calendars-only.zip calendars)
unzip -l backups/tal60-calendars-only.zip        # solo calendars/documents.jsonl
npx convex import --prod --replace backups/tal60-calendars-only.zip
```
(`--table` no admite ZIP; `--replace` reemplaza solo las tablas que trae el ZIP.)
Verificar: recuento de `calendars` = `wc -l`; 3 `_id` del log responden igual
(`calendars:get`); una membership de uno de ellos sigue resolviendo; la auditoría vuelve a
la foto previa. Un restore del snapshot entero (todas las tablas) queda descartado salvo
desastre.

## Evidencia en desarrollo

- `scripts/verify-tal60-cover-icon-migration.mjs` — ensaya todo lo anterior contra el
  deployment de desarrollo de la terminal (siembra crudo con `npx convex import
  --append`, backup, migración por lotes con fallo parcial, idempotencia, restauración con
  `skippedEdited`, restauración desde ZIP parcial con `_id` conservados y demás tablas
  intactas).
- `scripts/verify-tal60-icon-contrast.mjs` — contraste del icono con cada skin, en claro y
  oscuro, con el token de respaldo provisional y el definitivo.
