# 9router Upstream Port Audit — 2026-08-20

**Upstream head reviewed**: `699edac32` (`# v0.5.55 (2026-08-14)`) — re-confirmed as the current
`decolua/9router` `master` head at execution time, so the plan anchor needed no delta.
**Scope**: 194 items = the 300 most-recently-updated open PRs minus 110 already adjudicated in prior
campaign ledgers (167 in-scope after title triage) **+ 27 unreviewed `master` commits** landed after
the previous sync anchor `15223724c` (2026-08-05).
**Result**: 128 confirmed GAP + 1 uncertain, 56 DUPLICATE, 6 N-A, 3 DEFER.
**Method**: two passes per item (identifier extraction -> fork grep -> adversarial falsification);
every overturn and every security row was confirmed by a direct read of the named fork file.
**Policy**: per [`docs/UPSTREAM_SYNC.md`](../UPSTREAM_SYNC.md), unmerged open PRs stay on the WATCH
list — port only once their merged diff exists. The Tier 1 rows are merged commits on `master` and
are the PORT-NOW candidates.
**Fork baseline**: the verdict tables record fork state as audited against checkout HEAD
`4e81d7045`, which was 32 commits behind `origin/main` `f9753bdc7` (releases 3.12.0 -> 3.17.4). For
the merged PORT-NOW candidates re-verified against `f9753bdc7`, read the
**Appendix — current `origin/main` reconciliation** at the end of this file: net zero merged code
gaps remain.

---

### Tier 0 — Security (port first, independent security review gates each)

| Ref | Size/Risk | Upstream title | Smallest fork-appropriate port |
|---|---|---|---|
| 8a527fec9 | M/M | fix(security): SSRF guard on search baseUrl, default-password remote login, and request-deta | Apply existing assertPublicUrl to search baseUrl in callers.js, add default-password 403 in login route, and redact payloads in request-details route |
| #3313 | M/M | fix(security): chặn SSRF khi kiểm tra provider node | Port the upstream lookup/connector hooks and guarded fetch dispatcher into the fork's existing ssrfGuard.js and wire into provider-nodes/validate rout |
| #3381 | S/L | fix(db): create credential store with owner-only permissions | Add hardenPermissions with 0700 dir / 0600 file chmod on DB, WAL/SHM, and backups in existing dataDir/driver/backup modules plus the permissions test. |

- #8a527fec9 evidence: fork already has `assertPublicUrl` (`src/shared/utils/ssrfGuard.js:48`)
  applied in `src/sse/handlers/fetch.js:84` and `src/lib/network/proxyTest.js`, but the **search**
  path (`open-sse/handlers/search/callers.js`, uses `baseUrl`) does NOT call it — reuse the existing
  util there. The default-password-remote-login half is a separate hardening; verify against
  `custom-server.js`/`dashboardGuard.js` before claiming it fixed.
- #3313 overlaps #8a527fec9 (both SSRF on provider/search fetch); land one guard util, not two.
- #3381 (credential-store owner-only perms): add `0700`/`0600` chmod on DB + WAL/SHM + backups.

### Tier 1 — Merged commit gap (PORT-NOW; final diffs exist on master)

