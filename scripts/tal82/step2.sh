#!/bin/bash
# TAL-82 — PASO 2 de la fase e (plan §4): limpieza de datos. En producción no se lanza suelto: lo
# lanza Aitor con `!` a través de run-step2.sh (export → verificación → paso 2 → auditorías, con log).
#
# Uso:
#   scripts/tal82/step2.sh <slug> SKINS CATALOG RETIRED LEGACY LEGACY_IN_CATALOG CALENDARS LOG COVERLOG <export.zip>
# El export es OBLIGATORIO y se verifica antes de tocar nada (verify_export_fresh): de este deployment,
# en TAL82_BACKUPS, checksum del manifiesto, ZIP íntegro, de hace ≤ 30 min con el mismo HEAD y con
# los recuentos esperados de skins, calendars, skinMigrationLog y coverIconMigrationLog.
# Cifras esperadas de producción (plan §2/§4, medidas el 2026-10-12): 29 8 21 29 8 2 1 0
#
# Cada cifra es una PRECONDICIÓN: si el estado real no coincide con la fila esperada, aborta sin
# seguir. Después de cada fase: estado (legacyPhaseEStatus) y auditCalendarSkins.
source "$(dirname "$0")/lib.sh"
[ "$#" -eq 10 ] || die "uso: step2.sh <slug> SKINS CATALOG RETIRED LEGACY LEGACY_IN_CATALOG CALENDARS LOG COVERLOG <export.zip>"
slug="$1" SKINS="$2" CATALOG="$3" RETIRED="$4" LEGACY="$5" LEGACY_IN_CATALOG="$6" CALENDARS="$7" LOG="$8" COVERLOG="$9" EXPORT="${10}"
for n in "$SKINS" "$CATALOG" "$RETIRED" "$LEGACY" "$LEGACY_IN_CATALOG" "$CALENDARS" "$LOG" "$COVERLOG"; do
  case "$n" in ""|*[!0-9]*) die "cifra no válida: $n" ;; esac
done
guard_deployment "$slug"
echo "=== TAL-82 paso 2 — $slug — $(date -u +%Y-%m-%dT%H:%M:%SZ) — repo $TAL82_ROOT"

# 0 · el export previo, verificado ANTES de cualquier lectura o escritura en el deployment
verify_export_fresh "$slug" "$EXPORT" "$SKINS" "$CALENDARS" "$LOG" "$COVERLOG"

# expect_status <fase> skins inCatalog retired withLegacyFields calendars calendarsOnRetired skinMigrationLog coverIconMigrationLog
expect_status() {
  local phase="$1"; shift
  local json; json=$(run_fn "$slug" skins:legacyPhaseEStatus)
  echo "--- estado ($phase): $json"
  local want; want=$(jq -cn --argjson v "[$(IFS=,; echo "$*")]" '{skins:$v[0],inCatalog:$v[1],retired:$v[2],withLegacyFields:$v[3],calendars:$v[4],calendarsOnRetired:$v[5],calendarsMissingSkin:0,skinMigrationLog:$v[6],coverIconMigrationLog:$v[7],skinStylesOrphans:0}')
  local got; got=$(echo "$json" | jq -c '{skins,inCatalog,retired,withLegacyFields,calendars,calendarsOnRetired,calendarsMissingSkin,skinMigrationLog,coverIconMigrationLog,skinStylesOrphans}')
  [ "$got" = "$want" ] || die "estado ($phase) no cuadra. Esperado $want · real $got"
  echo "✓ estado ($phase) = fila esperada"
}
expect_audit() {
  local json; json=$(run_fn "$slug" skinMigration:auditCalendarSkins)
  echo "--- auditCalendarSkins: $(echo "$json" | jq -c '{total,inCatalog,legacy,missingSkin}')"
  [ "$(echo "$json" | jq '.legacy == 0 and .missingSkin == 0')" = "true" ] || die "auditoría: legacy/missingSkin distinto de 0"
}

set -x
# 0b · solo NOMBRES de las variables de entorno: nunca ALLOW_TEST_HELPERS en este deployment de destino de prod.
if [ "$slug" = "$TAL82_PROD_SLUG" ]; then
  cx "$slug" env list 2>/dev/null | cut -d= -f1 | sort
  [ "$(cx "$slug" env list 2>/dev/null | cut -d= -f1 | grep -c '^ALLOW_TEST_HELPERS$' || true)" = "0" ] || die "ALLOW_TEST_HELPERS definida en producción"
fi
set +x

# 1 · estado inicial = fila «Antes»
expect_status "antes" "$SKINS" "$CATALOG" "$RETIRED" "$LEGACY" "$CALENDARS" 0 "$LOG" "$COVERLOG"
expect_audit

# 2 · borrar los retirados (expectRetired obligatorio)
set -x
del=$(run_fn "$slug" skinMigration:runDeleteRetiredSkins "{\"expectRetired\":$RETIRED}")
set +x
echo "--- runDeleteRetiredSkins: $(echo "$del" | jq -c '{aborted,reason,deleted,skippedReferenced,batches}')"
[ "$(echo "$del" | jq --argjson n "$RETIRED" '.aborted == false and .deleted == $n and .skippedReferenced == 0')" = "true" ] || die "borrado de retirados distinto de lo esperado"
expect_status "tras borrar retirados" "$CATALOG" "$CATALOG" 0 "$LEGACY_IN_CATALOG" "$CALENDARS" 0 "$LOG" "$COVERLOG"
expect_audit

# 3 · quitar los 4 campos de las vigentes
set -x
clr=$(run_fn "$slug" skins:runClearLegacySkinFields "{\"expectCatalog\":$CATALOG,\"expectWithLegacyFields\":$LEGACY_IN_CATALOG}")
set +x
echo "--- runClearLegacySkinFields: $(echo "$clr" | jq -c '{aborted,reason,ok,cleared,alreadyClean,batches}')"
[ "$(echo "$clr" | jq --argjson n "$LEGACY_IN_CATALOG" '.aborted == false and .ok == true and .cleared == $n')" = "true" ] || die "limpieza de campos distinta de lo esperado"
expect_status "tras limpiar campos" "$CATALOG" "$CATALOG" 0 0 "$CALENDARS" 0 "$LOG" "$COVERLOG"
expect_audit

# 4 · vaciar skinMigrationLog (solo con 0 retirados)
set -x
log=$(run_fn "$slug" skinMigration:runClearSkinMigrationLog "{\"expectRows\":$LOG}")
set +x
echo "--- runClearSkinMigrationLog: $(echo "$log" | jq -c '{aborted,reason,ok,deleted,remaining}')"
[ "$(echo "$log" | jq --argjson n "$LOG" '.aborted == false and .ok == true and .deleted == $n and .remaining == 0')" = "true" ] || die "vaciado del log distinto de lo esperado"
expect_status "final" "$CATALOG" "$CATALOG" 0 0 "$CALENDARS" 0 0 "$COVERLOG"
expect_audit

# 5 · relectura de solo lectura, tabla a tabla, y referencias
for t in skins skinStyles skinMigrationLog coverIconMigrationLog calendars; do echo "$t: $(table_count "$slug" "$t")"; done
(cd "$TAL82_ROOT" && node scripts/tal82/check-refs.mjs "$slug")
echo "=== OK paso 2 — $slug — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
