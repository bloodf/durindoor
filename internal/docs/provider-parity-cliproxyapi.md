# Provider parity: CLIProxyAPI

Internal reference for work order #2034. This file inventories the outbound upstream
providers that `router-for-me/CLIProxyAPI` (the Go CLI proxy gateway) registers, and
compares them against the provider catalog, authentication surface and runtime
dispatch that DurinDoor actually ships.

Scope is provider contracts only: registration, sign-in, dispatch and model
discovery. This document does not propose code changes, does not call provider
APIs, and contains no credential values.

[The AI Studio Build and hosted Devin follow-up](./aistudio-relay-parity-2034.md) records the verified delegation and model discovery on the merged DurinDoor base.

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
| D8 | `antigravity` | DurinDoor and upstream both ship a dedicated Antigravity provider with OAuth, but the model-discovery contract differs: upstream probes `fetchAvailableModels` with an HTTP/1.1-only, ALPN-free transport and persists per-account capability hints in credential metadata; DurinDoor's probe goes through the shared `proxyAwareFetch` path with no protocol control and no persisted per-account hint set. | upstream `sdk/auth/antigravity_models.go` (`configureAntigravityHTTP11Transport`, `BuildPersistedAntigravityCapabilityHints`); DurinDoor `open-sse/providers/registry/antigravity.js` L38–L51, `open-sse/services/usage/google.js`, `open-sse/services/projectId.js` | See the Antigravity section below for the specific acceptance test. |
| D9 | `kimi` | Upstream's Kimi is an OAuth provider with three provider ids (`kimi`, `kimi-ai`, `kimi.ai`/`kimi.com`) that share one executor and one model set. DurinDoor's `kimi` entry is API-key only, against `api.moonshot.ai/anthropic/v1/messages`; the OAuth Kimi surface is a different provider id (`kimi-coding`, alias `kmc`, device-code OAuth against `api.kimi.com/coding/v1/messages`). | `open-sse/providers/registry/kimi.js` L4–L14; `open-sse/providers/registry/kimi-coding.js`; upstream `sdk/cliproxy/service_executors.go` L394–L395, `sdk/auth/kimi.go` | `tests/unit/kimi-oauth-alias-parity.test.js`: assert `kimi`, `kimi-ai`, `kimi.ai` and `kimi.com` all resolve to one Kimi executor and one shared model list, and that the OAuth device-code credential refreshes without a new sign-in. |
| D10 | `xai` | DurinDoor ships `xai` with `authModes: ["oauth", "apikey"]` and three transports (`openai`, `openai-responses`, `openai-responses-oauth`), plus image, video, TTS, STT and realtime service kinds. Upstream's xAI executor is also HTTP plus WebSocket, but upstream's model list is static while DurinDoor sets `passthroughModels` to tolerate model ids that ship ahead of the registry. | `open-sse/providers/registry/xai.js` L16–L36, L62–L79; upstream `internal/runtime/executor/xai_executor.go`, `internal/runtime/executor/xai_websockets_executor.go` | `tests/unit/xai-passthrough-model-id.test.js`: request an unknown `grok-*` model id and assert it is forwarded rather than rejected by catalog validation, and that the OAuth and API-key transports differ only in the auth header. |
| D11 | `devin` | Upstream's `devin` is a chat-capable provider with an OAuth flow and a live model catalog. DurinDoor's `devin` is a credential-and-catalog-only cloud-agent entry with `transport: null` and `serviceKinds: ["agent"]`; chat is explicitly unsupported, and the LLM-style surface is a separate provider id (`devin-cli`, ACP over stdio). | `open-sse/providers/registry/devin.js` (header comment and L20–L35); `open-sse/providers/registry/devin-cli.js`; upstream `internal/runtime/executor/devin_executor.go`, `sdk/auth/devin.go` | `tests/unit/devin-agent-kind-routing.test.js`: assert a Devin connection advertises only the `agent` kind in `/v1/models`, that a chat request for that provider is rejected with a clear error, and that `devin-cli` remains separately routable. |
| D12 | `meta` | Upstream's `meta` provider is the Meta Muse OAuth device-code flow against `api.meta.ai`. DurinDoor reaches the same vendor through a different provider id: `muse-code` (alias `mc`, device-code OAuth with a `mintUrl`, format `openai-responses`, base `https://api.meta.ai/v1/responses`). DurinDoor's `meta` alias belongs to `meta-llama` (`api.llama.com`), which is a different vendor from upstream's `api.meta.ai`. | `open-sse/providers/registry/muse-code.js`; `open-sse/providers/registry/meta-llama.js` L2–L6; upstream `sdk/auth/meta.go`, `internal/runtime/executor/meta_executor.go` | `tests/unit/meta-provider-id-collision.test.js`: assert the alias `meta` resolves to `meta-llama` and that the `api.meta.ai` vendor is reachable only through `muse-code`, with no id collision in model resolution. |
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
| M4 | `meta` (as a first-party provider id) | The Meta Muse vendor is reachable only through the `muse-code` id, and the `meta` alias belongs to `meta-llama` (`api.llama.com`). Upstream has a single `meta` provider with its own authenticator, executor and model set. | upstream `sdk/auth/meta.go`, `internal/runtime/executor/meta_executor.go`, `internal/registry/model_definitions.go` L624; DurinDoor `open-sse/providers/registry/meta-llama.js` L4, `open-sse/providers/registry/muse-code.js` | `tests/unit/meta-provider-id-collision.test.js`: assert a catalog-wide scan finds exactly one entry pointing at `api.meta.ai`, that model resolution cannot land on `meta-llama` for a Meta Muse model id, and that the `meta` alias still resolves to `meta-llama` for backwards compatibility. |
| M5 | `kimi` (OAuth, three provider ids) | DurinDoor's OAuth Kimi surface is `kimi-coding`, a different provider id with a different base path (`/coding/v1/messages`). The plain `kimi` id in DurinDoor is API-key only, against `api.moonshot.ai/anthropic/v1/messages`, and the `kimi-ai` / `kimi.ai` / `kimi.com` ids do not exist. | upstream `sdk/cliproxy/service_executors.go` L394–L395, `internal/watcher/synthesizer/file.go` L309, `internal/thinking/provider/kimi/apply.go` L25–L28; DurinDoor `open-sse/providers/registry/kimi.js` L4–L14 | `tests/unit/kimi-oauth-alias-parity.test.js`: assert the three Kimi aliases resolve to one executor and one model list, that an OAuth Kimi credential is accepted, and that the alias does not collide with the API-key `kimi` connection. |
| M6 | Upstream `openai-compatibility` as a config-declared provider set | DurinDoor has no single registry entry that turns a config group into a first-class provider id. Operator-declared OpenAI-compatible upstreams live in the provider-node system instead, which is a different lifecycle (nodes and connections, not config groups) and does not reuse the upstream naming rule. | upstream `sdk/cliproxy/service_executors.go` L45–L79, `config.example.yaml` `api-keys.openai-compatibility`; DurinDoor `src/app/api/provider-nodes/` | `tests/unit/openai-compat-node-catalog.test.js`: assert a configured OpenAI-compatible group is discoverable under a provider key derived from its group name and that its models appear in `/v1/models`. |
| M7 | `/v1beta/interactions` inbound route | DurinDoor's Gemini-native bridge exposes `/v1beta/models` and `/v1beta/models/*action` only. Clients that speak the Interactions shape have no inbound path. | upstream `internal/api/server_routes.go` L149–L157; DurinDoor `src/app/api/v1beta/models/route.js`, `src/app/api/v1beta/models/[...path]/route.js` | `tests/unit/inbound-route-parity.test.js`: assert `POST /v1beta/interactions` is handled by a Gemini-native handler rather than falling through to the JSON 404. |
| M8 | `/v1/alpha/search` inbound route | Upstream exposes Codex native search at this path. DurinDoor exposes `/v1/search` and per-provider `searchViaChat`, but not the Codex-native alpha search route. | upstream `internal/api/server_routes.go` L93, `internal/api/handlers/handlers_execution.go`; DurinDoor `src/app/api/v1/search/route.js`, `open-sse/handlers/search/` | `tests/unit/inbound-route-parity.test.js`: assert the alpha-search path is either served or returns a deliberate, documented error, and that it never reaches a provider that cannot serve it. |

