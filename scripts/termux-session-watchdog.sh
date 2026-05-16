#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${USER_HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
TERMUX_PREFIX="${TERMUX_PREFIX:-/data/data/com.termux/files/usr}"
LOG_DIR="${LOG_DIR:-$USER_HOME/.termux/logs}"
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
PID_FILE="${PID_FILE:-$RUNTIME_DIR/termux-session-watchdog.pid}"
STATE_FILE="${STATE_FILE:-$RUNTIME_DIR/termux-session-watchdog.state}"
WATCHDOG_LOG_PATH="${WATCHDOG_LOG_PATH:-$LOG_DIR/termux-session-watchdog.log}"
CHECK_INTERVAL_SECONDS="${CHECK_INTERVAL_SECONDS:-150}"
FORENSIC_SNAPSHOT_INTERVAL_SECONDS="${FORENSIC_SNAPSHOT_INTERVAL_SECONDS:-300}"
LOGCAT_LINES="${LOGCAT_LINES:-120}"
SSHD_BIND_HOST="${SSHD_BIND_HOST:-127.0.0.1}"
SSHD_PORT="${SSHD_PORT:-8022}"
WATCHDOG_ENSURE_SSHD="${WATCHDOG_ENSURE_SSHD:-true}"
WATCHDOG_ENSURE_TMUX="${WATCHDOG_ENSURE_TMUX:-true}"
TMUX_KEEPALIVE_SESSION="${TMUX_KEEPALIVE_SESSION:-termux-keepalive}"
RESTART_DEBOUNCE_SECONDS="${RESTART_DEBOUNCE_SECONDS:-360}"
WATCHDOG_RESPECT_SSHD_DOWN_FILE="${WATCHDOG_RESPECT_SSHD_DOWN_FILE:-true}"
SV_BIN="${SV_BIN:-$TERMUX_PREFIX/bin/sv}"
SERVICE_DAEMON_BIN="${SERVICE_DAEMON_BIN:-$TERMUX_PREFIX/bin/service-daemon}"
SVDIR_PATH="${SVDIR_PATH:-$TERMUX_PREFIX/var/service}"
LOGDIR_PATH="${LOGDIR_PATH:-$TERMUX_PREFIX/var/log}"
WATCHDOG_SERVICE_DEGRADED_LIST="${WATCHDOG_SERVICE_DEGRADED_LIST:-redis,postgres,jellyfin,qbittorrent,sonarr,radarr,prowlarr,bazarr,flarearr,jellyseerr}"
SFQ_HELPER="${SFQ_HELPER:-$PROJECT/scripts/service-fail-quiet.sh}"

LAST_SSHD_RESTART_EPOCH=0
LAST_TMUX_RESTART_EPOCH=0
LAST_FORENSIC_EPOCH=0
LAST_DEGRADED_SUMMARY=""
[ -f "$SFQ_HELPER" ] && . "$SFQ_HELPER"

timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}

now_epoch() {
    date +%s
}

log_line() {
    printf '[%s] %s\n' "$(timestamp)" "$*" >> "$WATCHDOG_LOG_PATH"
}

ensure_dirs() {
    mkdir -p "$LOG_DIR" "$RUNTIME_DIR"
}

pid_is_alive() {
    local pid="$1"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

list_watchdog_run_pids() {
    pgrep -f 'termux-session-watchdog\.sh run' 2>/dev/null | awk -v self="$$" '$1 != self {print $1}'
}

collect_watchdog_pids() {
    {
        if [ -f "$PID_FILE" ]; then
            tr -d '[:space:]' < "$PID_FILE" 2>/dev/null || true
            printf '\n'
        fi
        list_watchdog_run_pids || true
    } | awk '/^[0-9]+$/ && !seen[$1]++ {print $1}'
}

read_state() {
    if [ -f "$STATE_FILE" ]; then
        # shellcheck disable=SC1090
        . "$STATE_FILE" || true
    fi
    LAST_SSHD_RESTART_EPOCH="${LAST_SSHD_RESTART_EPOCH:-0}"
    LAST_TMUX_RESTART_EPOCH="${LAST_TMUX_RESTART_EPOCH:-0}"
    LAST_FORENSIC_EPOCH="${LAST_FORENSIC_EPOCH:-0}"
}

write_state() {
    local tmp_file="$STATE_FILE.tmp.$$"
    cat > "$tmp_file" <<EOF
LAST_SSHD_RESTART_EPOCH=${LAST_SSHD_RESTART_EPOCH}
LAST_TMUX_RESTART_EPOCH=${LAST_TMUX_RESTART_EPOCH}
LAST_FORENSIC_EPOCH=${LAST_FORENSIC_EPOCH}
LAST_DEGRADED_SUMMARY="${LAST_DEGRADED_SUMMARY}"
EOF
    mv -f "$tmp_file" "$STATE_FILE"
}

probe_host() {
    case "$1" in
        0.0.0.0|'::'|'[::]'|'')
            printf '127.0.0.1\n'
            ;;
        *)
            printf '%s\n' "$1"
            ;;
    esac
}