| Ref | Size/Risk | Upstream title | Smallest fork-appropriate port |
|---|---|---|---|
| e1115e283 | M/M | feat(opencode-go): route by request format via transports + per-model guard | Port multi-endpoint transports into opencode-go executor/registry plus per-model supportedFormats guard in chatCore with default-transport fallback |
| 27f3710c8 | S/L | fix(docker): ship sql.js so the pure-JS DB fallback can start | Add a COPY of node_modules/sql.js into the fork's Dockerfile runtime stage so sql-wasm.wasm is available for the pure-JS DB fallback. |
| 7e5f5a881 | M/M | fix(claude): re-anchor passthrough cache breakpoints with 1h TTL | Add cache-breakpoint re-anchoring helper (1h TTL on last system/tool, 5m on last assistant turn) plus mid-conversation system folding in open-sse/tran |
| 345cdcf6a | M/M | fix(combo): detect images from Hermes and attachment payloads for Vision Adapter | Add Hermes/Ollama/Vercel image detection (images[], attachments, data URIs) to combo capability scan and modality stripping, plus port hermes-vision-d |
| 67271d859 | S/L | fix(opencode): send official client headers on free-tier requests | Add official opencode fingerprint headers with resolveSessionId-based session id to free-tier requests in open-sse/executors/opencode.js |
| 6d30ce6de | S/L | fix: Fusion strip stream_options + reasoning model test probe | Strip stream_options in open-sse/services/combo.js fan-out and update ping.js probe to max_tokens 1024 with reasoning-only soft-pass, porting both tes |
| 5b417f9bf | S/M | fix(kiro): intercept chat via x-amz-target and prepend initial-response frame | Add x-amz-target-based chat interception in src/mitm/handlers/kiro.js and prepend the initial-response event-stream frame to the response. |
| 80afb5990 | S/M | fix(qoder): detect billing blocks at stream start, return 403 for failover | Add first-frame billing-signature peek in fork's open-sse/executors/qoder.js wrapQoderSSE returning synthetic 403 for failover, plus port qoder-billin |
| 456f2a263 | S/L | feat(usage): wire force flag through client + usage route | Add force param to fetchQuota client call and append ?force=1 in usage route to bypass quota cache on manual refresh |
| cd4003bc8 | M/M | feat(usage): dedup + cache Claude quota calls to avoid 429 | Port TTL cache + in-flight dedup with stale-on-failure into open-sse/services/usage(/claude).js, thread force flag, and add stable grouping in Provide |
| 86694ed8d | M/L | feat(antigravity): add Gemini 3.7 Flash models (#3286, #3281) | Add gemini-3.7-flash and tiered variants to the Antigravity/Gemini registries, capabilities, pricing, quota tracking, and tiered-model extraction, plu |
| b04c03c6b | S/L | feat(providers): add Alibaba Token Plan (token-plan.ap-southeast-1) | Add registry/alitp-intl.js with Singapore token-plan endpoint, register it in registry/index.js, and add the provider unit test. |
| 8af5e752d | S/L | feat(tts): add Fish Audio as a text-to-speech provider | Add fish-audio registry entry plus config-driven FORMAT_HANDLERS entry in genericFormats.js sending model in header and voice as reference_id, and wir |
| 8ed9da716 | S/L | feat(providers): add glm-5.3 to GLM Coding and GLM (China) registries | Add glm-5.3 model entries to open-sse/providers/registry/glm.js and glm-cn.js following existing capability/pricing patterns. |

### Tier 2 — Small correctness fixes (open PRs, S size; WATCH → port on merge)

| Ref | Size/Risk | Upstream title | Smallest fork-appropriate port |
|---|---|---|---|
| #3350 | S/L | Fix/kiro reasoning text content fields | Add 'text' field alongside 'content' in the reasoningContentEvent frame emitted in open-sse/executors/kiro.js (~line 572). |
| #3318 | S/L | fix(translator): wrap array tool outputs in object for Gemini/Antigravity functionResponse | In open-sse/translator/request/openai-to-gemini.js, wrap non-object parsed tool responses as { result: ... } before building functionResponse.response |
| #3369 | S/L | fix(translator): recover a tool result that arrived without an id | Add resolveToolResultId logic to ensureToolCallIds in open-sse/translator/concerns/toolCall.js pairing id-less tool results with oldest unanswered cal |
| #3419 | S/M | fix(minimax): preserve images on matched OpenAI transport | Reorder targetFormat precedence in open-sse/handlers/chatCore.js so a source-format-matched transport's format overrides model-level targetFormat, and |
| #3373 | S/L | fix(responses): normalize custom tool names in non-streaming conversion | Normalize customToolNames via new Set(customToolNames // []) in nonStreamingHandler.js and sseToJsonHandler.js before .has() checks |
| #3315 | S/L | fix(codex): retry phản hồi quá tải giả HTTP 200 | Port SSE delta-joining overload detection into open-sse/executors/codex.js peek logic, mapping matched overload text to the existing 503 retry path |
| #3186 | S/L | fix: Codex request hardening (custom provider params, replayed tool-call IDs) | add RegExp provider matching to stripUnsupportedParams in paramSupport.js to strip reasoning params for custom OpenAI-compatible providers, and apply  |
| #3411 | S/L | fix(gemini): sanitize schema keywords in function responses to prevent 400 | Add sanitizeFunctionResponseResult key-sanitization to open-sse/translator/formats/gemini.js function-response parsing |
| #3420 | S/L | fix(chat): sync negotiated stream flag into upstream body | Add stream-flag sync (translatedBody.stream = stream) on passthrough and same-format paths in open-sse/handlers/chatCore.js plus the unit test. |
| #3387 | S/L | fix(clinepass): unwrap { data, success } envelope in non-streaming responses | add ~6-line envelope unwrap (responseBody = responseBody.data when data.choices present) in open-sse/handlers/chatCore/nonStreamingHandler.js |
| #3366 | S/L | fix(antigravity): drop messages whose parts become empty after thought filtering | add filter(c => c.parts?.length > 0) after thought-part filtering in open-sse/executors/antigravity.js |
| #3310 | S/L | Sửa đối số tool call và khả năng Xiaomi Token Plan | Add null/empty arguments->"{}" normalization in open-sse/translator/concerns/toolCall.js and text-only caps overrides for xiaomi-tokenplan MiMo V2.5 i |
| #3331 | S/L | fix(auth): disable Qoder connection on quota exhaustion (403/code 112) | Add 403/code-112 detection in src/sse/services/auth.js to set isActive=false and fall back to next account, plus port the unit test. |
| #3342 | S/L | fix(codebuddy-cn): make the system-prompt length gate tunable and loud | Add CODEBUDDY_SYSTEM_PROMPT_MAX_LEN env override (0 disables) and rule-naming warning in open-sse/executors/codebuddy-cn.js, plus .env.example entry a |
| #3352 | S/L | feat(backoff): make 429 cooldown schedule configurable | Add resolveBackoffConfig with BACKOFF_BASE_MS/BACKOFF_MAX_MS/BACKOFF_MAX_LEVEL env parsing and validation to open-sse/config/errorConfig.js plus docs/ |
| #3267 | S/M | fix(models): don't dump full built-in catalog when DB is healthy but has no connections | Add dbAvailable flag in src/app/api/v1/models/route.js so a healthy DB with zero connections returns only custom models/combos, keeping full-catalog f |
| #3058 | S/L | fix: correct AssemblyAI STT auth header | Add raw "authorization" scheme to STT auth builder and pass formData to transcribeAssemblyAI mapping language→language_code in open-sse/handlers/sttCo |
| #2787 | S/L | fix(codex): preserve GPT-5.6 max reasoning | add supportsThinkingLevel helper to thinkingLevels.js and use it in codex.js and thinkingUnified.js to skip clamping "max" for GPT-5.6 |
| #3188 | S/L | fix: strip Qwen thinking params for OpenAI-compatible passthrough (#2752) | Add a regex-capable provider matcher and an /openai-compatible/custom/i rule stripping enable_thinking/thinking_budget in paramSupport.js |
| #3368 | S/L | fix(cli): stop the hard-coded heap cap from overriding the operator | Add cli/hooks/nodeFlags.js with resolveHeapFlags() and replace the hard-coded --max-old-space-size=6144 in cli/cli.js with its result. |
| #2699 | S/L | fix(cli): default to IPv4-first DNS resolution to avoid undici IPv6 connect timeouts | add "--dns-result-order=ipv4first" to the spawn arg arrays at cli/cli.js:523 and cli/cli.js:642 |
| #3314 | S/L | fix(cli): ngăn cài SQLite native khi khởi động | Gate better-sqlite3 install behind postinstall-only opt-in flag with 12.10.1 pin and 30s timeout in cli/hooks/sqliteRuntime.js |
| #2731 | S/M | refactor(kiro): keep terminal integrity transport-only | Strip response-text heuristics from the terminal-integrity gate in open-sse/executors/kiro.js, keeping transport-level checks plus malformed tool_call |
| #3421 | S/L | feat(kimi): force streaming for the Kimi Code endpoint | Add forceStream: true to the Kimi Code entries in open-sse/providers/registry/kimi.js and sync the negotiated stream flag into translatedBody in chatC |
| #3397 | S/L | fix(nvidia): drop EOL models, repoint DeepSeek V4 Flash at its live id | Remove minimax-m2.7 and deepseek-v4-pro from open-sse/providers/registry/nvidia.js and capabilities.js and repoint DeepSeek V4 Flash to deepseek-v4-fl |
| #3393 | S/L | fix(dashboard): prevent UI crash when API key is less than 8 characters | Wrap the mask repeat count in Math.max(0, ...) in Tts/Stt/GenericExampleCard.js |
| #3338 | S/L | fix(rtk): enforce dynamic user language detection in caveman prompts | Replace SHARED_PRESERVE_LANGUAGE string at cavemanPrompts.js:23 with the dynamic language-detection instruction |
| #3280 | S/L | fix: include freeTier no-auth providers (SearXNG) in webSearch/webFetch combo picker (#3269) | Extend the NO_AUTH_PROVIDER_IDS computation at ModelSelectModal.js:21 to also include noAuth entries from FREE_TIER_PROVIDERS. |
| #3111 | S/L | feat(telemetry): add model, kiro credits, and session id to the done line | Extend the 📊 DONE log line in streaming/nonStreaming handlers to append provider/model, kiro_credits (already preserved in usageTracking), and session |
| #3426 | S/L | fix(usage): show model and provider for single-item groups | Port the single-item group summary-row logic into src/shared/components/UsageStats.js |
| #3388 | S/L | fix(usage): update dashboard stats in real time | Port the +58/-26 patch across the 5 existing files: pass period to SSE stream, replace stats with SSE snapshot with abort ref, and key chart refresh o |
| #3320 | S/L | feat(antigravity): update Antigravity IDE fingerprint version to 2.5.5 | Bump Antigravity version constant and user agent to 2.5.5 in open-sse/providers/shared.js and update the usage-headers test expectations. |
| #2959 | S/L | test(api): add unit tests for count_tokens CORS preflight, 400 invalid JSON, and payload edg | Add CORS preflight, invalid-JSON 400, and empty/null payload test cases to existing tests/unit/count-tokens.test.js |

### Tier 3 — Medium correctness fixes (open PRs, M size; WATCH → port on merge)

| Ref | Size/Risk | Upstream title | Smallest fork-appropriate port |
|---|---|---|---|
| #3277 | M/M | fix: combo fallback on HTTP 200+error (#3242) + responses output_text.done ordering (#3234) | Add detectUpstreamError-based 200+error fallback in chatCore handlers and gate output_text.done on interleaved tool_calls in open-sse/translator/respo |
| #3055 | M/M | fix(translator): prevent merging Gemini functionResponse with text turns & fix missing tool  | Port normalizeGeminiContents functionResponse/text-merge guards and trailing-model-turn user append into open-sse/translator/request/openai-to-gemini. |
| #2681 | M/M | fix(kiro): validate completed nested tool_call payloads | Port wrapper tool_call buffering/validation into open-sse/executors/kiro.js plus SSE error formatting in open-sse/utils/stream.js, adapting the valida |
| #2688 | L/M | fix(kiro): retry malformed tool_call wrappers once | Port the one-shot repair gate into open-sse/executors/kiro.js streaming path (plus stream.js helper and tests), reusing existing fork retry/fallback p |
| #3333 | M/M | fix(tools): DeepSeek same-name tool dedup + endpoint matrix tests | extend dedupeTools in open-sse/utils/toolDeduper.js with DeepSeek same-name dedup (first wins, Claude-gated MCP path) and port the three test files |
| #3405 | L/M | fix(executor): handle CommandCode in-stream errors for combo and account fallback | Port stream-inspection wrapper (inspectAndWrapCommandCodeResponse/parseCommandCodeError/createReplayedStream) into open-sse/executors/commandcode.js t |
| #3386 | M/M | fix(codex): surface SSE context overflow as 413 | Port SSE context-overflow detection into open-sse/executors/codex.js with 413/context_length_exceeded terminal rule in errorConfig.js, mirroring githu |
| #3075 | M/M | fix(9router): correct usage accounting and error scope for claude-backed traffic | Port the remaining pieces—cache-inclusive usage folding in claude-to-openai.js, _customToolNames forwarding in openai-to-claude.js, and fallback:false |
| #2780 | M/M | fix: support Claude Code Auto Mode through GPT fallback | Port chatCore/claudeMessageResponse.js plus suffix-normalization helpers into fork's existing completionProjector/model-resolution paths. |
| #3250 | M/M | feat(opencode-go): read the plan usage endpoint, and stop calling a spent key invalid | Add usage/opencode-go.js handler and switch key validation to probe /zen/go/v1/usage so exhausted keys aren't marked invalid |
| #3332 | M/L | fix(opencode-go): keep DeepSeek on chat completions + normalize (max) | Restrict DeepSeek V4 entries in open-sse/providers/registry/opencode-go.js to supportedFormats ["openai"] and apply existing stripThinkingSuffix befor |
| #2895 | M/M | feat(fallback): per-provider retry-delay control | Port the +158 patch adding retryDelayByProvider setting with parseProviderResetMs/resolveCooldownMs into the fork's existing 5 touched files. |
| #3203 | M/M | feat(fallback): per-account RPM cap, default 40 for NVIDIA | Port rpmLimiter service plus getAuth skip check and rpmByProvider setting into fork's existing auth/settings files |
| #2755 | M/M | fix(cursor): implement real PKCE OAuth login | Port PKCE OAuth flow and refreshCursorToken into src/lib/oauth/services/cursor.js and tokenRefresh services, keeping IDE import route intact |
| #3261 | L/M | fix(proxy): rotate no-auth pools after rate limits | Port proxy-pool cooldown/rotation logic into accountFallback.js and chat handler, reusing existing isRateLimitError |
| #3166 | M/M | feat: 8 Production Features + fix(translator) thinking prefix for Kiro | Port only the Kiro translator fix into open-sse/executors/kiro.js: drop top-level systemPrompt and inject system prefix as frozen msg0 with "..." plac |

### Tier 4 — Features & larger enhancements (open PRs; port on demand)

| Ref | Size/Risk | Upstream title | Smallest fork-appropriate port |
|---|---|---|---|
| #3272 | L/M | feat: add Oh My Pi (omp) CLI tool integration | Port the omp tool card, role-based model assignment, and omp-settings YAML API into the fork's existing cli-tools dashboard and API routes, skipping a |
| #3042 | L/M | feat(combos): add combo test runner and fallback sequence diagnostic | Port the two new combo test routes, ComboTestModal component, and pingModelByKind prompt/preview options onto the fork's existing ping module (mind re |
| #3197 | S/L | feat(combos): add per-model test button in combo create/edit modal | Port the per-model Test button and /api/models/test probe into the combo create/edit modal in src/app/(dashboard)/dashboard/combos/page.js, reusing pr |
| #3062 | M/L | feat(combos): add import/export with capacity adapter support | Add the two new combos export/import API routes and the dashboard combos page Export/Import UI as in upstream #3062. |
| #2937 | M/L | feat: add one-click model health testing | Port the +290/-45 diff onto the existing provider UI and test-models route files, adding batch ping loop, classifyResult, and disable-failed action. |
| #3192 | M/M | feat(providers): add model search + batch model test to dashboard | Add modelBatchTester util and wire search filter + batch-test UI into providers list/detail pages |
| #2777 | S/L | feat(dashboard): add bulk enable/disable for provider connections | Add bulk Enable/Disable Selected buttons calling handleUpdateConnectionStatus over selected ids in src/app/(dashboard)/dashboard/providers/[id]/page.j |
| #3273 | M/M | feat(usage): live Sessions tab + CLI custom URL presets | Port the in-memory active-session tracker into chatCore/usage SSE plus new RequestsPanel Sessions tab and BaseUrlSelect custom-URL prefill, reusing fo |
| #3429 | M/M | feat(models): add combo-only model exposure | Add exposeComboOnly setting in settingsRepo/profile page and early-return deduped combo entries in src/app/api/v1/models (route.js/buildModelsList.js) |
| #2793 | M/L | feat(combo): expose provider-neutral route attribution | port routeAttribution.js helper and wire header annotation into combo.js and chat.js without body buffering |
| #3437 | M/M | feat: add Antigravity as web search provider with Google Search grounding | Port Antigravity web-search support (AG_MODEL_MAP, grounding-citation extraction, 503 fallback) into existing antigravity executor/registry and chatSe |
| #3407 | L/M | feat(usage): show Zed plan quota on the dashboard | Port new open-sse/services/usage/zed.js and shared/zedAuth.js plus wire Zed handler into usage dispatch and ProviderLimits quota rendering. |
| #3337 | M/L | feat(opencode-go): show subscription quota on the dashboard | Port the opencode-go usage handler into open-sse/services/usage.js and register quota-window rendering in ProviderLimits/utils.js |
| #3047 | L/M | feat(usage): TokenRouter quota tracker via optional Management Key | port new usage/tokenrouter.js handler plus optional managementKey UI fields and quota-row rendering into existing dashboard files |
| #2724 | S/L | feat(grok): show current-day request usage | Add getDailyConnectionUsage to usageRepo and wire it into the dashboard usage route for subscribed Grok connections, counting today's requests since l |
| #2893 | M/M | feat: add user-defined custom system prompt injector | Add customPrompt.js reusing existing injectSystemPrompt in open-sse/rtk/systemInject.js, wire into chatCore/chat handlers, and add Token Saver toggle  |
| #3123 | S/L | feat(providers): add per-provider toggle for usage topology canvas | port ~104-line change adding topologyVisibility setting to settingsRepo, toggle in providers page, and filtering in UsageStats |
| #3087 | S/L | feat(headroom): add lossless mode to proxy start | Add headroomLossless setting in settingsRepo and pass --lossless in process.js/start route, skipping the absent restart route. |
| #2845 | S/L | feat(headroom): add optional Bearer Token auth | Add optional headroomToken setting and pass Bearer header in open-sse/rtk/headroom.js, wiring through settingsRepo, chat handlers, and TokenSaverClien |
| #3417 | S/L | feat(headroom): configure compression timeout | Add headroomTimeoutMs setting (default 3000, normalized) and plumb it from settingsRepo/dashboard through chat handlers into headroom.js compress call |
| #3415 | S/L | feat(antigravity): add hot reload for pending quota countdown + bun lockfile support | Port the new hotreload API route plus dashboard UI hooks and .gitignore bun lockfile entries into existing fork files. |
| #2998 | S/L | feat(providers): paginate provider detail connection list | Port connectionsPagination.js helper plus pagination UI into provider detail page, add ?provider= filter to providers route, and extend shared Paginat |
| #3126 | M/M | Add local vs hosted deployment mode. | Add src/shared/utils/deploymentMode.js with isHosted/DEPLOYMENT_MODE and wire it into dashboardGuard, dataDir fallback, and OAuth modals for public ca |
| #2710 | L/M | feat(observability): correlate request attempts | Port correlation/attempt ID generation in chatCore, forward attempt ID via applyRequestIdHeader in executors, and persist both IDs in requestDetail. |
| #2723 | L/M | feat(quota): denser tracker UI, Available filter, 7d-hourly graphs | Port the tracker UI rework, shared availability classifier/filter, and 7d-hourly chart period into the existing fork files plus add the two unit tests |
| #2898 | L/M | feat(cli-tools): add Pi (pi.dev) coding agent support | Port PiToolCard, pi-settings route, pi.svg, and register Pi in CLI_TOOLS and all-statuses, following the existing openclaw-settings pattern |
| #3015 | L/M | feat(models): add Model Access page to gate what the endpoint serves | Port model-access page and /api/models/access route, wire gating into existing src/app/api/v1/models/route.js and add Fetch Models button on provider  |
| #3205 | L/M | feat(keys): per-key rate limits, budget, model allowlist and expiry | Port keyPolicy service, 002-api-key-controls migration, and keys API/dashboard edits, adapting the absent EndpointPageClient UI to the fork's dashboar |
| #2899 | L/M | feat: add Error Log dashboard, API, and error logging instrumentation | Port errorLogs table/repo, /api/usage/error-logs route, error-log dashboard page, and saveErrorLog instrumentation into fallback/combo paths. |
| #2871 | L/M | feat: add provider-scoped input guard rules | Port convoy rulesEngine, rulesRepo, migration 002, API route, and dashboard page, wiring rule application into chatCore streaming/non-streaming paths |
| #2941 | L/M | feat(routing): add latency-aware account routing | Port healthConfig/healthTracker services and latency-aware selection into fork's sse handlers, adding routing-health dashboard/API pages as new files |
| #2784 | L/M | feat(providers): add configurable error cooldown policies | Port the cooldown-policy module and thread errorCode/resetsAtMs through executors, handlers, and TTS providers, keeping policies opt-in per connection |
| #3345 | L/M | fix(models): respect UI configured models and prevent live catalog/upstream override | port the model-resolution guard skipping fetchCompatibleModelIds/LIVE_MODEL_RESOLVERS when static/custom models exist, into fork's providers catalog c |
| #3032 | L/M | feat(models): provider imports, models.dev metadata, and Models dashboard | Port the full model-catalog feature (bulk import API, models.dev metadata service, Models dashboard page) as one isolable stack slice. |
| #2943 | L/M | feat(codex): add transparent native provider transport | Port the new codex-native gateway files (server/codexNativeGateway.cjs, open-sse/config/codexNative.js, native-server.cjs, api routes) and wire /v1/co |
| #2713 | L/M | Fix OpenAI Responses stream reconstruction | Port responsesAccumulator.js module and wire its reduce/finalize into streamingHandler, sseToJsonHandler, streamToJsonConverter, and openai-responses  |
| #3161 | L/M | feat(cursor): bridge AgentService MCP tools | Port the AgentService MCP bridge into fork's existing cursor executor/translator files, adding cursorModels.js service and session TTL retention |
| #3276 | L/M | fix(cursor): tunnel AgentService through HTTP/2 proxy so vendor models stream | Add http2Connect/cursorModels utilities and wire cursor.js plus models routes to tunnel AgentService via the configured proxy with fail-closed resolut |
| #2769 | L/M | feat: add multi-reference image generation and quota-aware failover | Port multi-reference image handling and quota-aware failover, adding new open-sse/services/antigravityRuntime.js and updating existing image provider/ |
| #2954 | L/M | feat(codebuddy): shared protocol normalization + account profile refresh | Port the shared open-sse/protocol/codebuddy module and wire it into the existing codebuddy-cn executor/registry, adding the refresh-profile route and  |
| #3347 | L/M | Improvements: opencode/Hermes QOL - usable /v1/models listing, bare-name resolution, usage p | Port opencodeCatalog.js plus the /v1/models noAuth listing, canonical model echo, and usage-pipeline (combo name + aborted-row) changes as one isolabl |
| #3258 | M/L | feat(video): add MiniMax text-to-video generation | Add minimax video adapter and register MiniMax-H3 model/v2 endpoints in existing minimax registries, wiring through videoCore.js |
| #2948 | M/M | feat(media-providers): add support for custom video provider nodes and AddCustomVideoModal | Port custom-video provider support: add AddCustomVideoModal, custom-video node CRUD/validation with /generations probe, and baseUrl resolution from cr |
| #3132 | L/M | feat(elevenlabs): full TTS panel — v3 audio tags, AI enhance, stability, language override,  | Port the ElevenLabs v3 panel wholesale: add elevenlabsVoices.js and usage/elevenlabs.js, extend the existing ttsProviders/elevenlabs.js and dashboard  |
| #3376 | L/M | feat: Add custom JSON/JS provider adapters plugin system | Port the full custom-adapters plugin (loader, transformer, executor, CRUD routes, dashboard page) and wire into fork's executors/index.js, provider.js |
| #3255 | L/M | Latency Monitoring for Provider Selection | Port latency capture to all handlers plus new DB columns/backfill migrations and dashboard P50/P95 UI via latencyUtils.js |
| #2833 | L/M | feat(api-keys): add expiry, token quotas, and model policies | Port migration 002-api-key-policies plus reservation/settlement and policy enforcement into fork's existing handlers/repos, adapting dashboard bits si |
| #2908 | M/L | feat(dashboard): interactive model sub-node tree topology with real-time active pulse & disp | Port upstream #2908 topology changes into fork's ProviderTopology.js/UsageStats.js adding model sub-nodes, pulse animations, and display-mode toolbar. |

### Tier 5 — Provider / model catalog additions (open PRs; port on demand)

| Ref | Size/Risk | Upstream title | Smallest fork-appropriate port |
|---|---|---|---|
| #3363 | L/M | feat(providers): add Nous Research support | Port upstream Nous provider (registry/nous.js, services/nous.js, validation/model-discovery hooks) into the fork's existing provider registry and rout |
| #3396 | S/L | feat(providers): add Reasonix, OVH, JoyCode, OpenModel registries (salvage of #3120) | Add the four registry files under open-sse/providers/registry/ and register them in index.js, omitting the unrelated umbrel-app.yml. |
| #3423 | S/L | feat(open-sse): Revise Qwen3.8 pricing and add Meta Muse patterns and capabilities | Add the ~40 new Qwen3.8, Meta Muse, and Step 3.7 metadata entries to open-sse/providers/capabilities.js and pricing.js |
| #3382 | S/L | feat(antigravity): add Gemini 3.7 Flash (High, Medium, Low) to MITM proxy defaultModels | Add Gemini 3.7 Flash High/Medium/Low entries to MITM_TOOLS.antigravity.defaultModels in src/shared/constants/cliTools.js and port the tier routing tes |
| #3328 | S/L | fix(providers): add the missing Fish Audio and Alibaba Cloud brand icons | copy the three 128x128 PNGs into the fork's provider icon directory and add the icon-coverage unit test |
| #3317 | S/L | feat(cli-tools): add OpenClaude support | Add OpenClaude entry with guide setup steps and icon to src/shared/constants/cliTools.js plus the pinning unit test |
| #3268 | S/L | feat(codex): support fast service tier for image generation | Add shared/codexServiceTier.js helper and wire it into codex image executor, registry params, and dashboard example UI plus unit test. |
| #3311 | S/L | Sửa Test Connection Xiaomi Token Plan theo vùng | Add region-based models URL resolution (SGP fallback) and 401-only failure logic to testUtils.js plus provider config, porting the upstream test file |
| #2831 | S/L | feat: add reasoning level support for Codex models | Add supported_reasoning_levels to model entries in src/app/api/v1/models/route.js and include noAuth passthrough provider models via modelsFetcher.url |
| #2847 | S/L | feat(models): expose runtime LLM capabilities in models info | Merge getCapabilitiesForModel output into LLM entries in the /v1/models/info route, deriving contextWindow while keeping legacy arrays. |
| #3295 | S/L | fix(ollama-local): verbose debug diagnostics + timeout/retry tuning | Port the ~186-line patch into open-sse/executors/ollama-local.js, base.js, runtimeConfig.js and .env.example adding configurable 120s connect timeout, |
| #3265 | S/L | feat(commandcode): add per-connection ZDR toggle | Port the zdrEnabled toggle and x-cmd-zdr header into fork's existing commandcode executor, validate route, and connection modals plus tests. |
| #2887 | S/L | fix(openrouter): opt into provider fallback for `openrouter/fusion` e… | Add open-sse/executors/openrouter.js with allow_fallbacks injection, register it in executors/index.js, and extend parseUpstreamError in utils/error.j |
| #3359 | S/L | feat(antigravity): add hermes agent system prompt sanitization | port the sanitizer regex/replacement into open-sse/executors/antigravity.js and openai-to-gemini.js plus the hermes-cloaking unit test |
| #3064 | S/M | fix(antigravity): rewrite MITM proxy host to daily-cloudcode-pa.sandbox.googleapis.com | Add daily-cloudcode-pa.sandbox.googleapis.com to TARGET_HOSTS/getToolForHost in src/mitm/config.js and server.js and point Antigravity provider base U |

### Full verdict ledger (all 194 reviewed items)

Confidence: `2-pass` = extract+grep+falsify agreed; `manual-verified`/`2-pass-overturned` = I read
the fork file; `1-pass` = single heuristic pass (treat as provisional). Size/Risk `S/M/L`.

| Ref | Updated | Verdict | S/R | Confidence | Evidence |
|---|---|---|---|---|---|
| #2681 | 2026-07-18 | GAP | M/M | 2-pass | Behavior-defining probes 'invalid_kiro_tool_call', 'validateKiroToolUse', 'pendingWrapperToolCalls', and 'flus |
| #2688 | 2026-07-18 | GAP | L/M | 2-pass | Behavior-defining probes 'KIRO_TOOL_CALL_REPAIR_INSTRUCTION', 'buildKiroToolCallRepairBody', 'validateKiroTool |
| #2699 | 2026-07-18 | GAP | S/L | 2-pass | Behavior-defining probes '--dns-result-order=ipv4first' and 'ipv4first' are ABSENT fork-wide. The spawn sites  |
| #2710 | 2026-08-03 | GAP | L/M | 2-pass | Behavior-defining probes 'attemptId', 'requestCorrelationId', 'correlationId: requestCorrelationId', and 'appl |
| #2713 | 2026-07-19 | GAP | L/M | 2-pass | All behavior-defining probes for the shared per-request Responses accumulator are ABSENT: 'createResponsesAccu |
| #2723 | 2026-08-07 | GAP | L/M | 2-pass | Behavior-defining probes are all ABSENT: 'classifyConnectionAvailability', 'getUsageMaxFromDayBars', 'daybars' |
| #2724 | 2026-07-20 | GAP | S/L | 2-pass | Behavior-defining probes 'getDailyConnectionUsage', 'does not expose a numeric included quota', and 'Daily use |
| #2731 | 2026-07-20 | GAP | S/M | 2-pass | All behavior-defining probes are ABSENT: 'TOOL_CALL_REPAIR_INSTRUCTION', 'appendToolCallRepairInstruction', 'k |
| #2755 | 2026-07-21 | GAP | M/M | 2-pass | All behavior-defining probes are ABSENT or unrelated: 'refreshCursorToken', 'cleanupCursorSessions', 'CURSOR_S |
| #2769 | 2026-07-25 | GAP | L/M | 2-pass | All behavior-defining probes are ABSENT: 'applyAntigravityRuntimeLimits', 'classifyAntigravityRuntimeError', ' |
| #2777 | 2026-07-22 | GAP | S/L | 2-pass | Bulk-action probes 'Enable Selected (' and 'Disable Selected (' are ABSENT, and 'handleUpdateConnectionStatus( |
| #2780 | 2026-07-22 | GAP | M/M | 1-pass | suffix-normalization + reasoningTextFromResponses absent |
| #2784 | 2026-07-23 | GAP | L/M | 2-pass | All behavior-defining probes are ABSENT: 'errorCooldownPolicy', 'normalizeErrorCooldownPolicy', 'MAX_ERROR_COO |
| #2787 | 2026-07-22 | GAP | S/L | 2-pass | Behavior-defining probes 'supportsThinkingLevel', 'GPT_56_LEVELS', '*gpt-5.6-*', and 'normalizeReasoningEffort |
| #2793 | 2026-07-23 | GAP | M/L | 2-pass | All behavior-defining probes are ABSENT: 'ROUTE_ATTRIBUTION', 'X-9Router-Route-Path', 'X-9Router-Attempted-Mod |
| 27f3710c8 | 2026-08-14 | GAP | S/L | manual-verified | Dockerfile copies node-forge+next but NOT sql.js -> pure-JS DB fallback broken in container (verified by read) |
| #2831 | 2026-07-25 | GAP | S/L | 2-pass | The behavior-defining probe 'supported_reasoning_levels' is ABSENT, and no probe returned any hit in a /v1/mod |
| #2833 | 2026-07-25 | GAP | L/M | manual-verified | same theme as #3205 (api-key policies); dedupe: implement once |
| #2845 | 2026-07-26 | GAP | S/L | 2-pass | Behavior-defining probes 'headroomToken' (only hit is usageRepo.js:1322 'headroomTokensSaved', an unrelated us |
| #2847 | 2026-08-03 | GAP | S/L | 2-pass | The fork's src/app/api/v1/models/info/route.js exists (buildInfo hits at route.js:21,76,81,87), but every prob |
| #2871 | 2026-07-28 | GAP | L/M | 2-pass | Behavior-defining probes are absent across the board: 'convoy', 'ConvoyPage', '/api/convoy/rules', 'convoy ? { |
| #2887 | 2026-07-29 | GAP | S/L | 2-pass | Behavior-defining probes 'allow_fallbacks', 'allow_fallbacks: true', 'OpenRouterExecutor', 'invalidUrlEmpty',  |
| #2893 | 2026-07-31 | GAP | M/M | 2-pass | All behavior-defining probes for the user-configurable custom prompt feature are ABSENT: 'injectCustomPrompt', |
| #2895 | 2026-08-10 | GAP | M/M | 2-pass | All behavior-defining probes are ABSENT: 'retryDelayByProvider', 'parseProviderResetMs', 'resolveCooldownMs',  |
| #2898 | 2026-07-29 | GAP | L/M | 2-pass | All behavior-defining probes are ABSENT: 'PiToolCard', 'pi-settings', 'checkPiInstalled', and 'Pi Coding Agent |
| #2899 | 2026-07-29 | GAP | L/M | 2-pass | Behavior-defining probes 'saveErrorLog', 'errorLogsRepo', 'getErrorLogById', and 'ErrorLogClient' are all ABSE |
| #2908 | 2026-07-30 | GAP | M/L | 2-pass | All behavior-defining probes are ABSENT: 'activeModelSet', 'modelDisplayMode', 'ModelNode', 'radialRotation',  |
| #2937 | 2026-07-30 | GAP | M/L | 2-pass | Behavior-defining probes 'handleTestAllModels', 'handleDisableFailedModels', 'classifyResult', and 'MAX_CONSEC |
| #2941 | 2026-07-31 | GAP | L/M | 2-pass | Behavior-defining probes 'LATENCY_AWARE_STRATEGY', 'resolveHealthConfig', 'latencyAwareConfig', 'circuitCooldo |
| #2943 | 2026-07-31 | GAP | L/M | 2-pass | All behavior-defining probes are ABSENT: 'CODEX_NATIVE_CONFIG', 'acquireCodexNativeLease', 'codex_websocket_un |
| #2948 | 2026-07-31 | GAP | M/M | 2-pass | Behavior-defining probes 'AddCustomVideoModal', 'isCustomVideoProvider', 'CUSTOM_VIDEO_PREFIX', 'CUSTOM_VIDEO_ |
| #2954 | 2026-07-31 | GAP | L/M | 2-pass | All behavior-defining probes are ABSENT: 'sanitizeChatBody', 'createSseNormalizeTransform', 'normalizeChatChun |
| #2959 | 2026-07-31 | GAP | S/L | 2-pass | Behavior-defining probes are all ABSENT: 'handles OPTIONS CORS preflight requests', 'count_tokens/route.js', a |
| #2998 | 2026-08-02 | GAP | S/L | 2-pass | fork has usePagination hook but provider detail connection list not paginated |
| #3015 | 2026-08-17 | GAP | L/M | 2-pass | Behavior-defining probes are all ABSENT: '/api/models/access' (the API route path, which would survive identif |
| #3032 | 2026-08-14 | GAP | L/M | 2-pass | Behavior-defining probes are all ABSENT: 'ImportModelsModal', '/api/models/custom/bulk', 'invalidateModelCapsC |
| #3042 | 2026-08-06 | GAP | L/M | 2-pass | Behavior-defining probes 'ComboTestModal', 'servedStepIndex', 'Fallback satisfied by step', and 'Failed to tes |
| #3047 | 2026-08-07 | GAP | L/M | 2-pass | Behavior-defining probes 'getTokenRouterUsage', 'managementKey', 'MANAGEMENT_BASE_URL', 'voucher'/'voucherEffi |
| #3055 | 2026-08-06 | GAP | M/M | 2-pass | gemini functionResponse/text merge-prevention absent from fork translator |
| #3058 | 2026-08-05 | GAP | S/L | 2-pass | Behavior-defining probes are absent: 'language_code' -> ABSENT and 'case "authorization":' -> ABSENT. Moreover |
| #3062 | 2026-08-06 | GAP | M/L | 2-pass | All behavior-defining probes are ABSENT: 'validateCapacityAdapter', 'importedCapacityAdapter', 'VALID_CAPACITY |
| #3075 | 2026-08-06 | GAP | M/M | 1-pass | partial: toResponsesUsage present; claude-backed usage scope fix portion unverified |
| #3087 | 2026-08-06 | GAP | S/L | 2-pass | Behavior-defining probes 'headroomLossless', '--lossless', and the flag-passing snippet 'if (lossless) args.pu |
| #3111 | 2026-08-07 | GAP | S/L | 2-pass | The behavior-defining probes for the extended 📊 DONE console line are all ABSENT: 'sid:${sessionId}', 'u.kiro_ |
| #3123 | 2026-08-07 | GAP | S/L | 2-pass | All behavior-defining probes are ABSENT: 'topologyVisibility', 'topologyHiddenByDefault', 'isTopologyVisible', |
| #3126 | 2026-08-07 | GAP | M/M | 2-pass | The behavior-defining probes 'isHostedBrowser', 'DEPLOYMENT_MODE', and 'getConfiguredBaseUrl' are all ABSENT.  |
| #3132 | 2026-08-15 | GAP | L/M | 2-pass | All behavior-defining probes are ABSENT: 'getElevenLabsUsage', 'ELEVENLABS_DEFAULT_VOICES', 'ELEVEN_V3_TAG_GRO |
| #3161 | 2026-08-08 | GAP | L/M | 2-pass | All behavior-defining probes are ABSENT: 'encodeMcpToolDefinition', 'retainedAgentSessions', 'CURSOR_AGENT_SES |
| #3166 | 2026-08-15 | GAP | M/M | 2-pass | Behavior-defining probes '_frozenMsg0', 'previousIsFrozen', 'systemToUserMessage', 'historyPrefixOf', and 'kir |
| #3186 | 2026-08-09 | GAP | S/L | manual-verified | stripStoredItemReferences exists only in grok-cli.js:123, absent from codex executor |
| #3188 | 2026-08-09 | GAP | S/L | 2-pass | The fork's paramSupport.js clearly exists (open-sse/translator/concerns/paramSupport.js:28,86,89 via 'clampToM |
| #3192 | 2026-08-17 | GAP | M/M | 2-pass | Behavior-defining probes 'runModelBatchTest', 'MODEL_TEST_CONCURRENCY', 'handleStopTestModels', 'batchTestTarg |
| #3197 | 2026-08-17 | GAP | S/L | 2-pass | All behavior-defining probes ('handleTestModel', 'modelTestResults', 'testingModelIds', 'Model not reachable') |
| #3203 | 2026-08-10 | GAP | M/M | 2-pass | Behavior-defining probes 'rpmByProvider', 'rpmLimiter', 'resolveProviderRpm', and 'DEFAULT_PROVIDER_RPM' are a |
| #3205 | 2026-08-10 | GAP | L/M | manual-verified | src/sse/services/apiKeyPolicy.js only has isModelAllowed; no rate limits/budget/expiry |
| #3250 | 2026-08-12 | GAP | M/M | 2-pass | Behavior-defining probe 'zen/go/v1/usage' (the plan usage endpoint path, which cannot be renamed away) is ABSE |
| #3255 | 2026-08-12 | GAP | L/M | 2-pass | no latencyMonitor/avgLatency-based provider selection in fork; SSE latency capture exists |
| #3258 | 2026-08-12 | GAP | M/L | 2-pass | All behavior-defining probes are ABSENT: 'prepareMinimaxVideoRequest', 'normalizeMinimaxVideoResponse', 'minim |
| #3261 | 2026-08-12 | GAP | L/M | 2-pass | All three behavior-defining probes are token-level ABSENT: 'excludeProxyPoolIds', 'clearProxyPoolRateLimit', a |
| #3265 | 2026-08-12 | GAP | S/L | 2-pass | Behavior-defining probes 'x-cmd-zdr' and 'zdrEnabled' are ABSENT; the only 'Enabled'/'Retention' hits (TokenSa |
| #3267 | 2026-08-13 | GAP | S/M | 2-pass | The behavior-defining probe 'dbAvailable' is ABSENT, as is the dedicated test 'models-empty-connections.test'. |
| #3268 | 2026-08-13 | GAP | S/L | 2-pass | Behavior-defining probes 'normalizeCodexServiceTier', 'codexServiceTier', and 'codexServiceTier.js' are all AB |
| #3272 | 2026-08-19 | GAP | L/M | 2-pass | All behavior-defining probes are ABSENT: 'OmpToolCard', 'persistOmpModelSelection', 'emptyOmpRoleAssignments', |
| #3273 | 2026-08-13 | GAP | M/M | 2-pass | Behavior-defining probes 'trackActiveSession', 'stampActiveSession', 'ACTIVE_SESSION_TTL_MS', and 'ENDED_VISIB |
| #3276 | 2026-08-13 | GAP | L/M | 2-pass | All behavior-defining probes are ABSENT: 'connectHttp2', 'resolveCursorAgentModel', 'buildHttpConnectRequest', |
| #3277 | 2026-08-13 | GAP | M/M | 2-pass | Behavior-defining probes 'returned 200 but body is an error', 'failed (200+error body), trying next', and 'che |
| #3280 | 2026-08-13 | GAP | S/L | 2-pass | src/shared/components/ModelSelectModal.js:21 shows `const NO_AUTH_PROVIDER_IDS = Object.keys(FREE_PROVIDERS).f |
| #3295 | 2026-08-14 | GAP | S/L | 2-pass | Behavior-defining probes 'OLLAMA_LOCAL_CONNECT_TIMEOUT_MS', 'summariseMessages', 'warnLargeBody', and 'fmtByte |
| #3310 | 2026-08-14 | GAP | S/L | 2-pass | Behavior-defining probes 'XIAOMI_TOKENPLAN_TEXT_CAPS', 'XIAOMI_TOKENPLAN_CAPABILITIES', and 'tc.function.argum |
| #3311 | 2026-08-14 | GAP | S/L | 2-pass | The behavior-defining probes are ABSENT: 'isXiaomiTokenplanTestResponseValid', 'resolveXiaomiTokenplanModelsUr |
| #3313 | 2026-08-16 | GAP | M/M | 2-pass | All behavior-defining probes are ABSENT: 'createPublicOnlyLookup', 'createPublicOnlyConnector', 'fetchPublicUr |
| #3314 | 2026-08-14 | GAP | S/L | 2-pass | Behavior-defining probes 'BETTER_SQLITE3_INSTALL_TIMEOUT', 'installBetterSqlite', and 'better-sqlite3@12.10.1' |
| #3315 | 2026-08-14 | GAP | S/L | 2-pass | All behavior-defining probes are ABSENT: 'extractSseOutputText', 'CODEX_OVERLOADED_OUTPUT_MESSAGE', 'codex_ove |
| #3317 | 2026-08-14 | GAP | S/L | 2-pass | Behavior-defining probes are ABSENT: '/providers/openclaude.png' -> ABSENT, 'openclaude --provider openai' ->  |
| #3318 | 2026-08-14 | GAP | S/L | 2-pass | Relied on probe 'Array.isArray(parsedResp)' -> ABSENT. The fork's open-sse/translator/request/openai-to-gemini |
| #3320 | 2026-08-14 | GAP | S/L | 2-pass | The fork retains the old constant: open-sse/providers/shared.js:65 `export const ANTIGRAVITY_IDE_VERSION = "2. |
| #3328 | 2026-08-15 | GAP | S/L | 2-pass | Behavior-defining probes 'provider-brand-icons.test.js', 'ALIBABA_BRAND', 'NO_BRAND_MARK', and 'getProviderIco |
| #3331 | 2026-08-15 | GAP | S/L | 2-pass | The behavior-defining probes '"code"\s*:\s*"112"', 'isQoderQuotaExhausted', and 'Qoder quota exhausted (code 1 |
| #3332 | 2026-08-15 | GAP | M/L | 2-pass | All behavior-defining probes for the DeepSeek V4 transport restriction are ABSENT: 'deepseek-v4-flash(max)', ' |
| #3333 | 2026-08-15 | GAP | M/M | 2-pass | The fork does contain a dedupeTools implementation (open-sse/utils/toolDeduper.js:33, chatCore.js:507), but it |
| #3337 | 2026-08-15 | GAP | M/L | 2-pass | All behavior-defining probes are ABSENT: 'getOpencodeGoUsage', 'OPENCODE_GO_WINDOWS', 'readOpencodeGoError', ' |
| #3338 | 2026-08-15 | GAP | S/L | 2-pass | open-sse/rtk/cavemanPrompts.js:23 still contains the OLD hardcoded wording: "Preserve the user's dominant lang |
| #3342 | 2026-08-15 | GAP | S/L | 2-pass | Behavior-defining probes 'CODEBUDDY_SYSTEM_PROMPT_MAX_LEN', 'systemPromptMaxLen', 'DEFAULT_SYSTEM_PROMPT_MAX_L |
| #3345 | 2026-08-15 | GAP | L/M | 2-pass | All behavior-defining probes are ABSENT: 'CLINE_PASS_ID_PREFIX', 'fetchClineCatalog', 'resolveClineModels', 'i |
| #3347 | 2026-08-15 | GAP | L/M | 2-pass | All behavior-defining probes are ABSENT: 'canonicalEchoModel', 'CONNECTIONLESS_CATALOG_ALIASES', 'CONNECTIONLE |
| #3350 | 2026-08-20 | GAP | S/L | 2-pass | Behavior-defining probe 'text: thinking,' is ABSENT fork-wide. The fork does handle reasoningContentEvent (ope |
| #3352 | 2026-08-15 | GAP | S/L | 2-pass | Behavior-defining probes 'BACKOFF_MAX_LEVEL', 'resolveBackoffConfig', 'parsePositiveInteger', and 'DEFAULT_BAC |
| #3359 | 2026-08-15 | GAP | S/L | 2-pass | Behavior-defining probes 'sanitizeAntigravitySystemPrompt', 'HERMES_IDENTITY_RE', 'HERMES_IDENTITY_REPLACEMENT |
| #3363 | 2026-08-16 | GAP | L/M | 2-pass | All behavior-defining probes are ABSENT: 'NOUS_CHAT_COMPLETIONS_URL', 'createNousApiKeyProbe', 'normalizeNousF |
| #3366 | 2026-08-16 | GAP | S/L | 2-pass | Probe 'parts' (broadest token) hit only path-splitting in scripts/model-catalog-diff.mjs and object serializat |
| #3368 | 2026-08-16 | GAP | S/L | 2-pass | Behavior-defining probes 'NINEROUTER_MAX_OLD_SPACE_SIZE', 'resolveHeapFlags', 'nodeFlags', 'DEFAULT_MAX_OLD_SP |
| #3369 | 2026-08-16 | GAP | S/L | 2-pass | Behavior-defining probes 'unanswered', 'makeFallbackId', 'resolveToolResultId', and 'unanswered.splice(at, 1)' |
| #3373 | 2026-08-16 | GAP | S/L | 2-pass | Behavior-defining probes 'customToolNames', 'customToolNames instanceof Set', and 'new Set(customToolNames //  |
| #3376 | 2026-08-16 | GAP | L/M | 2-pass | All behavior-defining probes are ABSENT: 'registerCustomAdapter', 'normalizeAdapterDefinition', 'getCustomProv |
| #3381 | 2026-08-16 | GAP | S/L | 2-pass | Relied on 'chmod' probe: the only fs.chmodSync hit is cli/hooks/trayRuntime.js:54 setting 0o755 on a systray b |
| #3382 | 2026-08-16 | GAP | S/L | 2-pass | All 3.7-specific probes are ABSENT: 'gemini-3.7-flash-high', 'gemini-3.7-flash-low', 'gemini-3.7-flash-tiered' |
| #3386 | 2026-08-16 | GAP | M/M | 2-pass | Behavior-defining probes 'findSseContextOverflow', 'CODEX_SSE_CONTEXT_OVERFLOW_PATTERNS', 'PAYLOAD_TOO_LARGE', |
| #3387 | 2026-08-17 | GAP | S/L | 2-pass | Behavior-defining probes 'responseBody?.data?.choices' and 'responseBody = responseBody.data' are ABSENT. Gene |
| #3388 | 2026-08-17 | GAP | S/L | 2-pass | no refetchInterval in dashboard stats; real-time refresh absent |
| #3393 | 2026-08-17 | GAP | S/L | 2-pass | The behavior-defining probes 'Math.max(0, apiKey.length - 8)' and 'Math.min(20, Math.max(0' are both ABSENT fo |
| #3396 | 2026-08-18 | GAP | S/L | 2-pass | All behavior-defining probes are ABSENT: 'reasonix', 'joycode', 'ai.endpoints.ovh.com/v1/chat/completions', 'i |
| #3397 | 2026-08-17 | GAP | S/L | 2-pass | The behavior-defining probe 'deepseek-v4-flash-0731' (and its provider-prefixed variants 'deepseek-ai/deepseek |
| #3405 | 2026-08-18 | GAP | L/M | 2-pass | All behavior-defining probes for the CommandCode stream-inspection wrapper are ABSENT: 'inspectAndWrapCommandC |
| #3407 | 2026-08-20 | GAP | L/M | 2-pass | All Zed-specific behavior probes are ABSENT: 'getZedUsage', 'parseZedAuthenticatedUserUsage', 'formatZedPlanLa |
| #3411 | 2026-08-18 | GAP | S/L | 2-pass | Behavior-defining probes 'sanitizeFunctionResponseResult', 'k === "definitions"', and 'replace(/[\/#$]/g, "_") |
| #3415 | 2026-08-18 | GAP | S/L | 2-pass | All behavior-defining probes are ABSENT: 'getHotReloadConfig', 'HOT_RELOAD_BADGE_VARIANTS', 'handleHotReloadCo |
| #3417 | 2026-08-19 | GAP | S/L | 2-pass | All behavior-defining probes are ABSENT: 'headroomTimeoutMs', 'setHeadroomTimeoutMs', 'handleHeadroomTimeoutBl |
| #3419 | 2026-08-19 | GAP | S/M | 2-pass | open-sse/handlers/chatCore.js:317 shows `resolveTransport(provider, apikeyTransportFormat // modelTargetFormat |
| #3420 | 2026-08-19 | GAP | S/L | 2-pass | Behavior-defining probes 'translatedBody.stream = stream' and 'translatedBody.stream !== stream' are both ABSE |
| #3421 | 2026-08-19 | GAP | S/L | 2-pass | The 'forceStream: true' probe hits only open-sse/providers/registry/codebuddy-cn.js:23, commandcode.js:29, and |
| #3423 | 2026-08-20 | GAP | S/L | 2-pass | partial: Meta Muse present; Qwen3.8 pricing rows absent |
| #3426 | 2026-08-20 | GAP | S/L | 2-pass | Behavior-defining probes 'getSingleGroupItem', 'group.items.length === 1', 'item?.rawModel //', and 'item.prov |
| #3429 | 2026-08-20 | GAP | M/M | 2-pass | All behavior-defining probes are ABSENT: 'exposeComboOnly', 'updateExposeComboOnly', 'comboToEntry', 'comboOnl |
| #3437 | 2026-08-20 | GAP | M/M | 2-pass | Behavior-defining probes 'groundingChunkIndices', 'AG_MODEL_MAP', and 'SEARCH_FALLBACK' are all ABSENT. Broade |
| 345cdcf6a | 2026-08-13 | GAP | M/M | 2-pass | The behavior-defining probe 'experimental_attachments' is ABSENT — this is a literal Vercel AI SDK wire-format |
| 456f2a263 | 2026-08-13 | GAP | S/L | 2-pass | Behavior-defining probes 'fetchQuota(connectionId, provider, { force: true })' and 'proxyOptions, { force }' a |
| 5b417f9bf | 2026-08-13 | GAP | S/M | 2-pass | 'initial-response' frame absent from fork; kiro executor lacks x-amz-target chat intercept |
| 67271d859 | 2026-08-13 | GAP | S/L | 2-pass | Behavior-defining header token probes 'x-opencode-session' and 'x-opencode-request' are ABSENT, and 'resolveOp |
| 6d30ce6de | 2026-08-13 | GAP | S/L | 2-pass | Behavior-defining probes are absent or unrelated. 'stream_options, ...rest' -> ABSENT, and no 'stream_options' |
| 7e5f5a881 | 2026-08-14 | GAP | M/M | 2-pass | All behavior-defining probes are ABSENT: 'anchorClaudeCache', 'CACHE_CONTROL_1H', 'CACHE_CONTROL_5M', and 'mar |
| 80afb5990 | 2026-08-13 | GAP | S/M | 2-pass | Behavior-defining probes 'isBillingBlock', 'peekFirstQoderFrame', and 'qoder billing block' are all ABSENT. Th |
| 86694ed8d | 2026-08-14 | GAP | M/L | 2-pass | Probes 'gemini-3.7-flash-tiered', '*gemini-3.7*', and 'gemini-3.7-flash-medium' are all ABSENT. The only tiere |
| 8a527fec9 | 2026-08-13 | GAP | M/M | manual-verified | open-sse/handlers/search/callers.js uses baseUrl w/o assertPublicUrl (verified); fork HAS ssrfGuard util to re |
| 8af5e752d | 2026-08-14 | GAP | S/L | 2-pass | Behavior-defining probes are ABSENT: 'reference_id' (the wire-protocol field for voice, not renameable without |
| 8ed9da716 | 2026-08-14 | GAP | S/L | 2-pass | Both probes ('glm-5.3' and 'GLM 5.3') are ABSENT across the fork. The change is a registry data addition keyed |
| b04c03c6b | 2026-08-14 | GAP | S/L | 2-pass | The behavior-defining probes hit only test baseline fixtures, not runtime code. 'alitp-intl'/'alitp' appear so |
| cd4003bc8 | 2026-08-13 | GAP | M/M | 2-pass | All behavior-defining probes are ABSENT: 'USAGE_CACHE_TTL_MS', 'fetchClaudeUsageRaw', 'groupByProviderStable', |
| e1115e283 | 2026-08-14 | GAP | M/M | 2-pass | All behavior-defining probes are ABSENT: 'supportedFormats', 'getModelSupportedFormats', 'modelSupportedFormat |
| #3064 | 2026-08-12 | GAP? | S/M | uncertain | fork providerQuota uses sandbox host; MITM rewrite portion unverified; env-dependent |
| #2952 | 2026-08-16 | DEFER | L/H | manual | fork already has qoder-cn registry (bizVariant qoderwork); L refactor w/ partial overlap |
| #3048 | 2026-08-05 | DEFER | L/H | 1-pass | no fork occurrence of thinking-inline.test.js |
| #3346 | 2026-08-15 | DEFER | L/M | 1-pass | no fork occurrence of toKiroWireModelId; synthetic variants still built at open-sse/services/kiroModels.js:304 |
| 10a923da1 | 2026-08-13 | DUPLICATE | S/L | 1-pass | open-sse/translator/response/openai-responses.js:141: if (delta.tool_calls && delta.tool_calls.length) { |
| #2664 | 2026-07-19 | DUPLICATE | S/L | 1-pass | open-sse/executors/kiro.js:31 isConfirmedKiroCreditExhaustion; open-sse/config/errorConfig.js:52 KIRO_CREDIT_E |
| #2667 | 2026-08-03 | DUPLICATE | S/L | 1-pass | open-sse/executors/codex.js:655 and open-sse/services/accountFallback.js:67 |
| #2668 | 2026-07-17 | DUPLICATE | S/L | 2-pass-overturned | src/lib/db/migrate.js:196-197 handles imports of totalRequestsLifetime with a typeof guard (legacy backups lac |
| #2672 | 2026-07-17 | DUPLICATE | S/L | 1-pass | open-sse/services/usage/misc.js:330 (getXaiUsage) and open-sse/services/usage.js:54 (xai dispatch) |
| #2689 | 2026-07-18 | DUPLICATE | S/L | 1-pass | open-sse/services/combo.js:893 (isBodyEmpty) and :1139-1148 retry-then-fallback logic |
| #2705 | 2026-07-19 | DUPLICATE | S/L | 1-pass | open-sse/handlers/chatCore.js:317 and open-sse/executors/default.js:368 |
| #2706 | 2026-07-19 | DUPLICATE | S/L | 1-pass | open-sse/utils/stream.js:335 (quirks?.ensureThinkingSignature) and open-sse/providers/registry/minimax.js:31 |
| #2736 | 2026-08-09 | DUPLICATE | L/L | 2-pass-overturned | open-sse/services/combo.js:230-233 — `comboConversationAffinity = new Map()` with comment "round-robin sticky  |
| #2753 | 2026-07-22 | DUPLICATE | S/L | 1-pass | open-sse/providers/registry/antigravity.js:47-49 defines gemini-3.6-flash-high/medium/low mapped to gemini-3.6 |
| #2761 | 2026-07-22 | DUPLICATE | M/L | 2-pass-overturned | open-sse/executors/github.js:36 defines isClaudeModel(model), github.js:150 branches on `if (this.isClaudeMode |
| #2786 | 2026-08-08 | DUPLICATE | S/L | 1-pass | open-sse/providers/registry/opencode.js:24 (modelsFetcher url https://opencode.ai/zen/v1/models) and src/share |
| #2798 | 2026-07-23 | DUPLICATE | S/L | 1-pass | src/app/api/proxy-pools/[id]/test/route.js:14 ("x-relay-target": "https://api.ipify.org") and :15 ("x-relay-pa |
| #2869 | 2026-08-19 | DUPLICATE | S/L | 2-pass-overturned | open-sse/translator/response/openai-to-claude.js implements the same behavior under renamed identifiers: doubl |
| #2879 | 2026-08-10 | DUPLICATE | S/L | 1-pass | open-sse/services/accountFallback.js:100 (clampedReset = Math.min(evidence.resetAtMs, now + MAX_RATE_LIMIT_COO |
| #2955 | 2026-07-31 | DUPLICATE | S/L | 1-pass | scripts/gen-registry-index.mjs:17 |
| #2957 | 2026-07-31 | DUPLICATE | S/L | 1-pass | tests/package.json:8: "test": "vitest run --reporter=verbose" |
| #2972 | 2026-08-01 | DUPLICATE | S/L | 1-pass | src/app/(dashboard)/dashboard/usage/components/UsageChart.js:30: const [viewMode, setViewMode] = useState("tok |
| #3054 | 2026-08-05 | DUPLICATE | S/L | 1-pass | open-sse/executors/default.js:16 imports applyParamRenames from translator/concerns/paramSupport.js (rename en |
| #3065 | 2026-08-06 | DUPLICATE | S/L | 1-pass | src/app/api/headroom/proxy/[...path]/route.js:58-59 rewrites src/href "/dashboard" URLs with DASHBOARD_PREFIX |
| #3074 | 2026-08-06 | DUPLICATE | M/L | 2-pass-overturned | open-sse/translator/concerns/thinkingUnified.js:312 `setGeminiThinking(body, { thinkingBudget: budget ?? -1, i |
| 30fec4318 | 2026-08-13 | DUPLICATE | S/L | 1-pass | src/app/api/v1/models/buildModelsList.js:558-559 (snake_case fields with fallback at line 556) |
| #3124 | 2026-08-07 | DUPLICATE | -/- | 2-pass | open-sse/executors/muse-spark-web.js implements Meta AI (meta.ai graphql) capability |
| #3187 | 2026-08-09 | DUPLICATE | S/L | 2-pass-overturned | open-sse/services/combo.js:506 references body.max_completion_tokens and combo.js:835 exports getComboModelsFr |
| #3206 | 2026-08-10 | DUPLICATE | M/L | 2-pass-overturned | src/dashboardGuard.js:39-40 defines PUBLIC_PREFIXES = ["/v1", "/v1beta", "/api/v1", "/api/v1beta", "/codex"] a |
| #3211 | 2026-08-10 | DUPLICATE | S/L | 2-pass-overturned | src/app/api/providers/[id]/test/testUtils.js:689-690 has a `case "novita"` validating keys against https://api |
| #3214 | 2026-08-11 | DUPLICATE | L/L | 2-pass-overturned | open-sse/handlers/chatCore/emptyStreamGuard.js:107 exports createEmptyRetryStream and defines EMPTY_STREAM_MAX |
| #3297 | 2026-08-14 | DUPLICATE | S/L | 2-pass-overturned | open-sse/translator/response/openai-responses.js:13 imports { buildUsage, toResponsesUsage } from "../concerns |
| #3301 | 2026-08-14 | DUPLICATE | S/L | 2-pass-overturned | open-sse/handlers/chatCore.js:356 defines providerRequiresStreaming (forceStream check), chatCore.js:1300 `if  |
| #3316 | 2026-08-14 | DUPLICATE | S/L | 1-pass | open-sse/executors/codex.js:527-528, 638-651 (tierLogged gate and TIER:${effectiveTier} log) |
| #3319 | 2026-08-15 | DUPLICATE | M/L | 2-pass-overturned | The fork implements the same behavior under renamed identifiers: open-sse/utils/stream.js:85 defines `isClaude |
| #3321 | 2026-08-19 | DUPLICATE | M/L | 2-pass-overturned | open-sse/executors/opencode.js:11 contains `const OPENCODE_UA = "opencode/latest/1.18.18/cli"` — the exact off |
| #3325 | 2026-08-14 | DUPLICATE | S/L | 1-pass | open-sse/utils/adaptiveStripper.js:39 stripRejectedFields; :70 extractRejectedFieldNamesFromError; :1 BLOCKLIS |
| #3326 | 2026-08-14 | DUPLICATE | S/L | 1-pass | src/app/api/headroom/proxy/[...path]/route.js:58 and :85 |
| #3330 | 2026-08-15 | DUPLICATE | S/L | 1-pass | tests/unit/mimo-free.test.js:202: const credentials = { connectionId: "noauth" }; |
| #3348 | 2026-08-15 | DUPLICATE | S/L | 1-pass | open-sse/handlers/chatCore/streamingHandler.js:201 (onStreamAbandoned) and chatCore.js:810 abandonStreamingDet |
| #3361 | 2026-08-15 | DUPLICATE | S/L | 1-pass | open-sse/translator/formats/responsesApi.js:43 (typed MESSAGE/input_text emission) and :82 (legacy role-item n |
| #3364 | 2026-08-16 | DUPLICATE | S/L | 2-pass-overturned | src/sse/services/model.js:131-133 — `const matchedOpenAI = openaiNodes.find((node) => node.prefix === parsed.p |
| #3367 | 2026-08-16 | DUPLICATE | S/L | 1-pass | open-sse/services/usage/cursor.js:116 (getCursorUsage) and open-sse/services/usage.js:53 (cursor handler wired |
| #3379 | 2026-08-16 | DUPLICATE | S/L | 1-pass | open-sse/executors/default.js:643 |
| #3394 | 2026-08-17 | DUPLICATE | M/L | 2-pass-overturned | The fork implements the same behavior, relocated/renamed: open-sse/handlers/chatCore.js:1140 destructures `res |
| #3395 | 2026-08-17 | DUPLICATE | -/- | 2-pass | open-sse/executors/antigravity.js:116-123 already parses aspect-ratio suffixes |
| #3403 | 2026-08-18 | DUPLICATE | L/L | 2-pass-overturned | src/sse/services/auth.js:137 and :193 contain the exact upstream token `strictProxy: resolvedProxy.strictProxy |
| #3408 | 2026-08-18 | DUPLICATE | S/L | 1-pass | open-sse/translator/request/openai-to-commandcode.js:143: const cleanModel = stripThinkingSuffix(model); |
| #3428 | 2026-08-20 | DUPLICATE | S/L | 1-pass | open-sse/handlers/chatCore/streamFlag.js:29: let stream = providerRequiresStreaming ? true : bodyStream === tr |
| #3433 | 2026-08-20 | DUPLICATE | S/L | 1-pass | open-sse/transformer/responsesTransformer.js:233: const usage = toResponsesUsage(state.usage) // { input_token |
| #3434 | 2026-08-20 | DUPLICATE | S/L | 1-pass | open-sse/transformer/responsesTransformer.js:233: const usage = toResponsesUsage(state.usage) // { input_token |
| 59d858b63 | 2026-08-14 | DUPLICATE | S/L | 1-pass | open-sse/handlers/chatCore/requestDetail.js:56: const usageMetadata = responseBody.usageMetadata // responseBo |
| 70ba0024b | 2026-08-13 | DUPLICATE | S/L | 1-pass | open-sse/translator/request/openai-responses.js:429 |
| 71dcdc105 | 2026-08-13 | DUPLICATE | S/L | 1-pass | TokenSaverClient.jsx:524: checked={headroomEnabled} |
| 92259214d | 2026-08-14 | DUPLICATE | -/- | 2-pass | custom-server.js:69-117 installRequestWrapper implements peer-token + owner-proof (verified by read) |
| b44bb09f7 | 2026-08-13 | DUPLICATE | M/L | 2-pass-overturned | open-sse/executors/kiro.js:29 defines KIRO_TRUNCATION_STOP_REASONS = new Set(["model_context_window_exceeded", |
| b566b20ad | 2026-08-13 | DUPLICATE | S/L | 1-pass | open-sse/executors/antigravity.js:337-338 (systemInstruction?.parts scan with competitiveMarker), plus tests/t |
| b57c04134 | 2026-08-13 | DUPLICATE | S/L | 1-pass | open-sse/providers/registry/llm7.js:16 (validateUrl: "https://api.llm7.io/v1/models") |
| e02bde4a7 | 2026-08-13 | DUPLICATE | S/L | 1-pass | open-sse/providers/registry/kimchi.js:19 authModes: ["oauth", "apikey"]; src/app/api/providers/[id]/test/testU |
| e2a4fe048 | 2026-08-13 | DUPLICATE | S/L | 1-pass | src/app/api/cli-tools/hermes-settings/route.js:23 (api_key: ${OPENAI_API_KEY} in model block) and :38 (api_key |
| #2922 | 2026-07-30 | N-A | -/- | manual | opt-in TLS-verification bypass; rejected on security grounds |
| #3143 | 2026-08-08 | N-A | S/L | 1-pass | no fork occurrence of isConfigCmd; cli/src/cli/commands/config.js absent in fork |
| #3257 | 2026-08-12 | N-A | -/- | 1-pass | anti-ban device-fingerprint evasion; policy-excluded |
| #3357 | 2026-08-15 | N-A | S/L | 1-pass | no fork occurrence of CODEBUDDY_INTL_SYSTEM_PROMPT; open-sse/executors/codebuddy-intl.js absent in fork |
| #3385 | 2026-08-16 | N-A | S/L | 1-pass | no fork occurrence of '9router-standalone-assets-'; tests/unit/standalone-assets.test.js absent in fork |
| 65197ad11 | 2026-08-13 | N-A | -/- | 1-pass | SSO/SAML/OIDC is explicitly listed as out of scope for the DurinDoor fork. |

### Landmines

- **Stacked PRs** — #3048 (188 files, DEFER), #3346/#3345/#3032 (askidmobile kiro/models stacks,
  6000+ lines each), #3166/#3277/#3280 (claytontavaresdan stacks), #2869/#3026 (mega-diffs). Judge
  ONLY the hunk matching the title; the surrounding files are unrelated stacked commits.
- **Duplicate upstream pairs** — usage-on-`response.completed` is filed 4× (#3434/#3433/#3297 +
  commit): fork already forwards it via `toResponsesUsage`
  (`open-sse/translator/response/openai-responses.js:484`); all DUPLICATE. Headroom asset-path
  rewrite filed 2× (#3326/#3065): DUPLICATE. api-key policies filed 2× (#3205 richer, #2833):
  land once. Latency routing filed 2× (#2941 routing, #3255 monitoring): overlapping.
- **Path-vs-symbol trap** — the fork is rebranded/relocated; several first-pass GAPs were false
  positives found only by grepping the *symbol* (e.g. #2761 github `isClaudeModel`, #3319 claude
  auto-mode short-circuit, #92259214d peer-token proof already in `custom-server.js:69-117`).
- **Policy-excluded (N-A)** — #3257 (anti-ban device fingerprint), #2922 (`TUNNEL_WORKER_INSECURE`
  TLS-verification bypass), #3143/#3385 (test/CLI-cleanup only), #3357 (codebuddy-intl), SAML SSO
  commit `65197ad11`.
- **Uncertain (1 row)** — #3064 antigravity MITM host rewrite: fork `providerQuota` already uses the
  sandbox host; the MITM-proxy rewrite portion is env-dependent and unverified. Confirm the fork's
  MITM proxy host list before porting.

### Appendix — current `origin/main` reconciliation (merged candidates only)

The verdict tables above record fork state **as audited on 2026-08-20**, against the checkout HEAD
`4e81d7045`. `origin/main` was 32 commits ahead of that baseline (releases 3.12.0 -> 3.17.4,
including `7d8d1dde8 port(upstream): integrate 2026-08-14 audited campaign` and
`68545e64d port: 2026-08-18 upstream campaign`). Re-verifying the **merged** PORT-NOW candidates —
Tier 1 plus the Tier 0 security commit — against `origin/main` `f9753bdc7` by direct file read gives
the table below. Audit-date rows are deliberately left unchanged; this appendix is the current-state
answer.

| Ref | Current status on `f9753bdc7` | Evidence (read this pass) |
|---|---|---|
| 8a527fec9 | PRESENT (all three halves) | `open-sse/handlers/search/callers.js:78` `assertOutboundUrlAllowed(override, "public-only")` (renamed, stronger guard); default-password rejection `src/lib/auth/dashboardSession.js:15`; `redactPayloads` `src/app/api/usage/request-details/route.js:11,66` |
| e1115e283 | PRESENT | `getModelSupportedFormats` in `open-sse/config/providerModels.js`, guard in `open-sse/handlers/chatCore.js`; `tests/unit/opencode-go-models.test.js` |
| 27f3710c8 | N-A | Fork's `sqljsAdapter.js` statically imports `sql.js`, so the Next standalone trace already ships it (`.next/standalone/node_modules/sql.js/dist/sql-wasm.js` present in the built runtime); no explicit Dockerfile COPY needed. Matches the prior verdict at `upstream-omniroute-2026-08-14-audit.md:174` |
| 7e5f5a881 | PRESENT | `anchorClaudeCache`, `CACHE_CONTROL_1H`, `CACHE_CONTROL_5M` in `open-sse/translator/formats/claude.js`; `tests/unit/claude-cache-control.test.js` |
| 345cdcf6a | PRESENT | `experimental_attachments` handled in `open-sse/services/combo.js` and `open-sse/translator/concerns/modality.js`; `tests/unit/combo-capability-detection.test.js` |
| 67271d859 | PRESENT | `x-opencode-session` / `x-opencode-request` in `open-sse/executors/opencode.js`; `tests/unit/opencode-official-headers.test.js` |
| 6d30ce6de | PRESENT | `stream_options, ...rest` strip in `open-sse/services/combo.js`; `src/app/api/models/test/ping.js:165` `max_tokens: 1024` with reasoning-only soft-pass at `:219-233` |
| 5b417f9bf | PRESENT | `src/mitm/config.js:42` intercepts chat via `x-amz-target` `GenerateAssistantResponse`; initial-response frame in `src/mitm/handlers/kiro.js`; `tests/unit/kiro-mitm-chat-contract.test.js` |
| 80afb5990 | PRESENT | `isBillingBlock` first-frame peek in `open-sse/executors/qoder.js`; `tests/unit/qoder-billing-fallback.test.js` |
| 456f2a263 | PRESENT | `fetchQuota(connectionId, provider, { force: true })` in `ProviderLimits/index.js`; `{ force }` threaded in `src/app/api/usage/[connectionId]/route.js` |
| cd4003bc8 | PRESENT | `open-sse/services/usage/claude.js`: `OAUTH_QUOTA_CACHE_TTL_MS` cache, `oauthQuotaInFlight` single-flight dedup, `makeStaleResponse` stale-on-failure, `options.force` bypass |
| 86694ed8d | PRESENT | `gemini-3.7-flash-tiered` / `-medium` in `open-sse/providers/registry/antigravity.js` and `open-sse/services/usage/google.js`; `tests/unit/antigravity-model-catalog.test.js` |
| b04c03c6b | PRESENT | `open-sse/providers/registry/alitp-intl.js`, registered in `open-sse/providers/registry/index.js` |
| 8af5e752d | PRESENT | `open-sse/providers/registry/fish-audio.js` plus `reference_id` handling in `open-sse/handlers/ttsProviders/genericFormats.js`; `tests/unit/fish-audio-tts.test.js` |
| 8ed9da716 | PRESENT | `glm-5.3` entries in `open-sse/providers/registry/glm.js`, `glm-cn.js`, `open-sse/providers/capabilities.js`; `tests/unit/glm-model-catalog.test.js` |

**Net: zero merged code gaps remain.** Every merged PORT-NOW candidate is either already in
`origin/main` or N-A for this fork's build layout. The Tier 0 rows #3313 and #3381 are still
**unmerged upstream PRs** and stay on the WATCH list under the `docs/UPSTREAM_SYNC.md` rule, as do
all Tier 2-5 rows.

Non-exhaustive side observation from the same pass: probing the audit's GAP rows against
`f9753bdc7` also produced hits for the open-PR rows #3197, #3258, #3267, #3273, #3295, #3314,
#3315 and #3382 (e.g. `dbAvailable` at `src/app/api/v1/models/buildModelsList.js:476`,
`tests/unit/port-3295-ollama-local-diagnostics.test.js`,
`tests/unit/port-3314-cli-no-native-sqlite.test.js`, `CODEX_OVERLOADED_OUTPUT_MESSAGE` at
`open-sse/executors/codex.js:64`). Those rows were not re-audited row-by-row and their audit-date
verdicts above stand; treat this only as a hint to re-verify before any future port.
