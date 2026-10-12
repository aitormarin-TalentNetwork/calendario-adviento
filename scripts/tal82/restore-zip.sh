#!/bin/bash
# TAL-82 — ZIP de restauración reducido (plan §5.2 / §4.1): solo las tablas indicadas,
# en formato snapshot (<tabla>/documents.jsonl). `--table` no admite ZIP, por eso un ZIP reducido.
# Uso: scripts/tal82/restore-zip.sh <export.zip> <salida.zip> <tabla>…
source "$(dirname "$0")/lib.sh"
snap="${1:?export.zip}"; out="${2:?salida.zip}"; shift 2; [ "$#" -gt 0 ] || die "faltan tablas"
case "$out" in "$TAL82_BACKUPS"/*.zip) ;; *) die "la salida debe ir en $TAL82_BACKUPS" ;; esac
[ ! -e "$out" ] || die "ya existe $out"
W=$(mktemp -d "$TAL82_BACKUPS/restore-XXXXXX")
set -x
for t in "$@"; do unzip -q "$snap" "$t/*" -d "$W"; done
(cd "$W" && zip -q -r "$out" "$@")
# El temporal tiene copias de documentos: se borra en cuanto existe el ZIP. El `case` exige la forma exacta.
case "$W" in "$TAL82_BACKUPS"/restore-??????) rm -rf -- "$W" ;; *) die "W inesperado: $W" ;; esac
test ! -e "$W" && echo "temporal borrado: $W"
chmod 600 "$out"
unzip -l "$out"
shasum -a 256 "$out"
