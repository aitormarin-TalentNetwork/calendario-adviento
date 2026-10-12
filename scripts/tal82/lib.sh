#!/bin/bash
# TAL-82 — funciones comunes de los scripts de la fase e (export, restauración,
# paso 2 y ensayo). Se cargan con `source`. Se retiran en el paso 3.
#
# Barreras:
# - el deployment va SIEMPRE explícito (`--deployment <slug>`), nunca `--prod`;
# - DEV: solo el dev de esta terminal, y se comprueba la línea del .env.local;
# - PROD (abundant-badger-144): solo con TAL82_AITOR_OK=si (el OK de Aitor,
#   transmitido por la Directora). Sin ella, cualquier script aborta antes de
#   tocar nada.
set -euo pipefail
umask 077

TAL82_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
TAL82_BACKUPS="${TAL82_BACKUPS:-$HOME/advcal-backups}"
TAL82_DEV_SLUG="beloved-barracuda-617"
TAL82_PROD_SLUG="abundant-badger-144"

die() { echo "ABORTO: $*" >&2; exit 1; }

# guard_deployment <slug>: valida el destino antes de cualquier comando.
guard_deployment() {
  local slug="$1"
  case "$slug" in
    "$TAL82_DEV_SLUG")
      grep -q "^CONVEX_DEPLOYMENT=dev:$TAL82_DEV_SLUG" "$TAL82_ROOT/.env.local" || die "el .env.local de $TAL82_ROOT no es dev:$TAL82_DEV_SLUG"
      ;;
    "$TAL82_PROD_SLUG")
      grep -q "project: calendario-adviento" "$TAL82_ROOT/.env.local" || die "el .env.local no es del proyecto calendario-adviento"
      [ "${TAL82_AITOR_OK:-}" = "si" ] || die "producción sin TAL82_AITOR_OK=si (falta el OK de Aitor)"
      ;;
    *) die "deployment no permitido: $slug" ;;
  esac
}

# cx <slug> <args…>: `npx convex <args…> --deployment <slug>` (nunca --prod).
cx() {
  local slug="$1"; shift
  case " $* " in *" --prod "*) die "prohibido --prod" ;; esac
  (cd "$TAL82_ROOT" && npx convex "$@" --deployment "$slug")
}

# run_fn <slug> <función> [json]: `npx convex run` de una función interna; imprime el JSON.
run_fn() {
  local slug="$1" fn="$2" args="${3:-}"
  [ -n "$args" ] || args='{}'
  cx "$slug" run "$fn" "$args" 2> >(grep -v -e ExperimentalWarning -e trace-warnings >&2)
}

# table_count <slug> <tabla>: número de documentos (tope 10000; aborta si se alcanza).
table_count() {
  local n
  n=$(cx "$1" data "$2" --limit 10000 --format jsonl 2>/dev/null | grep -c '^{' || true)
  [ "$n" -lt 10000 ] || die "la tabla $2 llega al tope de lectura"
  echo "$n"
}
