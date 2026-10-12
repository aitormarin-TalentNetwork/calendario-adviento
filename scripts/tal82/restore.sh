#!/bin/bash
# TAL-82 — restauración (plan §5.3/§5.4 y §4.1): UNA sola importación del ZIP reducido
# (`--replace --yes`: solo sustituye las tablas presentes en el ZIP) y verificación de
# documentos COMPLETOS contra el export de origen, referencias y auditoría.
# Requisito: el schema todavía admite los campos y tablas (antes del paso 3 o con él revertido).
# Uso: scripts/tal82/restore.sh <slug> <restore.zip> <export-origen.zip> <tabla>…
source "$(dirname "$0")/lib.sh"
slug="${1:?slug}"; rzip="${2:?restore.zip}"; origin="${3:?export.zip}"; shift 3; [ "$#" -gt 0 ] || die "faltan tablas"
guard_deployment "$slug"
echo "=== TAL-82 restauración — $slug — $(date -u +%Y-%m-%dT%H:%M:%SZ) — repo $TAL82_ROOT"
set -x
unzip -l "$rzip"
cx "$slug" import --replace --yes "$rzip"
(cd "$TAL82_ROOT" && node scripts/tal82/compare-docs.mjs "$origin" "$slug" "$@")
(cd "$TAL82_ROOT" && node scripts/tal82/check-refs.mjs "$slug")
run_fn "$slug" skinMigration:auditCalendarSkins | jq -c '{total,inCatalog,legacy,missingSkin}'
set +x
echo "=== OK restauración — $slug"
