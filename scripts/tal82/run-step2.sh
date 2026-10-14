#!/bin/bash
# TAL-82 — ORQUESTADOR del paso 2 (plan §4), el único comando del paso 2 en producción:
#   export → verificación del export → step2.sh (precondiciones, borrado, limpieza, vaciado del log,
#   estado y auditCalendarSkins tras cada fase) → relectura y referencias.
# Toda la salida va también a un log 600 en TAL82_BACKUPS, que se pega ENTERO en la evidencia.
#
# En PRODUCCIÓN lo lanza Aitor él mismo, con `!` en la sesión de T1 (ningún agente):
#   ! TAL82_PROD_CONFIRM=abundant-badger-144 scripts/tal82/run-step2.sh abundant-badger-144 29 8 21 29 8 2 1 0
# Uso: scripts/tal82/run-step2.sh <slug> SKINS CATALOG RETIRED LEGACY LEGACY_IN_CATALOG CALENDARS LOG COVERLOG
source "$(dirname "$0")/lib.sh"
[ "$#" -eq 9 ] || die "uso: run-step2.sh <slug> SKINS CATALOG RETIRED LEGACY LEGACY_IN_CATALOG CALENDARS LOG COVERLOG"
slug="$1"
guard_deployment "$slug"
cd "$TAL82_ROOT"
RUNLOG="$TAL82_BACKUPS/tal82-$slug-paso2-$(date -u +%Y%m%dT%H%M%SZ).log"
[ ! -e "$RUNLOG" ] || die "ya existe $RUNLOG"
: > "$RUNLOG"
exec > >(tee -a "$RUNLOG") 2>&1
echo "=== TAL-82 paso 2 orquestado — $slug — log $RUNLOG"
echo "--- comando: $0 $*"
guard_deployment "$slug"

# 1 · export (su salida completa va al log; la última línea es la ruta del ZIP)
EXPORT=$(scripts/tal82/export.sh "$slug" pre-fase-e | tee /dev/stderr | tail -1)

# 2 · paso 2: verifica el export (verify_export_fresh) antes de tocar nada y después limpia
scripts/tal82/step2.sh "$@" "$EXPORT"

echo "=== OK paso 2 orquestado — $slug — export $EXPORT — log $RUNLOG"
