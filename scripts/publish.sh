#!/bin/sh
# Publica una o varias ramas de tarea en main, en el orden dado, con un solo push.
# Lo lanza solo el Integrador (ver integrador.md). Uso:
#   scripts/publish.sh <rama>[::<título>] [<rama>[::<título>] ...]
# Ejemplo:
#   scripts/publish.sh aitormarin/tal-59-menu-de-la-cuenta "aitormarin/tal-63-deps::parchear vulnerabilidades"
# El mensaje de cada merge es "merge: TAL-X — <título>". TAL-X sale del nombre de la rama;
# el título, de lo que va tras "::" o, si no hay, del resto del nombre de la rama.
# Si cualquier merge da conflicto, aborta y devuelve main a donde estaba (sin tocar los
# cambios sin commitear de la raíz) y no hace push.
set -eu

[ $# -ge 1 ] || { echo "Uso: $0 <rama>[::<título>] ..." >&2; exit 2; }

cd "$(dirname "$0")/.."

git checkout main
git pull --ff-only origin main
start=$(git rev-parse HEAD)

rollback() {
  git merge --abort 2>/dev/null || true
  git reset --keep "$start"
  echo "ABORTADO: main vuelve a $start, no se ha hecho push." >&2
  exit 1
}

for arg in "$@"; do
  branch=${arg%%::*}
  if [ "$branch" != "$arg" ]; then
    title=${arg#*::}
  else
    title=""
  fi
  git rev-parse --verify --quiet "$branch" >/dev/null || { echo "No existe la rama $branch" >&2; rollback; }
  slug=$(basename "$branch")
  task=$(echo "$slug" | grep -o -i -E '^tal-[0-9]+' | tr 'a-z' 'A-Z')
  [ -n "$task" ] || { echo "No encuentro TAL-X en el nombre de $branch" >&2; rollback; }
  if [ -z "$title" ]; then
    title=$(echo "$slug" | sed -E 's/^[Tt][Aa][Ll]-[0-9]+-?//; s/-/ /g')
  fi
  echo "== merge $task: $title"
  git merge --no-ff "$branch" -m "merge: $task — $title" || rollback
done

git push origin main
echo "LISTO: main en $(git rev-parse --short HEAD)"
