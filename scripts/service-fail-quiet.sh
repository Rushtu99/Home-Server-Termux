#!/data/data/com.termux/files/usr/bin/bash

# Shared helper for fail-quiet service startup behavior.

SERVICE_FAIL_MODE="${SERVICE_FAIL_MODE:-fail_quiet}"
SERVICE_RETRY_MAX_PER_HOUR="${SERVICE_RETRY_MAX_PER_HOUR:-4}"
SERVICE_BACKOFF_STEPS="${SERVICE_BACKOFF_STEPS:-60,300,900,3600}"
SERVICE_DEGRADED_COOLDOWN_SECONDS="${SERVICE_DEGRADED_COOLDOWN_SECONDS:-3600}"

sfq_now_epoch() {
    date +%s
}

sfq_state_file() {
    local runtime_dir="$1"
    local service="$2"
    local suffix="$3"
    printf '%s/%s.%s\n' "$runtime_dir" "$service" "$suffix"
}

sfq_log() {
    local log_path="$1"
    local message="$2"
    [ -n "$log_path" ] || return 0
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$message" >> "$log_path"
}

sfq_backoff_for_failcount() {
    local failcount="$1"
    local fallback=3600
    local idx=1
    local value=""

    while IFS= read -r value; do
        value="$(printf '%s' "$value" | tr -d '[:space:]')"
        [ -n "$value" ] || continue
        if [ "$idx" -eq "$failcount" ]; then
            printf '%s\n' "$value"
            return 0
        fi
        fallback="$value"
        idx=$((idx + 1))
    done < <(printf '%s\n' "$SERVICE_BACKOFF_STEPS" | tr ',' '\n')

    printf '%s\n' "$fallback"
}

sfq_is_cooldown_active() {
    local runtime_dir="$1"
    local service="$2"
    local now=""
    local until_file=""
    local until_raw=""

    now="$(sfq_now_epoch)"
    until_file="$(sfq_state_file "$runtime_dir" "$service" "cooldown_until")"
    [ -f "$until_file" ] || return 1

    until_raw="$(tr -d '[:space:]' < "$until_file" 2>/dev/null || true)"
    [[ "$until_raw" =~ ^[0-9]+$ ]] || return 1
    [ "$now" -lt "$until_raw" ]
}

sfq_remaining_cooldown() {
    local runtime_dir="$1"
    local service="$2"
    local now=""
    local until_file=""
    local until_raw=""

    now="$(sfq_now_epoch)"
    until_file="$(sfq_state_file "$runtime_dir" "$service" "cooldown_until")"
    [ -f "$until_file" ] || {
        printf '0\n'
        return 0
    }
    until_raw="$(tr -d '[:space:]' < "$until_file" 2>/dev/null || true)"
    [[ "$until_raw" =~ ^[0-9]+$ ]] || {
        printf '0\n'
        return 0
    }
    if [ "$now" -ge "$until_raw" ]; then
        printf '0\n'
        return 0
    fi
    printf '%s\n' "$((until_raw - now))"
}

sfq_mark_success() {
    local runtime_dir="$1"
    local service="$2"
    rm -f \
        "$(sfq_state_file "$runtime_dir" "$service" "degraded")" \
        "$(sfq_state_file "$runtime_dir" "$service" "cooldown_until")" \
        "$(sfq_state_file "$runtime_dir" "$service" "failcount")" \
        "$(sfq_state_file "$runtime_dir" "$service" "failures")"
}

sfq_record_failure() {
    local runtime_dir="$1"
    local service="$2"
    local log_path="$3"
    local reason="$4"
    local now=""
    local failcount_file=""
    local failures_file=""
    local cooldown_file=""
    local degraded_file=""
    local failcount=0
    local cooldown=60
    local until=0
    local recent_failures=0

    mkdir -p "$runtime_dir"
    now="$(sfq_now_epoch)"
    failcount_file="$(sfq_state_file "$runtime_dir" "$service" "failcount")"
    failures_file="$(sfq_state_file "$runtime_dir" "$service" "failures")"
    cooldown_file="$(sfq_state_file "$runtime_dir" "$service" "cooldown_until")"
    degraded_file="$(sfq_state_file "$runtime_dir" "$service" "degraded")"

    if [ -f "$failcount_file" ]; then
        failcount="$(tr -d '[:space:]' < "$failcount_file" 2>/dev/null || true)"
        [[ "$failcount" =~ ^[0-9]+$ ]] || failcount=0
    fi
    failcount=$((failcount + 1))
    printf '%s\n' "$failcount" > "$failcount_file"

    printf '%s\n' "$now" >> "$failures_file"
    recent_failures="$(awk -v now="$now" '$1 ~ /^[0-9]+$/ && now-$1 <= 3600 {c++} END {print c+0}' "$failures_file" 2>/dev/null)"

    cooldown="$(sfq_backoff_for_failcount "$failcount")"
    [[ "$cooldown" =~ ^[0-9]+$ ]] || cooldown=60
    if [ "$SERVICE_FAIL_MODE" = "fail_quiet" ] && [ "$recent_failures" -ge "$SERVICE_RETRY_MAX_PER_HOUR" ]; then
        cooldown="$SERVICE_DEGRADED_COOLDOWN_SECONDS"
        touch "$degraded_file"
    fi
    until=$((now + cooldown))
    printf '%s\n' "$until" > "$cooldown_file"

    sfq_log "$log_path" "SERVICE_STATE service=$service state=degraded reason=\"$reason\" failcount=$failcount recent_failures=$recent_failures cooldown_seconds=$cooldown retry_after_epoch=$until"
}
