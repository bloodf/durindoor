# Provider parity: CLIProxyAPI

Internal reference for work order #2034. This file inventories the outbound upstream
providers that `router-for-me/CLIProxyAPI` (the Go CLI proxy gateway) registers, and
compares them against the provider catalog, authentication surface and runtime
dispatch that DurinDoor actually ships.

Scope is provider contracts only: registration, sign-in, dispatch and model
discovery. This document does not propose code changes, does not call provider
APIs, and contains no credential values.

The snapshot tables below were written against the pins recorded in
[Revisions](#revisions). [Current closure comparison](#current-closure-comparison)
at the end of this file re-resolves upstream and DurinDoor at their current exact
commits and records the deltas and their dispositions.

[The AI Studio Build and hosted Devin follow-up](./aistudio-relay-parity-2034.md) records the verified delegation and model discovery on the merged DurinDoor base.

### Devin inference continuation evidence (#2034)

The pinned Devin-related delta in this work order does not add a Devin inference
executor or reasoning translator change. Devin Desktop is a separate guarded
hosted-dispatch surface and is outside this comparison. Operator-managed Devin
inference is covered by [`devin-inference-provider.test.js`](../../tests/unit/devin-inference-provider.test.js),
which exercises model discovery, account-bound routing, non-streaming and streaming
completions, and usage accounting through closed proxy fixtures. The focused
[`parity-cli-devin-696076.test.js`](../../tests/unit/parity-cli-devin-696076.test.js)
asserts the uncovered continuation contract at the CLIProxyAPI executor boundary:
reasoning, assistant tool-call identity/arguments, tool result, and the following
assistant message reach the configured sidecar in order. The executor makes a
wire-only copy only when consuming bridge-only tool error metadata; ordinary tool
continuation messages remain intact.

## Revisions

| Side | Revision | Note |
| --- | --- | --- |
| CLIProxyAPI `main` | [`6faa8d20b2673404cff70a2f2d9537ae0d0e684d`](https://github.com/router-for-me/CLIProxyAPI/commit/6faa8d20b2673404cff70a2f2d9537ae0d0e684d) | Upstream head resolved from the public GitHub commits API on 2026-11-20. Commit subject: `fix(codex): strip uniqueItems keyword from tool parameter schemas`. |
| DurinDoor | `3164ce3095774d5f7da49b3922195dd7376e6bb5` | Comparison SHA. Branch `orq/toruzq/inventory-cpa-a1`, subject `chore(upstream): sync the upstream intake branch with main (#2033)`. |

Upstream links below are pinned to the upstream SHA so the citations stay valid as
`main` moves. The upstream checkout used for this inventory was a shallow clone of
`main` at the SHA above; it was read only and was not modified.

## How the two projects differ in shape

CLIProxyAPI is a single-purpose proxy with a small, hand-written provider set:
one native executor per upstream, one authenticator per sign-in method, and a
config file that adds arbitrary OpenAI-compatible upstreams. DurinDoor is a
multi-protocol gateway whose provider catalog is registry-driven: each provider is
one file under `open-sse/providers/registry/`, and most of the 342 catalog entries
are third-party API-key gateways rather than first-party model vendors.

The useful comparison is therefore not "which provider ids exist", but "for each
CLIProxyAPI upstream, does DurinDoor reach the same vendor, over the same sign-in
method, and with the same dispatch and model-discovery behavior".

## Upstream CLIProxyAPI provider inventory

Registration is the executor switch in
[`sdk/cliproxy/service_executors.go`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/sdk/cliproxy/service_executors.go)
(`baselineExecutorAuths` at L285, `registerExecutorForAuth` at L336). Credential
kind and source come from
[`sdk/cliproxy/auth/classification.go`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/sdk/cliproxy/auth/classification.go)
(`apikey` / `oauth`, sources `config` / `file` / `git` / `memory` /
`objectstore` / `postgres`).

| Provider id | Aliases | Sign-in method | Auth source | Dispatch (executor) | Model discovery | Native or delegated |
| --- | --- | --- | --- | --- | --- | --- |
| `codex` | none (model prefix via `prefix:` on an API-key group) | OAuth (browser PKCE) or device code, or API key against a Codex-compatible base URL | file, or `api-keys.codex` in config | `CodexAutoExecutor` — HTTP and WebSocket paths to the ChatGPT Codex backend | Static per-plan lists plus a live catalog pulled from the Codex backend | Native |
| `claude` | none | OAuth (browser PKCE) or API key | file, or `api-keys.claude` in config | `ClaudeExecutor` | Static `GetClaudeModels` | Native |
| `gemini` | none | API key only (`api-keys.gemini`) | config | `GeminiExecutor` | Static `GetGeminiModels` | Native |
| `gemini-interactions` | `interactions` | API key only (`api-keys.interactions`) | config | `GeminiInteractionsExecutor` | Reuses the Gemini model set (`internal/registry/model_definitions.go` L576) | Native |
| `vertex` | none | Service-account JSON import, or API key (`api-keys.vertex`) | file, or config | `GeminiVertexExecutor` | Static `GetGeminiVertexModels` | Native |
| `aistudio` | none | OAuth via the AI Studio Build account | file | `AIStudioExecutor` — WebSocket-backed relay through `wsrelay.Manager` | Static `GetAIStudioModels` | Native |
| `antigravity` | none | OAuth | file | `AntigravityExecutor` | Static `GetAntigravityModels` plus a live per-account probe of `v1internal:fetchAvailableModels` | Native |
| `kimi` | `kimi-ai`, `kimi.ai`, `kimi.com` | OAuth device code (`kimi.com` and `kimi.ai` variants) or API key | file | `KimiExecutor` | Static `GetKimiModels`, shared across the Kimi aliases | Native |
| `xai` | none | OAuth device code or API key | file, or `api-keys.xai` in config | `XAIAutoExecutor` — HTTP and WebSocket paths | Static `GetXAIModels` | Native |
| `devin` | none | OAuth, or headless token paste | file, or `api-keys.devin` | `DevinExecutor` | Static list plus a live Devin model catalog | Native |
| `meta` | none | OAuth device code (Meta Muse) | file, or `api-keys.meta` | `MetaExecutor` | Static `GetMetaModels` | Native |
| `openai-compatibility` | any config group name becomes a provider key (`util.OpenAICompatibleProviderKey`) | API key only (`api-keys.openai-compatibility`) | config | `OpenAICompatExecutor`, one instance per configured group | Models declared in config; optional per-key model list | Native, generic |

Upstream sources for the rows above:

- Authenticators and login flows:
  [`internal/cmd/auth_manager.go`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/cmd/auth_manager.go)
  (L13 registers Codex, Claude, Antigravity, Kimi, Kimi AI, Kimi AI dot, xAI, Devin, Meta),
  [`sdk/auth/`](https://github.com/router-for-me/CLIProxyAPI/tree/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/sdk/auth),
  [`internal/auth/`](https://github.com/router-for-me/CLIProxyAPI/tree/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/auth)
  (`antigravity`, `claude`, `codex`, `devin`, `empty`, `kimi`, `meta`, `vertex`, `xai`).
- Client setup: the CLI flags in
  [`cmd/server/main.go`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/cmd/server/main.go)
  L153–L181 (`--codex-login`, `--claude-login`, `--antigravity-login`,
  `--kimi-login`, `--kimi-ai-login`, `--xai-login`, `--devin-login`,
  `--meta-login`, `--vertex-import`, `--siwc-bind`) and the TUI OAuth tab in
  [`internal/tui/oauth_tab.go`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/tui/oauth_tab.go).
- Dispatch: [`internal/runtime/executor/`](https://github.com/router-for-me/CLIProxyAPI/tree/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/runtime/executor).
- Model discovery:
  [`internal/registry/model_definitions.go`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/registry/model_definitions.go),
  [`internal/registry/model_updater.go`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/registry/model_updater.go),
  [`internal/registry/codex_client_models.go`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/registry/codex_client_models.go),
  [`internal/registry/devin_models.go`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/registry/devin_models.go),
  [`sdk/auth/antigravity_models.go`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/sdk/auth/antigravity_models.go).
- API-key groups:
  [`config.example.yaml`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/config.example.yaml)
  `api-keys:` — `gemini`, `interactions`, `vertex`, `codex`, `claude`, `xai`,
  `meta`, `openai-compatibility`.

### Upstream inbound API compatibility and client setup

Upstream exposes OpenAI-, Gemini- and Claude-shaped inbound routes in
[`internal/api/server_routes.go`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/internal/api/server_routes.go):

- `/v1` (L69): `chat/completions`, `completions`, `responses`, `responses/compact`,
  `messages`, `messages/count_tokens`, `models`, `images/*`, `videos*`, `audio/speech`,
  `tts`, `alpha/search` (L93), `live`.
- `/v1beta` (L149): Gemini-native `models/*action` plus `interactions` (L153).
- `/openai/v1` (L120): video create and retrieve.
- `/backend-api/codex` (L129): Codex CLI direct aliases.
- `/v1/tunnel`, `/v1/realtime/*`, `/muse-code/*`.

### Upstream network and local providers

Upstream has no Ollama-style local provider. Its only network-local surface is
mDNS LAN gateway discovery (`--discover`, `--discover-service-type`) documented in
[`docs/lan-discovery.md`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/docs/lan-discovery.md),
which advertises and browses `_ai-gateway._tcp` per
[draft-su-ai-gateway-discovery-00](https://datatracker.ietf.org/doc/draft-su-ai-gateway-discovery/).
Discovery only returns candidates; it never connects or forwards credentials.

## DurinDoor comparison surface

DurinDoor provider facts come from the registry, not from a hand-maintained list:

- Catalog: `open-sse/providers/registry/*.js` (342 entries), barrel
  `open-sse/providers/registry/index.js`, projection to `PROVIDERS`,
  `PROVIDER_MODELS`, `PROVIDER_OAUTH`, `PROVIDER_MEDIA` in
  `open-sse/providers/index.js`.
- Sign-in: `src/lib/oauth/constants/oauth.js` (per-provider OAuth client config),
  `src/app/api/oauth/[provider]/[action]/route.js` (start/poll/import endpoints),
  `open-sse/services/oauthCredentialManager.js` (credential lifecycle),
  `open-sse/services/tokenRefresh/` (refresh).
- Dispatch: `open-sse/executors/index.js` (`getExecutor`), `open-sse/handlers/chatCore.js`,
  `open-sse/handlers/chatCore/executorProxy.js` (upstream-proxy routing).
- Model discovery: `src/app/api/v1/models/buildModelsList.js`,
  `src/app/api/providers/[id]/models/`, `open-sse/services/ollamaCatalog.js`,
  `open-sse/services/copilotModels.js` and sibling per-provider catalog services.

DurinDoor provider categories in the current tree: `apikey` 258, `freeTier` 25,
`oauth` 29, `webCookie` 14, `free` 13, `system` 1, `hidden` 1.

### DurinDoor delegation to CLIProxyAPI

DurinDoor can run CLIProxyAPI as a sidecar and delegate to it in three modes,
configured through the `upstreamProxyConfig` settings map:

- `native` — DurinDoor calls the vendor directly (default).
- `cliproxyapi` — the request is handed to the sidecar, which owns the upstream
  credential and the vendor session.
- `fallback` — DurinDoor tries the vendor first and retries through the sidecar on
  a configured status set (default `429, 500, 502, 503, 504`).

Sources: `open-sse/handlers/chatCore/executorProxy.js`,
`open-sse/handlers/chatCore/comboContextCache.js`,
`open-sse/executors/cliproxyapi.js`,
`open-sse/providers/registry/omniroute-api-cloud.js` (the `cliproxyapi`
catalog entry, alias `cpa`, default `http://127.0.0.1:8317`).
A per-connection override `providerSpecificData.cliproxyapiMode = "claude-native"`
routes only that connection through the sidecar. The sidecar learns DurinDoor
provider metadata from `GET /v1/provider-plugin-manifest`; the outbound request
carries the `X-OmniRoute-Provider-Manifest-Url` header, resolved from trusted
server configuration only (see `docs/reference/provider-plugin-manifest.mdx`).

This is the single most important structural difference: upstream *is* the proxy,
while DurinDoor can either reimplement an upstream natively or borrow it wholesale
from a CLIProxyAPI sidecar.

## Existing provider deltas

These providers exist on both sides. The delta is in contract, not presence.

| # | Provider | Delta | Source citation (DurinDoor / upstream) | Suggested mock acceptance test |
| --- | --- | --- | --- | --- |
| D1 | `codex` | DurinDoor exposes only the ChatGPT OAuth path (`oauth.clientId`, `auth.openai.com`, fixed callback port 1455) and has no Codex API-key group. Upstream also accepts an API key against an arbitrary Codex-compatible base URL with per-key `prefix`, `weight`, `excluded-models` and `force-mapping`. | `open-sse/providers/registry/codex.js` L110–L130; upstream `config.example.yaml` `api-keys.codex` and `internal/registry/codex_client_models.go` | `tests/unit/codex-api-key-group.test.js`: build a config with an `api-keys.codex` group pointing at a mock upstream, assert the request path and `Authorization` header, and assert a prefixed model id routes to that credential only. |
| D2 | `codex` | DurinDoor's Codex model list is a static registry array; upstream keeps a live catalog from the Codex backend and refreshes it. DurinDoor has a `transport.usage.modelsUrl` for quota but no live catalog refresh for Codex models. | `open-sse/providers/registry/codex.js` L63–L102 (`transport.usage.modelsUrl` L58); upstream `internal/registry/codex_client_models.go` and `internal/registry/codex_client_models_updater.go` | `tests/unit/codex-model-catalog-refresh.test.js`: mock the Codex models endpoint, assert a refreshed catalog replaces stale entries and that a failed refresh keeps the last known good list. |
| D3 | `claude` | DurinDoor supports both `x-api-key` and OAuth bearer on the same provider. Upstream splits this into `api-keys.claude` (API key, with cloaking and native-tool-search knobs) and the Claude OAuth file credential. DurinDoor's per-connection cloaking is a transport quirk (`cloakToolsOnOAuth`), not a per-key mode. | `open-sse/providers/registry/claude.js` L27–L46; upstream `config.example.yaml` `api-keys.claude` `cloak` block | `tests/unit/claude-api-key-cloak-mode.test.js`: with an API-key connection and `cloak.mode: "never"`, assert the outgoing request carries no Claude Code identity headers, and with `"auto"` assert a non-Claude-Code client is cloaked. |
| D4 | `gemini` | DurinDoor classifies `gemini` as `freeTier` with both `x-goog-api-key` and OAuth bearer on one provider, and additionally ships `gemini-cli` (Google AI Studio Build, OAuth) as a separate provider. Upstream splits the same two surfaces into `gemini` (API key only) and `aistudio` (OAuth, WebSocket transport). | `open-sse/providers/registry/gemini.js` L23–L35; `open-sse/providers/registry/gemini-cli.js`; upstream `sdk/cliproxy/service_executors.go` L373–L383 | `tests/unit/gemini-interactions-split.test.js`: assert a Gemini API-key connection sends `x-goog-api-key`, and that the Google AI Studio Build OAuth connection resolves to the `gemini-cli` provider rather than `gemini`. |
| D5 | `gemini-interactions` | Upstream registers a distinct `gemini-interactions` provider whose executor serves the native Google Interactions API, with its own API-key group and its own inbound `/v1beta/interactions` route. DurinDoor has no Interactions provider and no `/v1beta/interactions` route; its Gemini-native surface is limited to `/v1beta/models/*action`. | upstream `sdk/cliproxy/service_executors.go` L375–L376, `internal/api/server_routes.go` L153, `config.example.yaml` `api-keys.interactions`; DurinDoor `src/app/api/v1beta/models/[...path]/route.js` (no sibling `interactions` route) | `tests/unit/gemini-interactions-provider.test.js`: POST to `/v1beta/interactions` against a mock upstream and assert the request is forwarded in Interactions shape with the credential attached; assert the route returns a JSON 404 today, so the test fails until the route exists. |
| D6 | `vertex` | DurinDoor's `vertex` provider is API-key/service-account based against `aiplatform.googleapis.com` with a fixed model list. Upstream imports a Vertex service-account JSON (`--vertex-import`), can namespace model names by import prefix, and registers a separate `vertex` executor. **Verified**: the Service Account, ADC `authorized_user` and raw-key routes match the pinned import/auth/executor contract. One delta was reproducible and fixed: a Google credential JSON that is neither a Service Account key nor an ADC file was demoted to a raw API key, which put a private key or client secret into the outbound URL. | `open-sse/providers/registry/vertex.js` L20–L26; upstream `cmd/server/main.go` L172–L173 and `internal/auth/vertex/`; [Vertex parity record](./vertex-signin-parity-2034.md) | `tests/unit/vertex-service-account-import.test.js`: import a mock service-account JSON and assert the resulting credential produces a signed request to the Vertex endpoint with the imported project and location. |
| D7 | `aistudio` | Upstream routes AI Studio Build through a WebSocket relay (`wsrelay.Manager`), which changes connection reuse and failure behavior. DurinDoor's equivalent provider (`gemini-cli`) uses HTTP against `cloudcode-pa.googleapis.com/v1internal` and has no WebSocket relay path. | upstream `internal/runtime/executor/aistudio_executor.go` L29–L49; DurinDoor `open-sse/providers/registry/gemini-cli.js` and `open-sse/executors/gemini-cli.js` | `tests/unit/aistudio-websocket-relay.test.js`: with a mock WebSocket relay, assert a chat request is carried over the relay and that a relay disconnect produces a retryable outcome rather than a terminal error. |
| D8 | `antigravity` | DurinDoor and upstream both ship a dedicated Antigravity provider with OAuth. Since #2034, DurinDoor's probe sends the account's own project and persists per-connection capability hints (project-, endpoint- and route-fingerprint-scoped) in connection PSD. The remaining discovery delta is the shared undici transport's ALPN negotiation versus upstream's HTTP/1.1-only, ALPN-free probe transport. | upstream `sdk/auth/antigravity_models.go` (`configureAntigravityHTTP11Transport`, `BuildPersistedAntigravityCapabilityHints`); DurinDoor `open-sse/services/antigravityCatalog.js`, `src/app/api/providers/[id]/models/modelsConfig.js`, `src/app/api/providers/[id]/models/fetchConnectionModels.js` | `tests/unit/antigravity-project-catalog.test.js` and `tests/unit/antigravity-capability-hints.test.js`: project-scoped probes, auth/transient classification, persisted hint reuse, connection isolation and route-fingerprint invalidation. |
| D9 | `kimi` | Upstream's Kimi is an OAuth provider with three provider ids (`kimi`, `kimi-ai`, `kimi.ai`/`kimi.com`) that share one executor and one model set. DurinDoor's `kimi` entry is API-key only, against `api.moonshot.ai/anthropic/v1/messages`; the OAuth Kimi surface is a different provider id (`kimi-coding`, alias `kmc`, device-code OAuth against `api.kimi.com/coding/v1/messages`). | `open-sse/providers/registry/kimi.js` L4–L14; `open-sse/providers/registry/kimi-coding.js`; upstream `sdk/cliproxy/service_executors.go` L394–L395, `sdk/auth/kimi.go` | `tests/unit/kimi-oauth-alias-parity.test.js`: assert `kimi`, `kimi-ai`, `kimi.ai` and `kimi.com` all resolve to one Kimi executor and one shared model list, and that the OAuth device-code credential refreshes without a new sign-in. |
| D10 | `xai` | DurinDoor ships `xai` with `authModes: ["oauth", "apikey"]` and three transports (`openai`, `openai-responses`, `openai-responses-oauth`), plus image, video, TTS, STT and realtime service kinds. Upstream's xAI executor is also HTTP plus WebSocket, but upstream's model list is static while DurinDoor sets `passthroughModels` to tolerate model ids that ship ahead of the registry. | `open-sse/providers/registry/xai.js` L16–L36, L62–L79; upstream `internal/runtime/executor/xai_executor.go`, `internal/runtime/executor/xai_websockets_executor.go` | `tests/unit/xai-passthrough-model-id.test.js`: request an unknown `grok-*` model id and assert it is forwarded rather than rejected by catalog validation, and that the OAuth and API-key transports differ only in the auth header. |
| D11 | `devin` | Upstream's `devin` is a chat-capable provider with an OAuth flow and a live model catalog. DurinDoor's `devin` is a credential-and-catalog-only cloud-agent entry with `transport: null` and `serviceKinds: ["agent"]`; chat is explicitly unsupported, and the LLM-style surface is a separate provider id (`devin-cli`, ACP over stdio). | `open-sse/providers/registry/devin.js` (header comment and L20–L35); `open-sse/providers/registry/devin-cli.js`; upstream `internal/runtime/executor/devin_executor.go`, `sdk/auth/devin.go` | `tests/unit/devin-agent-kind-routing.test.js`: assert a Devin connection advertises only the `agent` kind in `/v1/models`, that a chat request for that provider is rejected with a clear error, and that `devin-cli` remains separately routable. |
| D12 | `meta` | Upstream's `meta` provider is the Meta Muse OAuth device-code flow against `api.meta.ai`. DurinDoor reaches the same vendor through a different provider id: `muse-code` (alias `mc`, device-code OAuth with a `mintUrl`, format `openai-responses`, base `https://api.meta.ai/v1/responses`). DurinDoor's `meta` alias belongs to `meta-llama` (`api.llama.com`), which is a different vendor from upstream's `api.meta.ai`. | `open-sse/providers/registry/muse-code.js`; `open-sse/providers/registry/meta-llama.js` L2–L6; upstream `sdk/auth/meta.go`, `internal/runtime/executor/meta_executor.go` | `tests/unit/meta-provider-id-collision.test.js`: assert the alias `meta` resolves to `meta-llama` and that the `api.meta.ai` vendor is reachable only through `muse-code`, with no id collision in model resolution. Delivered: the file covers the alias split, the single `api.meta.ai` entry, the unchanged Meta Llama API-key route, account-scoped Model API dispatch and discovery, and the bounded attestation-denial path. |
| D13 | `openai-compatibility` | Upstream lets an operator declare arbitrary OpenAI-compatible upstreams in one config block, and each declared group becomes its own provider key. DurinDoor has no single equivalent registry entry; the capability is spread across the `openai` provider, the provider-node system (`src/app/api/provider-nodes/`), and the `cliproxyapi` sidecar entry. | upstream `sdk/cliproxy/service_executors.go` L45–L79 and L428–L456; DurinDoor `open-sse/providers/registry/openai.js`, `src/app/api/provider-nodes/`, `open-sse/providers/registry/omniroute-api-cloud.js` L144–L163 | `tests/unit/openai-compat-node-catalog.test.js`: register an OpenAI-compatible node against a mock server, assert its models are discovered from `GET <base>/models`, merged into `/v1/models`, and that the request carries no auth header when the node has no API key. |
| D14 | Inbound compatibility | DurinDoor matches upstream on the OpenAI Chat Completions, Responses and Anthropic Messages surfaces, and additionally exposes a Gemini-native `/v1beta` bridge. It has no `/v1beta/interactions` route, no `/v1/alpha/search` route, and no `/backend-api/codex` alias group. | upstream `internal/api/server_routes.go` L69–L172; DurinDoor `src/app/api/v1/chat/completions/route.js`, `src/app/api/v1/responses/route.js`, `src/app/api/v1/messages/route.js`, `src/app/api/v1beta/models/[...path]/route.js` | `tests/unit/inbound-route-parity.test.js`: enumerate the inbound route table and assert each CLIProxyAPI-compatible path resolves to a DurinDoor handler, reporting the unmapped paths as failures rather than silently 404ing. |
| D15 | Client setup | Upstream ships a single CLI with per-provider login flags and a TUI OAuth tab; provider plugins can also register OAuth providers through the plugin host. DurinDoor signs in through the dashboard and `/api/oauth/[provider]/[action]`, with a per-provider action directory (`codex/import-token`, `kiro/import-cli-proxy`, `cursor/auto-import`, `xiaomi-mimo/login/start`, and others). | upstream `cmd/server/main.go` L153–L181, `internal/tui/oauth_tab.go`, `internal/pluginhost/auth_provider.go`; DurinDoor `src/app/api/oauth/` | `tests/unit/oauth-provider-actions.test.js`: assert every registry entry with an `oauth` block exposes a reachable start/poll action under `/api/oauth/<provider>/`, and that the set of providers with an action matches the set with an `oauth` block. |
| D16 | LAN discovery | Upstream browses the LAN over mDNS (`_ai-gateway._tcp`) and never connects to what it finds. DurinDoor scans named hosts or one subnet of up to 256 addresses over HTTP for Ollama and OpenAI-compatible endpoints, behind the `lanDiscoveryEnabled` setting and the outbound URL guard, and also returns candidates only. | upstream `docs/lan-discovery.md`; DurinDoor `src/app/api/providers/lan-discovery/route.js`, `src/lib/lanDiscovery/` | `tests/unit/lan-discovery-candidates-only.test.js`: point the scan at a mock host and assert no connection is created, that the scan is disabled unless the setting is on, and that a disabled scan makes no outbound request. |

## Missing-provider table

Upstream providers with no DurinDoor equivalent under any provider id. Each row
states what upstream provides that DurinDoor does not.

| # | Upstream provider | What is missing in DurinDoor | Source citation | Suggested mock acceptance test |
| --- | --- | --- | --- | --- |
| M1 | `gemini-interactions` | No provider id, no executor, no API-key group and no inbound route for the native Google Interactions API. DurinDoor's Google coverage is `gemini` (API key), `gemini-cli` (AI Studio Build OAuth) and `vertex` (service account). | upstream `sdk/cliproxy/service_executors.go` L375–L376, `internal/runtime/executor/gemini_executor.go` L61–L76, `internal/api/server_routes.go` L153 | `tests/unit/gemini-interactions-provider.test.js`: assert a `gemini-interactions` connection exists in the registry, that a mock Interactions upstream receives the request in Interactions shape, and that `POST /v1beta/interactions` is routed rather than 404ing. |
| M2 | `aistudio` (WebSocket relay) | DurinDoor has no WebSocket-relay transport for AI Studio Build. `gemini-cli` speaks HTTP only, so AI Studio Build streaming, connection reuse and relay-specific failure handling have no counterpart. | upstream `internal/runtime/executor/aistudio_executor.go` L29–L126, `internal/wsrelay/`; DurinDoor `open-sse/executors/gemini-cli.js` | `tests/unit/aistudio-websocket-relay.test.js`: assert an AI Studio Build connection can be served over the WebSocket relay against a mock relay server, including a relay-disconnect retry case. |
| M3 | `devin` (chat-capable) | DurinDoor's Devin entry is agent-credentials-only. Upstream's Devin executor answers chat requests and maintains a live Devin model catalog; DurinDoor declares `transport: null` and explicitly rejects chat for that provider. | upstream `internal/runtime/executor/devin_executor.go`, `internal/registry/devin_models.go`, `internal/registry/devin_models_updater.go`; DurinDoor `open-sse/providers/registry/devin.js` | `tests/unit/devin-chat-provider.test.js`: assert a Devin chat request is served against a mock Devin upstream and that the live catalog replaces the single placeholder entry. |
| M4 | `meta` (as a first-party provider id) | The Meta Muse vendor is reachable only through the `muse-code` id, and the `meta` alias belongs to `meta-llama` (`api.llama.com`). Upstream has a single `meta` provider with its own authenticator, executor and model set. | upstream `sdk/auth/meta.go`, `internal/runtime/executor/meta_executor.go`, `internal/registry/model_definitions.go` L624; DurinDoor `open-sse/providers/registry/meta-llama.js` L4, `open-sse/providers/registry/muse-code.js` | `tests/unit/meta-provider-id-collision.test.js`: assert a catalog-wide scan finds exactly one entry pointing at `api.meta.ai`, that model resolution cannot land on `meta-llama` for a Meta Muse model id, and that the `meta` alias still resolves to `meta-llama` for backwards compatibility. Delivered: the file asserts all three plus gateway dispatch, streaming and remint against closed fixtures. |
| M5 | `kimi` (OAuth, three provider ids) | DurinDoor's OAuth Kimi surface is `kimi-coding`, a different provider id with a different base path (`/coding/v1/messages`). The plain `kimi` id in DurinDoor is API-key only, against `api.moonshot.ai/anthropic/v1/messages`, and the `kimi-ai` / `kimi.ai` / `kimi.com` ids do not exist. | upstream `sdk/cliproxy/service_executors.go` L394–L395, `internal/watcher/synthesizer/file.go` L309, `internal/thinking/provider/kimi/apply.go` L25–L28; DurinDoor `open-sse/providers/registry/kimi.js` L4–L14 | `tests/unit/kimi-oauth-alias-parity.test.js`: assert the three Kimi aliases resolve to one executor and one model list, that an OAuth Kimi credential is accepted, and that the alias does not collide with the API-key `kimi` connection. |
| M6 | Upstream `openai-compatibility` as a config-declared provider set | DurinDoor has no single registry entry that turns a config group into a first-class provider id. Operator-declared OpenAI-compatible upstreams live in the provider-node system instead, which is a different lifecycle (nodes and connections, not config groups) and does not reuse the upstream naming rule. | upstream `sdk/cliproxy/service_executors.go` L45–L79, `config.example.yaml` `api-keys.openai-compatibility`; DurinDoor `src/app/api/provider-nodes/` | `tests/unit/openai-compat-node-catalog.test.js`: assert a configured OpenAI-compatible group is discoverable under a provider key derived from its group name and that its models appear in `/v1/models`. |
| M7 | `/v1beta/interactions` inbound route | DurinDoor's Gemini-native bridge exposes `/v1beta/models` and `/v1beta/models/*action` only. Clients that speak the Interactions shape have no inbound path. | upstream `internal/api/server_routes.go` L149–L157; DurinDoor `src/app/api/v1beta/models/route.js`, `src/app/api/v1beta/models/[...path]/route.js` | `tests/unit/inbound-route-parity.test.js`: assert `POST /v1beta/interactions` is handled by a Gemini-native handler rather than falling through to the JSON 404. |
| M8 | `/v1/alpha/search` inbound route | Upstream exposes Codex native search at this path. DurinDoor exposes `/v1/search` and per-provider `searchViaChat`, but not the Codex-native alpha search route. | upstream `internal/api/server_routes.go` L93, `internal/api/handlers/handlers_execution.go`; DurinDoor `src/app/api/v1/search/route.js`, `open-sse/handlers/search/` | `tests/unit/inbound-route-parity.test.js`: assert the alpha-search path is either served or returns a deliberate, documented error, and that it never reaches a provider that cannot serve it. |

Notes on scope of "missing": items M1–M5 are provider-contract gaps. Items M6–M8
are surface gaps in how the same capability is exposed. None of these rows assert
that DurinDoor should copy upstream's exact id or shape; the acceptance tests are
written to accept an equivalent design.

## Antigravity observations

Recorded separately as requested. Observation 3 has since been applied as the
account-scoped discovery change for #2034; the rest is inventory, not a
recommendation.

1. **Upstream pins the model probe to HTTP/1.1 without ALPN.** The upstream fix
   (`d0c90bb`, "fix(antigravity): enforce HTTP/1.1 without ALPN in model probe")
   clears `Protocols`, `ForceAttemptHTTP2`, `TLSNextProto` and `NextProtos` on the
   probe transport, because native Antigravity sends no ALPN extension. See
   [`sdk/auth/antigravity_models.go`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/sdk/auth/antigravity_models.go)
   `configureAntigravityHTTP11Transport`. DurinDoor's equivalent probe goes
   through `proxyAwareFetch` with no protocol control, so the wire shape is not
   pinned. Whether that matters in practice is unverified here: no live Antigravity
   call was made. The shared transport was left intact; see
   [`antigravity-2034.md`](./antigravity-2034.md) for the recorded delta.
2. **Upstream persists per-account capability hints.** Upstream stores the probed
   model ids and web-search model ids in credential metadata under
   `antigravity_capability_hints`, together with the project id, the sanitized
   endpoint and a credential-free route fingerprint. DurinDoor now persists the
   same shape on the connection's `providerSpecificData` (transfer still drops
   the nested object) and reuses matching hints on later catalog GETs. Covered by
   `tests/unit/antigravity-capability-hints.test.js`. See
   [`antigravity-2034.md`](./antigravity-2034.md).
3. **Upstream treats an unknown catalog as transient, an unauthorized one as an
   auth error.** The upstream probe returns three distinct statuses, and only the
   auth-error status triggers credential handling. Applied for #2034: the
   Antigravity catalog probe classifies 401 and 403 as `auth_error` and every
   other non-2xx, an unreadable body and an unclassifiable payload as
   `transient`, and a failed probe no longer answers with an empty catalog.
   Sources: `open-sse/services/antigravityCatalog.js`,
   `src/app/api/providers/[id]/models/fetchConnectionModels.js`.
4. **DurinDoor ships two Antigravity-family entries.** `antigravity` (alias `ag`,
   `daily-cloudcode-pa.googleapis.com`) and `agy` (alias `agy`). `agy` is built by
   spreading the `antigravity` entry, so it keeps the same host, OAuth client,
   wire format and deprecation flags, and adds `passthroughModels: true` so
   model ids that ship ahead of the registry are not rejected. Both are served by
   `AntigravityExecutor` (`open-sse/executors/index.js`, `agy: new AntigravityExecutor("agy")`).
   Upstream has one Antigravity provider. The two DurinDoor entries differ in
   catalog content and in how quota is gathered, so a delta here is expected
   rather than a defect. Sources: `open-sse/providers/registry/antigravity.js`,
   `open-sse/providers/registry/agy.js` L1–L18.
5. **DurinDoor's Antigravity provider is marked deprecated.** `antigravity` sets
   `display.deprecated: true` with `deprecationNotice: "RISK_NOTICE"`, and `agy`
   inherits both by spreading that display block, while upstream continues to
   develop the Antigravity executor (reasoning replay alone is several thousand
   lines upstream). The deprecation is a DurinDoor product decision; this
   inventory records it, not a recommendation to reverse it.
6. **Mock acceptance test for observation 3** (written, run):
   `tests/unit/antigravity-project-catalog.test.js` drives the real
   `GET /api/providers/[id]/models` route with two synthetic signed-in
   connections against a closed outbound mock. It asserts the pinned endpoint,
   the single `project` field carrying each account's own project, the bearer
   token, the Antigravity user agent, the omitted invalid project, the
   unauthorized answer classified as an auth error, the malformed answer
   classified as transient, and that persisted capability hints keep a known
   catalog available without replacing it with a transient failure.
   Observation 1 (ALPN-free HTTP/1.1 probe transport) remains unchanged on
   purpose. Observation 2 is covered by
   `tests/unit/antigravity-capability-hints.test.js`.

## Uncertainty and related issues

- **No live verification.** Every upstream statement comes from reading the pinned
  upstream tree. No provider API was called and no credential was used, so
  "upstream supports sign-in method X" means "the upstream code contains a path
  for X", not "sign-in method X currently works against the vendor".
- **CLIProxyAPI is a moving target.** The upstream SHA is a single commit on
  `main`; upstream merges continuously. The provider set above should be
  re-resolved before any port decision.
- **DurinDoor's catalog is larger and partly generated.** Counts in this document
  were produced by importing `open-sse/providers/registry/index.js` at the
  comparison SHA. `open-sse/providers/registry/index.js` is generated by
  `pnpm run gen:registry-index` and must not be hand-edited.
- **Provider identity in DurinDoor is by connection, not by id.** Several
  DurinDoor providers expose more than one upstream host through
  `transports` (xAI) or through per-connection `providerSpecificData`. A
  provider id match is therefore evidence of a shared vendor, not proof of
  identical behavior.
- **Related `source:omniroute` lineage.** The DurinDoor `devin` cloud-agent entry
  records its origin as OmniRoute #6894 / diegosouzapw#6142, following the
  `jules` cloud-agent pattern. The `cliproxyapi` catalog entry lives in
  `open-sse/providers/registry/omniroute-api-cloud.js`, whose header records
  "Ported from OmniRoute non-registry provider sources at commit 3ddcee6"; the
  `upstreamProxyConfig` native/cliproxyapi/fallback modes are OmniRoute-derived
  as well. OmniRoute is listed alongside CLIProxyAPI in the upstream README
  under "More choices", so the two projects and OmniRoute share design ideas
  without sharing an id space; an upstream id must never be assumed to match a
  DurinDoor id. `.github/upstream-ported.json` carries no CLIProxyAPI entry, so
  there is no upstream-port ledger row for this work. No open OmniRoute pull
  request was found in the reviewed snapshot that specifically targets
  CLIProxyAPI provider parity.
- **Anti-gravity parity is unsettled in both directions.** Upstream's Antigravity
  work is newer and deeper in places; DurinDoor's is broader in catalog surface
  (two entries, weekly quota overlay). This document does not rank them.

## Method and limits

- Upstream was read from a shallow clone of `main` at
  `6faa8d20b2673404cff70a2f2d9537ae0d0e684d`; the SHA was confirmed against the
  public GitHub commits API.
- DurinDoor provider facts were read from the tree at
  `3164ce3095774d5f7da49b3922195dd7376e6bb5`, and the registry was enumerated by
  importing the generated barrel.
- No file outside `internal/docs/provider-parity-cliproxyapi.md` was modified in
  this work order.
- Suggested tests are proposals only. They have not been written or run. The
  repository test gate is `cd tests && npm run test:ci`, with an empty
  `tests/__baseline__/known-fails.txt`; a new failing assertion is a regression
  until the corresponding feature lands.

## Current closure comparison

Closure snapshot for #2034, taken against the current exact upstream commit and
the assigned DurinDoor integration head. The tables above stay the record for
the older pins; this section is the closure record for the current ones.

No file outside this inventory was modified. No provider service was called, no
credential was used, and no browser, Docker, end-to-end or deployment surface
was used.

### Pins

| Side | Revision | Note |
| --- | --- | --- |
| CLIProxyAPI `main` | `f5c5681a8361c9da53e93c60b6507816eee7468b` | Current upstream head. Commit subject: `fix(auth): capture per-attempt access token on streaming failure results`. |
| CLIProxyAPI snapshot pin | `6faa8d20b2673404cff70a2f2d9537ae0d0e684d` | The pin the snapshot tables above were written against. |
| DurinDoor integration | `082b48d0f85e3a11579bede9c6e1e5ec5c21472c` | Branch `orq/toruzq/inventory-current-cpa-a1-l2`. |
| DurinDoor comparison SHA | `3164ce3095774d5f7da49b3922195dd7376e6bb5` | The SHA the snapshot tables above were written against. |

Resolution method: `git ls-remote https://github.com/router-for-me/CLIProxyAPI.git
refs/heads/main` returned `f5c5681a8361c9da53e93c60b6507816eee7468b` on
2026-11-21. The upstream tree was read from a blob-filtered, read-only clone
outside the repository at that SHA; that checkout was not modified, and no
upstream interface owned by another orchestrator was used. Upstream delta
between the two pins: 28 commits, 96 files, +13900 / -357.

DurinDoor facts come from the worktree at `082b48d`. The catalog was
enumerated by importing the generated barrel `open-sse/providers/registry/index.js`:
374 provider entries (apikey 286, oauth 31, freeTier 26, free 14, webCookie 14,
system 1, hidden 1, and one entry without a category), against 342 at
`3164ce3`.

Upstream citations in this section are pinned to
`https://github.com/router-for-me/CLIProxyAPI/blob/f5c5681a8361c9da53e93c60b6507816eee7468b/`
so they stay valid as `main` moves.

### Upstream delta by dimension

| Dimension | Upstream change since `6faa8d20` | DurinDoor state at `082b48d` | Disposition |
| --- | --- | --- | --- |
| Provider registration | None. `sdk/cliproxy/service_executors.go`, `internal/registry/model_definitions.go`, `config.example.yaml`, `internal/cmd/auth_manager.go`, `cmd/server/main.go` and `internal/api/server_routes.go` are unchanged across the two pins. No executor, authenticator package or API-key group was added or removed; `internal/auth/` still holds `antigravity`, `claude`, `codex`, `devin`, `empty`, `kimi`, `meta`, `vertex`, `xai`. | Catalog 342 to 374 entries. Three CLIProxyAPI-adjacent entries were added since `3164ce3`: `gemini-interactions`, `kimi-ai`, `devin-cli-agentic`. | **Already covered.** Upstream added no provider identity, so there is no registration delta to port. The DurinDoor additions are listed under *New identities*. |
| Sign-in | None. The login surface is unchanged: `internal/cmd/auth_manager.go`, the per-provider flags in `cmd/server/main.go` L153-L181, `internal/tui/oauth_tab.go`, and `sdk/auth/codex_device.go`. The only sign-in-adjacent change is the Antigravity OAuth refresh transport, recorded under *Refresh*. | `codex` gained the upstream Codex device-code flow (`open-sse/providers/registry/codex.js` L130-L134); `claude` gained the upstream OAuth scope set and the refresh scope (`open-sse/providers/registry/claude.js` L69-L100). | **Already covered.** No upstream sign-in method was added, removed or renamed since the snapshot pin. |
| Refresh | (a) The Antigravity OAuth refresh now uses a dedicated HTTP/2-capable transport and no longer forces `Host: oauth2.googleapis.com` or `User-Agent: Go-http-client/2.0` (`internal/runtime/executor/antigravity_executor_auth.go`, `newAntigravityOAuthHTTPClient`); HTTP/1.1 without ALPN stays scoped to Cloud Code PA endpoints. (b) A refresh failure is credential-scoped: the credential cannot serve any model until it recovers. (c) The per-credential refresh lock honours context cancellation (`sdk/cliproxy/auth/conductor_refresh.go`, `lockRefreshContext`). (d) An unauthorized answer no longer triggers an implicit refresh when the failure is an explicit request stop, a request termination or a terms-of-service violation (`conductor_refresh.go`, `tryRefreshAfterUnauthorized`). (e) Interceptor session updates clone credential metadata before mutating it, and a 401 retry republishes the refreshed auth (`sdk/cliproxy/auth/types.go`). | Refresh runs through `open-sse/services/tokenRefresh/providers.js` (generic path L48-L106, Google-family path L258-L293, used by `antigravity`, `agy` and `gemini-cli`) behind `open-sse/services/tokenRefresh/dedup.js` and `open-sse/services/oauthCredentialManager.js` L303-L325. The reactive 401/403 refresh and its per-executor veto live in `open-sse/handlers/chatCore.js` L1572-L1619. DurinDoor pins no ALPN and forges no `Host` or `User-Agent`. | (a) **Already covered**: there is no pinned transport to undo. (b) **Still running**: a failed refresh yields no new credential and does not by itself quarantine the connection, though the durable reauth quarantine exists (`src/sse/services/auth.js` L1568). (c) **Still running**: `dedupRefresh` shares one in-flight promise per provider, token and route, and a cancelled waiter still awaits it. (d) **Already covered in shape**: the per-executor `shouldRefreshAfterAuthFailure` veto is the same seam, but the terms-of-service rule is a DurinDoor error-config entry (`open-sse/config/errorConfig.js` L176), not a refresh decision. (e) **Unsupported** as a parity obligation: it is upstream-internal credential bookkeeping with no provider-contract surface. |
| Requests | (a) The Claude-shaped inbound routes decode `gzip` and `x-gzip` request bodies under the configured size cap and drop `Content-Encoding` after decoding (`sdk/api/handlers/request_body.go`, `sdk/api/handlers/claude/code_handlers.go`). (b) An Antigravity project-discovery failure with no upstream HTTP status is now a transient 503 rather than an invalid-request 400, and is credential-scoped (`internal/runtime/executor/antigravity_executor_auth.go`, `prepareAntigravityProjectIDError`); the Antigravity authenticator also carries the provider `Retry-After` hint out of project discovery (`internal/auth/antigravity/auth.go`). (c) The synthesized Antigravity `request.sessionId` is scoped per credential (`internal/runtime/executor/antigravity_executor_request.go`). (d) The Meta executor synthesizes unstreamed Responses messages and translates refusal parts. (e) The Codex executor synthesizes Responses output for the Claude, Gemini and OpenAI-chat target shapes. | (a) The inbound chat handler parses the body with `request.json()` (`src/sse/handlers/chat.js` L397), so a compressed body is rejected. (b) DurinDoor's Antigravity project comes from the connection, not from a per-request discovery call, so the upstream reclassification has no counterpart. (c) The Antigravity session id is already derived from the connection identity (`open-sse/executors/antigravity.js` L200-L202 and L312-L313). (d) and (e) are upstream's internal inbound-format translation, whose counterpart is DurinDoor's own translator layer (`open-sse/translator/`). | (a) **Actionable**. (b) **Already covered in effect**: there is no per-request discovery call to classify. (c) **Already covered**. (d) and (e) **Unsupported** as upstream-parity obligations: they change upstream's internal translation output, not a provider contract. |
| Model discovery | (a) The Codex live catalog refresh now synthesizes the `gpt-5.5` baseline entry from the best visible, API-supported, priority-tier template and stamps `minimal_client_version` (`cmd/fetch_codex_models/main.go`, `internal/client/codex/models/models.go`); the catalog content itself moved to the `gpt-6.2` generation (`internal/registry/models/codex_client_models.json`). (b) The Antigravity probe returns a distinct `forbidden` status for 403, separate from the 401 auth error, with a route-scoped backoff that survives access-token rotation while 401 and transient failures stay token-scoped (`sdk/auth/antigravity_models.go`, `sdk/cliproxy/antigravity_models.go`). (c) The Antigravity probe and hint store skip credentials whose status is disabled, not only those flagged disabled. | The Codex model list is still the static registry array (`open-sse/providers/registry/codex.js` L63-L109); `transport.usage.modelsUrl` (L57) is used for quota only. The visible entries of the upstream Codex client catalog (`internal/registry/models/codex_client_models.json`) at the current pin are `gpt-6.2-sol`, `gpt-6.2-astra`, `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` and `gpt-5.5`, plus three hidden entries; the per-plan static lists in `internal/registry/model_definitions.go` are unchanged across the two pins. The DurinDoor static list tracks that visible set except `gpt-5.5`, which DurinDoor retires for ChatGPT sign-in. The Antigravity probe classifier maps 401 and 403 to `auth_error` and every other non-2xx to `transient` (`open-sse/services/antigravityCatalog.js` L52-L58, wired at `src/app/api/providers/[id]/models/modelsConfig.js` L579-L585). | (a) **Still running**: a live catalog refresh is still absent (row D2). (b) **Actionable**: the 403 classification is now a contract difference, not only an upstream internal change. (c) **Already covered in effect**: the Antigravity probe is an on-demand per-connection call under `src/app/api/providers/[id]/models/`, so there is no probe queue that a disabled credential could occupy. |
| Quota | (a) The Antigravity credits warm hint runs under a bounded timeout instead of an unbounded cancel (`internal/runtime/executor/antigravity_executor_credits.go`). (b) The Antigravity 403 probe backoff is separated from token rotation (`f8e297aa`). (c) The Antigravity credits fallback honours stop rules and retry limits (`a35e8be3`). | Antigravity quota comes from the Cloud Code quota RPCs declared in `open-sse/providers/registry/antigravity.js` L29-L40 (`retrieveUserQuotaSummary`, `loadCodeAssist`) and is parsed in `open-sse/services/usage/google.js` L133. The Antigravity catalog probe is a separate call (`open-sse/services/antigravityCatalog.js` L33-L34). | (a) and (c) **Unsupported** as parity obligations: they bound upstream's internal background work. (b) **Actionable** with the model-discovery row, because a 403 currently reads as an auth rejection in DurinDoor. |
| New identities | None. No provider id, executor, authenticator, API-key group or inbound route was added upstream between the two pins. | Three entries were added since `3164ce3`: `gemini-interactions` (`open-sse/providers/registry/gemini-interactions.js`), `kimi-ai` (`open-sse/providers/registry/kimi-ai.js`) and `devin-cli-agentic` (`open-sse/providers/registry/devin-cli-agentic.js`). | **Already covered** on the upstream side: there is nothing new upstream to adopt. The DurinDoor additions close rows M1, M5 and D11 below. |

### Snapshot rows re-dispositioned against the current pins

| Row | Subject | State at the current pins | Disposition now |
| --- | --- | --- | --- |
| D1 | Codex API-key group | Upstream `config.example.yaml` `api-keys.codex` is unchanged; DurinDoor `codex` remains OAuth-only, now with the device flow added (`open-sse/providers/registry/codex.js` L130-L134). | **Still running.** |
| D2 | Codex live model catalog | Static registry array (`open-sse/providers/registry/codex.js` L63-L109); upstream keeps a live catalog that has moved to the `gpt-6.2` generation. | **Still running.** The static list content now tracks the upstream visible set except `gpt-5.5`, which DurinDoor retires on purpose. |
| D3 | Claude per-key cloak mode | Upstream `api-keys.claude` cloak block unchanged; DurinDoor keeps the `cloakToolsOnOAuth` transport quirk (`open-sse/providers/registry/claude.js` L26). | **Still running.** |
| D4 | Gemini surface split | DurinDoor carries `gemini` (API key), `gemini-cli` (AI Studio Build OAuth), `gemini-interactions` and `vertex`; upstream is unchanged. | **Already covered.** |
| D5 | `gemini-interactions` provider | Present: `open-sse/providers/registry/gemini-interactions.js`, with the inbound route at `src/app/api/v1beta/interactions/route.js`. | **Already covered.** |
| D6 | Vertex sign-in contract | Both sides unchanged since the snapshot. | **Already covered.** |
| D7 | AI Studio Build WebSocket relay | Upstream `internal/wsrelay/` unchanged; DurinDoor `gemini-cli` still speaks HTTP only. | **Still running.** |
| D8 | Antigravity probe and transport | The upstream probe now separates 403 from 401; DurinDoor still maps both to `auth_error` (`open-sse/services/antigravityCatalog.js` L53). The HTTP/1.1-without-ALPN pinning of the Cloud Code PA probe is unchanged upstream, and the upstream OAuth refresh moved off that pinning while DurinDoor never pinned it. | **Actionable** on the 403 classification; the transport observations stay open as recorded under *Antigravity observations*. |
| D9 | Kimi OAuth aliases | `kimi-ai` with alias `kimi.ai` (`open-sse/providers/registry/kimi-ai.js` L6-L8) and `kimi-coding` with alias `kimi.com` (`open-sse/providers/registry/kimi-coding.js` L8) now exist; the plain `kimi` id stays API-key only. | **Already covered** in the sense that every upstream alias id resolves; the OAuth surface still spans two provider ids. |
| D10 | xAI transports | Both sides unchanged. | **Already covered.** |
| D11 | Devin service kinds | `devin` remains credential-and-catalog only with `transport: null` and `serviceKinds: ["agent"]` (`open-sse/providers/registry/devin.js` L34-L36); `devin-cli-agentic` was added, which is the ACP surface, not the upstream chat executor. | **Still running** for the chat delta; the agent-kind routing half stays covered. |
| D12 | Meta vendor id | `muse-code` still reaches `api.meta.ai`; upstream `meta` unchanged. | **Already covered.** |
| D13 | OpenAI-compatible upstreams | The provider-node system is unchanged; upstream `openai-compatibility` unchanged. | **Already covered.** |
| D14 | Inbound compatibility | `/v1beta/interactions` (`src/app/api/v1beta/interactions/route.js`) and `/v1/alpha/search` (`src/app/api/v1/alpha/search/route.js`) now exist. There is still no `/backend-api/codex` alias group and no `/muse-code/*` group. | **Already covered** for the two routes that were missing; **still running** for the two alias groups. |
| D15 | Client setup | Upstream CLI flags and TUI OAuth tab unchanged; DurinDoor signs in through the dashboard and `/api/oauth/[provider]/[action]`. | **Still running.** |
| D16 | LAN discovery | Both sides unchanged. | **Already covered.** |
| M1 | `gemini-interactions` provider | Provider id, executor path and API-key surface exist (`open-sse/providers/registry/gemini-interactions.js` L17-L25). | **Already covered.** |
| M2 | AI Studio Build WebSocket relay | Unchanged on both sides. | **Still running.** |
| M3 | Devin chat-capable provider | Unchanged upstream; DurinDoor still refuses chat for `devin`. | **Still running.** |
| M4 | Meta as a first-party id | Unchanged; `muse-code` remains the single `api.meta.ai` entry. | **Already covered.** |
| M5 | Kimi OAuth provider ids | The upstream alias ids now exist in DurinDoor, split across `kimi-ai` (international endpoint `api.kimi.ai`) and `kimi-coding` (alias `kimi.com`); upstream keeps one executor and one model set behind all of them. | **Already covered** by the alias ids; the shared-executor shape stays a deliberate DurinDoor difference. |
| M6 | Config-declared OpenAI-compatible groups | The provider-node system remains the equivalent lifecycle. | **Already covered.** |
| M7 | `/v1beta/interactions` inbound route | Present: `src/app/api/v1beta/interactions/route.js`. | **Already covered.** |
| M8 | `/v1/alpha/search` inbound route | Present: `src/app/api/v1/alpha/search/route.js`. | **Already covered.** |

### Actionable candidate work

Bounded and testable. Every candidate uses synthetic inputs and a closed
outbound mock; none calls a provider service, and none is written or run here.

1. **Antigravity 403 probe classification (C1).** Upstream separates `forbidden`
   (403) from the 401 auth error and backs 403 off on a route-scoped key that
   survives access-token rotation; DurinDoor maps 403 to `auth_error`
   (`open-sse/services/antigravityCatalog.js` L53). Candidate: add a third
   outcome to `ANTIGRAVITY_CATALOG_OUTCOME`, return it for 403, and keep the
   last known catalog in place on a 403 exactly as on a transient failure.
   Test: extend `tests/unit/antigravity-project-catalog.test.js` with a
   synthetic 403 asserting the new classification, the preserved catalog, and
   the unchanged 401 to `auth_error` mapping.
2. **Gzip request bodies on the inbound routes (C2).** Upstream decodes `gzip`
   and `x-gzip` under the configured size cap and drops `Content-Encoding` after
   decoding; DurinDoor parses the body with `request.json()`
   (`src/sse/handlers/chat.js` L397), so a compressed body fails. Candidate:
   decode a gzip body in the inbound reader before parsing, reject an over-cap
   body with 413, and strip `Content-Encoding` after a successful decode.
   Test: new `tests/unit/inbound-gzip-body.test.js` posting a synthetic gzip
   body to the messages route, asserting the request reaches the mock provider
   as plain JSON, plus an over-cap case.
3. **Antigravity refresh-failure scope (C3).** Upstream makes a refresh failure
   credential-scoped; DurinDoor's generic refresh returns no credential and
   leaves the connection selectable. Candidate, characterization only: new
   `tests/unit/antigravity-refresh-failure-scope.test.js` pinning that a failed
   OAuth refresh publishes no credential, that the original upstream status
   surfaces to the caller, and that the connection remains selectable; the
   test names the upstream difference so a later change is deliberate.
4. **Codex live model catalog (C4, row D2).** Unchanged from the snapshot row.
   Candidate: `tests/unit/codex-model-catalog-refresh.test.js` mocking the
   Codex models endpoint, asserting that a refreshed catalog replaces stale
   entries and that a failed refresh keeps the last known good list.

### Closure limits

- Every upstream statement above comes from reading the pinned upstream tree at
  `f5c5681a8361c9da53e93c60b6507816eee7468b`. No provider API was called and no
  credential was used, so a disposition describes a code contract, not a
  verified runtime behavior.
- Every DurinDoor statement above comes from the worktree at
  `082b48d0f85e3a11579bede9c6e1e5ec5c21472c`. No DurinDoor behavior was
  exercised; the citations are source reads.
- The dispositions use four values: **already covered** (the upstream contract
  has a DurinDoor counterpart), **still running** (the delta persists and needs
  a product decision or a port), **actionable** (a bounded upstream-parity gap
  with a candidate above), and **unsupported** (the upstream change has no
  DurinDoor contract counterpart and needs no work).
- Upstream `main` is a moving target. The pin must be re-resolved before any
  port decision, and the candidate work above is scoped to the current pin.

C2 implementation (#2034): Messages and count tokens decode bounded gzip and
x-gzip before their existing parsers. The compressed and expanded limits use the
existing admission defaults and environment overrides. At CLIProxyAPI
[f5c5681](https://github.com/router-for-me/CLIProxyAPI/blob/f5c5681a8361c9da53e93c60b6507816eee7468b/sdk/api/handlers/request_body.go),
its shared reader also supports zstd, encoding chains and a valid-JSON fallback;
these are deliberately outside this contract. Its
[Claude handlers](https://github.com/router-for-me/CLIProxyAPI/blob/f5c5681a8361c9da53e93c60b6507816eee7468b/sdk/api/handlers/claude/code_handlers.go)
use that reader for both Messages and count tokens. Closed fixtures exercise the
route boundary; they do not establish live-provider or deployment behavior.

### Antigravity probe and refresh follow-up (#2034)

The on-demand catalog probe classifies 401 as `auth_error` and 403 as
`forbidden`. A forbidden result backs off in process per connection and project,
including across access-token rotation; changing projects or accounts does not
share that backoff. Failed probes leave the last synced catalog intact. The
backoff follows CLIProxyAPI `f5c5681a` `sdk/cliproxy/antigravity_models.go`'s
five-minute minimum and exponential equal-jitter window. Process restart clears
the in-memory history.

A rejected Antigravity OAuth refresh currently returns no replacement credential.
The request retains its original upstream error, and the refresh coordinator does
not itself quarantine the connection. OAuth failures may be transient, and this
path discards their cause, so applying durable credential-wide quarantine would
not be justified by the available failure signal.
