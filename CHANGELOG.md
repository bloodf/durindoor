# Unreleased

## Added

- Kiro's static model catalog now advertises `simple-task` and `minimax-m2.1`, and its MITM picker labels `simple-task` correctly. Ports decolua/9router#3610 while retaining the fork-evidenced case-sensitive `MiniMax-M2.5` wire ID.

## Fixed

- Responses clients now receive ordered text and function-call items in terminal `response.completed.response.output`; Gemini/Antigravity non-stream and forced-SSE responses are projected to Responses shape instead of leaking Chat Completions JSON. Ports decolua/9router#3589 while retaining DurinDoor's bounded body reads, terminal validation, and robust SSE framing with single-newline compatibility and multi-line `data:` joining instead of upstream's lossy line parser. Closes #662.
- GLM/Z.AI 429 prose matching `reset at YYYY-MM-DD HH:mm:ss` now supplies bounded rate-limit evidence when executor, `Retry-After`, reset-header, and structured-body evidence are absent. DurinDoor adopts the UTC reading asserted by open, unmerged decolua/9router#3612 for its observed sample (`Your limit will reset at 2026-08-17 02:56:15`) without provider-scoped proof; a wrong offset can shift the deadline by hours but remains bounded by the seven-day cooldown cap.

# 3.18.1

## Fixed

- Clean standalone builds and Docker images now ship the ESM `src/shared/utils/typeChecks.js` helper imported by `open-sse/config/runtimeConfig.js`, preventing fresh deployments from failing with `ERR_MODULE_NOT_FOUND`.
- Tray mode now enables OS autostart only before the first recorded decision, preserving explicit disable, manual startup-entry removal, and later explicit re-enable choices across Windows, macOS, and Linux. Ports decolua/9router#3651 while reusing DurinDoor's `DATA_DIR`-aware app-data resolver.

# 3.18.0

## Added

- Proxy Timeline page (`/dashboard/timeline`) with live tail, hop/SSE history, and provider/connection View all.
- Settings: `enableProxyTimeline` (default off) and `proxyTimelineRetentionDays` (1/3/7). Sidecar `proxy-timeline.sqlite` is not in backups; secrets stay `[redacted]`.
- Usage provider graph tooltips show which named API keys are using each active model without exposing key secrets.
- Model discovery exposes additive human-readable model/provider metadata while preserving every existing callable model ID and harness configuration.
- OpenCode Go and CommandCode now expose DeepSeek V4 Flash Vision Exp with vision/reasoning capabilities; OpenCode Go enables all three declared request formats, and CommandCode preserves OpenAI image URLs and data URIs. Ports decolua/9router#3482. Closes #585.
- Grok CLI **Bulk Add** imports single, array, or `accounts` JSON with snake/camel token keys, derived identity/expiry, serial priority assignment, and token-safe partial results. Ports decolua/9router#3443. Closes #600.
- Headroom compression request timeout is now configurable (`headroomTimeoutMs`, default 15000 ms, validated 1–120 s) from the Token Saver dashboard and settings API; invalid values fail safe to the default. Ports decolua/9router#3417. Refs #602.
- Profile can restrict `/v1/models` discovery to deduplicated configured combo names while preserving web combo kinds. The authenticated setting defaults off. Ports decolua/9router#3429. Closes #598.

