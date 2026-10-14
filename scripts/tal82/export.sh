#!/bin/bash
# TAL-82 — export completo de un deployment a TAL82_BACKUPS (plan §5.1).
# Uso: scripts/tal82/export.sh <slug> <etiqueta>   → imprime en la última línea la ruta del ZIP.
# TAL82_BACKUPS (por defecto ~/advcal-backups) se valida en guard_deployment: fuera del repo y de
# iCloud. umask 077 → ZIP 600, carpeta 700. Junto al ZIP deja `<zip>.manifest` (600: deployment,
# fecha, sha256 y HEAD), que es lo que comprueba step2.sh antes de tocar nada.
# En la evidencia solo van nombres de tablas, tamaños, recuentos y shasum: NUNCA contenido (datos personales).
source "$(dirname "$0")/lib.sh"
slug="${1:?slug}"; tag="${2:?etiqueta}"
valid_tag "$tag"
guard_deployment "$slug"
ts=$(date -u +%Y%m%dT%H%M%SZ)
zip="$TAL82_BACKUPS/tal82-$slug-$tag-$ts.zip"
[ ! -e "$zip" ] && [ ! -e "$zip.manifest" ] || die "ya existe $zip"
set -x
cx "$slug" export --path "$zip"
chmod 600 "$zip"
unzip -tq "$zip"
sha=$(shasum -a 256 "$zip" | cut -d' ' -f1)
printf 'slug=%s\ncreated=%s\nsha256=%s\nhead=%s\n' "$slug" "$(date +%s)" "$sha" "$(git -C "$TAL82_ROOT" rev-parse HEAD)" > "$zip.manifest"
chmod 600 "$zip.manifest"
cat "$zip.manifest"
unzip -l "$zip" | grep -E ' (skins|skinStyles|skinMigrationLog|coverIconMigrationLog|calendars|calendarMemberships|invitations|days|dayViews)/documents\.jsonl$'
set +x
for t in skins skinStyles skinMigrationLog coverIconMigrationLog calendars; do
  echo "$t: $(unzip -p "$zip" "$t/documents.jsonl" 2>/dev/null | grep -c '^{' || true) documentos"
done
ls -l "$zip" "$zip.manifest"
echo "$zip"
