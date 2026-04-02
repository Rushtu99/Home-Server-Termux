#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

USER_HOME="${HOME:-/data/data/com.termux/files/home}"
PROJECT="${PROJECT:-$USER_HOME/home-server}"
SERVER_ENV_FILE="${SERVER_ENV_FILE:-$PROJECT/server/.env}"
if [ -f "$PROJECT/scripts/drive-common.sh" ]; then
    . "$PROJECT/scripts/drive-common.sh"
fi
RUNTIME_DIR="${RUNTIME_DIR:-$PROJECT/runtime}"
LOG_DIR="${LOG_DIR:-$PROJECT/logs}"
STORAGE_WATCHDOG_INTERVAL_SEC="${STORAGE_WATCHDOG_INTERVAL_SEC:-8}"
STORAGE_WATCHDOG_STABLE_HEALTH_CHECKS="${STORAGE_WATCHDOG_STABLE_HEALTH_CHECKS:-2}"
STORAGE_WATCHDOG_PID_PATH="${STORAGE_WATCHDOG_PID_PATH:-$RUNTIME_DIR/storage-watchdog.pid}"
STORAGE_WATCHDOG_LOG_PATH="${STORAGE_WATCHDOG_LOG_PATH:-$LOG_DIR/storage-watchdog.log}"
STORAGE_WATCHDOG_STATE_FILE="${STORAGE_WATCHDOG_STATE_FILE:-$RUNTIME_DIR/storage-watchdog-state.json}"
STORAGE_WATCHDOG_EVENTS_FILE="${STORAGE_WATCHDOG_EVENTS_FILE:-$RUNTIME_DIR/storage-watchdog-events.jsonl}"

MEDIA_VAULT_DRIVES="${MEDIA_VAULT_DRIVES:-D}"
MEDIA_SCRATCH_DRIVES="${MEDIA_SCRATCH_DRIVES:-E}"
MEDIA_VAULT_DIR_NAME="${MEDIA_VAULT_DIR_NAME:-VAULT}"
MEDIA_SCRATCH_DIR_NAME="${MEDIA_SCRATCH_DIR_NAME:-SCRATCH}"
MEDIA_VAULT_MEDIA_SUBDIR="${MEDIA_VAULT_MEDIA_SUBDIR:-Media}"
MEDIA_SCRATCH_MEDIA_SUBDIR="${MEDIA_SCRATCH_MEDIA_SUBDIR:-HmSTxScratch}"
MEDIA_ROOT="${MEDIA_ROOT:-$USER_HOME/Drives/Media}"
DEFAULT_VAULT_DRIVE_DIR=""
DEFAULT_SCRATCH_DRIVE_DIR=""
if type resolve_drive_dir >/dev/null 2>&1; then
    DEFAULT_VAULT_DRIVE_DIR="$(resolve_drive_dir "${MEDIA_VAULT_DRIVES%%,*}" || true)"
    DEFAULT_SCRATCH_DRIVE_DIR="$(resolve_drive_dir "${MEDIA_SCRATCH_DRIVES%%,*}" || true)"
fi
MEDIA_VAULT_ROOT="${MEDIA_VAULT_ROOT:-${DEFAULT_VAULT_DRIVE_DIR:+$DEFAULT_VAULT_DRIVE_DIR/$MEDIA_VAULT_DIR_NAME/$MEDIA_VAULT_MEDIA_SUBDIR}}"
MEDIA_SCRATCH_ROOT="${MEDIA_SCRATCH_ROOT:-${DEFAULT_SCRATCH_DRIVE_DIR:+$DEFAULT_SCRATCH_DRIVE_DIR/$MEDIA_SCRATCH_DIR_NAME/$MEDIA_SCRATCH_MEDIA_SUBDIR}}"
if [ -z "$MEDIA_VAULT_ROOT" ]; then
    MEDIA_VAULT_ROOT="${DRIVES_D_DIR:-$USER_HOME/Drives/D}/$MEDIA_VAULT_DIR_NAME/$MEDIA_VAULT_MEDIA_SUBDIR"
fi
if [ -z "$MEDIA_SCRATCH_ROOT" ]; then
    MEDIA_SCRATCH_ROOT="${DRIVES_E_DIR:-$USER_HOME/Drives/E}/$MEDIA_SCRATCH_DIR_NAME/$MEDIA_SCRATCH_MEDIA_SUBDIR"
