# 2.2.4

## Fixes
- **MCP instance enable/disable row toggle** — toggling an instance's enabled flag previously required opening the Edit modal. The instance row now exposes a `<Toggle>` that calls the existing `PUT /api/mcp-gateway/instances/[id]` directly, and the new helper `toggleInstanceEnabled` keeps the list in sync (`mcp-gateway/page.js`).

## Improvements
- **z.ai MCP auto-provision** — adding a z.ai API key in Providers can now create a z.ai MCP server in one click. The "New instance" modal exposes a "Z.AI MCP" preset that pre-fills the slug, title, kind, transport, and `https://api.z.ai/api/mcp/web_search_prime/mcp` URL; entering the `providerConnectionId` of a stored z.ai connection persists the reference. The API route validates that the connection exists, is active, and resolves to the `zai` canonical provider (`mcp-gateway/page.js`, `api/mcp-gateway/instances/route.js`).

## Tests / tooling
- **MCP providerConnectionId field** — added migration 012 (`mcp-provider-connection`) and the `providerConnectionId` column on `mcpInstances`. Fresh DBs pick the column up via the canonical `TABLES.mcpInstances`; v11 DBs catch up via the new migration, which tolerates the duplicate-column / missing-table errors so the chain stays idempotent (`db/migrations/012-mcp-provider-connection.js`, `db/schema.js`).
- **z.ai server-side Authorization** — `httpClient.buildHeaders` now resolves `providerConnectionId` server-side, decrypts the stored `apiKey`, and injects `Authorization: Bearer …` only for the pinned `https://api.z.ai/api/mcp/…` URL. The key never appears in the instance row, the API response, or any client-supplied payload (`mcp/gateway/httpClient.js`).
- **Test isolation** — `mcp-zai-provider-connection.test.js` covers the new column round-trip, the `updateInstance` preservation contract, and `getEnabledInstancesByIds` filtering.

# 2.2.3

## Fixes
- **Auto-configure Headroom badge** — a reachable external headroom proxy (CLI not installed locally, port reachable) was reported as Unavailable. The status classifier now considers the `running` signal in addition to `installed/detected` (`auto-configure/AutoConfigureClient.js`, `autoConfigure/headroom.js`).
- **Endpoint Local URL** — the displayed URL was hard-coded to port 20128 even when the service was running on a different port (e.g. 11434). It now reads the live `PORT` from the server (`endpoint/page.js`, `endpoint/endpointConstants.js`).
- **Firecrawl auto-configure false Unavailable** — the probe was hitting `GET /test`, which is 404 on the running Firecrawl build. It now falls back to a single `GET /` on the same candidate when `/test` returns 4xx (`firecrawl/firecrawlConfig.js`).
- **Endpoint Tunnel / Tailscale ready-but-Enable** — the rows showed "Enable" even when a Cloudflare named tunnel or a Tailscale system-daemon funnel was already serving the endpoint. The status APIs now surface `externalTunnel` / `systemTailscale`; the UI renders them as "External" with a copyable URL instead of a misleading Enable CTA (`tunnel/cloudflare/manager.js`, `tunnel/tailscale/manager.js`, `endpoint/EndpointPageClient.js`).
- **API-key daily limit broken layout** — the inline `<Input>` on the API-key card broke the row when `Unlimited` was rendered. The limit is now edited inside the existing API-key edit modal; the row shows a read-only "Daily limit: …" line (`endpoint/EndpointPageClient.js`).
- **PXPIPE / Headroom chart tooltips** — Recharts' default white tooltip was unreadable in dark mode and the timeline padded every day with `tokensSaved: 0`, hiding whether a day was a real measurement or just empty. The bucketing initializes `tokensSaved: null` and the tooltip uses theme colors plus a "No PXPIPE activity" label for null days.

## Tests / tooling
- **vitest worktree isolation** — exclude `**/.omc/**` from test collection.
- **noauth-models test isolation** — `build-models-list-noauth.test.js` now mocks `getSettings` so it no longer leaks to the operator's real `~/.9router` settings DB.

# 2.2.2

## Fixes
- **Providers config: unconnected local providers hidden** — under the default "Active only" filter, local no-auth infrastructure providers in the API-Key category (LM Studio, llama.cpp, llamafile, docker-model-runner, 9router, …) were shown as "active" without any connection, cluttering the grid. They now require a connection to appear under "Active only" and remain available under "Not configured" for setup. Genuine free no-auth cloud providers (free/freeTier categories) are unaffected (`providers/page.js`).

## Improvements
- **Headroom "Recent events" table is paginated** — the events table now uses the shared client-side pagination (20/page, adjustable) instead of rendering every row (`headroom/HeadroomClient.js`).
- **PXPIPE allowlist is easier to manage** — the Token Saver → PXPIPE "Allowed models" field now: explains *why* a model shows "Model not in allowlist" in History (PXPIPE only shrinks image payloads for allowlisted models); renders the current allowlist as removable chips; and offers one-click **quick-add buttons for models recently blocked** as `unsupported_model`, so operators no longer hand-copy model ids out of the History table (`token-saver/TokenSaverClient.js`).