port_is_open() {
    local host="$1"
    local port="$2"
    if command -v nc >/dev/null 2>&1; then
        nc -z "$host" "$port" >/dev/null 2>&1
        return $?
    fi

    ss -tln 2>/dev/null | grep -Eq "[.:]${port}[[:space:]]"
}

sshd_listener_ready() {
    local host=""
    host="$(probe_host "$SSHD_BIND_HOST")"
    port_is_open "$host" "$SSHD_PORT"
}

sshd_running() {
    pgrep -x sshd >/dev/null 2>&1
}

sshd_service_disabled() {
    [ "$WATCHDOG_RESPECT_SSHD_DOWN_FILE" = "true" ] && [ -f "$SVDIR_PATH/sshd/down" ]
}

tmux_server_running() {
    command -v tmux >/dev/null 2>&1 && tmux ls >/dev/null 2>&1
}

acquire_wake_lock() {
    if command -v termux-wake-lock >/dev/null 2>&1; then
        termux-wake-lock >/dev/null 2>&1 || log_line "WARN wake-lock acquisition failed"
    fi
}

capture_forensic_snapshot() {
    local reason="$1"
    LAST_FORENSIC_EPOCH="$(now_epoch)"
    log_line "FORENSIC snapshot reason=$reason boot_id=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo unknown)"
    log_line "FORENSIC ps sshd/tmux/termux/runsvdir:"
    ps -ef 2>/dev/null | rg -i 'sshd|tmux|termux|runsvdir|service-daemon' | head -n 80 >> "$WATCHDOG_LOG_PATH" || true
    log_line "FORENSIC process tree for watchdog pid=$$:"
    ps -ef 2>/dev/null | awk -v pid="$$" '$2==pid || $3==pid {print}' >> "$WATCHDOG_LOG_PATH" || true
    log_line "FORENSIC logcat lmk/activity sample:"
    if command -v logcat >/dev/null 2>&1; then
        logcat -d -v time 2>/dev/null \
            | rg -i 'ActivityManager|am_kill|force stop|lowmemorykiller|lmkd|Process com\.termux|Killing .*com\.termux|background.*restricted' \
            | tail -n "$LOGCAT_LINES" >> "$WATCHDOG_LOG_PATH" || true
    fi
}

start_sshd() {
    if [ "$WATCHDOG_ENSURE_SSHD" != "true" ] || ! command -v sshd >/dev/null 2>&1; then
        return 0
    fi
    if sshd_listener_ready; then
        return 0
    fi
    if sshd_service_disabled; then
        log_line "INFO sshd restart skipped because supervisor down marker exists path=${SVDIR_PATH}/sshd/down"
        return 0
    fi

    local now=""
    now="$(now_epoch)"
    if [ $((now - LAST_SSHD_RESTART_EPOCH)) -lt "$RESTART_DEBOUNCE_SECONDS" ]; then
        return 0
    fi
    LAST_SSHD_RESTART_EPOCH="$now"

    log_line "ACTION restart-sshd attempt host=${SSHD_BIND_HOST} port=${SSHD_PORT}"
    if [ -x "$SERVICE_DAEMON_BIN" ]; then
        env PREFIX="$TERMUX_PREFIX" SVDIR="$SVDIR_PATH" LOGDIR="$LOGDIR_PATH" "$SERVICE_DAEMON_BIN" start >/dev/null 2>&1 || true
    fi
    if [ -x "$SV_BIN" ] && [ -d "$SVDIR_PATH/sshd" ]; then
        env PREFIX="$TERMUX_PREFIX" SVDIR="$SVDIR_PATH" LOGDIR="$LOGDIR_PATH" "$SV_BIN" up sshd >/dev/null 2>&1 || true
    fi

    sleep 2
    if sshd_listener_ready; then
        log_line "RESULT restart-sshd success via supervisor"
        return 0
    fi

    sshd >> "$WATCHDOG_LOG_PATH" 2>&1 || true
    sleep 2
    if sshd_listener_ready; then
        log_line "RESULT restart-sshd success via direct launch"
    else
        log_line "ERROR restart-sshd failed listener-not-ready host=${SSHD_BIND_HOST} port=${SSHD_PORT}"
        capture_forensic_snapshot "sshd-restart-failed"
    fi
}

