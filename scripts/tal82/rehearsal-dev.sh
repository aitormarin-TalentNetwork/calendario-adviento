#!/bin/bash
# TAL-82 — ENSAYO COMPLETO en DEV (plan §4, §4.1 y §5), con los mismos scripts que en prod:
#   R1 verify-tal62-skin-migration.mjs (salida completa) ANTES de tocar dev;
#   R2 primer export; R3 preparación (migrar calendarios, vaciar coverIconMigrationLog);
#   R4 vuelta atrás de la preparación desde el PRIMER export + comparación completa;
#   R5 preparación otra vez; R6 segundo export; R7 paso 2 (step2.sh) con las cifras de dev;
#   R8 prueba de atomicidad de la importación; R9 restauración desde el segundo export.
# Solo dev (guard_deployment), desde un HEAD limpio (require_clean_head). `set -x`: lo que sale en el
# log es el comando que se ejecuta. Las salidas de export.sh se duplican a stderr para que queden en el log.
source "$(dirname "$0")/lib.sh"
slug="$TAL82_DEV_SLUG"
guard_deployment "$slug"
cd "$TAL82_ROOT"
echo "=== TAL-82 ensayo dev — $(date -u +%Y-%m-%dT%H:%M:%SZ) — repo $(pwd -P) — HEAD $(git rev-parse --short HEAD)"
grep -n '^CONVEX_DEPLOYMENT=' .env.local
set -x

# --- R0 · código de la rama desplegado en dev
npx convex dev --once

# --- R1 · verify-tal62 ANTES de cualquier limpieza de dev (su escenario necesita los retirados)
with_env_files node scripts/verify-tal62-skin-migration.mjs   # nunca `source` con `set -x` activo (ver lib.sh)

# --- R2 · primer export
EXPORT1=$(scripts/tal82/export.sh "$slug" ensayo-1 | tee /dev/stderr | tail -1)
run_fn "$slug" skins:legacyPhaseEStatus

# --- R3 · preparación: calendarios a skins vigentes + coverIconMigrationLog vacío
run_fn "$slug" skinMigration:runCalendarSkinMigration '{"migrationId":"tal82-ensayo-prep-1"}'
: > "$TAL82_BACKUPS/empty.jsonl"
table_count "$slug" coverIconMigrationLog
cx "$slug" import --table coverIconMigrationLog --replace --yes "$TAL82_BACKUPS/empty.jsonl"
table_count "$slug" coverIconMigrationLog
run_fn "$slug" skins:legacyPhaseEStatus

# --- R4 · vuelta atrás de la preparación desde el PRIMER export (una importación, 3 tablas)
PREPZIP="$TAL82_BACKUPS/tal82-$slug-prep-rollback-$(date -u +%Y%m%dT%H%M%SZ).zip"
scripts/tal82/restore-zip.sh "$EXPORT1" "$PREPZIP" calendars skinMigrationLog coverIconMigrationLog
scripts/tal82/restore.sh "$slug" "$PREPZIP" "$EXPORT1" calendars skinMigrationLog coverIconMigrationLog
# Lo que la preparación NO toca, igual al primer export (documentos completos):
node scripts/tal82/compare-docs.mjs "$EXPORT1" "$slug" skins skinStyles calendarMemberships invitations days dayViews
run_fn "$slug" skins:legacyPhaseEStatus

# --- R5 · preparación otra vez
run_fn "$slug" skinMigration:runCalendarSkinMigration '{"migrationId":"tal82-ensayo-prep-2"}'
cx "$slug" import --table coverIconMigrationLog --replace --yes "$TAL82_BACKUPS/empty.jsonl"
table_count "$slug" coverIconMigrationLog

# --- R6 · segundo export (punto de partida del ensayo del paso 2)
EXPORT2=$(scripts/tal82/export.sh "$slug" ensayo-2 | tee /dev/stderr | tail -1)
STATUS=$(run_fn "$slug" skins:legacyPhaseEStatus)
echo "$STATUS"

# --- R7 · paso 2 con las cifras de dev medidas ahora (las mismas comprobaciones que en prod, también
#          la verificación del segundo export)
read -r SKINS CATALOG RETIRED LEGACY LEGACY_IN_CATALOG CALENDARS LOG COVERLOG < <(echo "$STATUS" | jq -r '[.skins,.inCatalog,.retired,.withLegacyFields,.inCatalogWithLegacyFields,.calendars,.skinMigrationLog,.coverIconMigrationLog] | @tsv')
scripts/tal82/step2.sh "$slug" "$SKINS" "$CATALOG" "$RETIRED" "$LEGACY" "$LEGACY_IN_CATALOG" "$CALENDARS" "$LOG" "$COVERLOG" "$EXPORT2"

# --- R8 · atomicidad: ZIP con `skins` válido (29+ filas del segundo export) y un documento
#          INVÁLIDO en `skinMigrationLog` (restored: "x"). La importación debe fallar y `skins`
#          seguir en el estado tras el paso 2 (8 sin campos), sin aplicarse a medias.
BADZIP="$TAL82_BACKUPS/tal82-$slug-atomicidad-$(date -u +%Y%m%dT%H%M%SZ).zip"
W=$(mktemp -d "$TAL82_BACKUPS/restore-XXXXXX")
unzip -q "$EXPORT2" 'skins/*' -d "$W"
mkdir -p "$W/skinMigrationLog"
CAL=$(cx "$slug" data calendars --limit 1 --format jsonl 2>/dev/null | head -1 | jq -r ._id)
SKIN=$(cx "$slug" data skins --limit 1 --format jsonl 2>/dev/null | head -1 | jq -r ._id)
jq -cn --arg c "$CAL" --arg s "$SKIN" '{migrationId:"tal82-atomicidad",calendarId:$c,fromSkinId:$s,fromKey:"x",toSkinId:$s,restored:"x"}' > "$W/skinMigrationLog/documents.jsonl"
(cd "$W" && zip -q -r "$BADZIP" skins skinMigrationLog)
case "$W" in "$TAL82_BACKUPS"/restore-??????) rm -rf -- "$W" ;; *) die "W inesperado: $W" ;; esac
if cx "$slug" import --replace --yes "$BADZIP"; then die "la importación con un documento inválido NO falló"; fi
run_fn "$slug" skins:legacyPhaseEStatus | jq -c '{skins,inCatalog,retired,withLegacyFields,skinMigrationLog}'
[ "$(run_fn "$slug" skins:legacyPhaseEStatus | jq --argjson c "$CATALOG" '.skins == $c and .withLegacyFields == 0 and .skinMigrationLog == 0')" = "true" ] || die "la importación fallida dejó cambios: NO es atómica"
echo "✓ atomicidad: la importación falló entera y no aplicó nada"
rm -f -- "$BADZIP"

# --- R9 · restauración desde el SEGUNDO export (skins + skinMigrationLog, una importación)
RESTZIP="$TAL82_BACKUPS/tal82-$slug-restore-$(date -u +%Y%m%dT%H%M%SZ).zip"
scripts/tal82/restore-zip.sh "$EXPORT2" "$RESTZIP" skins skinMigrationLog
scripts/tal82/restore.sh "$slug" "$RESTZIP" "$EXPORT2" skins skinMigrationLog
run_fn "$slug" skins:legacyPhaseEStatus
set +x
echo "=== OK ensayo dev — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
