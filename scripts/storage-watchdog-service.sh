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
STORAGE_WATCHDOG_INTERVAL_SEC="${STORAGE_WATCHDOG_INTERVAL_SEC:-30}"
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
    MEDIA_VAULT_ROOT="${DRIVES_D_DIR:-$USER_HOME/Drives/D (VAULT_fallback)}/$MEDIA_VAULT_DIR_NAME/$MEDIA_VAULT_MEDIA_SUBDIR"
fi
if [ -z "$MEDIA_SCRATCH_ROOT" ]; then
    MEDIA_SCRATCH_ROOT="${DRIVES_E_DIR:-$USER_HOME/Drives/E (SCRATCH_fallback)}/$MEDIA_SCRATCH_DIR_NAME/$MEDIA_SCRATCH_MEDIA_SUBDIR"
fi
MEDIA_VAULT_ROOTS="${MEDIA_VAULT_ROOTS:-$MEDIA_VAULT_ROOT}"
MEDIA_SCRATCH_ROOTS="${MEDIA_SCRATCH_ROOTS:-$MEDIA_SCRATCH_ROOT}"

JELLYFIN_SERVICE_CMD="${JELLYFIN_SERVICE_CMD:-$PROJECT/scripts/jellyfin-service.sh}"
QBITTORRENT_SERVICE_CMD="${QBITTORRENT_SERVICE_CMD:-$PROJECT/scripts/qbittorrent-service.sh}"
BAZARR_SERVICE_CMD="${BAZARR_SERVICE_CMD:-$PROJECT/scripts/bazarr-service.sh}"
MEDIA_WORKFLOW_SERVICE_CMD="${MEDIA_WORKFLOW_SERVICE_CMD:-$PROJECT/scripts/media-workflow-service.sh}"
MEDIA_IMPORTER_CMD="${MEDIA_IMPORTER_CMD:-$PROJECT/scripts/media-importer.sh}"
QBITTORRENT_BIND_HOST="${QBITTORRENT_BIND_HOST:-127.0.0.1}"
QBITTORRENT_PORT="${QBITTORRENT_PORT:-8081}"
QBITTORRENT_WEBUI_USERNAME="${QBITTORRENT_WEBUI_USERNAME:-}"
QBITTORRENT_WEBUI_PASSWORD="${QBITTORRENT_WEBUI_PASSWORD:-}"
QBIT_FALLBACK_PAUSED_HASHES_FILE="${QBIT_FALLBACK_PAUSED_HASHES_FILE:-$RUNTIME_DIR/qb-fallback-paused.hashes}"
MEDIA_RECONCILE_MIN_INTERVAL_SEC="${MEDIA_RECONCILE_MIN_INTERVAL_SEC:-1800}"
MEDIA_RECONCILE_LAST_EPOCH_FILE="${MEDIA_RECONCILE_LAST_EPOCH_FILE:-$RUNTIME_DIR/media-reconcile.last-epoch}"
MEDIA_RECONCILE_AUTO_IMPORT="${MEDIA_RECONCILE_AUTO_IMPORT:-false}"

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

if type ensure_primary_mounts_checked_cached >/dev/null 2>&1; then
    ensure_primary_mounts_checked_cached "vault,scratch" >/dev/null 2>&1 || true
fi

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

canonical_path_watchdog() {
    local raw_path="$1"
    if [ -e "$raw_path" ]; then
        realpath "$raw_path" 2>/dev/null || realpath -m "$raw_path" 2>/dev/null || printf '%s\n' "$raw_path"
        return 0
    fi
    realpath -m "$raw_path" 2>/dev/null || printf '%s\n' "$raw_path"
}

