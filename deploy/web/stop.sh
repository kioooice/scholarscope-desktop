#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PID_FILE="$APP_ROOT/data/scholarscope.pid"

if [[ ! -f "$PID_FILE" ]]; then
  printf 'ScholarScope is not running.\n'
  exit 0
fi

pid="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ -z "$pid" ]] || ! kill -0 "$pid" 2>/dev/null; then
  rm -f "$PID_FILE"
  printf 'ScholarScope is not running.\n'
  exit 0
fi

kill "$pid" 2>/dev/null || true
for _ in $(seq 1 30); do
  if ! kill -0 "$pid" 2>/dev/null; then
    rm -f "$PID_FILE"
    printf 'ScholarScope stopped.\n'
    exit 0
  fi
  sleep 1
done

kill -KILL "$pid" 2>/dev/null || true
rm -f "$PID_FILE"
printf 'ScholarScope stopped forcefully.\n'
