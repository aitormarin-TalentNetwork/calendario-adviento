#!/bin/bash
# TAL-82 — funciones comunes de los scripts de la fase e (export, restauración,
# paso 2 y ensayo). Se cargan con `source`. Se retiran en el paso 3.
#
# Barreras:
# - el deployment va SIEMPRE explícito (`--deployment <slug>`), nunca `--prod`;
# - el código es el de un HEAD limpio (sin cambios en ficheros versionados ni ficheros nuevos en
#   convex/, src/, scripts/ ni e2e/), y el HEAD sale en la cabecera de cada script;
# - DEV: solo el dev de esta terminal, y se comprueba la línea del .env.local;
# - PROD (abundant-badger-144): los comandos de producción los lanza AITOR ÉL MISMO con `!` en la
#   sesión de T1, nunca un agente. `TAL82_PROD_CONFIRM=abundant-badger-144` es solo una barrera
#   contra accidentes (un agente podría escribirla, por eso no acredita nada): lo que acredita el OK
#   es que el comando conste como `!` de Aitor en la sesión y que su log (run-step2.sh lo guarda en
#   TAL82_BACKUPS) vaya entero a la evidencia;
# - TAL82_BACKUPS: ruta canónica fuera del repo y de iCloud (ver validate_backups);
# - el paso 2 exige un export previo verificado (ver verify_export_*).
set -euo pipefail
umask 077

TAL82_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)"
TAL82_BACKUPS="${TAL82_BACKUPS:-$HOME/advcal-backups}"
TAL82_DEV_SLUG="beloved-barracuda-617"
TAL82_PROD_SLUG="abundant-badger-144"
TAL82_EXPORT_MAX_AGE_MIN=30

die() { echo "ABORTO: $*" >&2; exit 1; }

