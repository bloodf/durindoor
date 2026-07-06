# Environment Variables

DurinDoor runs with sensible local defaults, but production deployments should set explicit values for secrets, storage, URLs, and logging. This page is the canonical environment reference for operators.

Use `.env.example` as the machine-readable starter file and this page as the explanation layer.

## Required for Production

| Variable | Example | Required | Description |
| --- | --- | --- | --- |
| `JWT_SECRET` | `openssl rand -hex 32` output | Production | Signs dashboard session tokens. Changing it invalidates active sessions. |
| `INITIAL_PASSWORD` | a strong password | First production boot | Initial dashboard password when no password exists yet. Change it in the dashboard after first login. |
| `DATA_DIR` | `/var/lib/durindoor` or `/app/data` | Production | Persistent storage for the SQLite database, auth secrets, logs, runtime helpers, tunnels, MITM files, and backups. |
| `API_KEY_SECRET` | `openssl rand -hex 32` output | Production | Used to validate the CRC section of generated DurinDoor API keys. Keep stable across redeploys. |

The default data path intentionally remains `~/.9router` on macOS/Linux and `%APPDATA%\9router` on Windows for migration compatibility.

## Runtime Server

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `20128` | HTTP port for the production gateway and dashboard. |
| `HOSTNAME` | runtime dependent | Bind address. Use `0.0.0.0` in containers and remote deployments. |
| `NODE_ENV` | development unless set by runtime | Set to `production` for production starts. |
| `BASE_URL` | local URL | Server-side URL for routes that need the current instance origin. |
| `NEXT_PUBLIC_BASE_URL` | local URL | Browser-visible base URL. Use the public HTTPS origin for remote deployments. |
| `CLOUD_URL` | project default | Optional remote/cloud endpoint value used by selected features. |
| `NEXT_PUBLIC_CLOUD_URL` | project default | Browser-visible cloud endpoint value. |
| `TRUST_PROXY` | `false` | When `true`, dashboard login rate limiting trusts forwarded IP headers from a reverse proxy. Only enable behind a trusted proxy. |
| `AUTH_COOKIE_SECURE` | `false` | Forces secure dashboard cookies when set to `true`. Use with HTTPS. |
| `SHUTDOWN_SECRET` | unset | Required secret for the shutdown API when configured. |

## API Access and Identity

| Variable | Default | Description |
| --- | --- | --- |
| `REQUIRE_API_KEY` | `false` in example | When enabled by settings/runtime paths, client requests must include a valid DurinDoor API key. |
| `MACHINE_ID_SALT` | `endpoint-proxy-salt` | Salt used when deriving the local machine identifier embedded in generated API keys. |
| `ROUTER_API_KEY` | unset | Optional automation key used by selected internal or external workflows. |
| `OPENAI_API_KEY` | unset | Not required by DurinDoor itself. Only use when a tool or provider-specific workflow expects it. |

## Observability and Logs

| Variable | Default | Description |
| --- | --- | --- |
| `ENABLE_REQUEST_LOGS` | `false` | Enables detailed request logging in the routing core. Prompts and responses may be sensitive. |
| `OBSERVABILITY_ENABLED` | `true` unless disabled | Enables request-detail persistence where supported. |
| `OBSERVABILITY_MAX_RECORDS` | repository default | Maximum number of request detail records retained. |
| `OBSERVABILITY_BATCH_SIZE` | repository default | Batch size for request-detail flushing. |
| `OBSERVABILITY_FLUSH_INTERVAL_MS` | repository default | Flush interval for request-detail persistence. |
| `OBSERVABILITY_MAX_JSON_SIZE` | `5` KB default in code path | Maximum JSON payload size stored per request detail record, in KB. |
| `LOG_LEVEL` | `INFO` | Server log level. Supported levels are `DEBUG`, `INFO`, `WARN`, and `ERROR`. |

Keep detailed request logs disabled in shared or production deployments unless you have a retention policy and user consent.

## Outbound Proxy

DurinDoor can send upstream provider calls through HTTP, HTTPS, SOCKS, or managed proxy settings.

| Variable | Description |
| --- | --- |
| `HTTP_PROXY` / `http_proxy` | Proxy URL for HTTP upstream requests. |
| `HTTPS_PROXY` / `https_proxy` | Proxy URL for HTTPS upstream requests. |
| `ALL_PROXY` / `all_proxy` | Fallback proxy URL for all protocols. |
| `NO_PROXY` / `no_proxy` | Comma-separated hosts that bypass the proxy. |
| `NINE_ROUTER_PROXY_URL` | Internal managed proxy URL set by dashboard proxy settings. |
| `NINE_ROUTER_NO_PROXY` | Internal managed no-proxy list set by dashboard proxy settings. |
| `NINE_ROUTER_PROXY_MANAGED` | Internal marker for dashboard-managed proxy env state. |

Prefer dashboard proxy settings for normal operation. Use process-level proxy variables for container or platform-level egress control.

