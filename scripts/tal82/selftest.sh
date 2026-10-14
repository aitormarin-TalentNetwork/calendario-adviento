#!/bin/bash
# TAL-82 — prueba de las barreras de lib.sh SIN tocar ningún deployment ni el .env*: TAL82_BACKUPS
# (rutas canónicas, repo, padres, iCloud, enlaces simbólicos), etiquetas de export.sh y verificación
# del export de step2.sh, con ZIPs falsos en un temporal. Cada caso corre en un bash aparte (con
# `set -e` de verdad) y se compara el resultado con el esperado.
# Uso: scripts/tal82/selftest.sh
set -uo pipefail
LIB="$(cd "$(dirname "$0")" && pwd -P)/lib.sh"
ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
MAIN_REPO="$(cd "$ROOT" && cd -P "$(git rev-parse --git-common-dir)/.." && pwd -P)"
T="$(mktemp -d "${TMPDIR:-/tmp}/tal82-selftest-XXXXXX")"; T="$(cd -P "$T" && pwd -P)"
trap 'case "$T" in */tal82-selftest-??????) rm -rf -- "$T" ;; esac' EXIT
fails=0

# case_ <ok|aborta> <descripción> <código bash que se ejecuta tras cargar lib.sh>
case_() {
  local want="$1" name="$2" code="$3" out rc
  out=$(bash -c "source '$LIB'; $code" 2>&1); rc=$?
  if { [ "$want" = ok ] && [ "$rc" = 0 ]; } || { [ "$want" = aborta ] && [ "$rc" != 0 ] && grep -q '^ABORTO' <<<"$out"; }; then
    echo "✓ [$want] $name — $(tail -1 <<<"$out")"
  else
    echo "✗ [$want] $name — rc=$rc — $out"; fails=$((fails + 1))
  fi
}
bk() { case_ "$1" "TAL82_BACKUPS=$2" "TAL82_BACKUPS='$2'; validate_backups; echo \"aceptada: \$TAL82_BACKUPS\""; }

echo "=== TAL82_BACKUPS"
bk ok "$T/backups"
ln -s "$ROOT" "$T/enlace-al-repo"
ln -s "$HOME/Documents" "$T/enlace-a-documents"
bk aborta "$ROOT/backups"
bk aborta "$MAIN_REPO/backups"
bk aborta "$ROOT"
bk aborta "$(dirname "$MAIN_REPO")"
bk aborta "$HOME"
bk aborta "/"
bk aborta "$HOME/Documents/backups"
bk aborta "$HOME/Desktop/backups"
bk aborta "$HOME/Library/Mobile Documents/backups"
bk aborta "$HOME/Library/CloudStorage/backups"
bk aborta "$T/enlace-al-repo/backups"
bk aborta "$T/enlace-a-documents/backups"
bk aborta "$T/a/../backups"
bk aborta "relativa/backups"
: > "$T/fichero"; bk aborta "$T/fichero"

echo "=== etiqueta de export.sh"
for tag in pre-fase-e ensayo-1 A9-z; do case_ ok "tag ${tag}" "valid_tag '$tag'; echo válida"; done
for tag in "" "a b" "x/y" "../x" "ñ" 'a$(id)' "a;b" "$(printf 'x%.0s' {1..41})"; do case_ aborta "tag «${tag}»" "valid_tag '$tag'"; done

