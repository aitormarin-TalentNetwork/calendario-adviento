#!/bin/bash
# Instalación limpia estándar para la evidencia del export (decidido por el Factory
# Architect, 2026-10-12). La salida completa de este script, pegada tal cual, ES la
# evidencia de instalación limpia: ni más ni menos.
#
# Uso, desde la raíz de TU worktree (_worktrees/T<n>):
#   scripts/clean-evidence.sh
#
# Playwright NO va aquí: la pasada completa necesita el cerrojo .e2e-suite-lock y su
# E2E_PORT, y se lanza aparte (README de la fábrica § 3bis).
set -euo pipefail

cd "$(dirname "$0")/.."
here="$(pwd -P)"

# Barrera 1: solo dentro de _worktrees/. Un rm -rf de node_modules en la raíz rompería
# al Integrador, que publica desde ahí.
case "$here" in
  */_worktrees/*) ;;
  *) echo "ABORTO: ejecuta esto solo dentro de _worktrees/<tu worktree>, no en $here" >&2; exit 1 ;;
esac

# Barrera 2: nunca contra producción.
if [ "$#" -gt 0 ]; then
  echo "ABORTO: este script no acepta argumentos ($*)" >&2; exit 1
fi
if grep -q "abundant-badger-144" .env.local 2>/dev/null || grep -q "^CONVEX_DEPLOYMENT=prod:" .env.local 2>/dev/null; then
  echo "ABORTO: .env.local apunta al deployment de PRODUCCIÓN de Convex" >&2; exit 1
fi
if [ -n "${CONVEX_DEPLOY_KEY:-}" ] || [[ "${CONVEX_DEPLOYMENT:-}" == prod:* ]]; then
  echo "ABORTO: hay credenciales o deployment de producción en el entorno" >&2; exit 1
fi

step() { echo; echo "=== $(date '+%H:%M:%S') \$ $*"; "$@"; }

echo "=== clean-evidence.sh en $here, rama $(git branch --show-current) @ $(git rev-parse --short HEAD)"
step ls -la
step rm -rf node_modules .next convex/_generated tsconfig.tsbuildinfo next-env.d.ts \
  test-results playwright-report blob-report playwright/.cache out build
step ls -la
step npm ci
step npx convex dev --once
step npm run build
step npx tsc --noEmit
step npm run lint
echo; echo "=== OK: instalación limpia completa ($(date '+%H:%M:%S')). Pega TODA esta salida en el export."