# 2.2.1

## Fixes
- **Sidebar duplicates** — removed the duplicate top-level "Quota Tracker" and "Provider Health" nav entries; they now live only under the collapsible Providers menu (`SidebarNavIcons.js`).
- **MCP Gateway OAuth connect** — `window.open(url, "_blank", "noopener,noreferrer")` returns `null` (the `noopener`/`noreferrer` tokens suppress the window handle), so the OAuth "Connect" flow always reported "popup blocked" and never started status polling. Dropped the features string so the popup handle and polling work (`mcp-gateway/page.js`).
- **Dead/duplicate dashboard routes removed** — deleted the orphaned `mcp-gateway/keys` and `mcp-gateway/servers` sub-routes (unreachable clones; the hub page already renders both) and the unreachable `providers/new` page (legacy form with a dead "Connect with OAuth2" button; the real OAuth flow lives under `providers/[id]`).
- **Usage overview** — removed a stale commented-out duplicate "Cached Tokens" card in `OverviewCards.js`.

## Changes
- **Ollama Cloud hidden from the UI** — set `hidden: true` on the `ollama` cloud registry entry so it no longer appears in the provider grid / media-provider lists. The provider stays fully functional for existing connections (registry, usage, executor, translation untouched); Ollama Local is unaffected.

## Tests / tooling
- **vitest worktree isolation** — exclude `**/.omc/**` (the current worktree convention) from test collection, matching the existing `**/.claude/**` exclude, so nested in-flight worktrees no longer break collection.
- **`build-models-list-noauth` isolation** — the suite now mocks `getSettings` so it no longer leaks to the operator's real `~/.9router` settings DB (where keyless providers like Pollinations / The Old LLM may be opted out), which had been hiding the keyless catalog under test.

# 2.2.0