echo "=== verificación del export (step2.sh / restore.sh)"
B="$T/backups"; S="beloved-barracuda-617"; HEAD="$(git -C "$ROOT" rev-parse HEAD)"
# fake_export <nombre> <skins> <calendars> <log> <cover> [created]
fake_export() {
  local z="$B/$1" w; w="$(mktemp -d "$T/w-XXXXXX")"
  local t n
  for t in skins:$2 calendars:$3 skinMigrationLog:$4 coverIconMigrationLog:$5; do
    mkdir -p "$w/${t%%:*}"; : > "$w/${t%%:*}/documents.jsonl"
    for ((n = 0; n < ${t#*:}; n++)); do echo '{"_id":"x'$n'"}' >> "$w/${t%%:*}/documents.jsonl"; done
  done
  (cd "$w" && zip -q -r "$z" .); chmod 600 "$z"
  printf 'slug=%s\ncreated=%s\nsha256=%s\nhead=%s\n' "$S" "${6:-$(date +%s)}" "$(shasum -a 256 "$z" | cut -d' ' -f1)" "$HEAD" > "$z.manifest"
  chmod 600 "$z.manifest"; echo "$z"
}
V="TAL82_BACKUPS='$B'; validate_backups;"
Z=$(fake_export "tal82-$S-ok.zip" 3 2 1 0)
case_ ok "export bueno" "$V verify_export_fresh $S '$Z' 3 2 1 0"
case_ aborta "otro deployment" "$V verify_export_fresh abundant-badger-144 '$Z' 3 2 1 0"
case_ aborta "cifra de skins distinta" "$V verify_export_fresh $S '$Z' 4 2 1 0"
case_ aborta "cifra de skinMigrationLog distinta" "$V verify_export_fresh $S '$Z' 3 2 0 0"
Z2=$(fake_export "tal82-$S-viejo.zip" 3 2 1 0 $(( $(date +%s) - 31 * 60 )))
case_ aborta "export de hace 31 min" "$V verify_export_fresh $S '$Z2' 3 2 1 0"
case_ ok "export de hace 31 min: íntegro (restore.sh no exige antigüedad)" "$V verify_export_integrity $S '$Z2'"
Z3=$(fake_export "tal82-$S-futuro.zip" 3 2 1 0 $(( $(date +%s) + 600 )))
case_ aborta "manifiesto con fecha futura" "$V verify_export_fresh $S '$Z3' 3 2 1 0"
Z4=$(fake_export "tal82-$S-otrohead.zip" 3 2 1 0); sed -i '' "s/^head=.*/head=0000000/" "$Z4.manifest"
case_ aborta "otro HEAD" "$V verify_export_fresh $S '$Z4' 3 2 1 0"
Z5=$(fake_export "tal82-$S-sha.zip" 3 2 1 0); sed -i '' "s/^sha256=.*/sha256=$(printf '0%.0s' {1..64})/" "$Z5.manifest"
case_ aborta "checksum distinto" "$V verify_export_fresh $S '$Z5' 3 2 1 0"
Z6=$(fake_export "tal82-$S-sinmanifiesto.zip" 3 2 1 0); rm -f -- "$Z6.manifest"
case_ aborta "sin manifiesto" "$V verify_export_fresh $S '$Z6' 3 2 1 0"
Z7=$(fake_export "tal82-$S-permisos.zip" 3 2 1 0); chmod 644 "$Z7"
case_ aborta "permisos 644" "$V verify_export_fresh $S '$Z7' 3 2 1 0"
Z8=$(fake_export "tal82-$S-danado.zip" 3 2 1 0); printf 'basura' | dd of="$Z8" bs=1 seek=40 conv=notrunc 2>/dev/null
sed -i '' "s/^sha256=.*/sha256=$(shasum -a 256 "$Z8" | cut -d' ' -f1)/" "$Z8.manifest"
case_ aborta "ZIP dañado (con checksum recalculado)" "$V verify_export_fresh $S '$Z8' 3 2 1 0"
ln -s "$Z" "$B/tal82-$S-enlace.zip"; cp -p "$Z.manifest" "$B/tal82-$S-enlace.zip.manifest"
case_ aborta "export como enlace simbólico" "$V verify_export_fresh $S '$B/tal82-$S-enlace.zip' 3 2 1 0"
cp -p "$Z" "$B/tal82-abundant-badger-144-renombrado.zip"; cp -p "$Z.manifest" "$B/tal82-abundant-badger-144-renombrado.zip.manifest"
case_ aborta "export de dev renombrado como de prod (manifiesto de otro deployment)" "$V verify_export_integrity abundant-badger-144 '$B/tal82-abundant-badger-144-renombrado.zip'"
mkdir -p "$T/fuera"; cp -p "$Z" "$Z.manifest" "$T/fuera/"
case_ aborta "export fuera de TAL82_BACKUPS" "$V verify_export_fresh $S '$T/fuera/$(basename "$Z")' 3 2 1 0"

echo "=== puerta de producción y HEAD limpio"
case_ aborta "prod sin TAL82_PROD_CONFIRM" "unset TAL82_PROD_CONFIRM; guard_deployment abundant-badger-144"
case_ aborta "prod con TAL82_PROD_CONFIRM de otro valor" "TAL82_PROD_CONFIRM=si guard_deployment abundant-badger-144"
case_ aborta "deployment desconocido" "guard_deployment otro-deployment-123"
R="$T/repo"; mkdir -p "$R/convex" "$R/otros"; git -C "$R" init -q; echo a > "$R/convex/a.ts"
git -C "$R" add -A; git -C "$R" -c user.name=t -c user.email=t@t commit -q -m t
case_ ok "repo limpio" "TAL82_ROOT='$R'; require_clean_head; echo limpio"
: > "$R/otros/nuevo.txt"
case_ ok "fichero nuevo fuera del código desplegado" "TAL82_ROOT='$R'; require_clean_head; echo limpio"
: > "$R/convex/nuevo.ts"
case_ aborta "fichero nuevo en convex/" "TAL82_ROOT='$R'; require_clean_head"
rm -f -- "$R/convex/nuevo.ts"; echo b > "$R/convex/a.ts"
case_ aborta "fichero versionado modificado" "TAL82_ROOT='$R'; require_clean_head"

echo "=== resultado: $fails fallos"
[ "$fails" = 0 ]