Notes on scope of "missing": items M1–M5 are provider-contract gaps. Items M6–M8
are surface gaps in how the same capability is exposed. None of these rows assert
that DurinDoor should copy upstream's exact id or shape; the acceptance tests are
written to accept an equivalent design.

## Antigravity observations

Recorded separately as requested. No Antigravity implementation was edited, and
no proposal below has been applied.

1. **Upstream pins the model probe to HTTP/1.1 without ALPN.** The upstream fix
   (`d0c90bb`, "fix(antigravity): enforce HTTP/1.1 without ALPN in model probe")
   clears `Protocols`, `ForceAttemptHTTP2`, `TLSNextProto` and `NextProtos` on the
   probe transport, because native Antigravity sends no ALPN extension. See
   [`sdk/auth/antigravity_models.go`](https://github.com/router-for-me/CLIProxyAPI/blob/6faa8d20b2673404cff70a2f2d9537ae0d0e684d/sdk/auth/antigravity_models.go)
   `configureAntigravityHTTP11Transport`. DurinDoor's equivalent probe goes
   through `proxyAwareFetch` with no protocol control, so the wire shape is not
   pinned. Whether that matters in practice is unverified here: no live Antigravity
   call was made.
2. **Upstream persists per-account capability hints.** Upstream stores the probed
   model ids and web-search model ids in credential metadata under
   `antigravity_capability_hints`, together with the project id and the sanitized
   endpoint, and refuses to persist an unknown (nil) catalog as an authoritative
   empty set. DurinDoor stores the quota response but has no equivalent persisted
   per-account model-hint set that survives a restart.
3. **Upstream treats an unknown catalog as transient, an unauthorized one as an
   auth error.** The upstream probe returns three distinct statuses, and only the
   auth-error status triggers credential handling. A DurinDoor equivalent split
   was not located.
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
6. **Suggested mock acceptance test for observation 1 and 2** (not written, not
   run): `tests/unit/antigravity-model-probe-hints.test.js` — serve
   `v1internal:fetchAvailableModels` from a mock, assert the probe request shape
   matches the upstream contract (single `project` field, bearer token, the
   Antigravity user agent), assert an unauthorized response is classified as an
   auth error and a malformed response as transient, and assert that a
   successful probe persists a capability-hint set that a later probe with an
   unknown catalog does not overwrite with an empty authoritative set.

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
