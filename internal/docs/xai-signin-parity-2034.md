# xAI sign-in comparison (#2034)

Comparison snapshots: router-for-me/CLIProxyAPI `6faa8d20b2673404cff70a2f2d9537ae0d0e684d`, router-for-me/EasyCLIProxyAPI `e4223d5eefa22a3301ca7e2a28d05897432b07f9`, and cheaper-inference/OmniRoute `e3c1531afd07d5e06f7ffab658584a7ae2e3627e`. The starting inventories are `provider-parity-cliproxyapi.md`, `provider-parity-easycliproxyapi.md`, and `provider-parity-omniroute.md`.

CLIProxyAPI `sdk/auth/xai.go` and `internal/auth/xai/xai.go` use device authorization, whereas DurinDoor's `src/lib/oauth/providers.js` xAI entry and OmniRoute `src/lib/oauth/providers/xai-oauth.ts` use loopback PKCE. DurinDoor's separate `grok-cli` device flow is a distinct provider connection, not proof of xAI device login parity. EasyCLIProxyAPI `src-tauri/src/management_api.rs` sends login to its core management API; it does not itself establish the core's device implementation. Device login for DurinDoor xAI remains unimplemented and unverified.

DurinDoor's `src/app/api/oauth/[provider]/[action]/route.js` binds flows to server-side sessions, and `src/lib/oauth/providers.js` maps tokens to the selected connection. `open-sse/services/tokenRefresh/providers.js` retains the old refresh token if rotation omits one; CLIProxyAPI `internal/runtime/executor/xai_executor_auth.go` does likewise. Further lifecycle and cross-connection route verification remains necessary.

`open-sse/handlers/chatCore.js` selects the connection transport and `open-sse/executors/xai.js` executes it. CLIProxyAPI `internal/runtime/executor/xai_executor_request.go` removes `stop` from Responses requests because xAI does not support it. DurinDoor now removes it for OAuth Responses, including streaming, while leaving API-key chat requests unchanged. The closed-fetch executor regression covers both modes; it does not establish parity for other request transformations or WebSocket transport.

DurinDoor's `open-sse/providers/registry/xai.js` has curated and passthrough models. CLIProxyAPI uses a static catalog; EasyCLIProxyAPI delegates runtime behavior to its core. OmniRoute's `open-sse/services/usage/xaiOauth.ts` uses OAuth billing with a connection-scoped fallback, whereas DurinDoor's `open-sse/services/usage.js` combines connection-local usage with `src/lib/usage/xaiQuotaAdapter.js`. Catalog and quota parity, including live OAuth billing, remains unverified. No live provider calls were made.

## Behavior comparison (partial)

The following compares CLIProxyAPI `6eb8554f0ede` and OmniRoute `5ffa68e83544`. This is not a completed function-by-function audit.

| Behavior | Upstream source | DurinDoor state |
| --- | --- | --- |
| Client ID and scopes | CLIProxyAPI `internal/auth/xai/types.go` | Already matched. |
| Authorization | CLIProxyAPI `internal/auth/xai/xai.go`; OmniRoute `src/lib/oauth/providers/xai-oauth.ts` | Loopback PKCE matches OmniRoute; CLIProxyAPI device authorization and polling remain unported. |
| Token exchange and refresh | CLIProxyAPI `internal/auth/xai/xai.go`; OmniRoute `open-sse/executors/xai.ts` | Missing access tokens are rejected here; full error and concurrency parity remains to be checked. |
| Responses `stop` | CLIProxyAPI `internal/runtime/executor/xai_executor_request.go` | Removed for OAuth and registered native Responses models; native API-key case ported here. |
| OAuth inference endpoint | CLIProxyAPI `internal/auth/xai/types.go` | CLIProxyAPI defaults to `cli-chat-proxy.grok.com`; DurinDoor uses `api.x.ai`; transport parity remains open. |
| Responses input and tools | OmniRoute `open-sse/executors/xai.ts` | Chat-style text and images, function/custom/namespace tools and web search filters normalized here. Full conversion and history-cap parity remains open. |
| OAuth weekly credits | OmniRoute `open-sse/services/usage/xaiOauth.ts`, `xaiOauthQuotaFetcher.ts` | Live connection-scoped billing lookup ported here; unavailable or malformed billing falls back to local usage. API-key prepaid credit still requires a separate management credential. |
| Account identity, retries, models and error classification | CLIProxyAPI `internal/auth/xai/`, `internal/runtime/executor/` | Detailed comparison and route-level evidence remain open. |
| Identity cloaking and detection evasion | CLIProxyAPI executor headers | Intentionally out of scope. |
