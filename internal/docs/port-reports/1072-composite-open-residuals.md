# #1072 composite open residuals (#2068 #3173 #4704 #4762 #5298 #5354)

Compared 2026-11-20 against DurinDoor base `c16334ec5e971bcc49ab0796b4decd81b8f79e55` (integration merge on `orq/tornf6/integration`) and upstream default branch `master` at [`1855aa44473e88feac9d3f131b9c0c5fc9706b68`](https://github.com/decolua/9router/commit/1855aa44473e88feac9d3f131b9c0c5fc9706b68). Each source below was open against upstream `master` with no merge when checked; the recorded head is the observed final diff head, not a claim about later upstream revisions.

Method: the final diff of each source was read against the current fork, not against upstream `master` alone, and each candidate behavior was traced to the module that owns it here. Diff size was not used as a disposition: [the earlier deferral of #4762](https://github.com/bloodf/durindoor/commit/8d44e6581d6f2a9e2f20b8d302fec3c794072a63) ("too large; the PR exceeds 1500 changed lines") is superseded by this per-behavior split, because #4762 contains both behaviors the fork already ships and one behavior it genuinely lacks. Related prior evidence: [1072-stream-response-residuals.md](1072-stream-response-residuals.md), [1072-provider-transport-residuals.md](1072-provider-transport-residuals.md), [1072-large-deferrals.md](1072-large-deferrals.md), [800-scan-reconciliation.md](800-scan-reconciliation.md).

No provider, browser, media or live request was made. All evidence below is source-diff reading, local code, and offline probes/tests. No product code was written for this review.

| Source | Disposition |
| --- | --- |
| [#2068](https://github.com/decolua/9router/pull/2068) | Partly already shipped; **three independent residuals** identified in the combo failover and account-cooldown paths |
| [#3173](https://github.com/decolua/9router/pull/3173) | Not applicable — new federation topology with its own authority boundary |
| [#4704](https://github.com/decolua/9router/pull/4704) | Not applicable — a different combo router over an external score source |
| [#4762](https://github.com/decolua/9router/pull/4762) | Mostly superseded; **one independent residual** (context markers) plus one conflicting local contract |
| [#5298](https://github.com/decolua/9router/pull/5298) | Not applicable — subprocess MCP bridge with a host-execution surface |
| [#5354](https://github.com/decolua/9router/pull/5354) | Partly already shipped; **three independent residuals** in catalog parameters and tunnel defaults |

## [#2068](https://github.com/decolua/9router/pull/2068) `25f5bec5f69e20e00998fe9dcc42524217adf390`

*Partly already shipped; three independent residuals in the combo failover and account-cooldown paths.*

The upstream PR rewrites `open-sse/utils/stream.js` around a new env-driven deadline ladder (`STREAM_HEADERS_TIMEOUT_MS`, `STREAM_FIRST_CHUNK_TIMEOUT_MS`, `STREAM_STALL_TIMEOUT_MS`, `STREAM_TERMINAL_GRACE_MS`), adds `open-sse/utils/preContentRetry.js` (re-execute the request on a fresh connection, up to three extra attempts with exponential backoff), and rewrites the combo branch around a peek outcome enum. Porting it verbatim would replace the fork's own watchdog, terminal tracker, Responses pending-completion deferral and one-hop failover contract, so the review decomposes it into independent behaviors.

Already present here, with evidence:

- The fork's own committed-stream lifecycle, including recovery bytes for a stream that ends without its terminal event: `open-sse/utils/streamHandler.js:145-266` (`createDisconnectAwareStream`, `emitClientRecovery`), wired at `open-sse/handlers/chatCore/streamingHandler.js:181-224` (`createTerminalTracker`, `onAbortTerminal`). Upstream's "structured terminal error if an already committed stream is interrupted" is covered by the fork's tracker, and the Responses lane additionally synthesizes `response.failed` + `[DONE]`.
- Pre-output recovery is already bounded and tested: `src/sse/handlers/chat.js:722` (`holdForEarlyEof`) and `src/sse/handlers/chat.js:1075-1078` ("at most ONE hop per request"), covered by `tests/unit/stream-early-eof-failover.test.js` ("makes at most one sibling hop per request", "does not fail over on a request-scoped refusal (#14585)", "never retries once content has started").
- A relay failure carried in an HTTP 200 body is already classified before a candidate is recorded as successful: `open-sse/services/combo.js:1315` (`detectUpstreamError`) called at `open-sse/services/combo.js:1650`.
- The part of #2068 that was already merged into this fork as its own port: commit `55dc45203` "port(upstream): preserve combo timing and DeepSeek tool calls (#2068)".

Residual 2068-A — a combo member's pre-content in-stream failure loses its real status and message.

- Local: `open-sse/services/combo.js:1667-1681` collapses every pre-content failure — including a request-scoped refusal carried in an SSE error envelope — into `lastError = "Provider returned an empty stream"` (`open-sse/services/combo.js:1677`) with `lastStatus = 503`. `requestScopedResult` is populated only on the HTTP paths (`open-sse/services/combo.js:1750`, `open-sse/services/combo.js:1772`), never on this stream path, so when no member can serve, the client is told 503 "Provider returned an empty stream" instead of the real cause (for example a 400 `invalid_request_error`).
- The fork's own single-model path already does the opposite: `holdForEarlyEof` (`src/sse/handlers/chat.js:722`) keeps a request-scoped refusal on the current member and returns the client's real error, protected by `tests/unit/stream-early-eof-failover.test.js:183` and `:280`. The combo path is the inconsistent one.
- The upstream branch handles this as a distinct outcome (`peeked.outcome === "error"`): it maps the error to a status, keeps a request-scoped result, and only advances to the next member when the error is fallback-worthy.
- Exact existing modules: `open-sse/services/combo.js` (the SSE branch of the `result.ok` path), `open-sse/utils/streamContentPeek.js:149` and `:201-203` (the peek already returns the pre-content error), `open-sse/utils/streamLifecycle.js:93` (`isRequestScopedStreamError`), `open-sse/utils/error.js` (`getClientStatusFromError`).
- Deterministic offline acceptance: `cd tests && node node_modules/vitest/vitest.mjs run unit/stream-early-eof-failover.test.js unit/port-5cdcddf5-combo-request-scoped-4xx.test.js unit/combo-empty-stream-3463.test.js --maxWorkers=2`, extended with a combo case asserting that a request-scoped in-stream refusal reaches the client with its own status and body instead of a 503 "empty stream" envelope.

Residual 2068-B — a gateway/relay failure locks the only configured account.

- Local: `checkFallbackError(502|503|504|524)` returns `{shouldFallback: true, cooldownMs: 30000}` (offline probe; `TRANSIENT_COOLDOWN_MS = 30 * 1000` at `open-sse/config/errorConfig.js:80`), so a single-account deployment locks its only account for 30 s on a transient Cloudflare 502/503/504/524 and then answers "all accounts locked".
- Upstream adds `shouldSkipAccountFallback(status, activeAccountCount)`: for statuses 502/503/504/524 with at most one active account, do not lock the account, because the hop in front of the origin never answered and the credential is not at fault.
- The fork has narrower "fallback without cooldown" guards only — Antigravity capacity (`src/sse/services/auth.js:1390`), recoverable Cloud Code 403 (`src/sse/services/auth.js:1395`), Codex OAuth invalidation (`src/sse/services/auth.js:1400`), durable credential replacement (`src/sse/services/auth.js:1425`) — and no gateway-status/single-account rule.
- Related: `getClientStatusFromError` (`open-sse/utils/error.js:608`) passes 524 through to the client; upstream keeps 524 for account fallback but returns 502 to the client, because 524 is a Cloudflare status outside the OpenAI error contract.
- Exact existing modules: `open-sse/services/accountFallback.js` (new predicate beside `checkFallbackError`), `src/sse/services/auth.js:1377` (`markAccountUnavailable`, which already loads the provider's connections, so the active-account count is available at the cooling site), `open-sse/utils/error.js:608` (`getClientStatusFromError`).
- Deterministic offline acceptance: `cd tests && node node_modules/vitest/vitest.mjs run unit/account-fallback-request-errors.test.js unit/account-fallback-request-scoped-4xx.test.js --maxWorkers=2`, extended with a case asserting that a 502/503/504/524 against a single active account does not write a cooldown while a multi-account deployment still cools the failing account.

Deferred, not a defect: upstream's late-terminal grace (`STREAM_TERMINAL_GRACE_MS`, holding the client stream up to 3 s after `finish_reason` for a trailing Chat usage trailer) and its pre-content re-execution budget. The fork already defers a trailing Responses completion (`PENDING_COMPLETION_FLUSH_MS = 3000` at `open-sse/utils/stream.js:51`, used at `open-sse/utils/stream.js:1386-1403`) and defers a Chat usage estimate only when the client asked for `stream_options.include_usage` (`open-sse/utils/stream.js:1099-1116`). Adopting upstream's grace would delay every terminal event by up to 3 s for all clients, and adopting its retry budget would multiply provider dispatches past the fork's documented one-sibling-hop contract (`src/sse/handlers/chat.js:1075-1078`). Both are policy decisions, not missing behavior.

## [#3173](https://github.com/decolua/9router/pull/3173) `1052f086fafac235fbed366f67afb56a2b10ee15`

*Not applicable to this fork — a new deployment topology with its own authority boundary.*

The diff adds 64 federation files: `src/lib/federation/{config,constants,headers,clientAuth,edgeClient,proxy,queue,replication,failover}.js`, `src/lib/db/migrations/002-federation.js` through `005-federation-central-watermark.js`, `src/app/api/federation/{snapshot,delta,verify,status,replay,config-status,local-status}/route.js`, a dashboard page, `Dockerfile.federation`, `docker-compose.federation.yml`, `.github/workflows/tests.yml`, `docs/FEDERATION.md` and `docs/federation-spec.md`. The fork has none of these: no `FEDERATION_*` setting, no federation module, no federation migration. It ships a single-node gateway (`src/lib/db`, `src/lib/localDb.js`) whose authentication and accounting are owned by one process, with the port contract 20128 production / 20127 dev.

The missing contracts are stated precisely, because "not applicable" here means a new trust boundary rather than an absent detail:

1. A role-guarded edge→central proxy for `/v1/*` and dashboard APIs, with SSE flush, backpressure and abort propagation across processes. The fork's disconnect-aware stream (`open-sse/utils/streamHandler.js:145`) is a single-process contract and has no cross-process equivalent.
2. A central→edge SQLite replication contract with a revision watermark and transactional batches that must work across the fork's DB adapter chain. The fork's schema is owned by `src/lib/db`, and a second process writing the same database would change who owns it.
3. An idempotency-keyed `pendingWrites` queue drained on recovery, with a fencing lease that answers 409 to a stale writer. The fork's write path (`src/lib/db/repos`) has no lease column and no second writer.
4. A shared secret (`FEDERATION_TOKEN`) that authenticates edge→central calls. The fork's key store (`src/shared/utils/apiKey.js`) models API keys for clients, not inter-node service credentials, so this would introduce a new credential class and a new rotation owner.
5. LINKED/DEGRADED/RECOVERING state shared by two processes: the fork's health and cooldown state is process-local (`src/sse/services/auth.js`).

Each item is a new integration, and the work order excludes building new integrations. The diff additionally adds a CI workflow and rewrites `AGENTS.md`, `CHANGELOG.md` and the READMEs, which this work order also excludes. A future federation proposal would need its own design review, a threat model for the replication secret and the fencing lease, and an explicit decision on which process owns writes — it is not a port of an existing upstream behavior into the fork's current streams.

## [#4704](https://github.com/decolua/9router/pull/4704) `9e442e7bbedfaab36b8075ea358bf4bd411b2a16`

*Not applicable to this fork — a different combo router over an external score source.*

Upstream adds a second combo type whose membership is resolved from the Artificial Analysis leaderboard: `src/lib/services/artificialAnalysis.js` parses the leaderboard HTML embedded in a server-rendered page, `src/lib/services/comboScheduler.js` drives manual/hourly/6h/12h/daily/weekly refresh, `/api/combos/leaderboard` and `/api/combos/[id]/refresh` expose it, and the combo row gains score-range, exclusion and refresh-cadence columns.

The fork's combo router is behavior-derived, not leaderboard-derived. `open-sse/services/combo.js` selects among a configured member list using observed success/cooldown evidence (the `smart-scoring` strategy) plus round-robin and weighted rotation, and the fork explicitly does not ship the score source an intelligence combo would need: `open-sse/services/freeProviderRankings.js:5-43` documents that the `model_intelligence` table is not ported, so the intelligence/elo fields are null by construction. Upstream's own matching contract is also deliberately different from anything here: eligibility is "configured provider routes only, never the static catalog", plus a name-shape matcher over alias spellings (`~openai/gpt-astra-latest`), bracket tags (`gpt-6-astra[1m]`), route suffixes (`-agentic`, `-thinking`, `:cloud`) and version guardrails (`deepseek-v4-flash` must not match `deepseek-v4.1-flash`).

Missing contracts, if this were ever wanted:

1. An external, unauthenticated score source becoming a routing authority over locally configured connections. A leaderboard score is a third-party claim about a model, not a local health signal; the fork's existing scoring is derived from this gateway's own outcomes.
2. A false-positive name matcher, whose cost is silent: one mis-matched route adds a model to the candidate set of every request that names the combo.
3. A refresh cadence plus an optimistic-concurrency write on the combo row, which the fork's combo repository does not currently perform.
4. The upstream PR's own unresolved follow-up, which it flags as blocking readiness: a provider-model discovery error is currently treated as an empty catalog, so a transient discovery failure can clear a combo's model list. The contract to keep is that an empty list may only be persisted after a successful catalog read proves that no configured route matches.

No port. The durable takeaway is the last contract, recorded here so a future score-driven combo does not repeat the upstream defect.

## [#4762](https://github.com/decolua/9router/pull/4762) `2551589adfab26a8ff9806f5a7e7414972c251e2`

*Mostly superseded; one independent residual (context markers) plus one conflicting local contract.*

Already present here, and in one case stronger than upstream:

- Auto-mode classifier non-streaming projection. The fork ships a classifier compat setting (`"off" | "auto" | "always"`) and a short-circuit that answers the Claude Code auto-mode classifier without dispatching upstream: `open-sse/handlers/chatCore.js:1907-1933` (`buildDefaultAllowClaudeMessage`), `open-sse/handlers/chatCore.js:1940-1944` (`detectClassifierFormat`), `open-sse/handlers/chatCore.js:1951-1961` (`shouldDefaultAllowClassifier`), dispatched at `open-sse/handlers/chatCore.js:1053-1063` and `:1454`, `:1683`. The non-stream and SSE→JSON handlers project the client-facing Anthropic Messages envelope: `open-sse/handlers/chatCore/nonStreamingHandler.js:313-318` and `:632-634`, `open-sse/handlers/chatCore/sseToJsonHandler.js:485` and `:591`. Offline evidence: `tests/unit/chatcore-classifier-default-allow.test.js` and `tests/unit/sse-to-json-claude-compat.test.js` pass (25 tests). Upstream's fix — projecting a Claude client answer into an Anthropic Messages object instead of an OpenAI Chat Completions envelope — is therefore already the fork's contract, and the fork additionally avoids the upstream call entirely when the request is the classifier.

Not applicable, because the bug does not exist here:

- Gemini synthetic-turn mimicry. Upstream removes injected `{role: "model", parts: [{text: "Processing tool output..."}]}` placeholders and purges legacy ones. The fork never injects them: there is no occurrence of "Processing tool output" anywhere in `src/` or `open-sse/`, and `open-sse/translator/formats/gemini.js` has no synthetic model-turn builder (its only Gemini request rules are `applyGemini4RequestRules` and `normalizeGeminiParameterRoot`).
- Antigravity schema-map traversal corruption. Upstream's `SCHEMA_MAP_KEYS` fix targets a visitor that recursed into every object value and therefore mutated an empty `properties` map into a schema node. The fork's visitor never does that: `addPlaceholders` in `open-sse/translator/formats/gemini.js:767-801` descends only into the values of `properties` and into `items`, with the #2884 name-map note in the same file.

Conflicting local contract (needs a decision, not a silent port):

- Synthetic `reason` parameter injection. Upstream removes the `{reason: string}` placeholder and the `required: ["reason"]` it adds to empty parameter schemas, because Claude Code's client-side validation rejects an unexpected `reason` parameter on zero-argument tools. The fork still injects it (`open-sse/translator/formats/gemini.js:771-793`) and pins that behavior in two local tests: `tests/unit/gemini-empty-schemas.test.js` and `tests/unit/gemini-schema-walkers-name-map-2884.test.js` (both pass offline, together with the focused files in the verification section). The fork's placeholder exists for the `$ref`-inlining case documented at `open-sse/translator/formats/gemini.js:712-716`, so removing it wholesale is not equivalent to upstream's replacement; adopting upstream's `ensureObjectProperties()` shape is a separate decision that would also require updating the two pinned tests.

Not applicable as a port, for want of a defined authority:

- Antigravity web-search grounding bridge. The bridge maps an Anthropic `web_search_20250305` server tool to Antigravity `{googleSearch: {}}` with `toolConfig.includeServerSideToolInvocations`, then streams `server_tool_use` / `web_search_tool_result` blocks back with contiguous monotonic block indices and `usage.server_tool_use.web_search_requests: 1`. The fork declares native Anthropic server-tool support for exactly one provider (`open-sse/providers/registry/deepseek.js:37`) and does not for Antigravity, and it owns no contract for the `server_tool_use` id namespace or the block-index continuity across the Gemini→Anthropic hop. Porting the bridge would first require deciding which providers may serve native Anthropic server tools and who accounts the search requests.

Residual 4762-A — context markers other than `[1m]` are not resolved.

- Upstream widens its context marker from `[1m]` to any `[<digits><m|k>]` (`open-sse/utils/modelMarkers.js`, `CONTEXT_MARKER = /\[([0-9]+[mk])\]$/i`) and strips it before alias and combo resolution.
- The fork has no `modelMarkers.js`. It strips only `[1m]`: `src/app/api/v1/models/_claudeCompat.js:5` (`CONTEXT_MARKER = /\[1m\]$/i`), used by `decodeClaudeCodeModelId` (`src/app/api/v1/models/_claudeCompat.js:29-45`, called at `src/sse/handlers/chat.js:490`) and by the narrow `glm-5.3[1m]` registry case (`src/sse/services/model.js:215-229`). Offline probe: `CONTEXT_MARKER` matches `claude-opus-5-5[1m]` only; `claude-opus-5-5[200k]`, `claude-sonnet-5[128k]` and `cx/codex[2m]` are left untouched.
- Consequence: a Claude Code extended-context id such as `claude-sonnet-5[200k]` survives to model resolution and the request fails with HTTP 400 "Invalid model format" (`src/sse/handlers/chat.js:900-901`) instead of routing normally.
- Exact existing module: `src/app/api/v1/models/_claudeCompat.js`. The projection regex (which decides whether a catalog row is advertised with `[1m]`, only for proven 1M windows) must stay `[1m]`; the decode regex needs to widen to `\[([0-9]+[mk])\]$/i`.
- Deterministic offline acceptance: `cd tests && node node_modules/vitest/vitest.mjs run unit/claude-code-compat.test.js unit/claude-max-context.test.js --maxWorkers=2`, extended with a decode case for a `[200k]` marker and one assertion that the existing `[1m]` projection cases (`claude-openai/gpt-5.5[1m]`, `kimi/k3[1m]`, `openai/gpt[1m]extra`) keep their current results.

## [#5298](https://github.com/decolua/9router/pull/5298) `7db4acfebf6723e0c8debceac39c7bb29792e6fc`

*Not applicable — a subprocess MCP bridge with a host-execution surface; a new integration.*

Upstream adds `open-sse/services/opencodeServiceBridge.js`, which spawns the OpenCode CLI as a local daemon (`spawn("opencode", ["serve", "--port", "0", "--print-logs"])`, upstream diff line 1360), opens a WebSocket JSON-RPC relay to the daemon's `/api/experimental/client-mcp` endpoint (upstream diff lines 712-715), intercepts internal tool calls at `session.tool.called`, sanitizes Code Mode scripts so execution is forced through `tools["ninerouter_..."]` namespaces, keeps `read`/`shell` declared for WAF heuristics while enforcing host safety at runtime, recycles sessions at 8 turns or on >30 % context compaction, evicts poisoned sessions on `session.execution.failed`, reaps idle daemons with a busy guard, and scrapes daemon logs for "Free usage limit reached" to answer HTTP 429.

The fork's OpenCode lane is HTTP-only against the hosted service: `open-sse/providers/registry/opencode.js:43` (`baseUrl: "https://opencode.ai"`) and `open-sse/executors/opencode.js` using `open-sse/services/opencodeTlsClient.js`. There is no daemon lifecycle, no client-mcp relay, no PATH detection and no rate-limit interception in the fork.

The gap is not a code detail but an authority boundary:

1. The gateway process would spawn a third-party CLI on the host and hand it an MCP tool namespace. Upstream's containment — "zero local execution" — is enforced inside the bridge by intercepting and sanitizing every tool call, which is code this fork would have to adopt wholesale rather than re-derive.
2. A PATH-aware dashboard toggle that switches routing (ON = local daemon, OFF = direct wire) silently changes which egress and which credentials a request uses. That is a routing-authority change, not a port.
3. The rate-limit interception reads daemon logs, so the 429 contract depends on a third-party log format that the fork cannot pin.

A future proposal would need an explicit product approval, a documented containment contract for the spawned process, and its own threat model covering host process spawning, PATH hijack, tool namespace remapping and log scraping. `ws` is already a root dependency (`package.json:79`), so the dependency question is not the blocker; the authority boundary is.

## [#5354](https://github.com/decolua/9router/pull/5354) `638d6fb4e014319723798524115867456ddb5b62`

*Partly already shipped; three independent residuals in catalog parameters and tunnel defaults.*

Already present here:

- Passthrough keepalive framing. Upstream holds SSE framing fields (`id:`/`retry:`/`event:`) until a data line proves the frame has a payload, re-emits them with the data line, and drops payload-less frames. The fork implements the same contract: the hold is declared at `open-sse/utils/stream.js:180-183`, field-only frames and their dangling tails are dropped at `open-sse/utils/stream.js:813-826`, and the held framing is re-emitted immediately before the data line at `open-sse/utils/stream.js:1173` and `:1496`. Covered by `tests/unit/passthrough-sse-field-only-5441.test.js` (ported as commit `ed1693633`, recorded in [1072-stream-response-residuals.md](1072-stream-response-residuals.md)) and `tests/unit/port-3457-sse-keepalive.test.js`.
- The Qwen 3.8 effort set on the `qwen-effort` lane. `open-sse/providers/thinkingLevels.js:36` defines `"qwen-effort": ["none", "low", "medium", "xhigh"]` and `open-sse/translator/concerns/thinkingUnified.js:477` handles that format, so `getThinkingLevels("openai", "qwen3.8-flash")` already returns `["none","low","medium","xhigh"]` — the same set upstream pins with a pattern row. Upstream's provider-agnostic `*qwen3.8*` row would additionally clamp registry-declared openai-format lanes such as `nan/qwen3.8-flash`, which still resolve to the openai default `["none","minimal","low","medium","high","xhigh"]`; see residual 5354-B for why that clamp is not simply copied.

Not applicable — different architecture:

- models.dev catalog sync. Upstream syncs a file-backed catalog through `src/lib/modelCatalog/sync.js` (a new file) and `open-sse/providers/catalogOverride.js`, and its fix is "limits collected for every model a gateway lists upstream, not just static-registry ones" plus "build() detaches the installed catalog while resolving". The fork has no `src/lib/modelCatalog`; it resolves limits through `open-sse/providers/capabilities.js` and its own `src/lib/modelAutoSync/` (`catalog.js`, `runner.js`, `scheduler.js`). The upstream fix has no counterpart module here to patch — the same job is done by a different owner.

Residual 5354-A — the open-weight `qwen3.8-flash-next` preview inherits the 1M API-line window.

- Upstream adds `{ pattern: "*qwen3.8*flash*next*", caps: { …, contextWindow: 262144, maxOutput: 131072 } }` above the generic `*qwen3.8*` row, because every models.dev listing caps flash-next at 262144 while the hosted API line stays at 1M.
- The fork has the qwen3.8 rows but not the flash-next row: `open-sse/providers/capabilities.js:955-958` (`*qwen3.8*omni*`, `*qwen3.8*27b*`, `*qwen3.8-2.4t*`, `*qwen3.8*`). The table is first-match-wins, so the generic 1M row decides alone.
- Offline probe: `resolveModelLimits("amd", "qwen3.8-flash-next")` → `{contextWindow: 1000000, maxOutput: 131072, known: true, source: "pattern"}`, identical to `resolveModelLimits("amd", "qwen3.8-flash")`. The API-line value must stay 1M; only the flash-next preview must drop to 262144.
- Exact existing module: `open-sse/providers/capabilities.js` (`PATTERN_CAPABILITIES`); the new row must be placed above `*qwen3.8*` to survive first-match-wins.
- Deterministic offline acceptance: `cd tests && node node_modules/vitest/vitest.mjs run unit/capabilities.test.js unit/capabilities-context-window.test.js --maxWorkers=2`, extended with a case asserting `qwen3.8-flash-next` → 262144/131072 and `qwen3.8-flash` → 1000000/131072.

Residual 5354-B — the tiered Gemini 3.6/3.7 flash lanes can still be sent `MINIMAL`.

- Upstream adds `PATTERN_THINKING` rows for `*gemini-3.8*`, `*gemini-3.7*` and `*gemini-3.6*` limited to `["low","medium","high"]`, because the tiered flash family answers 400 on `thinkingLevel: MINIMAL`.
- The fork already covers 3.8 through the capability row: `open-sse/providers/capabilities.js:430` declares `gemini-3.8-flash` with `thinkingEfforts: ["low","medium","high"]`, and the gemini-level clamp reads exactly that field (`open-sse/translator/concerns/thinkingUnified.js:446-450`). Antigravity's 3.6/3.7 tiers are covered by `ANTIGRAVITY_FLASH_TIER_CAPABILITIES` (`open-sse/providers/capabilities.js:413`).
- The uncovered lane is the google gemini provider's own ids: `open-sse/providers/registry/gemini.js:41-42` serves `gemini-3.7-flash` and `gemini-3.6-flash`, and their capability rows carry no `thinkingEfforts`. Offline probe: `getCapabilitiesForModel("gemini","gemini-3.7-flash")` → `{thinkingFormat: "gemini-level", thinkingEfforts: null}` and `getThinkingLevels("gemini","gemini-3.7-flash")` → `["minimal","low","medium","high"]`, so the clamp at `open-sse/translator/concerns/thinkingUnified.js:446-450` has no allowed set and passes `MINIMAL` through.
- Exact existing module: `open-sse/providers/capabilities.js` — add `thinkingEfforts: ["low","medium","high"]` to the `gemini-3.7-flash` / `gemini-3.6-flash` rows, mirroring the 3.8 row at line 430. (Upstream's mechanism is a `PATTERN_THINKING` row in `open-sse/providers/thinkingLevels.js`; in this fork the effective module is the capability row, because the wire clamp reads `caps.thinkingEfforts`.) Upstream's provider-agnostic `*qwen3.8*` effort pin is deliberately not copied: this fork's `qwen-effort` lanes already carry the official set, and copying a family-wide pin would also clamp third-party lanes that legitimately accept `minimal`/`high` — that clamp needs its own scoping decision.
- Deterministic offline acceptance: `cd tests && node node_modules/vitest/vitest.mjs run unit/gemini-declared-thinking-efforts.test.js unit/capabilities.test.js --maxWorkers=2`, extended with 3.7/3.6 cases asserting `minimal` normalizes to `low`. The existing case "retains minimal for models whose existing level contract permits it" (`tests/unit/gemini-declared-thinking-efforts.test.js:19-23`, `gemini-3-flash-preview`) must keep passing — it is not a 3.6/3.7 model.

Residual 5354-C — the tunnel and funnel forward to a hardcoded port.

- Upstream changes `enableTunnel`/`enableTailscale` to default to `getAppPort()` instead of 20128, because the dev server listens on 20127 while the funnel forwarded to 20128.
- The fork has the same hardcoded default: `src/lib/tunnel/cloudflare/manager.js:34` and `src/lib/tunnel/tailscale/manager.js:23`, while its dev script binds 20127 (`package.json:11`, `node scripts/next-owner-server.cjs --dev --port 20127`). The fork has no `getAppPort`, but it already resolves the runtime port as `process.env.PORT || UPDATER_CONFIG.appPort` elsewhere (`src/lib/appUpdater.js:97`, `src/app/(dashboard)/dashboard/endpoint/page.js:5`), so the resolution primitive exists.
- Exact existing modules: `src/lib/tunnel/cloudflare/manager.js:34` and `src/lib/tunnel/tailscale/manager.js:23`.
- Deterministic offline acceptance: `cd tests && node node_modules/vitest/vitest.mjs run unit/tunnel-manager-health-fallback.test.js unit/proxy-connect-tunnel.test.js --maxWorkers=2`, extended with a case asserting the managers default to the configured port rather than the literal 20128.

Deferred, needs a header-contract decision: upstream adds `"OpenAI-Beta": "responses=experimental"` to the Codex registry headers (`open-sse/providers/registry/codex.js`). The fork's Codex registry sends `originator`, `User-Agent` and `version` only (`open-sse/providers/registry/codex.js:44-46`), and no local test pins the header set. Adding an upstream beta header changes Responses negotiation for every Codex request, so it needs an explicit decision rather than a port; its acceptance would be a new unit test over the registry header set.

## Verification

Focused offline tests run for this review (from `tests/`, no network, no provider credentials):

- `unit/chatcore-classifier-default-allow.test.js` + `unit/sse-to-json-claude-compat.test.js` — 25 tests pass (the #4762 auto-classifier non-streaming projection).
- `unit/passthrough-sse-field-only-5441.test.js` + `unit/gemini-empty-schemas.test.js` + `unit/capabilities.test.js` — 76 tests pass (the #5354 keepalive framing, the #4762 pinned placeholder contract, and the capability table).

Read-only probes used to establish the residual gaps: `resolveModelLimits` for the qwen3.8 family, `getCapabilitiesForModel`/`getThinkingLevels` for the gemini 3.6/3.7/3.8 lanes, `checkFallbackError` for 502/503/504/524, and the fork's context-marker regex. All were run with `node --input-type=module` against the working tree and changed no file.

The full suite and the integration gate were not run here; they belong to the integration owner. No baseline entry, workflow, `AGENTS.md`, secret or generated file was touched, and no dashboard source changed, so no Storybook inventory regeneration was needed.
