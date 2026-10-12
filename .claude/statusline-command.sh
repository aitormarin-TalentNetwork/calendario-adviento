#!/bin/bash
# Línea de estado del proyecto "Calendario de Adviento".
# Muestra: [ROL] · directorio · modelo · contexto usado
#
# El rol se lee de la variable de entorno ROLE_NAME, que cada terminal debe
# exportar ANTES de lanzar `claude`, por ejemplo:
#   export ROLE_NAME="Director"
#   claude
# Si no está definida, se muestra "sin rol" en vez de fallar o dejarlo en blanco.

input=$(cat)

# --- Rol de la sesión (variable de entorno externa) ---
role="${ROLE_NAME:-sin rol}"

# --- Directorio y modelo (campos estándar del JSON de statusLine) ---
dir=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')
dir_name=$(basename "$dir" 2>/dev/null)
model=$(echo "$input" | jq -r '.model.display_name // empty')

# --- Contexto usado (mecanismo nativo de Claude Code, sin cálculo aproximado) ---
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
total_tokens=$(echo "$input" | jq -r '.context_window.total_input_tokens // empty')
window_size=$(echo "$input" | jq -r '.context_window.context_window_size // empty')

if [ -n "$used_pct" ]; then
  context_str=$(printf "Contexto: %.0f%%" "$used_pct")
  if [ -n "$total_tokens" ] && [ "$total_tokens" != "null" ] && [ -n "$window_size" ] && [ "$window_size" != "null" ]; then
    context_str="$context_str (${total_tokens}/${window_size} tok)"
  fi
else
  context_str="Contexto: N/D"
fi

# Color del contexto según el nivel de uso (verde/amarillo/rojo), tonos
# atenuados para no chillar en la terminal.
if [ -n "$used_pct" ]; then
  pct_int=${used_pct%.*}
  if [ "$pct_int" -ge 80 ] 2>/dev/null; then
    CTX_COLOR='\033[2;31m'   # rojo atenuado
  elif [ "$pct_int" -ge 50 ] 2>/dev/null; then
    CTX_COLOR='\033[2;33m'   # amarillo atenuado
  else
    CTX_COLOR='\033[2;32m'   # verde atenuado
  fi
else
  CTX_COLOR='\033[2;37m'     # gris atenuado
fi

BOLD_CYAN='\033[1;36m'
DIM='\033[2m'
RESET='\033[0m'

printf "${BOLD_CYAN}[%s]${RESET} ${DIM}%s${RESET} ${DIM}·${RESET} ${DIM}%s${RESET} ${DIM}·${RESET} ${CTX_COLOR}%s${RESET}\n" \
  "$role" "$dir_name" "$model" "$context_str"