fi
MEDIA_VAULT_ROOTS="${MEDIA_VAULT_ROOTS:-$MEDIA_VAULT_ROOT}"
MEDIA_SCRATCH_ROOTS="${MEDIA_SCRATCH_ROOTS:-$MEDIA_SCRATCH_ROOT}"

JELLYFIN_SERVICE_CMD="${JELLYFIN_SERVICE_CMD:-$PROJECT/scripts/jellyfin-service.sh}"
QBITTORRENT_SERVICE_CMD="${QBITTORRENT_SERVICE_CMD:-$PROJECT/scripts/qbittorrent-service.sh}"
BAZARR_SERVICE_CMD="${BAZARR_SERVICE_CMD:-$PROJECT/scripts/bazarr-service.sh}"
MEDIA_WORKFLOW_SERVICE_CMD="${MEDIA_WORKFLOW_SERVICE_CMD:-$PROJECT/scripts/media-workflow-service.sh}"

load_shell_env_file() {
    local env_file="$1"
    local line="" key="" value=""

    [ -f "$env_file" ] || return 0

    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%$'\r'}"
        case "$line" in
            ''|\#*) continue ;;
        esac
        key="${line%%=*}"
        value="${line#*=}"
        key="${key#"${key%%[![:space:]]*}"}"
        key="${key%"${key##*[![:space:]]}"}"
        if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
            continue
        fi
        case "$value" in
            \"*\") value="${value#\"}"; value="${value%\"}" ;;
            \'*\') value="${value#\'}"; value="${value%\'}" ;;
        esac
        export "$key=$value"
    done < "$env_file"
}

load_shell_env_file "$SERVER_ENV_FILE"

mkdir -p "$RUNTIME_DIR" "$LOG_DIR"

timestamp() {
    date '+%Y-%m-%d %H:%M:%S'
}

timestamp_iso() {
    date -u '+%Y-%m-%dT%H:%M:%SZ'
}

log() {
    local level="$1"
    local message="$2"
    printf '[%s] %5s %s\n' "$(timestamp)" "$level" "$message" >> "$STORAGE_WATCHDOG_LOG_PATH"
}

json_escape() {
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\r//g; s/\n/\\n/g'
}

normalize_csv_list() {
    local input="$1"
    printf '%s\n' "$input" | tr ';' ',' | tr '\n' ',' | tr -s ',' | sed 's/^,*//; s/,*$//'
}

csv_to_array() {
    local csv="$1"
    local out_name="$2"
    local token=""
    local -n out_ref="$out_name"

    out_ref=()
    csv="$(normalize_csv_list "$csv")"
    [ -n "$csv" ] || return 0

    while IFS= read -r token; do
        token="$(printf '%s' "$token" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
        [ -n "$token" ] || continue
        out_ref+=("$token")
    done < <(printf '%s\n' "$csv" | tr ',' '\n')
}

array_contains() {
    local needle="$1"
    shift
    local item=""

    for item in "$@"; do
        if [ "$item" = "$needle" ]; then
            return 0
        fi
    done

    return 1
}

array_push_unique() {
    local out_name="$1"
    local value="$2"
    local -n out_ref="$out_name"

    if ! array_contains "$value" "${out_ref[@]}"; then
        out_ref+=("$value")
    fi
}

array_remove_value() {
    local out_name="$1"
    local value="$2"
    local -n out_ref="$out_name"
    local next=()
    local item=""

    for item in "${out_ref[@]}"; do
        if [ "$item" != "$value" ]; then
            next+=("$item")
        fi
    done
    out_ref=("${next[@]}")
}

join_csv() {
    local out_name="$1"
    local -n out_ref="$out_name"
    local IFS=','
    printf '%s\n' "${out_ref[*]}"
}

append_reason() {
    local out_name="$1"
    local message="$2"
    local -n out_ref="$out_name"

    if [ -z "$out_ref" ]; then
        out_ref="$message"
    else
        out_ref="$out_ref; $message"
    fi
}

path_is_direct_mount() {
    local target="$1"
    if type path_is_direct_mount_in_proc >/dev/null 2>&1; then
        path_is_direct_mount_in_proc "$target"
        return $?
    fi
    grep -Fq " $target " /proc/mounts 2>/dev/null
}

resolve_candidate_drive_dirs() {
    local candidates_csv="$1"
    local out_name="$2"
    local candidate_tokens=()
    local token=""
    local resolved=""
    local candidate=""
    local -n out_ref="$out_name"

    out_ref=()
    csv_to_array "$candidates_csv" candidate_tokens
    for token in "${candidate_tokens[@]}"; do
        resolved=""
        if type resolve_drive_dir >/dev/null 2>&1; then
            resolved="$(resolve_drive_dir "$token" || true)"
        fi
        if [ -z "$resolved" ]; then
            case "$token" in
                /*) candidate="$token" ;;
                *) candidate="${DRIVES_DIR:-$USER_HOME/Drives}/$token" ;;
            esac
            if [ -d "$candidate" ]; then
                resolved="$candidate"
            fi
        fi
        [ -n "$resolved" ] || continue
        array_push_unique "$out_name" "$resolved"
    done
}

derive_drive_dir_from_root() {
    local root="$1"
    local role_dir="$2"
    local subdir="$3"
    local suffix="/$role_dir/$subdir"
    local base=""

    case "$root" in
        *"$suffix")
            base="${root%"$suffix"}"
            [ -d "$base" ] && printf '%s\n' "$base"
            ;;
    esac
}

collect_drive_dirs() {
    local drives_csv="$1"
    local roots_csv="$2"
    local role_dir="$3"
    local subdir="$4"
    local out_name="$5"
    local drive_dirs=()
    local root_tokens=()
    local root=""
    local derived=""
    local -n out_ref="$out_name"

    out_ref=()
    resolve_candidate_drive_dirs "$drives_csv" drive_dirs
    for root in "${drive_dirs[@]}"; do
        array_push_unique "$out_name" "$root"
    done

    csv_to_array "$roots_csv" root_tokens
    for root in "${root_tokens[@]}"; do
        derived="$(derive_drive_dir_from_root "$root" "$role_dir" "$subdir" || true)"
        [ -n "$derived" ] || continue
        array_push_unique "$out_name" "$derived"
    done
}

service_script_for() {
    case "$1" in
        jellyfin) printf '%s\n' "$JELLYFIN_SERVICE_CMD" ;;
        qbittorrent) printf '%s\n' "$QBITTORRENT_SERVICE_CMD" ;;
        bazarr) printf '%s\n' "$BAZARR_SERVICE_CMD" ;;
        media-workflow) printf '%s\n' "$MEDIA_WORKFLOW_SERVICE_CMD" ;;
        *) return 1 ;;
    esac
}

service_is_running() {
    local service="$1"
    local script_path=""
    script_path="$(service_script_for "$service" 2>/dev/null || true)"
    [ -n "$script_path" ] || return 1
    [ -x "$script_path" ] || return 1
    "$script_path" status >/dev/null 2>&1
}

stop_service_if_running() {
    local service="$1"
    local script_path=""
    script_path="$(service_script_for "$service" 2>/dev/null || true)"
    [ -n "$script_path" ] || return 1
    [ -x "$script_path" ] || return 1

    if ! "$script_path" status >/dev/null 2>&1; then
        return 1
    fi
    "$script_path" stop >/dev/null 2>&1 || true
    return 0
}

json_array_from_csv() {
    local csv="$1"
    local values=()
    local value=""
    local first=1
    local escaped=""

    csv_to_array "$csv" values
    printf '['
    for value in "${values[@]}"; do
        escaped="$(json_escape "$value")"
        if [ "$first" -eq 1 ]; then
            printf '"%s"' "$escaped"
            first=0
        else
            printf ',"%s"' "$escaped"
        fi
    done
    printf ']'
}

append_event() {
    local level="$1"
    local event="$2"
    local state="$3"
    local reason="$4"
    local blocked_csv="$5"
    local stopped_csv="$6"
    local timestamp_utc=""
    local reason_json=""
    local blocked_json=""
    local stopped_json=""

    timestamp_utc="$(timestamp_iso)"
    reason_json="$(json_escape "$reason")"
    blocked_json="$(json_array_from_csv "$blocked_csv")"
    stopped_json="$(json_array_from_csv "$stopped_csv")"

    printf '{"timestamp":"%s","level":"%s","event":"%s","state":"%s","reason":"%s","blockedServices":%s,"stoppedByWatchdog":%s}\n' \
        "$timestamp_utc" \
        "$level" \
        "$(json_escape "$event")" \
        "$(json_escape "$state")" \
        "$reason_json" \
        "$blocked_json" \
        "$stopped_json" >> "$STORAGE_WATCHDOG_EVENTS_FILE"
}

write_state_file() {
    local state="$1"
    local overall_healthy="$2"
    local reason="$3"
    local blocked_csv="$4"
    local stopped_csv="$5"
    local resume_required="$6"
    local healthy_streak="$7"
    local generated_at="$8"
    local last_transition_at="$9"
    local last_healthy_at="${10}"
    local last_degraded_at="${11}"
    local vault_healthy="${12}"
    local vault_reason="${13}"
    local scratch_healthy="${14}"
    local scratch_reason="${15}"
    local vault_roots_csv="${16}"
    local scratch_roots_csv="${17}"
    local vault_drives_csv="${18}"
    local scratch_drives_csv="${19}"
    local tmp_file=""
    local blocked_json=""
    local stopped_json=""
    local vault_roots_json=""
    local scratch_roots_json=""
    local vault_drives_json=""
    local scratch_drives_json=""

    blocked_json="$(json_array_from_csv "$blocked_csv")"
    stopped_json="$(json_array_from_csv "$stopped_csv")"
    vault_roots_json="$(json_array_from_csv "$vault_roots_csv")"
    scratch_roots_json="$(json_array_from_csv "$scratch_roots_csv")"
    vault_drives_json="$(json_array_from_csv "$vault_drives_csv")"
    scratch_drives_json="$(json_array_from_csv "$scratch_drives_csv")"
    tmp_file="$(mktemp "$RUNTIME_DIR/storage-watchdog-state.XXXXXX")"

    cat > "$tmp_file" <<EOF
{
  "schema": 1,
  "generatedAt": "$(json_escape "$generated_at")",
  "state": "$(json_escape "$state")",
  "overallHealthy": $overall_healthy,
  "healthyStreak": $healthy_streak,
  "manualResume": true,
  "resumeRequired": $resume_required,
  "lastTransitionAt": "$(json_escape "$last_transition_at")",
  "lastHealthyAt": "$(json_escape "$last_healthy_at")",
  "lastDegradedAt": "$(json_escape "$last_degraded_at")",
  "reason": "$(json_escape "$reason")",
  "blockedServices": $blocked_json,
  "stoppedByWatchdog": $stopped_json,
  "vault": {
    "healthy": $vault_healthy,
    "reason": "$(json_escape "$vault_reason")",
    "roots": $vault_roots_json,
    "drives": $vault_drives_json
  },
  "scratch": {
    "healthy": $scratch_healthy,
    "reason": "$(json_escape "$scratch_reason")",
    "roots": $scratch_roots_json,
    "drives": $scratch_drives_json
  }
}
EOF

    mv -f "$tmp_file" "$STORAGE_WATCHDOG_STATE_FILE"
}

load_existing_state() {
    local loaded=""
    local parsed=()

    CURRENT_STATE="unknown"
    LAST_TRANSITION_AT=""
    LAST_HEALTHY_AT=""
    LAST_DEGRADED_AT=""
    HEALTHY_STREAK=0
    BLOCKED_SERVICES=()
    STOPPED_BY_WATCHDOG=()

    [ -f "$STORAGE_WATCHDOG_STATE_FILE" ] || return 0
    if ! command -v node >/dev/null 2>&1; then
        return 0
    fi

    loaded="$(node -e '
const fs = require("fs");
const filePath = process.argv[1];
try {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const out = {
    state: String(raw.state || "unknown"),
    transition: String(raw.lastTransitionAt || ""),
    lastHealthyAt: String(raw.lastHealthyAt || ""),
    lastDegradedAt: String(raw.lastDegradedAt || ""),
    healthyStreak: Number(raw.healthyStreak || 0) || 0,
    blocked: Array.isArray(raw.blockedServices) ? raw.blockedServices.map(String).join(",") : "",
    stopped: Array.isArray(raw.stoppedByWatchdog) ? raw.stoppedByWatchdog.map(String).join(",") : ""
  };
  process.stdout.write(JSON.stringify(out));
} catch {
  process.stdout.write("");
}
' "$STORAGE_WATCHDOG_STATE_FILE" 2>/dev/null || true)"

    [ -n "$loaded" ] || return 0
    mapfile -t parsed < <(node -e '
const payload = JSON.parse(process.argv[1]);
console.log(payload.state || "unknown");
console.log(payload.transition || "");
console.log(payload.lastHealthyAt || "");
console.log(payload.lastDegradedAt || "");
console.log(String(payload.healthyStreak || 0));
console.log(payload.blocked || "");
console.log(payload.stopped || "");
' "$loaded")

    CURRENT_STATE="${parsed[0]:-unknown}"
    LAST_TRANSITION_AT="${parsed[1]:-}"
    LAST_HEALTHY_AT="${parsed[2]:-}"
    LAST_DEGRADED_AT="${parsed[3]:-}"
    HEALTHY_STREAK="${parsed[4]:-0}"
    csv_to_array "${parsed[5]:-}" BLOCKED_SERVICES
    csv_to_array "${parsed[6]:-}" STOPPED_BY_WATCHDOG
}

ROLE_HEALTHY=1
ROLE_REASON=""
ROLE_ROOTS=()
ROLE_DRIVES=()

check_role_health() {
    local role="$1"
    local roots_csv="$2"
    local drives_csv="$3"
    local role_dir="$4"
    local subdir="$5"
    local primary_root="$6"
    local compat_names_csv="$7"
    local roots=()
    local drives=()
    local compat_names=()
    local item=""
    local link_path=""
    local link_target=""

    ROLE_HEALTHY=1
    ROLE_REASON=""
    ROLE_ROOTS=()
    ROLE_DRIVES=()

    csv_to_array "$roots_csv" roots
    if [ "${#roots[@]}" -eq 0 ] && [ -n "$primary_root" ]; then
        roots+=("$primary_root")
    fi

    collect_drive_dirs "$drives_csv" "$roots_csv" "$role_dir" "$subdir" drives

    if [ "${#drives[@]}" -eq 0 ]; then
        ROLE_HEALTHY=0
        append_reason ROLE_REASON "No drives resolved for role '$role'"
    fi

    for item in "${drives[@]}"; do
        ROLE_DRIVES+=("$item")
        if [ ! -d "$item" ]; then
            ROLE_HEALTHY=0
            append_reason ROLE_REASON "$role drive missing: $item"
            continue
        fi
        if ! path_is_direct_mount "$item"; then
            ROLE_HEALTHY=0
            append_reason ROLE_REASON "$role drive not mounted: $item"
        fi
        if type is_writable_dir >/dev/null 2>&1 && ! is_writable_dir "$item"; then
            ROLE_HEALTHY=0
            append_reason ROLE_REASON "$role drive not writable: $item"
        fi
    done

    if [ "${#roots[@]}" -eq 0 ]; then
        ROLE_HEALTHY=0
        append_reason ROLE_REASON "No roots configured for role '$role'"
    fi

    for item in "${roots[@]}"; do
        ROLE_ROOTS+=("$item")
        if [ ! -d "$item" ]; then
            ROLE_HEALTHY=0
            append_reason ROLE_REASON "$role root missing: $item"
            continue
        fi
        if type is_writable_dir >/dev/null 2>&1 && ! is_writable_dir "$item"; then
            ROLE_HEALTHY=0
            append_reason ROLE_REASON "$role root not writable: $item"
        fi
    done

    csv_to_array "$compat_names_csv" compat_names
    for item in "${compat_names[@]}"; do
        link_path="$MEDIA_ROOT/$item"
        if [ ! -e "$link_path" ]; then
            ROLE_HEALTHY=0
            append_reason ROLE_REASON "Compatibility link missing: $link_path"
            continue
        fi
        if [ ! -L "$link_path" ]; then
            ROLE_HEALTHY=0
            append_reason ROLE_REASON "Compatibility path is not a symlink: $link_path"
            continue
        fi
        link_target="$(readlink -f "$link_path" 2>/dev/null || true)"
        if [ -z "$link_target" ] || [ ! -e "$link_target" ]; then
            ROLE_HEALTHY=0
            append_reason ROLE_REASON "Compatibility target unavailable: $link_path"
            continue
        fi
        if [ -n "$primary_root" ]; then
            case "$link_target" in
                "$primary_root"/*) ;;
                *)
                    ROLE_HEALTHY=0
                    append_reason ROLE_REASON "Compatibility target drifted for $link_path"
                    ;;
            esac
        fi
    done
}

compute_blocked_services() {
    BLOCKED_SERVICES=()
    if [ "$SCRATCH_HEALTHY" -ne 1 ]; then
        array_push_unique BLOCKED_SERVICES "qbittorrent"
        array_push_unique BLOCKED_SERVICES "media-workflow"
    fi
    if [ "$VAULT_HEALTHY" -ne 1 ]; then
        array_push_unique BLOCKED_SERVICES "jellyfin"
        array_push_unique BLOCKED_SERVICES "bazarr"
        array_push_unique BLOCKED_SERVICES "media-workflow"
    fi
}

enforce_blocked_services() {
    local service=""
    for service in "${BLOCKED_SERVICES[@]}"; do
        if stop_service_if_running "$service"; then
            array_push_unique STOPPED_BY_WATCHDOG "$service"
            log WARN "Stopped $service due to degraded storage health"
        fi
    done
}

prune_resumed_services() {
    local remaining=()
    local service=""
    for service in "${STOPPED_BY_WATCHDOG[@]}"; do
        if service_is_running "$service"; then
            log INFO "Detected manual resume for $service"
        else
            remaining+=("$service")
        fi
    done
    STOPPED_BY_WATCHDOG=("${remaining[@]}")
}

run_health_cycle() {
    local now_utc=""
    local blocked_csv=""
    local stopped_csv=""
    local vault_roots_csv=""
    local scratch_roots_csv=""
    local vault_drives_csv=""
    local scratch_drives_csv=""
    local next_state=""
    local overall_healthy=0
    local previous_state="$CURRENT_STATE"
    local reason=""
    local resume_required=0

    now_utc="$(timestamp_iso)"

    check_role_health \
        "vault" \
        "$MEDIA_VAULT_ROOTS" \
        "$MEDIA_VAULT_DRIVES" \
        "$MEDIA_VAULT_DIR_NAME" \
        "$MEDIA_VAULT_MEDIA_SUBDIR" \
        "$MEDIA_VAULT_ROOT" \
        "movies,series,music,audiobooks"
    VAULT_HEALTHY="$ROLE_HEALTHY"
    VAULT_REASON="$ROLE_REASON"
    VAULT_ROOTS=("${ROLE_ROOTS[@]}")
    VAULT_DRIVES=("${ROLE_DRIVES[@]}")

    check_role_health \
        "scratch" \
        "$MEDIA_SCRATCH_ROOTS" \
        "$MEDIA_SCRATCH_DRIVES" \
        "$MEDIA_SCRATCH_DIR_NAME" \
        "$MEDIA_SCRATCH_MEDIA_SUBDIR" \
        "$MEDIA_SCRATCH_ROOT" \
        "downloads,iptv-cache,iptv-epg"
    SCRATCH_HEALTHY="$ROLE_HEALTHY"
    SCRATCH_REASON="$ROLE_REASON"
    SCRATCH_ROOTS=("${ROLE_ROOTS[@]}")
    SCRATCH_DRIVES=("${ROLE_DRIVES[@]}")

    if [ "$VAULT_HEALTHY" -eq 1 ] && [ "$SCRATCH_HEALTHY" -eq 1 ]; then
        overall_healthy=1
        HEALTHY_STREAK=$((HEALTHY_STREAK + 1))
        compute_blocked_services
        if [ "${#BLOCKED_SERVICES[@]}" -eq 0 ] && [ "$HEALTHY_STREAK" -ge "$STORAGE_WATCHDOG_STABLE_HEALTH_CHECKS" ]; then
            prune_resumed_services
            if [ "${#STOPPED_BY_WATCHDOG[@]}" -gt 0 ]; then
                resume_required=1
            fi
            if [ "$previous_state" = "degraded" ]; then
                next_state="recovered"
                LAST_TRANSITION_AT="$now_utc"
                LAST_HEALTHY_AT="$now_utc"
            elif [ "$previous_state" = "recovered" ]; then
                next_state="recovered"
                LAST_HEALTHY_AT="$now_utc"
            else
                next_state="healthy"
                if [ -z "$LAST_TRANSITION_AT" ]; then
                    LAST_TRANSITION_AT="$now_utc"
                fi
                LAST_HEALTHY_AT="$now_utc"
            fi
            reason="Storage healthy"
        else
            next_state="degraded"
            reason="Waiting for stable recovery checks (${HEALTHY_STREAK}/${STORAGE_WATCHDOG_STABLE_HEALTH_CHECKS})"
        fi
    else
        overall_healthy=0
        HEALTHY_STREAK=0
        compute_blocked_services
        enforce_blocked_services
        next_state="degraded"
        LAST_DEGRADED_AT="$now_utc"
        if [ "$VAULT_HEALTHY" -ne 1 ] && [ "$SCRATCH_HEALTHY" -ne 1 ]; then
            reason="Vault and scratch degraded"
        elif [ "$VAULT_HEALTHY" -ne 1 ]; then
            reason="Vault degraded"
        else
            reason="Scratch degraded"
        fi
        if [ -n "$VAULT_REASON" ]; then
            reason="$reason: $VAULT_REASON"
        fi
        if [ -n "$SCRATCH_REASON" ]; then
            reason="$reason: $SCRATCH_REASON"
        fi
        if [ "$previous_state" != "degraded" ]; then
            LAST_TRANSITION_AT="$now_utc"
        fi
    fi

    if [ "$next_state" != "$CURRENT_STATE" ]; then
        LAST_TRANSITION_AT="$now_utc"
        if [ "$next_state" = "degraded" ]; then
            append_event "warn" "storage_degraded" "$next_state" "$reason" "$(join_csv BLOCKED_SERVICES)" "$(join_csv STOPPED_BY_WATCHDOG)"
            log WARN "$reason"
        elif [ "$next_state" = "recovered" ]; then
            append_event "info" "storage_recovered" "$next_state" "$reason" "" "$(join_csv STOPPED_BY_WATCHDOG)"
            log INFO "Storage recovered; manual resume required for stopped services"
        else
            append_event "info" "storage_healthy" "$next_state" "$reason" "" ""
            log INFO "Storage healthy"
        fi
    fi

    CURRENT_STATE="$next_state"
    blocked_csv="$(join_csv BLOCKED_SERVICES)"
    stopped_csv="$(join_csv STOPPED_BY_WATCHDOG)"
    vault_roots_csv="$(join_csv VAULT_ROOTS)"
    scratch_roots_csv="$(join_csv SCRATCH_ROOTS)"
    vault_drives_csv="$(join_csv VAULT_DRIVES)"
    scratch_drives_csv="$(join_csv SCRATCH_DRIVES)"

    write_state_file \
        "$CURRENT_STATE" \
        "$overall_healthy" \
        "$reason" \
        "$blocked_csv" \
        "$stopped_csv" \
        "$resume_required" \
        "$HEALTHY_STREAK" \
        "$now_utc" \
        "$LAST_TRANSITION_AT" \
        "$LAST_HEALTHY_AT" \
        "$LAST_DEGRADED_AT" \
        "$VAULT_HEALTHY" \
        "$VAULT_REASON" \
        "$SCRATCH_HEALTHY" \
        "$SCRATCH_REASON" \
        "$vault_roots_csv" \
        "$scratch_roots_csv" \
        "$vault_drives_csv" \
        "$scratch_drives_csv"
}

is_running() {
    local pid=""
    [ -f "$STORAGE_WATCHDOG_PID_PATH" ] || return 1
    pid="$(cat "$STORAGE_WATCHDOG_PID_PATH" 2>/dev/null || true)"
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

run_loop() {
    load_existing_state
    while true; do
        run_health_cycle
        sleep "$STORAGE_WATCHDOG_INTERVAL_SEC"
    done
}

start_service() {
    if is_running; then
        return 0
    fi

    if command -v setsid >/dev/null 2>&1; then
        setsid bash -lc "exec '$0' run-loop" >/dev/null 2>&1 < /dev/null &
    else
        nohup bash -lc "exec '$0' run-loop" >/dev/null 2>&1 &
    fi
    printf '%s\n' "$!" > "$STORAGE_WATCHDOG_PID_PATH"
}

stop_service() {
    local pid=""

    if [ ! -f "$STORAGE_WATCHDOG_PID_PATH" ]; then
        return 0
    fi

    pid="$(cat "$STORAGE_WATCHDOG_PID_PATH" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" >/dev/null 2>&1 || true
        sleep 1
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" >/dev/null 2>&1 || true
        fi
    fi

    rm -f "$STORAGE_WATCHDOG_PID_PATH"
}

run_once() {
    load_existing_state
    run_health_cycle
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
    run-loop)
        run_loop
        ;;
    run-once|check-now)
        run_once
        ;;
    *)
        echo "usage: $0 {start|stop|restart|status|run-once|check-now}" >&2
        exit 1
        ;;
esac
