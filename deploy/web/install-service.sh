#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SERVICE_NAME="scholarscope-web.service"
SERVICE_TEMPLATE="$APP_ROOT/scholarscope-web.service"
SERVICE_PATH="/etc/systemd/system/$SERVICE_NAME"

if [[ "$(id -u)" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    exec sudo bash "$0" "$@"
  fi
  printf 'Please run this script as root.\n' >&2
  exit 1
fi

[[ -f "$SERVICE_TEMPLATE" ]] || { printf 'Missing service template: %s\n' "$SERVICE_TEMPLATE" >&2; exit 1; }

escaped_root="$(printf '%s' "$APP_ROOT" | sed 's/[&|]/\\&/g')"
sed "s|__SCHOLARSCOPE_ROOT__|$escaped_root|g" "$SERVICE_TEMPLATE" > "$SERVICE_PATH"
systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"
printf 'Installed and started %s for %s.\n' "$SERVICE_NAME" "$APP_ROOT"
systemctl --no-pager --full status "$SERVICE_NAME" || true