## Features
- **AgentRouter runtime transports** — add per-format `transports[]` (claude + openai) and per-model `targetFormat` so AgentRouter Claude models stay on the source Claude wire while `deepseek-v3.2` routes to the OpenAI transport (PR #126 regression fix).
- **AliCode Intl endpoint** — switch `open-sse/providers/registry/alicode-intl.js` baseUrl from `coding-intl.dashscope.aliyuncs.com/v1/...` to `dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions` so standard DashScope keys work.
- **xAI Grok CLI proactive refresh** — `grok-cli` OAuth `mapTokens` now stores absolute `expiresAt` in addition to `expiresIn`, enabling proactive token refresh instead of waiting for the 40-45 minute silent-expiry window.
- **Model capability overrides** — new migration `011-model-capability-overrides` adds per-key model capability overrides; `SCHEMA_VERSION=11`. Headroom circuit breaker already on dev via #356; bulk-add API-key overwrite already on dev via `apiKeyConnectionName.js`; Grok Build protocol fingerprint already on dev inline in `grok-cli.js` executor; Thai i18n and featherless registry already on dev.
- **Auto-combo engine + resolver + preview** — combo engine backend analysis, resolver wiring, and compression preview route/dashboard page merged.
- **Catalog allowlist tooling** — reviewed orphan allowlist to diff tool.
- **Codex review followups** — persistence, usage, stream, and translator Codex review findings closed.

## Fixes
- **MCP transport race hardening** — stdio/HTTP/SSE transport races in MCP gateway hardened.
- **Migrations** — consolidated migration registry (now 004-010 + 011).
- **AliCode Intl** — `alicode-intl` compatible-mode endpoint fixes the fork-original URL.

# 2.0.0

## Features
- **xAI**: route the Responses-tagged model grok-4.20-multi-agent-0309 to Grok's native `/v1/responses` endpoint; plain chat models keep `/v1/chat/completions` (OmniRoute #6709, upstream 9router #2439).
- **CLI tools**: Grok Build (xAI CLI) tool card + settings — apply/reset a routed `[model.9router]` slot in `~/.grok/config.toml` with previous-default restore and TOML-injection hardening (9router #2571).
- **GitHub Copilot**: route Claude models through Copilot's native `/v1/messages` endpoint so prompt-cache token counts (`cached_tokens`) surface; non-Claude models keep `/chat/completions` (upstream 9router #2608).
- **Token Saver**: aggregate token-saver telemetry with per-request persistence and period aggregation, dashboard overview, stats API + live stream, and fail-open recording on chat and /v1/responses (#2562).
- **Updater**: one-click Update in the dashboard sidebar (auto install + restart via the detached updater status endpoint, bounded poll with manual fallback; decolua/9router #2575).
- **Auto-configure**: add idempotent Headroom, PxPipe, Firecrawl, and RTK/Caveman/Ponytail setup scripts, plus CLI, API route, and dashboard System menu.

## Fixes
- **MiniMax-M3**: attach the OpenAI transport in the dashboard translator step 3 so the executor uses the `/v1/text/chatcompletion_v2` endpoint and matching headers; clamp unsupported `tool_choice` values (`"required"` and function objects) to `"auto"` on the OpenAI transport (upstream decolua/9router#2533).
- **Claude**: map `claude-fable-5` and `claude-mythos-5` to `claude-adaptive` thinking format; sanitize unsigned, invalid, or default-signature historical thinking blocks and never synthesize placeholder thinking for those models. Preserve Opus/Sonnet signed-thinking history and placeholder behavior.
- **Anthropic**: do not trigger account fallback for `invalid_request_error` 400 responses; `providerFieldStrips` no longer strips top-level `thinking` when a 400 error points to a nested `messages.*.content.*.thinking` path.
- **Models**: discover OpenAI/Anthropic-compatible provider models in `/v1/models` — the old UUID suffix guard skipped UUID-v4 compatible node IDs and prevented `fetchCompatibleModelIds` from running (upstream #2645).
- **Claude Code**: strip the `cc/` provider prefix from `ANTHROPIC_DEFAULT_*_MODEL` when writing Claude Code settings so bare model ids (e.g. `claude-opus-4-8`) reach Anthropic instead of 400 (upstream #2645).
- **Bootstrap**: strip empty-string `process.env` values before app modules load so Docker `-e KEY=` no longer overrides real values and crash-loops the container (OmniRoute #6828).
- **Routing**: the `auto` combo's no-auth candidate pool now honors a disabled provider connection's own `isActive=false` (the main Providers grid toggle), seeding chat-eligible no-auth providers by default and gating them out when their connection row is disabled (OmniRoute #6889, fixes #6557).
- **Codex**: rewrite replayed assistant history `input_text`/`text` parts to `output_text` (dropping `annotations`/`logprobs`/`obfuscation`) so the Codex/OpenAI backend accepts codex-cli conversation replays; user and function items unchanged (OmniRoute #6932).
- **Codex**: echo the client-requested effort-suffixed model id (e.g. `gpt-5.5-xhigh`) in Responses `response.created`/`response.in_progress`/`response.completed` payloads so the Codex CLI status line shows the active effort, without changing the routed upstream model id (OmniRoute #6820).
- **Models**: route `/v1/models` live model-list discovery through the local-first provider-validation SSRF guard (`getProviderValidationGuard`) so LAN-local OpenAI-compatible providers (e.g. LM Studio on 192.168.x.x) appear under default settings while cloud-metadata endpoints stay blocked before any fetch; discovery fetches force `redirect: "manual"` (OmniRoute #6966).
- **Providers**: adding a second API-key connection for the same provider no longer silently overwrites the first — POST /api/providers now runs create-only and returns 409 `PROVIDER_CONNECTION_ALREADY_EXISTS` on a duplicate (provider, apikey, name), the Add-API-key modal pre-fills a unique provider-scoped default name (`main`, `main-2`, …), and PUT /api/providers/[id] remains the explicit update path (OmniRoute #6499).
- **CLI**: `waitServerReady()` no longer reports ready from a raw TCP accept alone — it classifies each health probe as ready / fast-reject / hanging / not-listening, so the "server is running" banner no longer fires while the backend still cannot answer a request (OmniRoute #6892).
- **GitHub Copilot**: harden the native `/v1/messages` Claude route — strip params upstream rejects (`temperature`, non-4.6 `thinking`/`reasoning_effort`), map `max_completion_tokens`/`stop`/`tool_choice:"none"` to Anthropic shapes, bound the fetch with the provider connect timeout, retry transient 502/503/504 and network failures, drop the Claude Code persona for non-Claude-Code Copilot clients, and strip unsigned `thinking` history (upstream 9router #2608, Codex #291).
- **Resilience**: honor explicit daily/weekly/monthly quota-exhausted text on apikey-category 429s — bench the connection for the parsed reset window (or preserve `exhausted` state when resetless) instead of retrying on the generic transient backoff; ordinary transient 429s keep exponential backoff (OmniRoute #6731 / #6638).
- **Gemini**: omit unsupported thinking config for Gemma 4 on OpenAI-to-Gemini requests (OmniRoute #6708).
- **Routing**: clamp reasoning-token headroom to explicit model output caps and isolate fallback attempts (#6714).
- **OAuth**: regression-test Codex OAuth connection dedup — Codex same-email logins remain isolated by account and provider, preventing silent token overwrite (OmniRoute #6706; behavior already enforced by account-id-scoped dedup).
- **Claude streaming**: defer `content_block_start` until a streamed tool name arrives so GLM-style split id/name chunks no longer emit an empty tool name (OmniRoute #6730).

## Providers
- **Kiro**: add the GPT-5.6 family (Sol/Terra/Luna) as synthetic `-thinking`/`-agentic` variants with a 272k context window and per-tier rate multipliers, expose MITM picker slots for the new base ids, preserve static alias-to-provider mapping for combo capability aggregation, and normalize dash-form ids before pricing lookup (upstream decolua/9router#2596).

- **Ollama**: accept native `application/x-ndjson` streams from ollama-local backends instead of blocking them as error pages, and pass raw NDJSON through the Ollama-compat `/api/chat` transform (upstream #2541).
- **Gemini**: omit unsupported thinking config for Gemma 4 on OpenAI-to-Gemini requests (OmniRoute #6708).
- **Routing**: clamp reasoning-token headroom to explicit model output caps and isolate fallback attempts (#6714).
- **OAuth**: regression-test Codex OAuth connection dedup — Codex same-email logins remain isolated by account and provider, preventing silent token overwrite (OmniRoute #6706; behavior already enforced by account-id-scoped dedup).
# v1.1.0 (2026-07-14)

First published DurinDoor release since v1.0.1. Includes the previously
unreleased v1.0.2 changelog and version changes (brand + build), which ship
here for the first time.

## Features
- **Compression**: token-compression engine catalog wired into chatCore, with a compression-studio preview (#203, #223).
- **Quota**: atomic quota-aware routing with preflight + fallback and per-provider quota trackers/persistence (#211, #212, #213).
- **Auto-combo**: combo engine with patches and resolver for multi-provider routing (#205).
- **Health**: provider health monitoring and free-provider rankings (#198).
- **Playground**: full chat playground replacing basic-chat (#199).
- **Realtime**: OpenAI realtime WebSocket bridge (#192).
- **Catalog**: refreshed model catalog and paid-model filtering across catalog and pickers (#193, #200).
- **UI**: show Codex plan labels in provider and quota views (#241).

## Providers
- **Kimi Web**: add the www.kimi.com consumer-chat provider with web-cookie auth (#140).
- **SenseNova**: Token Plan support with OpenAI-style reasoning and a max-tokens clamp (#138).
- **OpenRouter**: register the rerank provider and `/v1/rerank` routing (#139).
- **grok-cli**: cap tools at 200 for the cli-chat-proxy and add usage/quota parsing (#237, #246, #248).
- **OpenAI**: route GPT-5.6 Sol tools through the Responses API; honor GPT-5.6 effort semantics on the Codex wire (#233, #240).
- **Ollama**: add a native Claude transport (upstream #2475).
- **MiniMax**: OpenAI transport passthrough (#234).
- **Codex**: fast tier, long contexts, capacity SSE, reset-credit expiry, and refresh-token family-revocation cascade (#217, #235, #236).
- Providers batch (ClinePass, NVIDIA, and more) (#195).

## Security
- Require `API_KEY_SECRET`; refuse the hardcoded HMAC fallback (SEC-B-01) (#231).
- Encrypt OAuth tokens and API keys at rest in provider connections (SEC-B-02) (#232).
- Close SSRF holes in provider-node validation, proxy-test, and the MCP gateway; fail-closed CORS and sanitized errors (SEC-A-01/02/03) (#228, #229, #230, #191).

## Localization
- Complete Simplified Chinese UI translations and guard English/zh-CN key parity (#2436).
- Indonesian caveman language pack (#222).

## Fixes
- **Thinking/Kiro**: keep request-only thinking controls out of provider model IDs, validate native Kiro envelopes, preserve direct-route sessions, and reconcile Claude passthrough thinking budgets.
- **Anthropic**: lowercase the `anthropic-version` header to prevent duplication on `/v1/messages` (#238).
- **Headroom**: allow larger prompt compression to finish (#239).
- **Dashboard**: support buffered tunnels and stable quota refresh via a single auto-refresh scheduler (#243).
- **Gemini**: preserve chat `file_data` PDFs through openai-to-gemini translation (#147).
- **Translator**: preserve reasoning/thinking history across the OpenAI request bridge; prevent doubled tool args OpenAI↔Claude; per-toolUseEvent Kiro tool-call indices (#214, #215, #224).
- **MCP gateway**: harden stdio/HTTP/SSE transport races and error shapes (#218, #219, #220).
- **Usage**: validate page bounds and refetch tabs on reset without clobbering the period (#226).
- **Executors**: source `DEFAULT_MODEL` from the provider registry; dedupe mimocode keys; use `ANTHROPIC_API_VERSION` in zenmux-free (#225, #227).

## Brand
- Rebrand all user-facing documentation, GitBook, Docker docs, CLI README, and assets to the DurinDoor identity.
- Remove non-English documentation; keep English-only docs for now.
- Rename skill modules to the `durindoor-*` namespace and update URLs to `bloodf/durindoor`.
- Update favicon and app icons to the new DurinDoor mark.
- Fix release workflow to publish the `cli` package rather than the private root package.

## Build
- Bump root and CLI package versions to 1.1.0.

# v0.5.18 (2026-07-03)

## Features
- **Usage**: track cached tokens + correct input/output/cache cost (#2209) — hodtien
- **Codex**: show reset credit expiry details (#2290) — Rafli Ahmad Zulfikar
- **NVIDIA**: add new models and capabilities — decolua
- **ClinePass**: add provider support — sternelee

## Fixes
- **Usage**: dedupe streaming request-details log entries — Qin Li
- **Claude**: drop foreign thinking signatures in passthrough — decolua
- Prevent non-SSE stream pipe crash and cross-IdP account overwrites (#2244) — KunN-21
- **Kiro**: route IdC auth to regional CodeWhisperer surface (#2297) — Volodymyr Saakian
- **Kiro**: add Claude Sonnet 5 model support (#2264) — Edison42
- **Xiaomi-tokenplan**: region selector, key validation, multi-connection (#2251) — MiQieR
- **Translator**: strict Anthropic content block compliance (#2225) — Sahrul Ramadhan Hardiansyah
- **Kimchi**: strip reasoning_content echo to bound multi-turn input tokens — KunN-21
- **Kimchi**: bump User-Agent to kimchi/0.1.40 (#2256) — Ansh7473
- **Codebuddy-cn**: strip empty tool_calls arrays to preserve reasoning — zmf
- **Antigravity**: preserve Claude tool delta index (#2223) — Sutarto Jordan Chrisfivo
- **MITM**: generate root CA on server startup (#2228) — Sutarto Jordan Chrisfivo

# v0.5.15 (2026-06-29)

## Features
- Add Kimchi OAuth provider — Nant361
- Refine Qwen vision/video + thinking model patterns — decolua
- Opt-in Codex auto-ping quota keep-alive — Emirhan

## Fixes
- **Responses**: handle response.done terminal events (#2142) — rifuki
- **Headroom**: skip unsafe responses tool history (#2132) — Sutarto Jordan Chrisfivo
- **Translator**: map mid-conversation system message to user (claude→openai) — decolua
- **Gemini**: normalize contents to prevent 400 invalid_argument (#2192) — warelik
- **Gemini**: backfill thoughtSignature + suppress stream done sentinel — WARELIK
- **Alicode**: preserve cache_control for DashScope providers (#2069) — Rex
- **Antigravity**: strip deprecated/readOnly/writeOnly from tool schemas — iletai, Yudhistira-Official
- **CodeBuddy CN**: show bonus packs as one-time, not monthly-replenishing — whale9820
- **Kiro**: strip leaked <thinking> tags from content stream (#2158) — hamsa0x7
- **Tray**: make Windows context menu DPI-aware — Emirhan
- **Kilocode**: expose full gateway catalog in combo model picker — jellylarper
- **OpenCode**: fix Go GLM — decolua

# v0.5.12 (2026-06-26)

## Features
- Add token-saver dashboard page — decolua
- Add bulk delete for provider connections — teddytkz
- Resolve GitHub Copilot model catalog from upstream — caiqinzhou
- Add Venice AI provider — Brokenc0de
- Add Kiro external_idp import for Microsoft SSO (CLIProxyAPI) — Stevanus Pangau
- Overhaul Blackbox provider catalog + WebUI test support — suryacagur

## Fixes
- Provider thinking compatibility (DeepSeek/Gemini) — Mink Nguyen
- Stop double-counting streaming usage at source — decolua
- Usage logging dedupe to reduce stats churn — Mink Nguyen
- Prevent non-JSON SSE lines / duplicate [DONE] from breaking clients (PR #2046) — qianze
- Resolve Gemini TTS models from catalog — nguyenha935
- Support Kiro IDC (organization) token import — quanturbo
- Preserve forced streaming for JSON clients (#2031) — Joseph Yaksich
- Preserve Responses text format (Codex) — tenglong
- Support Gemini native TTS generateContent endpoint — nguyenha935
- Add missing zh-CN endpoint key label (i18n) — weimaozhen
- CodeBuddy: only send reasoning params when client requests reasoning (#2071) — Rex
- CodeBuddy CN: show one-shot bonus packs as expiring, not monthly-replenishing
- Show custom provider models in combo picker — Sapto
- Docker: add docker-compose.yml with headroom enabled by default — nitsuahlabs
- Clarify token diagnostics vs provider billing (headroom, #1998) — Sutarto Jordan Chrisfivo
- Translate openai-responses input through OpenAI for compression (#1998) — Ankit
- Kiro: report 1M context window for claude-opus-4.8 — EdisonPVE
- Avoid stale redirects after auth changes (#2100) — Emirhan
- Mark Claude Opus 4.7 (dashed id) as 1M context — Brokenc0de
- Preserve reasoning effort through Codex translations — ntdung6868
- Token-saver: full width card layout — decolua
- Antigravity: retry transient upstream failures — Sutarto Jordan Chrisfivo
- Param-support: handle strip rules without match/drop (#1960) — Joseph Yaksich
- Translator: resolve custom provider prefix in debug endpoint (#1083) — hamsa0x7

# v0.5.8 (2026-06-21)

## Features
- **Antigravity**: native image generation support (image models tagged kind:image, hiển thị trong media-providers UI)
- **CodeBuddy CN**: API key auth + credit quota tracker
- **CodeBuddy CN**: short model prefix alias "cbcn"

## Fixes
- **MiniMax-M3**: enable vision capability
- **Headroom**: support Docker sidecar proxy
- **Antigravity**: image executor fixes
- **mimo-free**: Chrome User-Agent rotation to bypass anti-abuse gate
- **cloudflare-ai**: flatten content-part arrays to string to avoid oneOf 400 (#1926)
- **Translator**: normalize tools to Anthropic-native shape for non-Anthropic providers
- **CLI**: handle Next.js 16 nested standalone output path (#1940)
- **Codex**: preserve custom tools during request normalization
- **next.config**: add new route for responses endpoint to API

# v0.5.6 (2026-06-20)

## Features
- **Ponytail**: minimalist code generation feature
- **Headroom**: proxy lifecycle management + dashboard UI (one-click start/stop, install detection, status probing, token saver, claude↔openai shape conversion)
- **CodeBuddy CN**: new OAuth provider (copilot.tencent.com) — 15-model catalog, /v2 inference, forced streaming, OpenAI-style reasoning
- **OpenCode-Go**: align models with official endpoints; route Qwen 3.7 MiniMax via /v1/messages, GLM/Kimi/DeepSeek/MiMo via /chat/completions

## Fixes
- **Anthropic-compatible validation**: use POST /v1/messages (GET /models not spec, false "invalid" for valid keys)
- **CLI tools**: tolerate JSONC configs in all 8 settings routes (opencode, openclaw, kilo, droid, cowork, copilot, claude, cline)
- **Gemini/Antigravity**: preserve 'pattern' in tool schema translation (glob/grep)
- **Combo/Fusion**: flatten Anthropic-style tool messages in panel calls (prevent 503)
- **Models**: store provider custom models by provider scope
- **Perplexity**: use /v1/models endpoint for key validation

# v0.5.4 (2026-06-18)

## Fixes
- **Kiro**: honor thinking effort budgets
- **AG/Kiro/Xiaomi**: provider fixes
- **Combo/Fusion**: flatten tool history in panel calls to prevent 503
- **LLM selector**: show custom vision models in selector and model list
- **Image**: prevent compatible nodes from shadowing provider aliases

# v0.5.2 (2026-06-17)

## Features
- **Combo Fusion strategy** — fans the prompt out to all member models in parallel, then a configurable judge model synthesizes one final answer (quorum-grace, anonymized sources, graceful degradation)
- **Per-combo strategy selector** — pick `fallback` / `round-robin` / `fusion` / `capacity` per combo (replaces the old round-robin toggle), with a judge picker for fusion
- **Capacity auto-switch** — reorders models per request so images/PDFs route to capable models first
- **Kiro headless API-key auth** (`ksk_`) + direct `claude↔kiro` route that avoids the lossy OpenAI two-hop pivot
- **Claude auto-ping** — warms the 5h quota window right after reset so a fresh window starts immediately (per-connection toggle)

## Fixes
- **Claude 429**: stop hammering the OAuth usage endpoint — cache resetAt, throttle quota refresh to 3 min, cool down after a 429 (chat unaffected)
- **Usage logs always empty**: missing `await` on `getAdapter()` in `getRecentLogs` made `/api/usage/logs` & `/api/usage/request-logs` return nothing
- **Executors**: strip params unsupported by the provider/model (drops deprecated `temperature` for claude-opus-4 → Anthropic 400)
- **Translator**: derive deterministic tool_call ids for gemini/antigravity → OpenAI so function call/response pair correctly (fixes tool-pairing 400s)
- **Antigravity**: strip `optional` from tool schemas before sending to Gemini
- **Claude-to-OpenAI**: handle OpenAI-format responses in the non-streaming path (e.g. xiaomi-tokenplan)
- **Usage views**: show edited connection names consistently across Providers & Quota Tracker
- **Security**: hardened reverse-proxy local-access trust
- **Security**: SSRF hardening on web fetch

## Internal
- Large **open-sse / translator refactor** (~40 commits): unified provider/model registry (LiteLLM-style `models[]` + `kind` field, 100 co-located registry files), single-sourced media/OAuth/refresh/token URLs, registry-based dispatch for usage & token-refresh, DRY translator concerns (buildUsage, encodeDataUri, finishReasonMap, chunkBuilder, reasoningDelta…), ESM-safe registry init, large-file splits, dead-code removal, and golden/no-regression test gates

# v0.4.80 (2026-06-13)

## Features
- Vercel AI Gateway: support embeddings, images and credit usage (#1183)
- Add MiMo Free no-auth provider (#1789)
- Vertex: support ADC `authorized_user` credential
- Cowork: re-enable Claude Cowork with preset-only stdio MCP
- Codex: bulk add accounts via JSON (#1719)
- Kiro: enable multi-endpoint failover for GenerateAssistantResponse (#1722)

## Fixes
- Security: re-auth on DB export/import + SSRF guard on web fetch
- Auth: real client IP rate-limiting + remote default-password guard
- Cerebras/Mistral: strip unsupported `client_metadata` from downstream requests (#1742)
- SiliconFlow: update baseUrl `.cn` -> `.com` + curate verified model list (#1760)
- Gemini-to-OpenAI: route unsigned thought parts to `reasoning_content` (#1752)
- Claude-to-OpenAI: strip Anthropic billing header from system prompt (#1765)
- Anthropic-compatible: send Bearer auth for third-party gateways (#1795)
- Usage-stats: avoid partial stats on initial SSE race (#1767)
- Proxy: use `export default` in proxy.js for Next.js 16 middleware detection
- Claude passthrough: add body normalization
- GitHub Copilot: refresh missing/expired token on models discovery (#1727) + add mappable gpt-5-mini/gpt-5.4-nano slots for Copilot MITM (#1653)
- Kiro: auto-resolve profileArn to prevent 403 on IDC login, enhance profile ARN resolution, update endpoint to `runtime.us-east-1.kiro.dev` (#1713)
- Tunnel: detect system-installed Tailscale via dual-socket probe (#1723) + non-blocking probes to prevent UI freeze
- CommandCode: force `stream=true` in transformRequest (#1706)
- Qoder: increase timeouts for reasoning models and improve stream handling
- Dashboard: show provider node name instead of connection name in topology (#1770) + show explicit `kind="llm"` combos on combos page (#1684)

## Docs
- README: add Indonesian DurinDoor tutorial video (#1709)

# v0.4.71 (2026-06-06)

## Features
- Caveman: add wenyan classical Chinese levels and sync upstream prompts; locale-based visibility on endpoint page
- i18n: endpoint exposure notice across multiple languages + Russian README
- Antigravity: add gemini-3.5-flash-extra-low (Low) model
- xiaomi-tokenplan: add Claude-native MiMo V2.5 Pro alias via dedicated executor
- Qoder: fetch latest model + dashboard import-model button (#1642)
- MiniMax: add MiniMax-M3 + update Quota Tracker coding/CN (#1631)

## Fixes
- Codex: harden streaming timeouts (stall/connect raised to 60s, configurable per-provider), accept `response.done` event, and always emit a terminal `response.failed` + `[DONE]` for Responses passthrough when a stream closes, stalls, or aborts before a terminal event — prevents codex clients from hanging (#1648, #1680, #1688, #1618)
- Codex: durable OAuth refresh lifecycle (#1664)
- Tunnel: skip virtual interfaces to prevent false netchange watchdog
- Claude: fix forced tool_choice 400 on cc/ OAuth route (#1592)
- Proxy: raise Next client body limit to 128MB via `NINEROUTER_PROXY_CLIENT_MAX_BODY_SIZE` (#1529, #1572)
- MiniMax: echo `reasoning_content` on follow-up turns to avoid 400 (#1543)
- Kiro: handle 400 on tool-bearing history without client tools; add mappable "auto" model slot; fix binary EventStream crash + add models & TTS tool filtering
- Antigravity: passthrough tab-autocomplete + mark default agent slot mandatory
- Qoder: allow `qmodel_latest` model key (#1638)
- Providers: restore one-connection guard for compatible/embedding nodes
- Model-test: route image/STT probes to their real endpoints, harden STT ping; add opencode-go + xiaomi-tokenplan to connection test (#1576, #1628)

## Improvements
- Dashboard: reorganize menu actions across sidebar/header/profile
- Translator: add data-driven coverage, bug-exposing cases, and real provider smoke tests

# v0.4.66 (2026-05-29)

## Features
- Add Qoder provider: device-flow OAuth, COSY signing, WAF-bypass body encoding, live model catalog, dashboard quota tracker, 11 models (#1372)
- Add new models: Claude Opus 4.8 (Claude Code), GPT 5.4 Mini (Codex)

## Fixes
- DeepSeek thinking mode: echo `reasoning_content` back on follow-up/tool-call turns so OpenCode-free and custom providers no longer 400 with "reasoning_content must be passed back" (#1543)
- Reasoning injector: match deepseek/kimi model ids case-insensitively (covers custom providers using capitalized model names)
- OpenCode suggested-models: include free models without the `-free` suffix, e.g. `big-pickle` (#1535)

## Improvements
- Codex: trim sunset models, keep gpt-5.5 / gpt-5.4 / gpt-5.3-codex family, add gpt-5.4-mini
- volcengine-ark: refresh model list (add DeepSeek-V4-Flash/Pro, drop EOL entries)
- Lower stream stall timeout 35s → 30s for faster hang detection

# v0.4.63 (2026-05-26)

## Fixes
- GitHub Copilot: never route Gemini/Claude models to the `/responses` endpoint; prevents misleading "does not support Responses API" 400s (#1062)
- proxyFetch: restore missing `Readable` import causing runtime `ReferenceError` in DNS-bypass fetch path

## Improvements
- Lower stream stall timeout from 60s → 35s for faster hang detection

# v0.4.62 (2026-05-26)

## Fixes
- Codex: auto-retry when upstream drops mid-stream (no more hangs)
- Codex: fix random 400/404 errors, tool-calling failures, and unstable prompt cache
- MITM: support Antigravity 2.x 
- Sanitize Read tool args to prevent retry loops from non-Anthropic models (#1144)
- Implement json_schema fallback for OpenAI-compatible providers without native Structured Output (#1343)
- Strip empty Read pages argument in OpenAI-to-Claude translator (#1354)
- Forward Gemini output dimensions for embeddings (#1366)
- Resolve setState-in-effect errors in dashboard components (#1362)
- Gemini CLI: reuse stored OAuth project IDs for quota checks and show clearer setup guidance when the project is missing (#1271, #1428)

## Features
- Add Cloudflare Workers proxy deployer and pool integration (#1360)
- Add Deno Deploy relays support and improved proxy pools dashboard layout (#1437)

## Improvements
- Refactor Tunnel into dedicated Cloudflare and Tailscale manager modules
- Refactor tokenRefresh service with in-flight dedup to prevent refresh_token_reused errors

# v0.4.59 (2026-05-21)

## Fixes
- OAuth: fix login flow on Windows

# v0.4.58 (2026-05-21)

## Features
- xAI Grok provider (OAuth, API key, image)
- Provider limits: paginated accounts with page size controls

## Fixes
- Tailscale: fix connection status on Windows (#1300)
- Tunnel: fix false "checking" when tunnel URL is reachable
- Stream: fix pipe errors on client disconnect/abort

# v0.4.55 (2026-05-18)

## Features
- Xiaomi MiMo Token Plan: region selector (Singapore / China / Europe) — keys are cluster-specific
- Antigravity: risk confirmation dialog before first connection
- Gemini CLI: surface upstream retry delay on 429 errors

## Fixes
- MITM: cannot kill process on macOS under sudo (lsof not found in PATH)
- Stream: false-positive stall timeout on Claude reasoning / Kiro responses
- Tunnel: cannot re-enable after disable (stuck state)
- Tunnel: cloudflared error messages now include log tail for easier debugging
- Language switcher: applies selected locale immediately on close (#1234)
- Antigravity OAuth: metadata now matches the official client

## Improvements
- Gemini CLI: bump engine to 0.34.0
- Re-hide `qwen` (OAuth EOL) and `iflow` (not ready) providers

# v0.4.52 (2026-05-17)

## Features
- Add Vercel AI Gateway provider support (#1183)
- rtk: Kiro format tool result compression — handle conversationState.history & currentMessage, preserve error results, ~13.6% savings (#1194)

## Fixes
- openclaw: normalize agent.model object form `{primary, fallbacks}` before .startsWith → fix TypeError & 'not configured' status (#1216)
- Usage Details pagination: stay inside mobile viewport <640px (#1218)
- Fix test model error
- Fix MIMO provider in Codex
- Disable log file creation when using MITM AG

# v0.4.50 (2026-05-16)

## Fixes
- Fix duplicate tray icon on macOS when hiding to tray
- Fix tray not showing in background mode on macOS
- Fix hide to tray broken on Windows/Linux
- Fix Shutdown button in web UI not working

# v0.4.49 (2026-05-16)

## Features
- Add Kiro provider support: full request/response translation, live model listing, reasoning content support
- Add `buildOutput` RTK filter with autodetect for npm/yarn/cargo build logs
- Add MITM warning notification in tray and dashboard

## Improvements
- Add modalities (input/output) to model configuration for OpenCode
- Fix tray hide-to-tray: keep current process alive instead of spawning detached child (fixes macOS NSStatusItem ghost icon)
- Fix tray kill: graceful shutdown with SIGTERM/SIGKILL escalation
- Fix SIGHUP handling so macOS terminal close doesn't kill tray process
- Hide deprecated providers (qwen, iflow, antigravity)
- Update i18n across 32 languages

## Fixes
- Fix model check (test-models) blocked by dashboardGuard: pass machineId-based CLI token in internal self-calls

# v0.4.46 (2026-05-15)

## Breaking Changes
- Tunnel public URL changed — old tunnel links no longer work, please reconnect to get the new URL