ensure_sshd_health() {
    if [ "$WATCHDOG_ENSURE_SSHD" != "true" ]; then
        return 0
    fi

    local listener_ok="false"
    local process_ok="false"

    if sshd_listener_ready; then
        listener_ok="true"
    fi
    if sshd_running; then
        process_ok="true"
    fi

    if [ "$listener_ok" = "true" ]; then
        return 0
    fi

    if [ "$process_ok" = "true" ]; then
        # Avoid restart storms when probe disagrees with process state or another manager owns sshd.
        log_line "WARN sshd listener probe failed but sshd process exists; skipping restart to avoid churn"
        return 0
    fi

    log_line "WARN sshd listener missing and process missing host=${SSHD_BIND_HOST} port=${SSHD_PORT}"
    start_sshd
}

ensure_tmux_keepalive() {
    if [ "$WATCHDOG_ENSURE_TMUX" != "true" ] || ! command -v tmux >/dev/null 2>&1; then
        return 0
    fi

    if tmux has-session -t "$TMUX_KEEPALIVE_SESSION" >/dev/null 2>&1; then
        return 0
    fi

    local now=""
    now="$(now_epoch)"
    if [ $((now - LAST_TMUX_RESTART_EPOCH)) -lt "$RESTART_DEBOUNCE_SECONDS" ]; then
        return 0
    fi
    LAST_TMUX_RESTART_EPOCH="$now"

    tmux new-session -d -s "$TMUX_KEEPALIVE_SESSION" "while true; do sleep 3600; done" >/dev/null 2>&1 || true
    if tmux has-session -t "$TMUX_KEEPALIVE_SESSION" >/dev/null 2>&1; then
        log_line "ACTION ensure-tmux created session=$TMUX_KEEPALIVE_SESSION"
    else
        log_line "ERROR ensure-tmux failed session=$TMUX_KEEPALIVE_SESSION"
        capture_forensic_snapshot "tmux-create-failed"
    fi
}

emit_degraded_service_summary() {
    local service=""
    local summary=""
    local remain=0

    type sfq_is_cooldown_active >/dev/null 2>&1 || return 0

    while IFS= read -r service; do
        service="$(printf '%s' "$service" | tr -d '[:space:]')"
        [ -n "$service" ] || continue
        if sfq_is_cooldown_active "$RUNTIME_DIR" "$service"; then
            remain="$(sfq_remaining_cooldown "$RUNTIME_DIR" "$service" 2>/dev/null || echo 0)"
            summary="${summary}${service}:${remain}s,"
        fi
    done < <(printf '%s\n' "$WATCHDOG_SERVICE_DEGRADED_LIST" | tr ',' '\n')

    summary="${summary%,}"
    if [ "$summary" != "$LAST_DEGRADED_SUMMARY" ]; then
        if [ -n "$summary" ]; then
            log_line "SERVICE_STATE degraded_active=$summary"
        else
            log_line "SERVICE_STATE degraded_active=none"
        fi
        LAST_DEGRADED_SUMMARY="$summary"
    fi
}