path_prefix_match_watchdog() {
    local path="$1"
    local parent="$2"
    case "$path" in
        "$parent"|"$parent"/*)
            return 0
            ;;
    esac
    return 1
}

roots_safe_for_reconcile() {
    local vault_resolved=""
    local scratch_resolved=""

    vault_resolved="$(canonical_path_watchdog "$MEDIA_VAULT_ROOT")"
    scratch_resolved="$(canonical_path_watchdog "$MEDIA_SCRATCH_ROOT")"
    [ -n "$vault_resolved" ] || return 1
    [ -n "$scratch_resolved" ] || return 1
    [ "$vault_resolved" = "$scratch_resolved" ] && return 1
    if path_prefix_match_watchdog "$vault_resolved" "$scratch_resolved"; then
        return 1
    fi
    if path_prefix_match_watchdog "$scratch_resolved" "$vault_resolved"; then
        return 1
    fi
    return 0
}

read_last_reconcile_epoch() {
    local raw=""
    [ -f "$MEDIA_RECONCILE_LAST_EPOCH_FILE" ] || {
        printf '0\n'
        return 0
    }
    raw="$(tr -d '[:space:]' < "$MEDIA_RECONCILE_LAST_EPOCH_FILE" 2>/dev/null || true)"
    if [[ "$raw" =~ ^[0-9]+$ ]]; then
        printf '%s\n' "$raw"
        return 0
    fi
    printf '0\n'
}

record_reconcile_epoch() {
    local now_epoch="$1"
    printf '%s\n' "$now_epoch" > "$MEDIA_RECONCILE_LAST_EPOCH_FILE"
}

reconcile_cooldown_elapsed() {
    local last_epoch=0
    local now_epoch=0

    last_epoch="$(read_last_reconcile_epoch)"
    now_epoch="$(date +%s)"
    [ "$MEDIA_RECONCILE_MIN_INTERVAL_SEC" -le 0 ] && return 0
    [ "$now_epoch" -lt "$last_epoch" ] && return 1
    [ $((now_epoch - last_epoch)) -ge "$MEDIA_RECONCILE_MIN_INTERVAL_SEC" ]
}

should_trigger_hdd_reconcile() {
    if [ "$MEDIA_RECONCILE_AUTO_IMPORT" != "true" ]; then
        return 1
    fi
    if [ "$QBIT_FALLBACK_MODE" != "fallback" ] || [ "$1" != "normal" ]; then
        return 1
    fi
    if [ "$VAULT_HEALTHY" -ne 1 ] || [ "$SCRATCH_HEALTHY" -ne 1 ]; then
        log WARN "Skipping hdd-reconcile import because storage health is not stable"
        return 1
    fi
    if ! roots_safe_for_reconcile; then
        log WARN "Skipping hdd-reconcile import because vault/scratch roots overlap or are ambiguous"
        return 1
    fi
    if ! reconcile_cooldown_elapsed; then
        log INFO "Skipping hdd-reconcile import because reconcile cooldown is active"
        return 1
    fi
    return 0
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

reason_count() {
    local reason_text="$1"
    local count=0
    local item=""

    while IFS= read -r item; do
        item="$(printf '%s' "$item" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
        [ -n "$item" ] || continue
        count=$((count + 1))
    done < <(printf '%s\n' "$reason_text" | tr ';' '\n')

    printf '%s\n' "$count"
}

first_reason_item() {
    local reason_text="$1"
    local item=""

    while IFS= read -r item; do
        item="$(printf '%s' "$item" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
        [ -n "$item" ] || continue
        printf '%s\n' "$item"
        return 0
    done < <(printf '%s\n' "$reason_text" | tr ';' '\n')

    return 1
}

summarize_role_reason() {
    local role="$1"
    local reason_text="$2"
    local issue_count=0
    local first_item=""
    local role_label=""

    role_label="$(printf '%s' "$role" | tr '[:upper:]' '[:lower:]')"
    issue_count="$(reason_count "$reason_text")"
    if [ "$issue_count" -le 0 ]; then
        printf '%s issue detected\n' "$role_label"
        return 0
    fi

    first_item="$(first_reason_item "$reason_text" || true)"
    if [ -z "$first_item" ]; then
        printf '%s: %s issue%s\n' "$role_label" "$issue_count" "$([ "$issue_count" -eq 1 ] && printf '' || printf 's')"
        return 0
    fi

    if [ "${#first_item}" -gt 96 ]; then
        first_item="${first_item:0:93}..."
    fi
    printf '%s: %s issue%s (e.g. %s)\n' "$role_label" "$issue_count" "$([ "$issue_count" -eq 1 ] && printf '' || printf 's')" "$first_item"
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
QBIT_FALLBACK_MODE="unknown"

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
    local drive_ok=0
    local root_ok=0
    local drive_reason=""
    local root_reason=""
    local drive_mounted=1
    local drive_writable=1
    local drive=""
    local root_maps_to_drive=0
    local require_drive_health=1

    ROLE_HEALTHY=1
    ROLE_REASON=""
    ROLE_ROOTS=()
    ROLE_DRIVES=()

    csv_to_array "$roots_csv" roots
    if [ "${#roots[@]}" -eq 0 ] && [ -n "$primary_root" ]; then
        roots+=("$primary_root")
    fi

    collect_drive_dirs "$drives_csv" "$roots_csv" "$role_dir" "$subdir" drives

    for item in "${drives[@]}"; do
        ROLE_DRIVES+=("$item")
        if [ ! -d "$item" ]; then
            append_reason drive_reason "$role drive missing: $item"
            continue
        fi
        drive_mounted=1
        if ! path_is_direct_mount "$item"; then
            drive_mounted=0
            append_reason drive_reason "$role drive not mounted: $item"
        fi
        drive_writable=1
        if type is_writable_dir >/dev/null 2>&1 && ! is_writable_dir "$item"; then
            drive_writable=0
            append_reason drive_reason "$role drive not writable: $item"
        fi
        if [ "$drive_mounted" -eq 1 ] && [ "$drive_writable" -eq 1 ]; then
            drive_ok=1
        fi
    done

    if [ "${#roots[@]}" -eq 0 ]; then
        root_reason="No roots configured for role '$role'"
    fi

    for item in "${roots[@]}"; do
        ROLE_ROOTS+=("$item")
        if [ ! -d "$item" ]; then
            append_reason root_reason "$role root missing: $item"
            continue
        fi
        if type is_writable_dir >/dev/null 2>&1 && ! is_writable_dir "$item"; then
            append_reason root_reason "$role root not writable: $item"
            continue
        fi
        root_ok=1
    done

    if [ "$root_ok" -ne 1 ]; then
        ROLE_HEALTHY=0
        if [ -n "$root_reason" ]; then
            append_reason ROLE_REASON "$root_reason"
        else
            append_reason ROLE_REASON "No healthy root found for role '$role'"
        fi
    fi

    if [ "${#roots[@]}" -gt 0 ] && [ "$root_ok" -eq 1 ]; then
        for item in "${roots[@]}"; do
            for drive in "${drives[@]}"; do
                case "$item" in
                    "$drive"|"$drive"/*)
                        root_maps_to_drive=1
                        break
                        ;;
                esac
            done
            if [ "$root_maps_to_drive" -eq 1 ]; then
                break
            fi
        done
        if [ "$root_maps_to_drive" -eq 0 ]; then
            require_drive_health=0
        fi
    fi

    if [ "$require_drive_health" -eq 1 ]; then
        if [ "${#drives[@]}" -eq 0 ]; then
            ROLE_HEALTHY=0
            append_reason ROLE_REASON "No drives resolved for role '$role'"
        elif [ "$drive_ok" -ne 1 ]; then
            ROLE_HEALTHY=0
            if [ -n "$drive_reason" ]; then
                append_reason ROLE_REASON "$drive_reason"
            else
                append_reason ROLE_REASON "No healthy mounted drive found for role '$role'"
            fi
        fi
    fi

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
    local scratch_fallback_ready=0
    local vault_fallback_ready=0

    if role_fallback_usable SCRATCH_ROOTS; then
        scratch_fallback_ready=1
    fi
    if role_fallback_usable VAULT_ROOTS; then
        vault_fallback_ready=1
    fi

    BLOCKED_SERVICES=()
    if [ "$SCRATCH_HEALTHY" -ne 1 ] && [ "$scratch_fallback_ready" -ne 1 ]; then
        array_push_unique BLOCKED_SERVICES "qbittorrent"
        array_push_unique BLOCKED_SERVICES "media-workflow"
    fi
    if [ "$VAULT_HEALTHY" -ne 1 ] && [ "$vault_fallback_ready" -ne 1 ]; then
        array_push_unique BLOCKED_SERVICES "jellyfin"
        array_push_unique BLOCKED_SERVICES "bazarr"
        array_push_unique BLOCKED_SERVICES "media-workflow"
    fi
}

role_has_writable_root() {
    local roots_name="$1"
    local root=""
    local -n roots_ref="$roots_name"

    for root in "${roots_ref[@]}"; do
        [ -d "$root" ] || continue
        if type is_writable_dir >/dev/null 2>&1; then
            if is_writable_dir "$root"; then
                return 0
            fi
            continue
        fi
        return 0
    done

    return 1
}

role_fallback_usable() {
    local roots_name="$1"
    role_has_writable_root "$roots_name"
}

vault_main_mount_ready() {
    [ -n "${DRIVES_D_MAIN_DIR:-}" ] || return 1
    path_is_direct_mount "$DRIVES_D_MAIN_DIR"
}

run_qb_webui_fallback_action() {
    local action="$1"
    local vault_roots_csv="$2"

    command -v node >/dev/null 2>&1 || return 1

    node - "$action" "$QBITTORRENT_BIND_HOST" "$QBITTORRENT_PORT" "$QBITTORRENT_WEBUI_USERNAME" "$QBITTORRENT_WEBUI_PASSWORD" "$vault_roots_csv" "$QBIT_FALLBACK_PAUSED_HASHES_FILE" <<'JS'
const fs = require('fs');
const [action, host, port, username, password, vaultRootsCsv, pausedFile] = process.argv.slice(2);
const base = `http://${host}:${port}`;
const vaultRoots = String(vaultRootsCsv || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => (entry.endsWith('/') ? entry : `${entry}/`));
let sidCookie = '';

const readPausedHashes = () => {
  try {
    return String(fs.readFileSync(pausedFile, 'utf8'))
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
};

const writePausedHashes = (hashes) => {
  const payload = [...new Set(hashes.map((entry) => String(entry || '').trim()).filter(Boolean))];
  if (payload.length === 0) {
    try { fs.unlinkSync(pausedFile); } catch {}
    return;
  }
  fs.writeFileSync(pausedFile, `${payload.join('\n')}\n`);
};

const login = async () => {
  if (!username && !password) return false;
  const body = new URLSearchParams({ username, password });
  const response = await fetch(`${base}/api/v2/auth/login`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
  });
  if (!response.ok) return false;
  const setCookie = response.headers.get('set-cookie') || '';
  const sidPair = setCookie
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith('SID='));
  if (!sidPair) return false;
  sidCookie = sidPair;
  return true;
};

const qbFetch = async (path, options = {}, allowRetry = true) => {
  const headers = { ...(options.headers || {}) };
  if (sidCookie) headers.Cookie = sidCookie;
  const response = await fetch(`${base}${path}`, { ...options, headers });
  if (response.status === 403 && allowRetry) {
    const authed = await login();
    if (authed) {
      return qbFetch(path, options, false);
    }
  }
  return response;
};

const pauseVaultDownloads = async () => {
  const response = await qbFetch('/api/v2/torrents/info');
  if (!response.ok) {
    process.stdout.write('mode=pause action=skip reason=unreachable\n');
    return;
  }
  const torrents = await response.json().catch(() => []);
  const hashesToPause = [];

  for (const torrent of Array.isArray(torrents) ? torrents : []) {
    const hash = String(torrent.hash || '').trim();
    if (!hash) continue;
    const state = String(torrent.state || '').toLowerCase();
    if (state.startsWith('paused') || Number(torrent.progress || 0) >= 1) continue;

    const savePath = String(torrent.save_path || '');
    const contentPath = String(torrent.content_path || '');
    let inVault = savePath.includes('/VAULT/') || contentPath.includes('/VAULT/');
    if (!inVault && vaultRoots.length > 0) {
      const saveNorm = savePath.endsWith('/') ? savePath : `${savePath}/`;
      const contentNorm = contentPath.endsWith('/') ? contentPath : `${contentPath}/`;
      inVault = vaultRoots.some((root) => saveNorm.startsWith(root) || contentNorm.startsWith(root));
    }
    if (!inVault) continue;
    hashesToPause.push(hash);
  }

  if (hashesToPause.length > 0) {
    const body = new URLSearchParams({ hashes: hashesToPause.join('|') });
    const pauseResponse = await qbFetch('/api/v2/torrents/pause', { method: 'POST', body });
    if (!pauseResponse.ok) {
      process.stdout.write(`mode=pause action=error count=${hashesToPause.length}\n`);
      return;
    }
  }

  const knownPaused = readPausedHashes();
  writePausedHashes([...knownPaused, ...hashesToPause]);
  process.stdout.write(`mode=pause action=ok count=${hashesToPause.length}\n`);
};

const resumeFallbackPaused = async () => {
  const pausedHashes = readPausedHashes();
  if (pausedHashes.length === 0) {
    process.stdout.write('mode=resume action=ok count=0\n');
    return;
  }

  const body = new URLSearchParams({ hashes: pausedHashes.join('|') });
  const response = await qbFetch('/api/v2/torrents/resume', { method: 'POST', body });
  if (!response.ok) {
    process.stdout.write(`mode=resume action=error count=${pausedHashes.length}\n`);
    return;
  }
  writePausedHashes([]);
  process.stdout.write(`mode=resume action=ok count=${pausedHashes.length}\n`);
};

if (action === 'pause') {
  pauseVaultDownloads().catch(() => process.stdout.write('mode=pause action=error count=0\n'));
} else if (action === 'resume') {
  resumeFallbackPaused().catch(() => process.stdout.write('mode=resume action=error count=0\n'));
} else {
  process.stdout.write('mode=unknown action=skip\n');
}
JS
}

enforce_qb_fallback_policy() {
    local mode="fallback"
    local action_result=""
    local vault_roots_csv=""
    local now_epoch=0

    if vault_main_mount_ready; then
        mode="normal"
    fi

    vault_roots_csv="$(join_csv VAULT_ROOTS)"
    if service_is_running "qbittorrent"; then
        if [ "$mode" = "fallback" ]; then
            action_result="$(run_qb_webui_fallback_action "pause" "$vault_roots_csv" 2>/dev/null || true)"
            if printf '%s' "$action_result" | grep -Fq 'action=ok'; then
                log INFO "qB fallback policy active; vault-target downloads paused as needed"
            fi
        elif [ "$QBIT_FALLBACK_MODE" = "fallback" ]; then
            action_result="$(run_qb_webui_fallback_action "resume" "$vault_roots_csv" 2>/dev/null || true)"
            if printf '%s' "$action_result" | grep -Fq 'action=ok'; then
                log INFO "qB fallback policy cleared; previously paused vault downloads resumed"
            fi
        fi
    fi

    if should_trigger_hdd_reconcile "$mode" && [ -x "$MEDIA_IMPORTER_CMD" ]; then
        "$MEDIA_IMPORTER_CMD" import --trigger hdd-reconcile >/dev/null 2>&1 || true
        now_epoch="$(date +%s)"
        record_reconcile_epoch "$now_epoch"
        log INFO "Triggered media import reconcile after external mount recovery"
    fi

    QBIT_FALLBACK_MODE="$mode"
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

    if type ensure_primary_mounts_checked_cached >/dev/null 2>&1; then
        ensure_primary_mounts_checked_cached "vault,scratch" >/dev/null 2>&1 || true
    fi

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
        local vault_summary=""
        local scratch_summary=""
        vault_summary="$(summarize_role_reason "vault" "$VAULT_REASON")"
        scratch_summary="$(summarize_role_reason "scratch" "$SCRATCH_REASON")"
        if [ "$VAULT_HEALTHY" -ne 1 ] && [ "$SCRATCH_HEALTHY" -ne 1 ]; then
            reason="Vault and scratch degraded ($vault_summary; $scratch_summary)"
        elif [ "$VAULT_HEALTHY" -ne 1 ]; then
            reason="Vault degraded ($vault_summary)"
        else
            reason="Scratch degraded ($scratch_summary)"
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

    enforce_qb_fallback_policy

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

status_service() {
    local mode="${1:-text}"
    local running=0
    local pid=""
    if is_running; then
        running=1
        pid="$(cat "$STORAGE_WATCHDOG_PID_PATH" 2>/dev/null || true)"
    fi

    if [ "$mode" = "json" ]; then
        printf '{\n'
        printf '  "service": "storage-watchdog",\n'
        printf '  "running": %s,\n' "$([ "$running" -eq 1 ] && printf 'true' || printf 'false')"
        printf '  "pid": %s,\n' "$([ -n "$pid" ] && printf '%s' "$pid" || printf 'null')"
        printf '  "stateFile": "%s",\n' "$(json_escape "$STORAGE_WATCHDOG_STATE_FILE")"
        printf '  "eventsFile": "%s",\n' "$(json_escape "$STORAGE_WATCHDOG_EVENTS_FILE")"
        printf '  "intervalSec": %s\n' "$STORAGE_WATCHDOG_INTERVAL_SEC"
        printf '}\n'
        return 0
    fi

    if [ "$running" -eq 1 ]; then
        printf 'running (pid %s)\n' "$pid"
    else
        printf 'stopped\n'
    fi
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
        if [ "${2:-}" = "--json" ]; then
            status_service json
        else
            status_service text
        fi
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
