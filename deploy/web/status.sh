#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PID_FILE="$APP_ROOT/data/scholarscope.pid"
CONFIG_FILE="$APP_ROOT/config.env"

if [[ -f "$CONFIG_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
  set +a
fi

api_host="${SCHOLARSCOPE_API_HOST:-127.0.0.1}"
api_port="${SCHOLARSCOPE_API_PORT:-5181}"

if [[ -f "$PID_FILE" ]]; then
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    printf 'Process: running (PID %s)\n' "$pid"
  else
    printf 'Process: stopped\n'
  fi
else
  printf 'Process: stopped\n'
fi

if command -v curl >/dev/null 2>&1; then
  curl --silent --show-error --max-time 5 "http://${api_host}:${api_port}/api/status" || true
  printf '\n'
elif command -v wget >/dev/null 2>&1; then
  wget -qO- --timeout=5 "http://${api_host}:${api_port}/api/status" || true
  printf '\n'
else
  printf 'API status: curl or wget is required for the readiness check.\n'
fi