run_loop() {
    ensure_dirs
    if [ -f "$PID_FILE" ]; then
        local tracked_pid=""
        tracked_pid="$(tr -d '[:space:]' < "$PID_FILE" 2>/dev/null || true)"
        if ! pid_is_alive "$tracked_pid"; then
            printf '%s\n' "$$" > "$PID_FILE"
        fi
    else
        printf '%s\n' "$$" > "$PID_FILE"
    fi
    read_state
    acquire_wake_lock
    log_line "watchdog loop started pid=$$ interval=${CHECK_INTERVAL_SECONDS}s"

    while true; do
        acquire_wake_lock

        ensure_sshd_health

        ensure_tmux_keepalive
        emit_degraded_service_summary

        if [ "$WATCHDOG_ENSURE_TMUX" = "true" ] && ! tmux_server_running; then
            log_line "WARN tmux server unavailable"
            ensure_tmux_keepalive
        fi

        local now=""
        now="$(now_epoch)"
        if [ $((now - LAST_FORENSIC_EPOCH)) -ge "$FORENSIC_SNAPSHOT_INTERVAL_SECONDS" ]; then
            capture_forensic_snapshot "periodic"
        fi

        write_state
        sleep "$CHECK_INTERVAL_SECONDS"
    done
}

start_watchdog() {
    ensure_dirs
    if [ -f "$PID_FILE" ]; then
        local pid=""
        pid="$(tr -d '[:space:]' < "$PID_FILE" 2>/dev/null || true)"
        if pid_is_alive "$pid"; then
            log_line "watchdog already running pid=$pid"
            printf 'watchdog already running (pid %s)\n' "$pid"
            return 0
        fi
        rm -f "$PID_FILE"
    fi
    local existing_pid=""
    existing_pid="$(list_watchdog_run_pids | head -n 1 || true)"
    if [ -n "$existing_pid" ] && pid_is_alive "$existing_pid"; then
        printf '%s\n' "$existing_pid" > "$PID_FILE"
        log_line "watchdog already running discovered pid=$existing_pid"
        printf 'watchdog already running (pid %s)\n' "$existing_pid"
        return 0
    fi

    nohup "$0" run >> "$WATCHDOG_LOG_PATH" 2>&1 &
    local new_pid="$!"
    sleep 1
    if ! pid_is_alive "$new_pid"; then
        log_line "ERROR watchdog failed to stay alive after launch"
        rm -f "$PID_FILE"
        printf 'watchdog failed to start\n' >&2
        return 1
    fi
    printf '%s\n' "$new_pid" > "$PID_FILE"
    log_line "watchdog started pid=$new_pid"
    printf 'watchdog started (pid %s)\n' "$new_pid"
}

stop_watchdog() {
    local stopped_any="false"
    local pid=""

    while IFS= read -r pid; do
        [ -n "$pid" ] || continue
        if pid_is_alive "$pid"; then
            kill "$pid" >/dev/null 2>&1 || true
            sleep 1
            if pid_is_alive "$pid"; then
                kill -9 "$pid" >/dev/null 2>&1 || true
            fi
            stopped_any="true"
            log_line "watchdog stopped pid=$pid"
        fi
    done < <(collect_watchdog_pids)

    rm -f "$PID_FILE"
    if [ "$stopped_any" = "false" ]; then
        printf 'watchdog is not running\n'
        return 0
    fi
    printf 'watchdog stopped\n'
}

status_watchdog() {
    local pid="" first_pid=""
    first_pid="$(collect_watchdog_pids | head -n 1 || true)"
    if [ -n "$first_pid" ]; then
        printf '%s\n' "$first_pid" > "$PID_FILE"
        if pid_is_alive "$first_pid"; then
            printf 'watchdog running (pid %s)\n' "$first_pid"
            return 0
        fi
    fi
    if [ -f "$PID_FILE" ]; then
        pid="$(tr -d '[:space:]' < "$PID_FILE" 2>/dev/null || true)"
        if pid_is_alive "$pid"; then
            printf 'watchdog running (pid %s)\n' "$pid"
            return 0
        fi
        rm -f "$PID_FILE"
    fi
    printf 'watchdog stopped\n'
    return 1
}

ACTION="${1:-status}"
case "$ACTION" in
    run)
        run_loop
        ;;
    start)
        start_watchdog
        ;;
    stop)
        stop_watchdog
        ;;
    restart)
        stop_watchdog
        start_watchdog
        ;;
    status)
        status_watchdog
        ;;
    *)
        printf 'usage: %s {start|stop|restart|status|run}\n' "$(basename "$0")" >&2
        exit 1
        ;;
esac
