#!/data/data/com.termux/files/usr/bin/bash
# Shared environment loader for v2 Home Server shell modules.

set -euo pipefail

hs_project_root() {
  if [ -n "${PROJECT:-}" ]; then
    printf '%s\n' "$PROJECT"
    return 0
  fi
  local script_dir=""
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  printf '%s\n' "$script_dir"
}

hs_load_env_file() {
  local env_file="$1"
  local line="" key="" value=""
  [ -f "$env_file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in ''|\#*) continue ;; esac
    key="${line%%=*}"
    value="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac
    export "$key=$value"
  done < "$env_file"
}

PROJECT="$(hs_project_root)"
USER_HOME="${USER_HOME:-${HOME:-/data/data/com.termux/files/home}}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-$PROJECT/server/.env}"
hs_load_env_file "$SERVER_ENV_FILE"
mkdir -p "$RUNTIME_DIR" "$LOG_DIR"