## Web Fetch Providers

| Variable | Default | Description |
| --- | --- | --- |
| `FIRECRAWL_BASE_URL` | `https://api.firecrawl.dev` | Firecrawl-compatible base URL for `/v1/web/fetch`. |
| `FIRECRAWL_API_KEY` | unset | Firecrawl API key. Leave empty for a self-hosted instance that does not require a key. |
| `FIRECRAWL_TIMEOUT_MS` | `30000` | Request timeout for Firecrawl calls. |
| `FIRECRAWL_DEFAULT_FORMAT` | `markdown` | Default extraction format. |

## OAuth Provider Overrides

Most OAuth providers use built-in client metadata or provider-specific flows. These variables override selected OAuth clients.

| Variable | Description |
| --- | --- |
| `GEMINI_OAUTH_CLIENT_ID` | Optional Gemini CLI OAuth client ID override. |
| `GEMINI_OAUTH_CLIENT_SECRET` | Optional Gemini CLI OAuth client secret override. |
| `ANTIGRAVITY_OAUTH_CLIENT_ID` | Optional Antigravity OAuth client ID override. |
| `ANTIGRAVITY_OAUTH_CLIENT_SECRET` | Optional Antigravity OAuth client secret override. |
| `KIMI_CODING_OAUTH_CLIENT_ID` | Optional Kimi Coding OAuth client ID override. |

Only set these when you operate your own OAuth app or a provider integration explicitly requires it.

## MCP Gateway OAuth

| Variable | Description |
| --- | --- |
| `MCP_GATEWAY_OAUTH_PUBLIC_URL` | Public HTTPS origin used for MCP Gateway OAuth callbacks. |
| `OAUTH_PUBLIC_BASE_URL` | Backward-compatible public OAuth origin fallback. |

MCP OAuth requires a public HTTPS URL. If the dashboard is accessed through a tunnel, set the public tunnel URL here.

## Tunnels and Remote Access

| Variable | Default | Description |
| --- | --- | --- |
| `TUNNEL_WORKER_URL` | project default | Cloudflare tunnel worker endpoint used by tunnel features. |
| `TUNNEL_TRANSPORT_PROTOCOL` | `http2` | Quick tunnel protocol. Supported values include `http2`, `quic`, and `auto`. |
| `CLOUDFLARED_PROTOCOL` | `http2` fallback | Alternative variable for Cloudflare tunnel protocol. |

## Token Saver and Headroom

| Variable | Default | Description |
| --- | --- | --- |
| `HEADROOM_URL` | `http://localhost:8787` | External Headroom proxy URL used by token-saver workflows. |

## MITM and IDE Interception

MITM mode is optional and requires explicit local setup.

| Variable | Default | Description |
| --- | --- | --- |
| `MITM_ROUTER_BASE` | `http://localhost:20128` | Router base URL used by the MITM helper process. |
| `MITM_SERVER_PATH` | auto-detected | Path to the MITM server implementation copied into runtime storage. |
| `DEBUG_MITM` | unset | Enables verbose MITM handler debugging. |

## Translator and Provider Debugging

| Variable | Default | Description |
| --- | --- | --- |
| `VALIDATE_OUTBOUND` | `true` | Set to `false` to disable outbound payload validation in the chat core. |
| `CONCURRENCY_GATE_TIMEOUT_MS` | code default | Overrides provider concurrency gate timeout. |
| `CURSOR_STREAM_DEBUG` | unset | Enables Cursor executor stream debug logs when set to `1`. |
| `CURSOR_PROTOBUF_DEBUG` | unset | Enables Cursor protobuf debug logs when set to `1`. |
| `ENABLE_TRANSLATOR` | `false` unless set | Enables the dashboard translator feature path. |

## Build and Packaging

| Variable | Default | Description |
| --- | --- | --- |
| `NEXT_DIST_DIR` | `.next` | Next.js output directory. |
| `NEXT_TRACING_ROOT_MODE` | project root | Set to `workspace` when CLI packaging needs workspace-level file tracing. |
| `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE` | `128mb` | Next.js proxy client body-size limit for large LLM requests. |
| `NEXT_TELEMETRY_DISABLED` | unset | Set to `1` to disable Next.js telemetry. |

## Updater Internals

These variables are used by the packaged updater and are not normally set by operators:

`UPDATER_APP_PORT`, `UPDATER_LINGER_MS`, `UPDATER_PKG_NAME`, `UPDATER_PORT`, `UPDATER_RELAUNCH`, `UPDATER_RELAUNCH_ARGS`, `UPDATER_RELAUNCH_CMD`, `UPDATER_RETRIES`, `UPDATER_RETRY_DELAY_MS`, `UPDATER_SCRIPT_PATH`, `UPDATER_TAIL_LINES`, `UPDATER_WAIT_CHECK_MS`, `UPDATER_WAIT_MAX_MS`, `UPDATER_WAIT_MIN_MS`.

