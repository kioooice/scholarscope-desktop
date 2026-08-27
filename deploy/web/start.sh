#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
APP_DIR="$APP_ROOT/app"
RUNTIME_DIR="$APP_ROOT/runtime"
PYTHON_DIR="$RUNTIME_DIR/python"
DATA_DIR="$APP_ROOT/data"
PID_FILE="$DATA_DIR/scholarscope.pid"
LOG_FILE="$DATA_DIR/server.log"
CONFIG_FILE="$APP_ROOT/config.env"

if [[ -f "$CONFIG_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$CONFIG_FILE"
  set +a
fi

die() {
  printf 'ScholarScope: %s\n' "$1" >&2
  exit 1
}

find_node() {
  local candidate
  candidate="${SCHOLARSCOPE_NODE_BIN:-$RUNTIME_DIR/node/bin/node}"
  if [[ -f "$candidate" ]]; then
    # ZIP extraction may not preserve the executable bit on the bundled binary.
    chmod +x "$candidate" 2>/dev/null || true
    printf '%s\n' "$candidate"
    return
  fi
  command -v node 2>/dev/null || true
}

find_python() {
  local candidate
  local resolved
  local fallback=""
  candidate="${SCHOLARSCOPE_PYTHON:-}"
  if [[ -n "$candidate" ]]; then
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return
    fi
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return
    fi
  fi
  for candidate in python3.13 python3.12 python3.11 python3 python; do
    resolved="$(command -v "$candidate" 2>/dev/null || true)"
    [[ -n "$resolved" ]] || continue
    fallback="${fallback:-$resolved}"
    if python_supported "$resolved"; then
      printf '%s\n' "$resolved"
      return
    fi
  done
  printf '%s\n' "$fallback"
}

python_supported() {
  "$1" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1
}

python_has_modules() {
  "$1" -c 'import scansci_pdf, requests, mcp' >/dev/null 2>&1
}

python_version() {
  "$1" -c 'import sys; print("%d.%d.%d" % (sys.version_info.major, sys.version_info.minor, sys.version_info.micro))' 2>/dev/null || true
}

prepare_python() {
  local system_python
  local configured_python="${SCHOLARSCOPE_ENGINE_PYTHON:-}"
  local current_version
  local pip_index="${SCHOLARSCOPE_PIP_INDEX_URL:-https://pypi.org/simple}"
  local pip_extra_index="${SCHOLARSCOPE_PIP_EXTRA_INDEX_URL:-}"
  local pip_args=(--index-url "$pip_index")

  if [[ -z "$pip_index" ]]; then
    pip_index="https://pypi.org/simple"
    pip_args=(--index-url "$pip_index")
  fi
  if [[ -n "$pip_extra_index" ]]; then
    pip_args+=(--extra-index-url "$pip_extra_index")
  fi

  if [[ -n "$configured_python" && -x "$configured_python" ]]; then
    current_version="$(python_version "$configured_python")"
    if ! python_supported "$configured_python"; then
      die "需要 Python 3.11 或更高版本才能运行 scansci-pdf。SCHOLARSCOPE_ENGINE_PYTHON 当前为 ${current_version:-未知版本}（${configured_python}）。"
    fi
    if python_has_modules "$configured_python"; then
      printf '%s\n' "$configured_python"
      return
    fi
  fi

  if [[ -e "$PYTHON_DIR" && ! -x "$PYTHON_DIR/bin/python" ]]; then
    printf 'ScholarScope: removing incomplete local Python environment.\n' >&2
    rm -rf -- "$PYTHON_DIR"
  fi

  if [[ -x "$PYTHON_DIR/bin/python" ]]; then
    if ! python_supported "$PYTHON_DIR/bin/python"; then
      current_version="$(python_version "$PYTHON_DIR/bin/python")"
      printf 'ScholarScope: replacing incompatible local Python environment (%s; requires Python 3.11+).\n' "${current_version:-unknown}" >&2
      rm -rf -- "$PYTHON_DIR"
    elif python_has_modules "$PYTHON_DIR/bin/python"; then
      printf '%s\n' "$PYTHON_DIR/bin/python"
      return
    fi
  fi

  system_python="$(find_python)"
  [[ -n "$system_python" ]] || die "未找到 Python 3。请在 1Panel 中安装 Python 3 后重试。"
  current_version="$(python_version "$system_python")"
  if ! python_supported "$system_python"; then
    die "需要 Python 3.11 或更高版本才能安装 scansci-pdf。当前检测到 ${current_version:-未知版本}（${system_python}），请在 1Panel 安装/选择 Python 3.11+ 后重试。"
  fi
  mkdir -p "$RUNTIME_DIR"

  if [[ ! -x "$PYTHON_DIR/bin/python" ]]; then
    printf 'ScholarScope: creating local Python environment...\n' >&2
    "$system_python" -m venv "$PYTHON_DIR" || die "无法创建 Python 虚拟环境。请安装 python3-venv 后重试。"
  fi

  printf 'ScholarScope: installing paper engine dependencies from %s...\n' "$pip_index" >&2
  if ! PIP_DISABLE_PIP_VERSION_CHECK=1 PIP_NO_INDEX= \
    "$PYTHON_DIR/bin/python" -m pip install \
      --disable-pip-version-check --no-cache-dir --upgrade \
      "${pip_args[@]}" \
      'scansci-pdf[web]==1.9.0' 'mcp<2' >&2; then
    printf 'ScholarScope: Python dependency installation diagnostics:\n' >&2
    printf '  Python: %s (%s)\n' "${current_version:-unknown}" "$system_python" >&2
    "$PYTHON_DIR/bin/python" -m pip --version >&2 || true
    "$PYTHON_DIR/bin/python" -m pip config list >&2 || true
    printf '  pip index: %s\n' "$pip_index" >&2
    if [[ -n "$pip_extra_index" ]]; then
      printf '  pip extra index: %s\n' "$pip_extra_index" >&2
    fi
    die "Python 引擎依赖安装失败。请确认服务器可以访问该 pip 索引；如果使用的镜像没有 scansci-pdf，请在 config.env 设置 SCHOLARSCOPE_PIP_INDEX_URL=https://pypi.org/simple 后重试。"
  fi

  python_has_modules "$PYTHON_DIR/bin/python" || die "Python 引擎依赖校验失败。"
  printf '%s\n' "$PYTHON_DIR/bin/python"
}

[[ -d "$APP_DIR" ]] || die "缺少 app 目录，请确认压缩包已完整解压。"
[[ -f "$APP_DIR/server.mjs" ]] || die "缺少 app/server.mjs，请确认压缩包已完整解压。"
[[ -f "$APP_DIR/dist/index.html" ]] || die "缺少 app/dist 前端文件，请确认压缩包已完整解压。"

NODE_BIN="$(find_node)"
[[ -n "$NODE_BIN" ]] || die "未找到 Node.js。请在 1Panel 中安装 Node.js 20 或更高版本。"
PYTHON_BIN="$(prepare_python)"

mkdir -p "$DATA_DIR"
export SCHOLARSCOPE_HOST="${SCHOLARSCOPE_HOST:-127.0.0.1}"
export SCHOLARSCOPE_PORT="${SCHOLARSCOPE_PORT:-5180}"
export SCHOLARSCOPE_API_HOST="${SCHOLARSCOPE_API_HOST:-127.0.0.1}"
export SCHOLARSCOPE_API_PORT="${SCHOLARSCOPE_API_PORT:-5181}"
export SCHOLARSCOPE_DATA_DIR="${SCHOLARSCOPE_DATA_DIR:-$DATA_DIR}"
export SCANSCI_PDF_DATA_DIR="${SCANSCI_PDF_DATA_DIR:-$SCHOLARSCOPE_DATA_DIR}"
export SCHOLARSCOPE_ENGINE_PYTHON="$PYTHON_BIN"

run_foreground() {
  local child_pid
  local child_status
  "$NODE_BIN" "$APP_DIR/server.mjs" &
  child_pid=$!
  printf '%s\n' "$child_pid" > "$PID_FILE"

  cleanup() {
    trap - TERM INT EXIT
    if kill -0 "$child_pid" 2>/dev/null; then
      kill "$child_pid" 2>/dev/null || true
      wait "$child_pid" 2>/dev/null || true
    fi
    rm -f "$PID_FILE"
  }
  trap 'cleanup; exit 143' TERM INT
  trap 'rm -f "$PID_FILE"' EXIT

  wait "$child_pid" || child_status=$?
  child_status="${child_status:-0}"
  exit "$child_status"
}

if [[ "${1:-}" == "--foreground" ]]; then
  run_foreground
fi

if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
    printf 'ScholarScope is already running (PID %s).\n' "$existing_pid"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

nohup "$NODE_BIN" "$APP_DIR/server.mjs" >>"$LOG_FILE" 2>&1 </dev/null &
server_pid=$!
printf '%s\n' "$server_pid" > "$PID_FILE"
sleep 1

if ! kill -0 "$server_pid" 2>/dev/null; then
  rm -f "$PID_FILE"
  printf 'ScholarScope failed to start. Recent log:\n' >&2
  tail -n 80 "$LOG_FILE" >&2 || true
  exit 1
fi

printf 'ScholarScope started (PID %s).\n' "$server_pid"
printf 'Web proxy target: http://%s:%s\n' "$SCHOLARSCOPE_HOST" "$SCHOLARSCOPE_PORT"
printf 'Run bash status.sh to check engine readiness.\n'
