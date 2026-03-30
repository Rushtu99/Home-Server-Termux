#!/data/data/com.termux/files/usr/bin/bash

set -euo pipefail

CHAIN_NAME="${CHAIN_NAME:-HS_LOOPBACK_ONLY}"
PORTS_CSV="${LOOPBACK_LOCKDOWN_TCP_PORTS:-3000,4000,445,2121,3923,5055,5432,6379,6767,7681,7878,8081,8096,8384,8989,9696}"
EXEMPT_PORTS_CSV="${LOOPBACK_LOCKDOWN_EXEMPT_TCP_PORTS:-}"
COMMENT_TAG="${COMMENT_TAG:-home-server-loopback-only}"

normalize_ports() {
    printf '%s' "$1" | tr ', ' '\n' | sed '/^$/d'
}

build_multiport_arg() {
    local port=""
    local -a result=()
    declare -A exempt=()
    declare -A seen=()

    while IFS= read -r port; do
        [[ "$port" =~ ^[0-9]+$ ]] || continue
        exempt["$port"]=1
    done < <(normalize_ports "$EXEMPT_PORTS_CSV")

    while IFS= read -r port; do
        [[ "$port" =~ ^[0-9]+$ ]] || continue
        [ -n "${exempt[$port]:-}" ] && continue
        [ -n "${seen[$port]:-}" ] && continue
        seen["$port"]=1
        result+=("$port")
    done < <(normalize_ports "$PORTS_CSV")

    local IFS=,
    printf '%s' "${result[*]}"
}

run_root() {
    su -c "$1"
}

ensure_chain() {
    local ports
    ports="$(build_multiport_arg)"

    run_root "iptables -N \"$CHAIN_NAME\" 2>/dev/null || true"
    run_root "iptables -F \"$CHAIN_NAME\""
    run_root "iptables -A \"$CHAIN_NAME\" -i lo -j RETURN"
    if [ -n "$ports" ]; then
        run_root "iptables -A \"$CHAIN_NAME\" -p tcp -m multiport --dports \"$ports\" -m comment --comment \"$COMMENT_TAG\" -j REJECT --reject-with tcp-reset"
    fi
    run_root "iptables -C INPUT -j \"$CHAIN_NAME\" >/dev/null 2>&1 || iptables -I INPUT 1 -j \"$CHAIN_NAME\""
}

clear_chain() {
    run_root "iptables -D INPUT -j \"$CHAIN_NAME\" >/dev/null 2>&1 || true"
    run_root "iptables -F \"$CHAIN_NAME\" >/dev/null 2>&1 || true"
    run_root "iptables -X \"$CHAIN_NAME\" >/dev/null 2>&1 || true"
}

status_chain() {
    run_root "iptables -S \"$CHAIN_NAME\" 2>/dev/null"
}

case "${1:-status}" in
    apply|sync)
        ensure_chain
        ;;
    clear)
        clear_chain
        ;;
    status)
        status_chain
        ;;
    *)
        echo "usage: $0 {apply|sync|clear|status}" >&2
        exit 1
        ;;
esac