# canonical_path <ruta>: ruta absoluta con los enlaces simbólicos resueltos. La ruta puede no existir
# todavía: se resuelve el antepasado que exista y se le añade el resto. No admite `.` ni `..`.
canonical_path() {
  local p="$1" rest=""
  case "$p" in /*) ;; *) die "ruta no absoluta: $p" ;; esac
  case "$p/" in */./*|*/../*) die "ruta con . o ..: $p" ;; esac
  while [ "${p%/}" != "$p" ] && [ "$p" != "/" ]; do p="${p%/}"; done
  while [ ! -d "$p" ]; do
    [ ! -e "$p" ] && [ ! -L "$p" ] || die "$p existe y no es un directorio"
    rest="/$(basename "$p")$rest"; p="$(dirname "$p")"
  done
  p="$(cd -P "$p" && pwd -P)"
  [ "$p" = "/" ] && p=""
  echo "$p$rest"
}

# validate_backups: TAL82_BACKUPS pasa a su ruta canónica y se rechaza si está dentro del repo
# (worktree o repo principal), si es un padre de cualquiera de los dos, o si está en ~/Documents,
# ~/Desktop o el almacenamiento de iCloud/nube (o es un padre de esas carpetas, como $HOME o /).
# Después crea la carpeta (700) y comprueba que la ruta creada sigue siendo la validada.
validate_backups() {
  local c bad cb main_repo home
  c="$(canonical_path "$TAL82_BACKUPS")" || exit 1
  [ -n "$c" ] || die "TAL82_BACKUPS no puede ser /"
  home="$(cd -P "$HOME" && pwd -P)"
  main_repo="$(cd "$TAL82_ROOT" && cd -P "$(git rev-parse --git-common-dir)/.." && pwd -P)"
  for bad in "$TAL82_ROOT" "$main_repo" "$home/Documents" "$home/Desktop" "$home/Library/Mobile Documents" "$home/Library/CloudStorage"; do
    cb="$(canonical_path "$bad")" || exit 1
    case "$c/" in "$cb"/*) die "TAL82_BACKUPS ($c) está dentro de $cb" ;; esac
    case "$cb/" in "$c"/*) die "TAL82_BACKUPS ($c) contiene $cb" ;; esac
  done
  mkdir -p -- "$c" && chmod 700 "$c"
  [ "$(cd -P "$c" && pwd -P)" = "$c" ] || die "TAL82_BACKUPS cambió al crearla: $c"
  TAL82_BACKUPS="$c"
}

# require_clean_head: aborta si hay cambios en ficheros versionados o ficheros nuevos en el código
# que se despliega o se ejecuta (convex/, src/, scripts/, e2e/, package*.json).
require_clean_head() {
  local dirty
  dirty="$(git -C "$TAL82_ROOT" status --porcelain --untracked-files=no)$(git -C "$TAL82_ROOT" status --porcelain --untracked-files=all -- convex src scripts e2e package.json package-lock.json | grep '^??' || true)"
  [ -z "$dirty" ] || die "el árbol no está limpio (HEAD $(git -C "$TAL82_ROOT" rev-parse --short HEAD)):
$dirty"
}

# valid_tag <etiqueta>: solo letras ASCII, dígitos y guiones, de 1 a 40 caracteres.
valid_tag() {
  case "$1" in ""|*[!A-Za-z0-9-]*) die "etiqueta no válida (solo A-Z, a-z, 0-9 y -): $1" ;; esac
  [ "${#1}" -le 40 ] || die "etiqueta de más de 40 caracteres: $1"
}

# with_env_files <comando…>: ejecuta el comando en un subshell con las variables de .env.local y
# .env. SEGURIDAD (incidente de TAL-82): `set -x` imprimiría en el log cada asignación del
# `source`, secretos incluidos. Por eso la traza se apaga ANTES (sin trazar el propio `set +x`) y
# solo se vuelve a encender, si estaba activa, cuando el subshell con las variables ya ha terminado.
with_env_files() {
  local was_tracing=0
  case "$-" in *x*) was_tracing=1 ;; esac
  { set +x; } 2>/dev/null
  echo "(con .env.local y .env cargados, traza desactivada): $*"
  local rc=0
  ( set -a; source "$TAL82_ROOT/.env.local"; source "$TAL82_ROOT/.env"; set +a; "$@" ) || rc=$?
  [ "$was_tracing" = 1 ] && set -x
  return "$rc"
}

# guard_deployment <slug>: valida el destino antes de cualquier comando.
guard_deployment() {
  local slug="$1"
  case "$slug" in
    "$TAL82_DEV_SLUG")
      grep -q "^CONVEX_DEPLOYMENT=dev:$TAL82_DEV_SLUG" "$TAL82_ROOT/.env.local" || die "el .env.local de $TAL82_ROOT no es dev:$TAL82_DEV_SLUG"
      ;;
    "$TAL82_PROD_SLUG")
      grep -q "project: calendario-adviento" "$TAL82_ROOT/.env.local" || die "el .env.local no es del proyecto calendario-adviento"
      [ "${TAL82_PROD_CONFIRM:-}" = "$TAL82_PROD_SLUG" ] || die "producción: lo lanza Aitor él mismo con «!», con TAL82_PROD_CONFIRM=$TAL82_PROD_SLUG delante (ver docs/skins.md, fase e)"
      ;;
    *) die "deployment no permitido: $slug" ;;
  esac
  require_clean_head
  validate_backups
  echo "--- destino $slug · HEAD $(git -C "$TAL82_ROOT" rev-parse HEAD) (árbol limpio) · backups $TAL82_BACKUPS · usuario $(id -un) · tty $(tty 2>/dev/null || echo ninguna) · $(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

# manifest_get <zip> <clave>: valor de una línea `clave=valor` del manifiesto que escribe export.sh.
manifest_get() { sed -n "s/^$2=//p" "$1.manifest"; }

# verify_export_integrity <slug> <zip>: el ZIP es un export de export.sh de ESTE deployment, en
# TAL82_BACKUPS, fichero normal 600, con su manifiesto 600, el checksum del manifiesto y el ZIP íntegro.
verify_export_integrity() {
  local slug="$1" zip="$2" sha
  case "$zip" in "$TAL82_BACKUPS"/tal82-"$slug"-*.zip) ;; *) die "el export no es de $slug o no está en $TAL82_BACKUPS: $zip" ;; esac
  [ -f "$zip" ] && [ ! -L "$zip" ] || die "el export no es un fichero normal: $zip"
  [ -f "$zip.manifest" ] && [ ! -L "$zip.manifest" ] || die "falta el manifiesto de export.sh: $zip.manifest"
  [ "$(stat -f %Lp "$zip")" = 600 ] && [ "$(stat -f %Lp "$zip.manifest")" = 600 ] || die "permisos distintos de 600 en el export o su manifiesto"
  [ "$(manifest_get "$zip" slug)" = "$slug" ] || die "el manifiesto es de otro deployment: $(manifest_get "$zip" slug)"
  sha="$(shasum -a 256 "$zip" | cut -d' ' -f1)"
  [ "$sha" = "$(manifest_get "$zip" sha256)" ] || die "el checksum del export no coincide con el del manifiesto"
  unzip -tq "$zip" >/dev/null || die "el ZIP del export está dañado"
  echo "✓ export íntegro: $zip · sha256 $sha · deployment $slug"
}

# verify_export_fresh <slug> <zip> SKINS CALENDARS LOG COVERLOG: además de íntegro, hecho hace como
# mucho TAL82_EXPORT_MAX_AGE_MIN minutos con el MISMO HEAD, y con los recuentos esperados en las
# tablas que toca el paso 2 (y en calendars).
verify_export_fresh() {
  local slug="$1" zip="$2" created now age pair t want got
  verify_export_integrity "$slug" "$zip"
  created="$(manifest_get "$zip" created)"; now="$(date +%s)"
  case "$created" in ""|*[!0-9]*) die "fecha del manifiesto no válida" ;; esac
  [ "$created" -le "$now" ] || die "el manifiesto tiene fecha futura"
  age=$(( (now - created) / 60 ))
  [ "$age" -le "$TAL82_EXPORT_MAX_AGE_MIN" ] || die "el export tiene $age min (máximo $TAL82_EXPORT_MAX_AGE_MIN): hay que hacer otro"
  [ "$(manifest_get "$zip" head)" = "$(git -C "$TAL82_ROOT" rev-parse HEAD)" ] || die "el export se hizo con otro HEAD: $(manifest_get "$zip" head)"
  for pair in "skins:$3" "calendars:$4" "skinMigrationLog:$5" "coverIconMigrationLog:$6"; do
    t="${pair%%:*}"; want="${pair#*:}"
    got="$(unzip -p "$zip" "$t/documents.jsonl" 2>/dev/null | grep -c '^{' || true)"
    [ "$got" = "$want" ] || die "el export tiene $got documentos en $t (esperados $want)"
  done
  echo "✓ export reciente ($age min, mismo HEAD) y con las cifras esperadas: skins=$3 calendars=$4 skinMigrationLog=$5 coverIconMigrationLog=$6"
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