## Fixed
- Headroom now records a diagnostic when an OpenAI Responses request cannot translate to compression `messages[]`, while preserving fail-open behavior (ports decolua/9router#3535). Refs #602.
- Headroom dashboard proxy now rewrites allow-listed asset, form, fetch, and redirect URLs, preserves external URLs, recalculates rewritten HTML lengths, forwards the original public host/protocol, and aborts stalled upstream requests through its bounded 502 response. Ports decolua/9router#3494. Refs #602.
- Headroom compression now uses one fail-open proxy call and rejects CCR markers, explicit error-tool results, unsafe message identity changes, no-gain or conflicting metrics, and candidates without meaningful byte shrink. Managed proxy shutdown now awaits TERM→KILL completion and preserves newer PID ownership. Ports decolua/9router#3493. Closes #602.
- Browser OAuth attempts now clear callback poll timers and release local listeners on timeout, callback validation, token exchange, and credential-save failures. Fixed-port Codex and xAI logins can retry immediately instead of failing with `EADDRINUSE`. Ports decolua/9router#3543 and extends it to the fork-only xAI flow. Closes #588.
- Provider connection fallback state now persists bounded, secret-safe failure diagnostics such as `fetch failed (ECONNREFUSED)` instead of the generic “Provider unavailable”, including the fork’s atomic DB and compatibility paths. Ports decolua/9router#3518. Closes #587.


- Codex GPT-5.3-Spark quota now reaches both dashboard usage and request preflight from top-level, indexed, and additional `wham/usage` response shapes, normalized to the existing `model:codex-spark` quota family. Ports decolua/9router#3458. Closes #593.
- Model-pinned request formats now select the matching multi-endpoint transport, so translated Claude bodies use the Claude URL and `x-api-key` authentication instead of an OpenAI chat endpoint and bearer header. Unpinned models retain source-format routing. Ports decolua/9router#3538. Closes #604.
- Exact-model and account-wide model-lock timestamps are now validated independently, so an expired exact lock cannot mask an active account-wide lock. Ports decolua/9router#3516. Closes #578.
- The pt-BR dashboard catalog now translates retained usage, media-provider, proxy-pool, quota, and navigation labels instead of falling back to English. Ports decolua/9router#3473.
- The sql.js fallback now stages, fsyncs, and atomically renames full database images, preserving the prior valid database and removing temporary files when persistence fails (ports decolua/9router#3523). Closes #589.
- Active generated and assistant-anchored sessions now refresh their in-memory recency, so capacity eviction removes the least-recently-used session instead of the first-created one. Ports decolua/9router#3550. Closes #590.
- Antigravity and `agy` now refresh shared provider-quota snapshots after upstream `409` or reset-free `429` responses before creating a legacy lock. Fresh exact quota blockers reselect another account or return the repository's earliest reset; executor-provided resets and fail-open fallback behavior remain unchanged. Ports decolua/9router#3563. Closes #595.
- OpenAI-compatible streams retain standalone generated-image deltas; empty deltas and empty image arrays remain filtered. Ports decolua/9router#3521. Closes #597.
- Qwen3.8 exact rates and ordered Qwen3.8/Muse capability and pricing patterns now prevent generic fallbacks from misbilling or misadvertising manually configured models, while CommandCode Muse keeps its exact thinking-format override. Ports decolua/9router#3423. Closes #599.
- Responses SSE-to-JSON and usage translation preserve normalized cache, reasoning, and other token detail objects; OpenAI reasoning tokens are billed once as part of output, and official OpenAI/O-series list prices now include exact `gpt-5-pro`, `gpt-5.2-pro`, and `o1-pro` rows without changing fork GPT-5.6 tier prices or Kiro suffix resolution. Ports decolua/9router#3481. Closes #592.
- Corrected decolua/9router#3454 so case-matched `OpenCode` branding is rewritten only in Antigravity system instructions after provider-envelope translation. Plain Gemini, Gemini CLI, Vertex, and conversation content remain unchanged. Closes #608.
- Thinking effort now reaches Ollama as `think`, Z.AI as both scalar and `reasoning.effort`, OpenCode free models as its gateway enum, and Grok CLI 4.6 virtual models through `xhigh`.
- Claude-format requests now normalize trailing assistant prefills into a continuation user turn (or matching error `tool_result`), unless `X-9Router-Assistant-Prefill: preserve` is set; falsy Claude `tools[].type` values now default to `custom`. Ports decolua/9router#3506 and #3484. Closes #580.
- Google Cloud Code project discovery now treats completed empty onboarding as terminal and preserves stored project IDs across OAuth token rotation, avoiding redundant onboarding and project lookup requests while retaining connection proxy routing. Ports decolua/9router#3452. Closes #594.
- RTK Caveman/Ponytail prompt injection now deduplicates complete prompt blocks, follows translated wire shape before format labels, preserves non-message Responses items, and injects Kiro instructions into `conversationState.currentMessage.userInputMessage.content` without adding an unsupported `systemPrompt`. Ports decolua/9router#3491. Closes #601.

- Qoder refreshes its fallback catalog with `lite`, Qwen3.8-Max, and GLM-5.3; opaque Qoder model IDs now expose correct reasoning, vision, context, and output capabilities, and vision models retain OpenAI URL/data-URI and Claude base64 image blocks in outgoing chat payloads. Ports decolua/9router#3555. Closes #583.
- OpenCode Free Muse models use the Responses endpoint without unsupported token caps; Ox Alpha Free is available as `oc/x-preview-f-free` and `ocg/ox-alpha-free` with image input and low/high/max reasoning effort. Ports decolua/9router#3509, #3483, #3447, and #3451. Closes #584.
- Groq replaces decommissioned seed model IDs with its current production catalog, discovers live models through the authenticated OpenAI-compatible `/models` endpoint, and accepts future model IDs via passthrough. Closes #582.
- Responses API stream translation now preserves UTF-8 characters split across transport chunks, drains a final unterminated SSE event, carries reasoning-token details into `response.completed`, and omits `usage` when upstream sent none (ports decolua/9router#3547 and #3433). Closes #576.
- port(upstream): #3549 - CommandCode error chunk opens with the assistant role.
- Claude→OpenAI stream translation emits a single whitespace `delta.content` before the terminal `finish_reason` chunk when the upstream stream produced no text or tool-call content (e.g. thinking-only responses, which map to `reasoning_content`). OpenAI-compat clients (AI SDK / Kilo) no longer throw `APIEmptyResponseError` on otherwise-successful streams; streams that already emitted content or tool calls are unchanged (independent re-implementation of VansRouter `5cc11b8` intent, not a cherry-pick). Closes #572.
- Claude `/v1/messages` streams now emit Anthropic ping events during slow handler setup and post-translation upstream silence, stopping at the first real client byte. Set `SSE_KEEPALIVE_MS=0` to disable them. Ports decolua/9router#3457.
- Streaming requests now abort at the configurable `STREAM_FIRST_CHUNK_TIMEOUT_MS` deadline when an upstream returns headers but never yields response bytes; the fork keeps its 200-second default, then uses the existing raw-byte stall watchdog after first-byte arrival. Ports decolua/9router#3556.
- Provider validation and proxy-aware connection tests now abort hung upstream probes at bounded deadlines, preserve caller cancellation and SSRF guarding, route Ollama tests through the configured proxy, and tolerate unnamed providers in dashboard search (ports decolua/9router#3552 and #3553). Closes #586.
- Cancelled and interrupted chat streams now persist partial content, thinking, TTFT, and provider-reported or estimated token usage exactly once, including a usage event when transform flush cannot run (ports decolua/9router#3542 and #3513).
- `/v1/models/info` keeps registry `name` values additive (e.g. `cx/gpt-5.6-sol` stays `GPT 5.6 Sol`); presentation only adds provider display fields. Agent plan/spec trees under `docs/superpowers/` stay deleted. Closes #566.
- Combo and account fallback now reject HTTP 200 chat responses with no usable output. SSE combos inspect a bounded first meaningful frame and replay consumed bytes, while null non-stream content and completed empty streams bench failing accounts. Ports upstream 9router #3560 and #3465. Closes #577.
- Observability settings now use the canonical `enableObservability` key. Stored `enableObservability2` migrates once and is dropped.
- `OBSERVABILITY_ENABLED` now explicitly enables or vetoes Usage → Details request-detail persistence before the canonical dashboard setting. `ENABLE_REQUEST_LOGS` remains limited to diagnostic files under `logs/`. Ports the enable-check intent of decolua/9router#3515. Closes #591.
- Proxy Timeline now closes traces on early streaming errors, avoids event-payload reads while filtering live writes, coalesces live dashboard reloads, and leaves the sidecar unopened while capture is disabled.
- Standalone builds and the Docker image ship `src/shared/utils/typeChecks.cjs` beside `custom-server.js`. The entry requires it at import time (#551) but it sat outside Next's file trace, so fresh deploys crash-looped at boot with MODULE_NOT_FOUND.
- Model display metadata prefers the friendly registry name when a live provider catalog echoes the model id as `name` (e.g. Codex `gpt-5.6-sol` now displays as `GPT 5.6 Sol`). Supplied names that differ from the id still win.
- `provider(kimi)!`: align Kimi Code with the documented [`k3`, `k3-256k`, and K2.7 Code model IDs](https://www.kimi.com/code/docs/en/kimi-code/models.html), [protocol endpoints](https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html), and [quota/error semantics](https://www.kimi.com/code/docs/en/kimi-code/membership.html). This is a clean cutover for first-party `kimi`/`kimi-coding` provider catalogs: their legacy `kimi-k*`/`moonshotai/*` IDs, the `.cn` fallback, and `?beta=true` are removed; generic Kimi metadata for third-party registries remains, and the documented inbound `k3[1m]` spelling remains.
- Default/LLM combos in `/v1/models` now advertise member-safe `context_length` and `max_completion_tokens` limits while preserving nested capabilities; web-search and web-fetch combos remain field-free. Ports decolua/9router#3529. Closes #596.

## Security

- Public tunnel subdomains now use unbiased OS CSPRNG sampling instead of predictable `Math.random()` state, and Cloudflare tunnel startup accepts either the preferred relay URL or direct URL as health proof while still failing when both are unavailable. Ports decolua/9router#3522 and #3519. Closes #605.
- Login rate limiting no longer trusts `X-Forwarded-For` from unproved peers when `TRUST_PROXY=true`; spoofed values stay in one limiter bucket, while wrapper-proved proxy and loopback identities retain their existing precedence. Ports decolua/9router#3496. Refs #607.
- Web fetch now rejects private, loopback, link-local, cloud-metadata, malformed, and credential-bearing request targets before contacting a fetch provider, while provider traffic uses the existing DNS-pinned outbound guard with manual redirects. Kiro API-key, token, cache auto-import, and dashboard connection-test paths validate AWS regions before network use, URL construction, or persistence; tampered stored regions fail without outbound traffic. Ports the residual decolua/9router#3497 intent; existing OIDC and outbound URL protections remain unchanged. Refs #607.

- Headroom status and statistics reads now use the management API guard: remote callers need a dashboard JWT or machine-bound CLI token even when `requireLogin=false`, while trusted loopback open-dashboard reads remain available. API keys grant no management access; existing CSRF, Origin, and dashboard protections remain unchanged. Ports the residual read-only intent of decolua/9router#3503. Closes #607.
- OIDC discovery (`fetchOidcDiscovery`) rejects link-local, private, and metadata issuer URLs via `assertPublicUrl` before any network fetch. Login start, callback, and settings discovery test share the same guard; public issuers still work. Independent of 9router #3497 (OIDC SSRF intent only; DNS pin already in `outboundUrlGuard`). Closes #570.
- `requireApiKey` now shares the JWT/CLI proof gate used by other auth-critical settings, so loopback, remote, and open-dashboard callers cannot disable LLM API-key enforcement through settings mass assignment. Ports the residual protected-key intent of decolua/9router#3499. Refs #607.
- MCP plugin bridges (`GET` `/api/mcp/[plugin]/sse`, `POST` `/api/mcp/[plugin]/message`) re-check the LOCAL_ONLY gate in-handler (machine-bound CLI token, or loopback with dashboard auth) and release SSE bridge sessions on `request.signal` abort as well as `ReadableStream.cancel()`, so disconnects cannot leave unreaped stdio children (intent of 9router #3498 / #3527; not a cherry-pick). Closes #564.
- Database export/import (`GET`/`POST` `/api/settings/database`) now requires dual auth: a valid machine-bound CLI token **or** dashboard JWT session, **plus** the dashboard password. A stolen CLI token alone can no longer dump or replace credentials (GHSA-qvfm intent; independent of 9router #3500). Profile Export/Import (logged-in user confirms password) is unchanged. Loopback emergency recovery remains `POST /api/auth/reset-password`. Closes #561.
- Local OAuth callback servers (`startCodexProxy`, `startXaiProxy`, and `startLocalServer`) reject requests whose `Origin` header is present and not loopback. Legitimate OAuth redirects (no `Origin`) continue to work. Closes #557.
- Management dashboard APIs (`/api/providers`, `/api/usage`, `/api/keys`, `/api/settings`, and related prefixes) no longer accept the global `requireLogin=false` guard bypass for remote callers. Unauthenticated remote clients receive `401`; loopback open-dashboard usage, dashboard JWT sessions, and machine-bound CLI tokens continue to work. Closes #555.
- Require an explicit `JWT_SECRET` for dashboard sessions (independent of 9router #3501 / GHSA-jphh). DurinDoor no longer auto-writes `DATA_DIR/jwt-secret`. Existing installs that already have that file keep working with a warning; set `JWT_SECRET` to the file contents (or a new secret, accepting session invalidation) to silence the warning. Fresh installs without env or file fail closed. Closes #550.
- PATCH `/api/settings` no longer accepts mass assignment of auth-critical keys (`requireLogin`, `authMode`, OIDC fields, outbound proxy, observability toggle, and related secrets) unless the caller presents a valid dashboard session JWT or machine-bound CLI token. The `requireLogin=false` dashboard guard bypass can still reach the route but cannot persist those settings. Resolves GHSA-vmjq / CWE-915 (adapted from upstream 9router PR decolua/9router#3499). Closes #553.

# 3.17.7

33 upstream 9router GAP/PARTIAL ports from the 2026-08-21 #508 shortlist, plus the campaign closeout ledger.

## What's included
- Tool-call, translator, and stream fixes: Kiro nested tool_call validation and one-shot repair, Gemini turn/key sanitization, missing tool-result IDs, DeepSeek tool-name dedupe, Responses custom tools, Codex 413 overflow, CommandCode in-stream errors, and Kimi Code force-stream.
- Quota, retry, and catalog: per-provider retry delay, per-account RPM cap (NVIDIA default 40), Qoder 112 auto-disable, DNS-pinned provider probes, NVIDIA EOL remaps, OpenCode Go usage, and usage SSE period refresh.
- CLI and dashboard: IPv4-first DNS, operator heap flags, CodeBuddy prompt-length filter, and single-item usage group summaries.

## Compatibility and verification
- No stored-data or API-key format changes. `~/.9router/` and `X-Msh-Platform: 9router` remain accepted.
- Each port was SHA-pinned Node-20 gated and squash-merged with required GitHub checks green. Composed `origin/main` `GATE_PASS` after the campaign.

# 3.17.6

Headroom extras now install by default, and every setup failure tells the operator exactly what is wrong and how to fix it. The compression proxy used by the Token Saver dashboard previously reported "Python >= 3.10 not found" when an interpreter was present but Headroom lived in a `uv tool` venv that has no `pip`, so the `code` and `ml` extras were never requested and the operator was given no usable next step. DurinDoor now owns a managed virtual environment at `${DATA_DIR}/headroom/venv` (resolving to `/opt/cortexos/.durindoor/headroom/venv` on the deployment host), builds it from a root-visible Python 3.10 or newer, and installs `headroom-ai[proxy,code,ml]` through that venv's own `pip`; user-scoped `uv` and `pipx` installs are detected and reported but never used, and every setup diagnostic names the observed condition and the matching repair. See [docs/HEADROOM.md](docs/HEADROOM.md) for the full code table and recovery commands.

# 3.17.5

The pure-JS SQLite fallback can now actually start. `src/lib/db/driver.js` tries
better-sqlite3, then `node:sqlite` (Node 22.5+), then sql.js, so sql.js is the
only driver left on a host whose native binding failed to build and whose Node
predates 22.5. sql.js loads `dist/sql-wasm.wasm` at runtime via emscripten's
default `locateFile`, and because no import statement names that file, Next's
tracer copied the JS entry into the standalone bundle and dropped the wasm — the
terminal driver could only ever fail with `[DB] sql.js unavailable`, leaving
those hosts with no database at all. Both packaging surfaces now copy the asset
explicitly: `scripts/build-app.mjs` for `npm run build` and systemd standalone
deploys, and the Dockerfile runtime stage for the container image.

Ports upstream 9router `27f3710c8`.

# 3.17.4

Headroom proxy recovery now works on a fresh install. 3.17.3 revived the proxy
through an `ExecStartPost`, which only exists on hosts whose service unit was
wired by hand — this project ships no unit file and the container image does not
copy `scripts/`, so a new deployment still lost its proxy on the first restart
and compression failed open from then on. Recovery moved into the Next
instrumentation boot hook, which runs once per server start in every deployment
shape (systemd, Docker, `npm start`), so no host-specific wiring is needed.

The hook stays narrow: it never installs Headroom and never enables it, so
opting in remains an explicit Auto-configure action. It only revives a loopback
proxy already turned on, no-ops when one is alive, leaves remote proxies alone,
and never blocks the gateway from starting.

# 3.17.3

The Headroom compression proxy now survives a gateway restart. It is spawned by
DurinDoor itself, but `KillMode=control-group` reaps the whole service cgroup —
which a detached child does not escape — so every restart killed the proxy and
nothing brought it back. The dashboard then read "Stopped" while compression
silently failed open. DurinDoor now recreates its own proxy on every start via
`scripts/start-headroom.mjs`; the script is idempotent, skips remote proxy URLs,
honours the enabled setting, and is fail-open so a proxy failure can never block
the gateway from booting.

The Headroom dashboard no longer shows the proxy URL. It is server-side config
the browser never calls, so displaying `http://localhost:8787` read as a broken
connection when viewing the dashboard remotely. It remains editable in Token
Saver settings, which the page already links to.

# 3.17.2

The xAI (Grok) usage card now shows the real SuperGrok weekly quota instead of
local-history-only rows. Previously an xAI OAuth connection rendered 30-day spend
and token totals against an infinite denominator, so every row read "100%" and
disagreed with the weekly limit shown on grok.com. The xAI OAuth token can in
fact read grok.com's `GetGrokCreditsConfig`, so the card now surfaces a
`Weekly SuperGrok` row with the true percentage used and reset date, keeping the
local 30-day totals as supplementary rows. The lookup is fail-open: any network,
auth, or parse failure leaves the previous local-history card untouched.

# 3.17.1

Security patch release. Resolves all 46 open Dependabot alerts (14 high, 28
moderate, 4 low) across 9 dependencies with no breaking major version bumps:
`next` 16.2.10 → 16.2.11, `undici` → 7.29.0, and `postcss` → 8.5.23 directly,
plus `dompurify`, `sharp`, `nanoid`, `js-yaml`, `ip-address`, and
`brace-expansion` pinned to patched versions via scoped `overrides` (bounded to
the vulnerable ranges so untouched majors are preserved). `npm audit` reports no
remaining vulnerabilities. No API, wire-format, or behavioral changes.

# 3.17.0

The Headroom dashboard now renders correctly through the gateway proxy. Static
assets, the settings request, and dashboard sub-pages such as `/dashboard/settings`
are rewritten through the proxy prefix instead of escaping it.

Search-only providers can no longer reach the chat-completions path. A request
naming one now fails with a 400 pointing at `/v1/search` instead of falling back
to the OpenAI executor, which sent the user's search API key to OpenAI.

A curated custom-provider model list no longer suppresses live catalog discovery
when the curated rows are of a different kind than the request.

Codex overload notices returned as ordinary HTTP 200 output streams are now
detected and retried instead of surfacing as a broken success, and the logged
service tier reflects the tier actually sent upstream.

Providers emitting lowercase tool call names (`read`, `bash`) are normalized to
the PascalCase names Claude Code expects, on the translated and passthrough paths
alike.

`mimocode` rotates to the next account on a network throw, not only on 429, when
the account has a dedicated proxy; 4xx request errors still do not rotate.

OpenCode Zen free-tier requests forward the real client IP, so users no longer
share one rate-limit bucket. Loopback and private addresses are never forwarded.

Added the Novita AI provider. Antigravity now reports IDE fingerprint 2.5.5.
The RTK system-prompt injector emits the content-part type the target API expects.
ollama-local gained debug diagnostics and connect-timeout tuning. The CLI no
longer triggers a native SQLite build at startup. Fresh settings default
`debugMode` to false, the provider connection route accepts PATCH so CLI
credential rotation no longer 405s, health grouping canonicalizes provider
aliases, and chutes declares its `imageToText` service kind.

# 3.16.3

Dashboard login now works over every remote path — Tailscale (Serve/HTTPS and raw
IP), a Cloudflare/other tunnel, and direct LAN IP — not just the single origin
configured in `BASE_URL`. The same-origin login guard compares the browser
`Origin` against the `Host` header by hostname and port, independent of scheme: a
TLS-terminating proxy makes the upstream socket plain HTTP while the browser
`Origin` is HTTPS, but the request is still same-origin. The `Host` header is set
by the proxy, not by an attacker's cross-site page, so host+port equality is the
CSRF-relevant invariant; cross-host Origins and port mismatches are still
rejected. `BASE_URL` / `NEXT_PUBLIC_BASE_URL` remain an accepted allowlist for
proxies that rewrite `Host` to an internal name, but are no longer required for a
Host-preserving proxy. This supersedes the 3.16.2 BASE_URL-only allowlist, which
rejected any remote host other than the one configured value.

# 3.16.2

Dashboard login behind a TLS-terminating tunnel or reverse proxy (Cloudflare
Tunnel, Tailscale) now succeeds when the deployment's public address is set via
`BASE_URL` / `NEXT_PUBLIC_BASE_URL`. The 3.16.1 attempt read `x-forwarded-proto`,
but `custom-server.js` strips client-forgeable `x-forwarded-*` headers at the
boundary, so that scheme was never visible to the guard. The same-origin login
guard now accepts a browser `Origin` that matches a configured public base URL —
the operator-set, non-forgeable source of the deployment's canonical origin — and
otherwise keeps the exact Host-derived comparison. Operators exposing the
dashboard through a tunnel must set `BASE_URL` to that public origin (e.g.
`https://llm.amoena.ai`).

# 3.16.1

Dashboard login behind a TLS-terminating proxy or tunnel (Cloudflare Tunnel,
Tailscale Serve) no longer fails with `Cross-origin login is not allowed`. The
same-origin login guard now trusts the `x-forwarded-proto` scheme when present —
matching the cookie-security convention — so an `https` browser Origin reaching a
plain-HTTP upstream on the same host is accepted. Attacker-controlled Origins are
still rejected on host mismatch, and requests without a forwarded scheme keep the
original request-URL scheme comparison.

# 3.16.0

## Responses API output_index allocation
A tool call emitted after a reasoning or message item no longer reuses that
prior item's `output_index`. The legacy Responses transformer now allocates a
monotonic `output_index` per output item and reuses it for every delta and
terminal event of that item, matching the pattern the existing OpenAI
Responses translator already followed. No wire-format, provider, or
wire-compatibility change.

Perplexity Web now extracts answer-variant text from the workflow-block SSE format, including streamed RFC-6902 chunk patches and terminal materialized blocks. Search and thinking workflow items remain excluded; legacy markdown-block responses are unchanged.

Qoder billing blocks (quota exhaustion codes `112`/`10605`, or a `pricingUrl`
field) in the first SSE frame now produce a synthetic HTTP 403 before stream
bytes commit. This supports status-driven combo/account failover; it does not
change ordinary streaming failures. Normal streams replay the bounded 64 KiB
peek byte-for-byte without buffering a full response. The peek shares Qoder's
configured request timeout, so a response that sends headers but no first frame
also fails promptly for fallback.

K2.6's 403 "billing cycle" wording covers two different conditions: a
depleted weekly subscription and a short per-model request window. A
temporary K2.6 window no longer blocks the account — chatCore probes Kimi
usage on that 403, and when the weekly quota still has capacity and the
rate-limit window carries a future reset, the account cooldown expires at
that reset instead of staying account-terminal. Other Kimi models retain
their original terminal handling without a usage probe. Usage probes against
Kimi are bounded by a single absolute deadline (10s) covering both headers
and body; a stalled body cancels the response stream and falls through to
the same fail-closed 403 path. An exhausted weekly quota, an unreadable
usage response, or a probe failure also preserve the original terminal 403
(fail closed).
Compatible-provider icons now accept bounded raster `data:image/...;base64,...`
URLs as well as bounded HTTP(S) URLs. Invalid schemes, malformed or oversized
payloads, and unsanitized SVG data are rejected before persistence; create and
edit dialogs show the server error instead of silently failing.

Compression token estimation now strips embedded base64 image data URI
payloads (`data:image/...;base64,...`) before measuring length, so
attachments with inline images report accurate token savings instead of
inflated originals. The strip scan is bounded by a 50_000-char cap
(matching upstream `MAX_EXACT_TOKEN_COUNT_CHARS`); inputs above the
cap bypass the scan and use a raw `length/4` heuristic, so hostile
multi-MB payloads cannot drive linear CPU work.

`estimateCompressionTokens` is the only token estimator in the fork; non-image data URIs (e.g. `data:audio/mpeg;base64,...`), malformed or truncated image URIs, and plain text are unaffected.

Remote dashboard login now refuses to issue a session while the built-in `123456` password is active, and dashboard request-detail responses redact captured request and response bodies. The login screen uses the DurinDoor wordmark and shows the default-password hint only when the effective password is literally that built-in value.

# 3.15.2

Authenticated dashboards reached through a reverse proxy can manage PXPIPE
again. Proxied PXPIPE requests require a dashboard session or machine-bound
CLI token even when dashboard login is disabled; API keys remain invalid for
management, while direct loopback requests retain the normal local policy.

The Token Saver settings card and PXPIPE overview now share one tested status
loader and classifier. HTTP failures, network errors, malformed responses, and
unknown state render `Unavailable` with a warning diagnostic instead of
claiming the bundled dependency is missing. Independent statistics, logs, or
health failures no longer overwrite a successful PXPIPE status.

No stored-data, dependency, API-key, or wire-format changes are included.

Native Claude passthrough now re-anchors cache breakpoints after token-saving
transforms: final system block and tool use the one-hour TTL, and final
cacheable assistant content uses the standard five-minute TTL. Mid-conversation
system reminders remain adjacent to their turn rather than invalidating the
top-level system prefix.

Combo names now resolve case-insensitively during model routing while retaining
their stored spelling for access-control, strategy, and rotation state. Exact
names win; colliding case variants use a deterministic oldest-record fallback.
Provider and model IDs remain case-sensitive.
Gemini 3.7 Flash now has direct Gemini catalog visibility plus Antigravity high, medium, and low tier routes, aliases, and quota rows, ported from upstream commit `86694ed8d048` (#3286, #3281).

# 3.15.1

DurinDoor now refuses to start on a SQLite database whose structural check
reports corruption. The guard runs after migrations and before the database
adapter is accepted, preserving the original database for operator-led
recovery instead of serving partially readable state.

The regression fixture reproduces the production failure by corrupting the
`quotaFetchStates` primary-key auto-index directly. Without the guard the
database opens; with it, startup fails with SQLite's exact diagnostic.

Recovery documentation now distinguishes the fast startup `quick_check` from
full `integrity_check` and `foreign_key_check`, and notes that lightweight
migration backups omit the auto-pruned `requestDetails` observability log.

# 3.15.0

Provider catalogs are now discovered live where the upstream supports it, 35 missing models were added, and six upstream 9Router fixes landed.

## Dynamic model discovery
Each provider is now dynamic to exactly the level its API actually permits:
- **Anthropic** — full: model IDs, `max_input_tokens`/`max_tokens`, plus vision, PDF, and thinking capabilities read straight from `/v1/models`. New Claude releases are picked up without a catalog edit.
- **Cloudflare** — context windows parsed from the model-search `properties`. Enrich-only: a short or empty catalog page can never remove a model, because Cloudflare's pagination is unreliable.
- **Codex** — account catalog IDs and context windows via the ChatGPT Codex endpoint.
- **MiniMax and GLM** — ID enumeration. Their endpoints publish no limits, so newly released models appear automatically while the static catalog supplies capabilities. An unknown ID never receives a fabricated context window.

An exhausted chat quota no longer suppresses list discovery: GLM's `/models` answers 200 even while chat returns 429.

## Catalog
- **35 models added** with vendor-sourced windows: 6 Anthropic, 4 GLM, 1 Codex, 17 Cloudflare LLMs, and 7 Cloudflare embedding models.
- **Cloudflare embeddings** work end to end through a dedicated account-scoped adapter, verified by a live vector round-trip rather than a mock.
- **Codex surface limits are provider-scoped.** The ChatGPT Codex transport serves a 272,000 window where the direct OpenAI API serves 1,050,000. Both are now represented, so a Codex user is not promised a window that transport will not honor and a direct-API user is not understated.

## Upstream ports
- **#3277** — combo routing now falls back when a provider returns HTTP 200 with an error body, and Responses `output_text.done` no longer closes text early on interleaved tool calls (fixed on both the current translator and the legacy transformer).
- **#3267** — a healthy database with zero connections no longer advertises the entire built-in catalog.
- **#3258** — MiniMax text-to-video, with polling pinned to the originating account.
- **#3273** — live Sessions in the usage dashboard and named CLI URL presets.
- **#3272** — Oh My Pi added as a CLI target, wired to the shipped `omp-extension`.
- **#3245** — already covered by the earlier #3204 port; verified rather than duplicated.

`#3255` (latency monitoring) was deliberately declined: despite its title, nothing consumes latency for provider selection, and it would add a schema migration plus a widened synchronous write on every completion for monitoring-only benefit.

## Compatibility and verification
- No stored-data, API-key, or wire-format changes. Static catalogs remain the fallback, so a provider outage cannot empty or zero the catalog.
- The capability catalog stays free of server-only imports, keeping Node networking out of the dashboard bundle.
- Full Vitest/no-regression, lint, build, and commitlint gates green on `main`.

# 3.14.0

Context windows can now come from the provider instead of a hardcoded table, and Kimi's limits were confirmed against the live API.

## Dynamic context windows
- **Live limits drive enforcement, not just display** — where an upstream publishes its real context window, that value is used for request preflight. Previously an upstream advertising a larger window than our static table still had requests rejected at the smaller number, and an upstream with a smaller window let over-budget requests through to fail upstream.
- **Precedence** is `user/custom override > live upstream > static catalog > default`. The static catalog remains the fallback, so a provider outage can never empty or zero the catalog.
- **No cost on the hot path** — preflight performs a synchronous cache read; discovery happens on the request/account-selection path or when `/v1/models` is built, never as an import side effect. Results are cached with TTL, negative caching, and in-flight coalescing.
- **Per-connection cache scoping** — the catalog cache key previously omitted the provider, so two accounts with divergent catalogs could overwrite each other's limits.

Not every upstream benefits. Kimi coding, OpenRouter, and Pollinations publish per-model limits; GLM's endpoints return bare entries with no limit fields. Where an upstream says nothing, the static value stands.

## Kimi windows confirmed
Moonshot documents labels ("256K", "1M") rather than integers, so the stored values were expansions. Live probing settled them exactly: `kimi-k3` reports `context_length: 1048576` directly, and the K2.x family returns an explicit `exceeded model token limit: 262144` — binary, not 256,000. A broad pattern that matched the genuinely distinct `k3-256k` to the wrong window was also removed.

GLM remains unverified: its catalog endpoints expose no limit fields and every overflow probe was blocked by quota before context validation. Those values are unchanged rather than guessed.

## Compatibility and verification
- No stored-data, API-key, or wire-format changes.
- The capability catalog stays free of server-only imports, so no Node networking stack is pulled into the dashboard bundle.
- Full Vitest/no-regression, lint, build, and commitlint gates green on `main`.

# 3.13.1

Completes the model-catalog audit started in 3.13.0: every served model was checked against its vendor's primary documentation.

## What's fixed
- **Cloudflare Workers AI windows** — Cloudflare serves smaller windows than the underlying models' trained maximums. Seven models were advertising the model spec rather than what Cloudflare actually serves: `deepseek-r1-distill-qwen-32b` (262,144 to 80,000), `kimi-k2.5` (262,144 to 256,000), `glm-4.7-flash` (200,000 to 131,072), `qwq-32b` (131,072 to 24,000), `llama-3.2-1b` (128,000 to 60,000), `llama-3.2-3b` (128,000 to 80,000), and `llama-3.3-70b-fp8-fast` (128,000 to 24,000).
- **Local Ollama context** — `llama3.2:1b` advertised 128,000 while the daemon serves 4,096. The catalog now reads the served `context_length` instead of the model's trained maximum, so requests are no longer silently truncated.
- **Impossible output limits removed** — several models reported `maxOutput` equal to `contextWindow`, which cannot be true since output is a subset of the window. Affected the Kimi K2.x family and two Cloudflare-hosted Moonshot models.
- **GLM-4.6V output** — corrected to the documented 32,768 maximum.
- **Router aliases** — `cu/default` and `nr/auto` resolve to varying upstream targets, so their fixed 200,000 window was a guess and is now unset.

## Unpublished limits stay unset
Where a vendor documents a *default* but no maximum, no ceiling is stored. Cloudflare publishes no max-output ceiling for any model, and Moonshot documents a 32,768 default without an upper bound. Storing a default as a ceiling would reject legitimate longer generations at our own preflight, so those fields are left unset — the same treatment xAI received in 3.13.0.

## Compatibility and verification
- No stored-data, API-key, or wire-format changes. Some models now report a smaller, correct window.
- A new regression test enforces `maxOutput < contextWindow` across the served catalog, so this class of error cannot silently return.
- Full Vitest/no-regression, lint, and commitlint gates green on `main`.

# 3.13.0

Model-catalog accuracy release: adds Grok 4.6, corrects context windows that were wrong in both directions, fixes a Responses-transport translation bug, and ships an oh-my-pi extension that syncs the catalog into omp.

## What's included
- **Grok 4.6 and a refreshed xAI lineup** — `grok-4.6` (500K context, `xhigh` reasoning) is now the xAI default, alongside `grok-4.5` (500K), `grok-4.3` (1M, the only Grok that can disable thinking), the 4.20 family (1M), and `grok-build-0.1` (262K, renamed from `grok-code-fast-1`, old id retained as an alias). Ids absent from xAI's live docs were removed.
- **Context-window corrections** — a Cloudflare-hosted 32B model no longer claims a 1M window (32,768 per Cloudflare's docs); `gpt-5.5` effort-suffix aliases report their real 1,050,000 rather than 400,000; MiniMax M2/M2.1 corrected to 204,800; an embedding model no longer advertises a chat context window.
- **Responses transport fix** — a Chat Completions body targeting a Responses-only model now has `max_tokens` translated to `max_output_tokens` on both the message and pre-formed `input` paths. Previously such requests failed upstream with a field-shape 400.
- **oh-my-pi extension** — `omp-extension/` discovers DurinDoor's `/v1/models` and registers every model in omp with its real context window, output limit, and capability flags. Fail-soft: a stopped gateway leaves omp fully usable.

## Notes on unpublished limits
`maxOutput` is deliberately left unset for first-party xAI models. xAI documents `max_completion_tokens` as a 128,000 **default**, not a maximum; storing it would impose a client-side ceiling xAI never published. A test asserts this contract with a control model that does have a real ceiling, so the exemption itself is falsifiable.

Anthropic needed no change: 1M context is already the documented default on Opus 5/4.8/4.7/4.6, Sonnet 5/4.6 and Fable 5 — no beta header, no tier gate, and no `[1m]` model-id suffix exists.

## Compatibility and verification
- No stored-data, API-key, or wire-format changes.
- Every catalog number is traceable to a vendor primary source; values that could not be confirmed were left unchanged rather than guessed.
- Full Vitest/no-regression, lint, and commitlint gates green on `main`.

# 3.12.0

Upstream sync release covering 68 non-merge commits, including the 37-PR port campaign in #434–#470, with explicit client-default changes plus security, reliability, protocol, provider, and dashboard fixes.

## Behavior changes
- **Non-streaming is now the default** — when a client omits `stream`, DurinDoor now uses `stream: false` per the OpenAI specification (upstream #1272). Clients that relied on implicit streaming must now send `stream: true`.
- **Reasoning content is preserved by default** — non-streaming replies now keep `reasoning_content`; stripping it is opt-in instead of the default (upstream #2774).

## What's included
- **Security and authentication** — search `baseUrl` values are protected by an SSRF guard (#3063); CORS `OPTIONS` preflight is exempt from auth on `/v1/*` without weakening authentication for any other method (#3025); a valid `x-api-key` is accepted alongside a stale `Authorization` header without borrowing stored credentials (#2926); API-key usage statistics use a salted, per-install HMAC identity instead of raw-key-derived grouping (#2919); and Claude session headers are emitted only for genuinely client-provided session IDs.
- **Reliability and account rotation** — `proxyFetch` uses undici connection pooling to avoid connection exhaustion (#2997); HTTP 400/422 request errors no longer rotate accounts (#3181); Envoy HTTP 507 buffer-overflow responses replay on the same account (#2946); and concurrent OAuth quota polls are coalesced (#2848).
- **Translator and protocol correctness** — empty `tool_calls` arrays no longer truncate replies (#3254); Responses targets receive nested reasoning effort (#3243); Gemini schema walkers preserve user property names and remove only stray node-level `value` markers (#3082/#3089); nested Claude server-tool models are normalized (#2649); and Kiro gains system-prompt, API-key model-discovery, and unsupported-tool-schema fixes (#2911/#3038/#3039).
- **Providers and dashboard** — Hugging Face speech-to-text presets now include dispatchable STT configuration (#2600); Qoder organization quota renders even when its total is zero (#2909); quota rows stay scoped to their connection (#3122); providers return to active status after cooldown expiry (#3182); and Amp is marked unsupported (#2921).
- **Additional gateway fixes** — streaming lifecycle, executor state, credential metadata, MiMo affinity, Responses tool namespacing and cache keys, Claude thinking limits and accounting, Antigravity schemas, Vertex credentials, Codex OAuth profiles, and binary-transport response formatting were corrected across the earlier and campaign work.

## Compatibility and verification
- No stored-data or API-key format changes. The `stream` default and `reasoning_content` preservation described above are the only client-visible defaults that shift.
- Every ported change shipped with a unit test verified load-bearing by targeted revert. Full suite, lint, and commitlint are green on `main`.

# 3.11.1

Patch release preventing OpenAI-only streaming options from reaching Anthropic Messages.

## What's fixed
- **Claude streaming requests** — `DefaultExecutor` now keys `stream_options.include_usage` injection to the resolved runtime transport instead of any streaming body with `messages`. Direct and runtime-selected Claude transports no longer receive the unsupported `stream_options` field that Anthropic rejected with HTTP 400; OpenAI and `openai-apikey` transports keep usage reporting.

## Compatibility and verification
- No stored-data, API-key, or accepted wire-format changes.
- The regression suite covers direct Claude, runtime-selected Claude, OpenAI, and normalized `openai-apikey` transports. Full Vitest/no-regression, lint, build, docs, generated-index, and commitlint gates passed in PR #401.

# 3.11.0

Model catalog corrections, real context-limit enforcement, and the 2026-08-09 upstream/OmniRoute port window.

## What's included
- **Context limits are enforced, not guessed** — `resolveModelLimits(provider, model)` reports whether a limit is actually known and where it came from. A registry row counts as evidence only when it declares a positive context window, so capability-only rows no longer republish the generic 200k floor as a provider guarantee. Over-budget requests are rejected at ingress with exact token accounting instead of failing upstream, and `/v1/models` publishes limits only for models that genuinely have them.
- **Model catalog fixes** — Kiro agentic Claude variants gained their missing capability rows, and verified 1M-context corrections landed for the models that actually support it.
- **Upstream and OmniRoute ports** — the 2026-08-09 window, including a loopback-only fix for `/api/pxpipe/*`, Ollama Cloud usage reporting with a background OAuth refresh scheduler, Gemini 3.6 Flash registry entries plus quota bars, and translator/executor corrections.
- **Codex fixes** — the CAVEMAN system-prompt injector no longer sends a Responses-only content part to chat providers; auto-ping picks its model from the account's live catalog rather than a hardcoded `gpt-5.5`; and the plan badge prefers the live plan with stored OAuth metadata as fallback.

## Compatibility and verification
- Existing API-key formats and accepted 9router wire forms remain compatible; no destructive migration is included.
- Full Vitest/no-regression, lint, production build, generated-index, documentation-integrity, and commitlint gates passed. Per-workstream verdicts live under `docs/campaigns/`.

# 3.10.0

Upstream and OmniRoute sync release adding provider, authentication, quota, and translation capabilities verified against the 2026-07-25 through 2026-08-04 source window.

## What's included
- **New and refreshed providers** — added Poolside and Morph, Kiro Claude Opus 5 variants, refreshed Qoder models, and Qoder Personal Access Token authentication with guarded job-token exchange caching.
- **Quota and usage coverage** — added Kimi Coding and DeepSeek usage handlers plus SuperGrok's gRPC-web weekly pool while preserving existing REST quota rows.
- **Claude Code configuration** — added persisted `CLAUDE_CODE_MAX_CONTEXT_TOKENS` presets, manual configuration output, and reset support.
- **Translator and executor fixes** — repaired empty Gemini tool schemas, stripped invalid non-stream Antigravity options, normalized terminal Responses usage, forwarded Claude `output_config.effort` and Ollama thinking, and hardened Claude format detection.
- **Reliability fixes** — transient token-refresh failures retry immediately without consuming the normal retry budget, and provider dashboard counts now include both API-key and OAuth modes consistently.

## Compatibility and verification
- Existing API-key formats and accepted 9router wire forms remain compatible; no destructive migration is included.
- Full Vitest/no-regression, lint, production build, generated-index, documentation-integrity, commitlint, and isolated standalone smoke gates passed. Detailed verdicts live in `docs/campaigns/upstream-omniroute-2026-08-04-ledger.md`.

# 3.9.1

Patch release with the README handbook revamp, current 1M model catalog corrections, and targeted upstream gateway fixes.

## What's included
- **README handbook revamp** — journey-first project README with quick navigation, quick start, tool integrations, capabilities, API surface, architecture, security guidance, and documentation links.
- **1M model catalog corrections** — Claude Opus 5 added to Claude Code and Anthropic catalogs; Claude Code Opus defaults to `cc/claude-opus-5`; `opus[1m]` and `sonnet[1m]` aliases recognized; Anthropic/OpenAI/Codex/Kiro big-context capability metadata corrected.
- **Ollama terminal stream fix** — terminal Ollama chunks now preserve content, reasoning, and non-empty tool calls in the final SSE delta and request details.
- **Compatible-node model whitelist fix** — custom models configured on OpenAI/Anthropic-compatible nodes now act as an explicit whitelist instead of also exposing the full upstream model catalog.

# 3.9.0

Release consolidating the work merged since 2.3.0. The intermediate 2.3.1 /
2.3.2 `package.json` bumps collided with pre-existing tags from divergent
history (the tag namespace runs to v3.8.x), so this release is numbered
**3.9.0** — above the entire tag namespace — to stay monotonic and
collision-free. No behavior change from 2.3.2; the sections below are the
per-PR detail that shipped under those interim labels.

## What's included
- **Copy an API key after creation** (2.3.1) — re-copy API keys and MCP gateway keys from list rows via guarded reveal routes.
- **API keys list redesign** — status badges, metadata chips, grouped row actions, key-count header.
- **Privacy: Google Analytics fully removed** — beacon, `@next/third-parties` import, and dependency deleted (stronger than upstream #2775's opt-in).
- **Verified upstream ports** — 9router #2800 (openai-compatible thinking format), #2748 (CLI clean build), #2798 (proxy-pool relay); OmniRoute #8238 (drop Gemini civic-integrity safety).
- **Combo provider / model-family invariants** (2.3.2, OmniRoute #8304) — declarative `allowedProviders` / `allowedModelFamilies` with atomic validation; `combos.invariant` column (migration 013).

# 2.3.2

## Improvements
- **Combo provider / model-family invariants** (port of OmniRoute #8304) — a combo may now declare `allowedProviders` and/or `allowedModelFamilies` (top-level or under `invariant`). On create/update every non-combo-ref target is validated; a violating target aborts the write atomically. Persisted in a new nullable `combos.invariant` column (migration 013, idempotent).

## Tests / tooling
- Added `tests/unit/combo-invariants.test.js` covering the validator: no-op without constraints, family/provider rejection, slash-qualified provider derivation, nested `invariant` + combo-ref skipping, and unknown-family rejection.

# 2.3.1

## Improvements
- **Copy an API key after creation** — API keys and MCP gateway keys can now be re-copied from their list rows via a "Copy key" action, not only at creation time. The raw secret is fetched on demand from a dedicated, guarded reveal route (`GET /api/keys/[id]/reveal` and `GET /api/mcp-gateway/keys/[id]/reveal`) so it is never dumped into the list response; the gateway reveal route keeps the same local-request restriction as gateway key creation.
- **"All combos" select in create-key** — the endpoint create-key modal now exposes an explicit "All combos" option (checked = unrestricted access), making the previously implicit "empty means all combos" behavior a visible, selectable control.

## Tests / tooling
- Added `tests/unit/api-keys-reveal-route.test.js` covering both reveal routes: raw-secret return, 404 on missing key, and the gateway route's local-only 403.

# 2.3.0

## Improvements
- **MCP Help page** — documents both MCP surfaces end to end: the gateway (aggregating registered upstream MCP servers) and the control server (DurinDoor's own management tools). It covers the three transports (streamable HTTP, SSE, and the stdio bridge), the `<instanceSlug>__<toolName>` namespacing convention, the seven control tools at `POST /api/mcp/control`, the upstream-server OAuth flow, and troubleshooting.

## Tests / tooling
- Added `tests/unit/mcp-help-content.test.js` asserting the MCP Help page documents every surface (both servers, all transports, namespacing, the seven control tools, the OAuth flow, and troubleshooting).

# 2.2.9

## Ports
- **`service_tier` passthrough** (upstream `c97963c`) — the OpenAI→Responses request conversion now forwards `service_tier`, so Responses API callers keep their requested provisioning tier instead of falling back to the default (`translator/request/openai-responses.js`).
- **opencode-go boolean `reasoning` strip** (OmniRoute #7891) — providers backed by the opencode-go backend (opencode-go, opencode, opencode-zen) 400 on a boolean `reasoning: true/false` because their Go request struct types `reasoning` as a structured object. DurinDoor now strips the boolean before forwarding so the upstream applies its own default; object/string forms are left untouched (`services/opencodeReasoningSanitizer.js`, hooked in `chatCore`).

## Notes
- Scanned decolua/9router and OmniRoute for further portable fixes; the remaining candidates were already present (drop-temperature-for-all-Claude, Gemini 429 `RetryInfo.retryDelay` parsing), not applicable (Codex Responses Lite `parallel_tool_calls`), or too large/risky for a clean port (TitleCase tool-name normalization). Recorded in the port PR for the campaign ledger.

# 2.2.8

## Fixes
- **Tailscale funnel URL** — the endpoint page showed `null/v1` for Tailscale even when the funnel was live. `getActualFunnelUrl` queried only the app's own tailscaled socket (a system-managed daemon doesn't answer it) and never included the funnel port. It now tries the app → system → default socket, reads `Self.DNSName`, and appends the funnel port that fronts the local server (matched from `funnel status --json`'s `Web → Proxy` mapping), producing e.g. `https://<host>.ts.net:11434`. The status manager prefers this live CLI value over any stale persisted URL. Pure derivation is unit-tested (`tunnel/tailscale/tailscale.js`, `tunnel/tailscale/manager.js`).

# 2.2.7

## Fixes
- **Themed Select** — the shared `Select` component was a native `<select>` whose OS-rendered popup ignored the dashboard theme. Rewritten as a fully-themed, keyboard-accessible custom dropdown with the same prop API, so every callsite (playground, usage, media providers, MCP gateway, …) now looks consistent (`Select.js`).
- **Endpoint Tailscale `null/v1`** — the External row rendered `null/v1` when the Tailscale funnel URL was unavailable; it is now guarded so a null URL no longer shows (`endpoint/EndpointPageClient.jsx`).
- **Endpoint Cloudflare URLs** — the page now lists ALL configured Cloudflare tunnel URLs (stable worker shortlink + quick/custom) via a new `allUrls` status field, instead of guessing a single URL and hiding the user's custom tunnel (`tunnel/cloudflare/manager.js`, `endpoint/EndpointPageClient.jsx`).
- **Local Ollama embedding card missing** — `dashboardGuard` now accepts the dashboard session JWT for safe GET reads of `/api/models` and `/api/v1/models/*`. The embedding page's model-list fetch carries the session cookie (not an API key) and a remote/Tailscale dashboard is not loopback, so it was getting 401 and the local-Ollama embedding card never rendered. The API-key gate is unchanged for chat/completions and other LLM traffic; POST still requires a key (`dashboardGuard.js`).
- **Provider health false "down"** — `no probe for provider` (cursor's protobuf transport, OAuth-only backends) now maps to `unknown` instead of `down`, so an unprobeable provider that is actively serving traffic is not painted red (`healthMonitor.js`).
- **Provider-icon fallback** — providers without an icon file now show a readable lettered badge instead of a blank square (`ProviderIcon.js`).

## Improvements
- **Playground labels** — added "Model" and "Effort" labels above the toolbar controls (`PlaygroundPageClient.js`).
- **API key edit button** — moved the edit (pencil) into the top-right action cluster beside the delete button (`endpoint/EndpointPageClient.jsx`).
- **Headroom reliability** — the compression-proxy circuit breaker was a latching breaker that stayed degraded until process restart (the only reset path could never run once open). It now self-heals via a 60s cooldown + half-open probe (`rtk/headroomCircuit.js`).

## Tests / tooling
- Added dashboard-guard JWT-for-models cases, a headroom half-open recovery test, and a health `no-probe → unknown` test.

# 2.2.6

## Fixes
- **Provider health false "down"** — the health page overlays recent successful requests onto probe state, so an account actively serving traffic is reported healthy even when its independent probe disagrees (probe-host 5xx, or an OAuth token the probe can't replay). `blocked` (SSRF) and `unconfigured` states are never overridden (`healthMonitor.js`, `usageRepo.getRecentlyActiveConnectionIds`).
- **Quota tracker phantom card** — a disabled (`isActive:false`) non-OAuth connection no longer renders a quota card (e.g. a stale cloud "ollama" row kept only for history). OAuth rows stay visible so they can be reconnected (`api/providers/client/route.js`).
- **Usage "by Account" columns** — the Account/Model/Provider columns were misaligned by one, so the Provider column showed the model and the Account column showed the provider. The account table now leads with the group key like the other breakdowns (`UsageStats.js`).
- **Oversized provider icons** — `ProviderIcon` now caps the rendered image at its `size` prop, so PNGs with a larger natural size stop overflowing their box across the providers, quota, and usage surfaces (`ProviderIcon.js`).

## Improvements
- **Model context windows** — the provider detail page shows each model's context window next to the capability badges (`contextWindow` is now threaded through `/api/models` and `useModelCaps` into `ModelRow`).
- **Playground reasoning effort** — the effort control is now a themed Select (options already dynamic per model) aligned with the model selector, replacing the misaligned segmented control (`PlaygroundPageClient.js`).
- **Usage by Provider** — a new breakdown table backed by the existing `byProvider` aggregate (`UsageStats.js`).
- **Unified chart tooltips** — the token-saver, pxpipe, and headroom charts now use the same themed tooltip as the Usage page via a shared `chartTooltip.js` (`UsageChart.js`, `TokenSaverOverview.js`, `PxpipeClient.js`, `HeadroomClient.js`).
- **Usage date range** — the period pill bar is now a Select of presets plus a calendar `DateRangePicker`. Selecting a preset syncs the calendar; a custom range filters the stats cards + table end-to-end (`/api/usage/stats` and `getUsageStats` accept optional `startDate`/`endDate`). The chart, whose endpoint is preset-only, shows an honest note while a custom range is active.

## Tests / tooling
- Added `health-monitor-recent-activity.test.js`, custom-range cases in `usage-period-aggregation.test.js`, and disabled-connection cases in `provider-client-isUsageEligible.test.js`. Updated the usage route/handler source-assertion tests for the new call signature and props.

# 2.2.5

## Fixes
- **Endpoint page crash** — the authenticated `/dashboard/endpoint` page failed to load because `tunnel/tailscale/manager.js` called `isSystemDaemonRunning()` and `getActualFunnelUrl()` without importing them (and `getActualFunnelUrl` was unexported), so `/api/tunnel/status` 500'd and flooded the console with a `ReferenceError`. Both symbols are now exported and imported (`tunnel/tailscale/tailscale.js`, `tunnel/tailscale/manager.js`). The page client also had a lost `editKeyPolicy` state binding and two `updateReachable` calls wired to the wrong Tailscale setter — restored and corrected (`endpoint/EndpointPageClient.jsx`).
- **Provider health false "down"** — the health probe read `connection.apiKey`, but OAuth accounts (claude/codex) store their token in `accessToken`, so actively-serving accounts probed as down with a false 401. The probe now falls back to the OAuth token, and `ollama-local` was added to the local-probe set so a local Ollama server is probed at `localhost:11434` instead of the cloud catalog (`providerHealthProbe.js`).
- **Local Ollama embedding models missing** — added the `gte` family to `OLLAMA_EMBEDDING_FAMILIES` so GTE-family local embed models are tagged as embeddings (`api/v1/models/buildModelsList.js`).
- **Console log level colors** — a global-flag regex made the level lookup always `undefined`, so every line rendered green. Level detection now reads the capture group correctly (`console-log/ConsoleLogClient.js`).
- **Profile data-directory label** — removed a duplicated `(DurinDoor data directory)` parenthetical (`profile/page.js`).

## Improvements
- **Dashboard UI revamp** — redesigned the Playground, MCP Help, API Docs, and Console Log pages for usability: sectioned cards, proper toolbars, responsive layout, and accessibility (labels, roles, focus rings). The usage chart tooltip now uses a themed text color so hovered values are legible in both themes (`playground/PlaygroundPageClient.js`, `mcp-help/page.js`, `api-docs/page.js`, `console-log/ConsoleLogClient.js`, `usage/components/UsageChart.js`).
- **OAuth session durability** — Claude/Codex refresh is serialized through one coordinator and quota reads skip proactive refresh for rotation-group providers, so quota sweeps no longer rotate multiple account families. Expired sessions persist a durable `reauth_required` state with an in-place account reconnect instead of losing credentials (OAuth credential manager, quota tracker, connections repo, providers dashboard).
- **Context-window capabilities** — corrected under-reported context windows for Claude Opus 4.6/4.7/4.8, GPT-5.5/5.6 family, Kimi K2.x, MiniMax M2.x/M3, and Z.ai GLM-5.x/4.x so the operator-visible window matches the published one (`providers/capabilities.js`, `services/model.js`).

## Ports
- **OmniRoute** — Responses API custom-tool schema + non-stream input (#7905), `reasoning_text` acceptance + internal-reasoning replay-sentinel suppression (#7919/#7912), Anthropic thinking-signature recovery + client-abort resilience (#7906/#7908).
- **decolua/9router upstream** — proxy timeouts, log permissions, MiniMax signature, Claude usage/reconcile, combos, K3 (batch 1); Codex encrypted-content recovery (#2667) + combo empty-body retry (#2689) (batch 2); Codex id_token account binding (#1819), Kiro credit-exhaustion vs daily-probe cooldown (#2664), headroom compression before translation (#2698), loopback dashboard bind by default (#2725).

## Tests / tooling
- **Endpoint regression test** — `tests/unit/endpoint-page-client-regression.test.js` renders `EndpointPageClient.jsx` via `react-dom/server` and guards the restored `editKeyPolicy` state and the corrected Tailscale reachability wiring.

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
