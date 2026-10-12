#!/bin/bash
# TAL-82 — export completo de un deployment a ~/advcal-backups (plan §5.1).
# Uso: scripts/tal82/export.sh <slug> <etiqueta>   → imprime en la última línea la ruta del ZIP.
# Fuera del repo y fuera de ~/Documents (iCloud); umask 077 → ZIP 600, carpeta 700.
# En la evidencia solo van nombres de tablas, tamaños, recuentos y shasum: NUNCA contenido (datos personales).
source "$(dirname "$0")/lib.sh"
slug="${1:?slug}"; tag="${2:?etiqueta}"
guard_deployment "$slug"
mkdir -p "$TAL82_BACKUPS" && chmod 700 "$TAL82_BACKUPS"
ts=$(date -u +%Y%m%dT%H%M%SZ)
zip="$TAL82_BACKUPS/tal82-$slug-$tag-$ts.zip"
set -x
cx "$slug" export --path "$zip"
chmod 600 "$zip"
shasum -a 256 "$zip"
unzip -l "$zip" | grep -E ' (skins|skinStyles|skinMigrationLog|coverIconMigrationLog|calendars|calendarMemberships|invitations|days|dayViews)/documents\.jsonl$'
set +x
for t in skins skinStyles skinMigrationLog coverIconMigrationLog calendars; do
  echo "$t: $(unzip -p "$zip" "$t/documents.jsonl" 2>/dev/null | grep -c '^{' || true) documentos"
done
ls -l "$zip"
echo "$zip"
