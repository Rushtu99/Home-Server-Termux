# Configuration

## Security

The most important settings live in [server/.env.example](../server/.env.example):

- `JWT_SECRET`: JWT signing key
- `APP_AUTH_SECRET`: secondary auth/session secret
- `DASHBOARD_USER`: initial admin username
- `DASHBOARD_PASS`: initial admin password used only when the user DB is empty
- `ADMIN_ACTION_PASSWORD`: separate unlock password for protected actions
- `STRICT_BOOTSTRAP=true`: fail closed when placeholder secrets/passwords are still present

Do not lower the bar here. The server intentionally warns or aborts on default bootstrap values.

## Network

Core ports and bind hosts:
- `BACKEND_BIND_HOST`, `PORT`
- `FRONTEND_BIND_HOST`, `FRONTEND_PORT`
- `TTYD_BIND_HOST`
- `LLM_BIND_HOST`, `LLM_PORT`
- service-specific bind hosts and ports for Jellyfin, qBittorrent, ARR services, Redis, PostgreSQL, and Syncthing

The intended public surface is still nginx on `:8088`. For remote access, prefer Tailscale and keep the tailnet entrypoints limited to the gateway on `:8088` and SSH on `:8022`.

Tailscale settings:
- `TAILSCALE_MODE=disabled|android_app|managed_daemon`
- `TAILSCALE_DNS_NAME`, `TAILSCALE_IP` for stable app-mode links
- `TAILSCALE_GATEWAY_PORT`, `TAILSCALE_SSH_PORT`
- `TAILSCALE_EXPOSE_GATEWAY`, `TAILSCALE_EXPOSE_SSH`
- managed mode only: `TAILSCALE_BIN`, `TAILSCALED_BIN`, `TAILSCALE_STATE_DIR`, `TAILSCALE_SOCKET`, `TAILSCALE_STATE_PATH`, `TAILSCALE_AUTH_KEY`, `TAILSCALE_HOSTNAME`

On this Android/Termux host, `android_app` is the primary supported mode. `managed_daemon` requires both CLI binaries and a working `/dev/net/tun`; otherwise it should be treated as unsupported and the UI will report degraded remote access.

## Storage and Media Layout

Key storage env vars:
- `MEDIA_VAULT_DRIVES`, `MEDIA_SCRATCH_DRIVES`
- `MEDIA_VAULT_ROOT`, `MEDIA_SCRATCH_ROOT`
- `MEDIA_VAULT_ROOTS`, `MEDIA_SCRATCH_ROOTS`
- `MEDIA_LAYOUT_STRICT`
- `MEDIA_PREFLIGHT_FAIL_CLOSED`
- `MEDIA_IMPORT_ABORT_FREE_GB`
- `MEDIA_SCRATCH_MIN_FREE_GB`
- `MEDIA_SCRATCH_WARN_USED_PERCENT`
- `MEDIA_SCRATCH_RETENTION_DAYS`
- `MEDIA_SCRATCH_CLEANUP_ENABLED`

Status artifacts:
- `MEDIA_IMPORT_STATUS_FILE`
- `MEDIA_CLEANUP_STATUS_FILE`
- `MEDIA_IMPORTED_INDEX_FILE`
- `MEDIA_IMPORT_EVENTS_FILE`
- `STORAGE_WATCHDOG_STATE_FILE`
- `STORAGE_WATCHDOG_EVENTS_FILE`

## Service Helpers

The backend and startup script resolve helpers from env, so you can override paths if needed:
- `JELLYFIN_SERVICE_CMD`
- `QBITTORRENT_SERVICE_CMD`
- `MEDIA_IMPORTER_CMD`
- `MEDIA_WORKFLOW_SERVICE_CMD`
- `STORAGE_WATCHDOG_SERVICE_CMD`
- `LLM_SERVICE_CMD`
- `LLM_MODEL_PULL_CMD`

If you override these, keep them executable and keep their CLI contract stable.

## Local LLM

Relevant LLM settings:
- `LLM_MODELS_DIR`
- `LLM_DEFAULT_MODEL_ID`
- `LLM_DEFAULT_MODEL_PATH`
- `LLM_CTX_SIZE`
- `LLM_THREADS`
- `LLM_BATCH_SIZE`
- `LLM_GPU_LAYERS`
- `LLM_MAX_TOKENS`
- `LLM_TEMPERATURE`
- `LLM_REQUEST_TIMEOUT_MS`
- `ONLINE_LLM_BASE_URL`
- `ONLINE_LLM_API_KEY`
- `ONLINE_LLM_DEFAULT_MODEL`
- `ONLINE_LLM_TIMEOUT_MS`

The backend supports both:
- a local `llama.cpp`/`llama-server` path
- an online-provider path through the OpenAI-compatible API config vars
