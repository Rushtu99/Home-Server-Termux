#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
MEDIA_SERVICES_HOME="${MEDIA_SERVICES_HOME:-$USER_HOME/services}"
LLM_HOME="${LLM_HOME:-$MEDIA_SERVICES_HOME/llm}"
LLM_MODELS_DIR="${LLM_MODELS_DIR:-$LLM_HOME/models}"
LLM_BIND_HOST="${LLM_BIND_HOST:-127.0.0.1}"
LLM_PORT="${LLM_PORT:-11435}"
LLM_CTX_SIZE="${LLM_CTX_SIZE:-4096}"
LLM_THREADS="${LLM_THREADS:-4}"
LLM_GPU_LAYERS="${LLM_GPU_LAYERS:-0}"
LLM_DEFAULT_MODEL_PATH="${LLM_DEFAULT_MODEL_PATH:-}"
LLM_ACTIVE_MODEL_FILE="${LLM_ACTIVE_MODEL_FILE:-$RUNTIME_DIR/llm-active-model.txt}"
LLM_PID_PATH="${LLM_PID_PATH:-$RUNTIME_DIR/llm.pid}"
LLM_LOG_PATH="${LLM_LOG_PATH:-$LOG_DIR/llm.log}"
LLM_SERVER_BIN="${LLM_SERVER_BIN:-$(command -v llama-server || true)}"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR" "$LLM_HOME" "$LLM_MODELS_DIR"

is_running() {
    local pid=""
    [ -f "$LLM_PID_PATH" ] || return 1
    pid="$(cat "$LLM_PID_PATH" 2>/dev/null || true)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

resolve_model_path() {
    local candidate=""
    if [ -f "$LLM_ACTIVE_MODEL_FILE" ]; then
        candidate="$(cat "$LLM_ACTIVE_MODEL_FILE" 2>/dev/null || true)"
    fi

    if [ -z "$candidate" ]; then
        candidate="$LLM_DEFAULT_MODEL_PATH"
    fi

    if [ -z "$candidate" ]; then
        candidate="$(find "$LLM_MODELS_DIR" -maxdepth 2 -type f -name "*.gguf" | head -n 1 || true)"
    fi

    printf '%s\n' "$candidate"
}

start_service() {
    [ -n "$LLM_SERVER_BIN" ] || {
        echo "llama-server is not installed" >&2
        return 1
    }

    if is_running; then
        return 0
    fi

    local model_path=""
    model_path="$(resolve_model_path)"
    [ -n "$model_path" ] || {
        echo "no GGUF model found. Set LLM_DEFAULT_MODEL_PATH or write runtime/llm-active-model.txt" >&2
        return 1
    }
    [ -f "$model_path" ] || {
        echo "model path does not exist: $model_path" >&2
        return 1
    }

    if command -v setsid >/dev/null 2>&1; then
        setsid "$LLM_SERVER_BIN" \
            --host "$LLM_BIND_HOST" \
            --port "$LLM_PORT" \
            --model "$model_path" \
            --ctx-size "$LLM_CTX_SIZE" \
            --threads "$LLM_THREADS" \
            --n-gpu-layers "$LLM_GPU_LAYERS" \
            --jinja \
            > "$LLM_LOG_PATH" 2>&1 < /dev/null &
    else
        nohup "$LLM_SERVER_BIN" \
            --host "$LLM_BIND_HOST" \
            --port "$LLM_PORT" \
            --model "$model_path" \
            --ctx-size "$LLM_CTX_SIZE" \
            --threads "$LLM_THREADS" \
            --n-gpu-layers "$LLM_GPU_LAYERS" \
            --jinja \
            > "$LLM_LOG_PATH" 2>&1 &
    fi
    printf '%s\n' "$!" > "$LLM_PID_PATH"
}

stop_service() {
    local pid=""
    if [ ! -f "$LLM_PID_PATH" ]; then
        return 0
    fi

    pid="$(cat "$LLM_PID_PATH" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" >/dev/null 2>&1 || true
        sleep 1
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" >/dev/null 2>&1 || true
        fi
    fi

    rm -f "$LLM_PID_PATH"
}

case "${1:-status}" in
    start)
        start_service
        ;;
    stop)
        stop_service
        ;;
    restart)
        stop_service
        start_service
        ;;
    status)
        is_running
        ;;
    *)
        echo "usage: $0 {start|stop|restart|status}" >&2
        exit 1
        ;;
esac
