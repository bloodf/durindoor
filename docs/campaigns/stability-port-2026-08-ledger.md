# Stability port campaign — 2026-08

## Theme: sse-streaming

### 9router candidates (20)

| PR | Source | Title | Verdict | Evidence / commit |
|----|--------|-------|---------|-------------------|
| #3020 | 9router | fix(usage): don't lose cached tokens in the forced-SSE→JSON path | GAP → ported | commit in this branch |
| #3013 | 9router | feat(oauth): background token keep-alive so idle connections stay valid | DEFER (new background subsystem, 5 files) | New 140-line `tokenKeepAlive.js` service with global scheduler/singleton, `TOKEN_KEEPALIVE_CONFIG`, app-startup wiring, failure cache + 30-min backoff; 5-file change touching core app lifecycle and OAuth refresh |
| #2713 | 9router | Fix OpenAI Responses stream reconstruction | DEFER (new subsystem, 19 files) | 13 source + 6 test files; new 557-line `responsesAccumulator.js` subsystem; `streamToJsonConverter`, `streamingHandler`, `sseToJsonHandler` require accumulator wiring |
| #2320 | 9router | fix(tts): chunk long text for google-tts and replace fragile line-index parser | DUPLICATE | `open-sse/handlers/ttsProviders/googleTts.js` — DD has `MAX_CHUNK=190`, `chunkText()`, `extractBase64()` with identical algorithm |
| #2299 | 9router | fix(sse): strip ANSI/VT100 codes from gc/ stream frames (#2273) | DUPLICATE | `open-sse/utils/streamHelpers.js` — DD has `stripAnsiCodes()` and lazy ANSI guard in `parseSSELine()` identical to upstream; `stripOrphanedToolResults` in `toolCall.js` also present |
| #1938 | 9router | feat: Support MCP Gateway with SSE Stream and Combos Management | DEFER (new feature, 73 files) | 73 files, +5605 lines; MCP gateway, API key management, dashboard UI; conflicts with DD's own MCP architecture; upstream merge state DIRTY |
| #1843 | 9router | fix(commandcode): force params.stream=true for non-streaming requests | DUPLICATE | `open-sse/executors/commandcode.js` — DD's `transformRequest` already sets both `body.stream = true` and `body.params.stream = true` |
| #1805 | 9router | fix(qoder): propagate upstream error status via HTTP status instead of SSE text, enabling combo/account fallback | DEFER (provider-specific executor rewrite) | Adds an 87-line first-event stream peeker/reconstructor in `qoder.js`; belongs in provider-fixes with Qoder fallback smoke coverage, not the SSE core batch. |
| #1717 | 9router | fix(open-sse): codex api compatibility and sse translation fixes | DEFER (mixed translator/executor change) | Bundles Responses event buffering, first-delta role state, and Codex request normalization across three hot-path files; requires a dedicated translator port with direct-route regression coverage. |
| #1568 | 9router | fix(sse): prevent false stall aborts on large-context reasoning streams | DUPLICATE | DurinDoor's `streamHandler.js` resets its watchdog on every raw upstream byte, not translated output, already preventing reasoning-frame false stalls; `kiro.js:801-803` also emits `: ka` when a frame yields no client chunk. |
| #1399 | 9router | fix(db,sse): bound usageHistory growth and clean up usage SSE listeners (#1245) | DEFER (db-usage theme) | SSE listener cleanup is already present; remaining database prune/cap belongs to the dedicated db-usage theme so migration/repository behavior is gated together. |
| #1272 | 9router | fix(chatCore): default stream to false per OpenAI spec (#1260) | GAP → ported | `open-sse/handlers/chatCore/streamFlag.js` now requires explicit `stream: true` for ordinary providers; regression in `tests/unit/resolve-stream-flag.test.js` |
| #1232 | 9router | fix: usage screen not update information with stream | DUPLICATE | `src/shared/components/UsageStats.js:300-305` — DD already uses `{ ...data }` spread; explicitly fixed |
| #1148 | 9router | fix(sse): drop empty data: null event between chunks | GAP → ported | Same-format null flushes now return no chunks and `formatSSE` emits no frame; regression in `tests/unit/sse-null-frame.test.js` |
| #1084 | 9router | fix(antigravity): drop literal <think>/</think> markers from Claude→OpenAI stream | DUPLICATE | `open-sse/translator/response/claude-to-openai.js:119-124` — DD already sets inThinkingBlock = false without emitting <think>/</think> content |
| #882 | 9router | fix(open-sse): decloak Claude tool names on every client-bound path | DEFER (translator-wide behavior) | Streaming decloak already exists; recursive shape rewriting plus suffix fallback spans translator and non-stream handlers and belongs in the translator theme with all client wire shapes covered. |
| #721 | 9router | fix: suppress null Responses SSE frames and preserve completed output | GAP → ported | Both Responses emitters now record finalized `response.output_item.done` items and attach deterministic dense `response.output`; regression in `tests/unit/responses-completed-output.test.js` |
| #651 | 9router | fix: translate non-streaming Ollama tool_calls for OpenAI SDK stream=false (closes #302) | DUPLICATE | DurinDoor's `translateNonStreamingResponse(responseBody, targetFormat, sourceFormat)` uses `targetFormat` for the upstream wire format, as shown by adjacent Claude/OpenAI conversion; its existing `targetFormat === OLLAMA` branch already translates Ollama provider bodies. Upstream's parameter semantics differ. |
| #345 | 9router | fix: preserve tool_calls during SSE-to-JSON reassembly | DUPLICATE | `open-sse/handlers/chatCore/sseToJsonHandler.js:106` — DD has `toolCallMap` accumulation preserving tool_calls in reassembly |
| #286 | 9router | Fix: SSE data: [DONE] sentinel for non-streaming requests (complements PR #285) | DUPLICATE | Current `github.js` consumes raw `[DONE]` without emitting it at the cited path; `stream.js` terminal sentinel is inside the streaming transform and is required by streaming clients. The upstream guard targets an older executor shape. |

### OmniRoute candidates (28)

| PR | Source | Title | Verdict | Evidence / commit |
|----|--------|-------|---------|-------------------|
| #9457 | OmniRoute | fix(sse): preserve client cache boundaries when hoisting system roles | DEFER (missing hoisting subsystem) | DurinDoor lacks OmniRoute's `claudeSystemRole` hoisting module; importing the subsystem is a separate Claude-cache feature, not a localized SSE fix. |
| #9440 | OmniRoute | fix(sse): restores #5887 openai precedence for bare gpt-5.5 routing | DEFER (routing theme) | Alters model precedence/routing rather than SSE framing; evaluate with combo-routing candidates and catalog invariants. |
| #9414 | OmniRoute | feat(sse): server-side template expansion for combo system prompts (#5501) | DEFER (new combo feature) | Requires absent `comboAgentMiddleware` and fingerprint/template expansion subsystem; belongs in combo-routing, not streaming stability. |
| #9381 | OmniRoute | refactor(sse): move the thinking-budget helpers out of base.ts | DEFER (pure refactor, no behavior change) | `+72/-65` in new `thinkingBudget.ts`; extracts private helpers for reuse; pure extraction, no behavior change; PR has no test file; plan: no pure refactors |
| #9380 | OmniRoute | fix(sse): drop the localDb barrel imports from chat and auth | DUPLICATE | `src/lib/localDb.js` IS the barrel re-export shim; pattern already established in DD exactly as the PR enforces |
| #9378 | OmniRoute | fix(sse): honor comment opt-out for final metadata (#9305) | DEFER (missing heartbeat subsystem) | DurinDoor has no `sseHeartbeat`/comment-option mechanism; adding the configuration surface is a standalone feature rather than a compatible localized port. |
| #9281 | OmniRoute | fix(mcp): stop DB init logging from corrupting the stdio JSON-RPC stream | DEFER (new infra entrypoint) | `bin/` directory absent; new `mcpStdioConsoleGuard.mjs` preload guard via `node --import`; requires Node.js module loader hook at entrypoint level |
| #9198 | OmniRoute | fix(sse): back the CCR block store with a durable tier (#9061) | DEFER (new DB subsystem) | New `src/lib/db/ccrBlocks.ts` SQLite table; `persistCcrBlock`, `loadCcrBlock`, `touchCcrBlock`, `flushCcrDurableWrites`; new DB subsystem with its own table and lifecycle; depends on #9191 |
| #9196 | OmniRoute | fix(open-sse): populate empty message content when reasoning text is present on tool_calls finish | DEFER (unverified mixed alias/stream patch) | Bundles a stream-shape guard with an absent `agy` auth alias; requires scoped live behavior verification in the translator theme rather than partial application. |
| #9191 | OmniRoute | fix(sse): evict a principal's own CCR blocks before another principal's (#9146) | DEFER (missing CCR subsystem) | Owner-aware CCR storage/eviction helpers are absent; depends on OmniRoute's CCR block-store architecture and cannot be localized to SSE framing. |
| #9184 | OmniRoute | fix(routing): evict affinity after terminal stream EOF | DEFER (routing lifecycle) | Session-affinity eviction changes routing state and terminal failure semantics; belongs in combo-routing with affinity tests. |
| #9115 | OmniRoute | fix(memory): enable agent memory save via MCP tools + builtin stream guard | DEFER (new feature subsystem) | ~5323-line diff; MCP memory tools, `omniroute_memory_*` builtin tools, FTS5 retrieval; new architecture, out of SSE-stability scope |
| #9090 | OmniRoute | [TS7] [v3.8.50] fix(types): preserve SSE tool call function shape | DEFER (TypeScript-only) | Pure TS type-widening fix; `|| {}` pattern absent in DD; no runtime effect |
| #9086 | OmniRoute | [TS7] fix(types): narrow stream response output | DEFER (TypeScript-only) | Pure TS narrowing fix; `asRecord()` exists in DD with incompatible sig; no runtime effect |
| #9063 | OmniRoute | test(sse): cover the 14 exported specificity-rules detectors | DEFER (test-only PR) | `open-sse/services/specificityRules.ts` does not exist in DD; no coverage gap |
| #9050 | OmniRoute | fix(open-sse): route GitHub Copilot gpt-5.6 sol/terra/luna to /responses | DEFER (provider catalog theme) | Registry/model endpoint selection belongs in provider-fixes and must be verified against current model catalog, not mixed into streaming framing. |
| #9006 | OmniRoute | fix(sse): make Claude effort/no-think catalog variants dispatchable on every provider | DEFER (broad hot-path, 14 files, 4 areas) | 14 files across 4 hot-path areas: effort/no-think dispatch (Area A), catalog aliases (Area B), chat-helpers targetFormat threading (Area C), Vertex 403 classifier (Area D); spans SSE core routing, translator dispatch, and auth |
| #9003 | OmniRoute | fix(sse): preserve tools echo on response.completed lifecycle event (… | DUPLICATE | `open-sse/services/responseModelEcho.js` never touches `tools`; `stream.js` PASSTHROUGH/TRANSLATE modes preserve tools on all lifecycle events |
| #8976 | OmniRoute | fix(sse): default OpenAI Chat Completions to non-stream when stream omitted | DUPLICATE | Cross-source duplicate of newer 9router #1272, ported on this branch |
| #8948 | OmniRoute | fix(responses): use protocol-neutral keepalive before response starts | DUPLICATE | `open-sse/utils/earlyStreamKeepalive.js:19` already has brand-neutral `: keepalive\n\n`; `KEEPALIVE_FRAME` named export alone is not a behavior gap; Responses API route (`src/app/api/v1/responses/route.js`) absent in DD |
| #8934 | OmniRoute | fix(sse): preserve Claude Code cache breakpoints | DEFER (new Claude constraints subsystem) | Adds absent `claudeCodeConstraints` plus Codex failover classification in chatCore; multi-concern hot-path change needs a dedicated translator/provider PR. |
| #8888 | OmniRoute | fix(sse): brand-neutral keepalive frames | DUPLICATE | `open-sse/utils/earlyStreamKeepalive.js:19` already has `: keepalive\n\n`; DD never used omniroute-branded keepalive |
| #8807 | OmniRoute | [v3.8.50] fix(sse): stop fabricating encrypted Codex reasoning summary text | DEFER (fix target absent) | `ENCRYPTED_REASONING_PLACEHOLDER` absent in DD (`grep` exit 1); `pureHelpers.js` path doesn't map to DD translator structure; PR removes fabrication that does not exist in DD |
| #8774 | OmniRoute | [v3.8.50] fix(open-sse): filter non-numeric values in comboTargetLimits before min calculation | DEFER (fix target absent) | `comboTargetLimits` absent from entire `open-sse/` in DD (`grep` exit 1); fix target does not exist; PR prevents NaN in a `Math.min()` for a feature not yet present |
| #8772 | OmniRoute | [v3.8.50] fix(test): revive orphaned open-sse vitest tests | DEFER (infra-specific) | `open-sse/services/__tests__/` absent in DD; worktree vitest config explicitly excludes `.omc/**` directories; main checkout test state is the relevant target |
| #8755 | OmniRoute | [v3.8.50] fix(sse): replay Gemini thought_signature on direct Claude→Gemini path (400 error) | DEFER (oversized unscoped history) | PR contains 49 commits and a >50MB truncated patch; direct Claude→Gemini request fix cannot be safely isolated from the current live diff. |
| #8704 | OmniRoute | [v3.8.50] fix(open-sse): add 'has been exhausted' to CREDITS_EXHAUSTED_SIGNALS (fixes #8631) | DEFER (classifier subsystem absent) | OmniRoute's `classifyProviderError` and `CREDITS_EXHAUSTED_SIGNALS` do not exist in DurinDoor; quota classification lives in `utils/error.js` with stricter quota/limit evidence and needs a resilience-theme policy decision. |
| #8338 | OmniRoute | [v3.8.50] feat(sse): Cursor plan images via Agent CLI (IMAGE_PROVIDERS.cursor) | DEFER (new feature subsystem) | `open-sse/handlers/imageGeneration/` directory absent; entire image generation provider architecture not in DD; new feature, not SSE-stability fix |

### SSE Theme summary

| Verdict | Count | PRs |
|---------|-------|-----|
| GAP → ported | 4 | #3020, #1272, #1148, #721 |
| DUPLICATE | 14 | #2320, #2299, #1843, #1568, #1232, #1084, #651, #345, #286, #9380, #9003, #8976, #8948, #8888 |
| DEFER | 30 | #3013, #2713, #1938, #1805, #1717, #1399, #882, #9457, #9440, #9414, #9381, #9378, #9281, #9198, #9196, #9191, #9184, #9115, #9090, #9086, #9063, #9050, #9006, #8934, #8807, #8774, #8772, #8755, #8704, #8338 |
| **Total** | **48** | |

| Source | GAP → ported | DUPLICATE | DEFER |
|--------|-------------|-----------|-------|
| 9router (20) | 4 | 9 | 7 |
| OmniRoute (28) | 0 | 5 | 23 |
| **Total** | **4** | **14** | **30** |

## Theme: translator

### 9router candidates (41)

| PR | Source | Title | Verdict | Evidence / commit |
|----|--------|-------|---------|-------------------|
| #3018 | 9router | fix(translator): drop JSON Schema keywords Gemini has no field for | GAP → ported | Added `uniqueItems`, `contains`, `unevaluatedProperties`, `unevaluatedItems`, and `contentSchema` to Gemini schema stripping; regression in `tests/unit/gemini-schema-multiple-of.test.js`. |
| #2927 | 9router | fix(thinking): stop claude-adaptive's unlevelled auto intent from 400ing | DEFER (thinking policy change) | Bare-auto clamping changes centralized `thinkingUnified` semantics for every Claude-adaptive provider; requires a dedicated translator PR with provider/model-level intent tests. |
| #2925 | 9router | fix(claude): preserve signed thinking across Responses tools | DEFER (Responses recovery path) | Existing chat path recovery is present; wiring one-shot signed-thinking retry into the separate Responses path spans request policy and executor recovery and needs dedicated end-to-end coverage. |
| #2911 | 9router | fix(kiro): drop top-level systemPrompt for kiro.dev gateway | DUPLICATE | `open-sse/translator/request/openai-to-kiro.js:363-372` — DD merges system into user `<instructions>` tags; no top-level `systemPrompt` key written to Kiro payload root. Bug absent. |
| #2869 | 9router | fix(translator): guard against doubled tool-call arguments from openai-compat providers | DUPLICATE | `open-sse/translator/request/openai-to-claude.js:19-61` — `deduplicateDoubledJson()` + `sanitizeToolArgs()` already fix doubled JSON. Bug absent. |
| #2831 | 9router | feat: add reasoning level support for Codex models | DUPLICATE | `open-sse/providers/thinkingLevels.js:35-42` — `*codex*` pattern with `["low","medium","high","xhigh"]` and `thinkingCanDisable: false`. `resolveOpenAiEffort()` at `thinkingUnified.js:233-244`. Bug absent. |
| #2800 | 9router | fix(thinking): keep compatible Qwen requests OpenAI-shaped | DUPLICATE | `open-sse/translator/concerns/thinkingUnified.js:102-109` — explicit comment: "Dynamic OpenAI-compatible gateways speak the OpenAI wire format...". Bug absent. |
| #2787 | 9router | fix(codex): preserve GPT-5.6 max reasoning | DUPLICATE | `open-sse/providers/thinkingLevels.js:27-31` — `*gpt-5.6-sol/terra/luna*` patterns with `"max"` and `"ultra"` → `"max"` conversion at `resolveOpenAiEffort` line 237. Bug absent. |
| #2770 | 9router | feat(usage): surface Claude thinking token counts to clients | DUPLICATE | `open-sse/utils/usageTracking.js:47,229,517`; `openai-to-claude-json.js:68-69`; `requestDetail.js` exposes `reasoning_tokens`. Bug absent. |
| #2762 | 9router | fix(pricing): stop billing reasoning tokens twice | DUPLICATE | `open-sse/providers/pricing.js:510-516` — `billedReasoningTokens = Math.min(outputTokens, reasoningTokens)` with separate reasoning rate. Bug absent. |
| #2760 | 9router | fix(capabilities): correct thinking format and limits for the 4.6+ Claude generation | DUPLICATE | `open-sse/providers/capabilities.js:82-103` — explicit `claude-opus-4.6/4.7/4.8/5`, `claude-sonnet-4.6/5` entries with `thinkingFormat: "claude-adaptive"`, `contextWindow: 1000000`. Bug absent. |
| #2706 | 9router | fix(minimax): normalize unsigned thinking block starts | DUPLICATE | `open-sse/handlers/chatCore/thinkingSignatureRecovery.js` — thinking signature recovery (ported from OmniRoute #7906). Bug absent. |
| #2691 | 9router | fix(azure): send max_completion_tokens for gpt-5/o-series reasoning deployments | DEFER (Azure Responses route) | Chat-completions rename exists; remaining `/responses` bypass requires route/executor design outside translator-local scope and Azure-specific request tests. |
| #2688 | 9router | fix(kiro): retry malformed tool_call wrappers once | DEFER (broad Kiro rewrite) | `kiro.js` delegates to `BaseExecutor.execute()`; no specific malformed tool_call wrapper one-shot retry found; PR diff needed to identify exact failure mode. |
| #2681 | 9router | fix(kiro): validate completed nested tool_call payloads | DEFER (broad Kiro rewrite) | Kiro streams wrapper tool_calls in phases (init/input/terminal); `validateKiroToolUse` + phased buffering requires broad executor rewrite. PR diff needed to scope exact failure mode. |
| #2652 | 9router | fix(github): use adaptive thinking for Claude Fable 5 | DUPLICATE | Superseded by #2756 (provider-scoped `thinkingFormat: "claude-adaptive"`). DurinDoor has `*claude*fable*` pattern. |
| #2369 | 9router | fix(kiro): nest thinking/output_config/max_tokens in additionalModelRequestFields | DEFER (Kiro wire rewrite) | Replaces DurinDoor's current Kiro thinking tag transport with native `additionalModelRequestFields`; broad executor/request wire migration needs dedicated Kiro real-provider verification. |
| #2323 | 9router | fix(nvidia): disable thinking for minimaxai/minimax-m2.7 on NVIDIA NIM | DUPLICATE | `capabilities.js:265` — `"minimaxai/minimax-m2.7": { reasoning: false, contextWindow: 200000, maxOutput: 131072 }, // #2323`. Bug absent. |
| #2312 | 9router | fix(translator): preserve Z.ai reasoning effort | DUPLICATE | `thinkingUnified.js:201-203` — Z.ai `max`/`xhigh` → `"max"` effort, lower levels → `"high"`. Bug absent. |
| #2295 | 9router | fix(claude): return summarized adaptive thinking | DUPLICATE | `thinkingUnified.js:268` sets `{ type: "adaptive", display: "summarized" }`; `base.js:314-315` removes `redact-thinking-2026-02-12` beta. Bug absent. |
| #2147 | 9router | feat(xai): register XaiExecutor with reasoning-effort suffix parsing | DUPLICATE | `open-sse/executors/xai.js:27-50` — identical `DENY_REASONING`/`ALLOW_REASONING` arrays. Bug absent. |
| #2001 | 9router | fix(antigravity): sanitize thinking level and map Claude models under antigravity to gemini-level | DUPLICATE | `thinkingUnified.js:98-105` (antigravity→gemini-level), lines 191-200 (gemini clamps xhigh/max/auto→high), 228-232/245-248 (openai/openai-responses). Bug absent. |
| #1936 | 9router | feat: OpenCode context window and reasoning controls | DEFER (dashboard/overrides subsystem) | 3-epic architectural PR: model metadata overrides KV store, runtime reasoning normalization, dashboard editor UI. Dashboard/overrides subsystem design decision required. |
| #1600 | 9router | fix: resolve 6 high-impact agentic workflow issues | DEFER (mixed six-fix bundle) | Five behaviors are already present; residual Gemini flat-schema repair is bundled with unrelated runtime/tool/system changes and needs a scoped schema-only source PR. |
| #1599 | 9router | fix: strip reasoning blobs from agentic context | DEFER (three-path history policy) | Removes reasoning state across Responses request translation, Codex stored items, and OpenAI helper history; this cross-path context-loss policy requires a dedicated compatibility PR. |
| #1460 | 9router | Preserve reasoning effort for Codex translations | DUPLICATE | `claude-to-openai.js:94-100` maps `output_config.effort→reasoning_effort`; `openai-responses.js:410-412` maps reasoning/reasoning_effort. Bug absent. |
| #1425 | 9router | Default Codex reasoning to medium | GAP → ported | Codex requests without explicit/model-suffix effort now default to `medium`; wire regression in `tests/unit/codex-effort-wire.test.js`. |
| #1412 | 9router | fix: replay reasoning content for thinking tool calls | DEFER (reasoning replay architecture) | Requires collecting/replaying real Claude assistant reasoning rather than DurinDoor's current placeholder injector; broader history semantics need direct DeepSeek tool-loop tests. |
| #1337 | 9router | Fix Xiaomi reasoning content echo | GAP → ported | Added all-message reasoning echo rules for `xiaomi-mimo` and `xiaomi-tokenplan`; regressions in `tests/unit/reasoningContentInjector.test.js`. |
| #1273 | 9router | feat(kiro): bulk refresh-token import + thinking/agentic variants | DEFER (mixed UI/Kiro feature) | Model variants already exist; remaining bulk-import UI/API and inline thinking splitter are separate auth/provider features, not a translator-local stability fix. |
| #1264 | 9router | fix(translator): strip temperature for Claude models with extended thinking | DUPLICATE | `openai-to-claude.js:18-32` strips temperature for `claude-opus-4`/`claude-sonnet-4`; lines 212-215 strip `result.temperature` when `result.thinking` set. Bug absent. |
| #1193 | 9router | fix: Responses API MCP namespace + deepseek 思考后缀支持 | DEFER (broad namespace/state change, 8 files) | Eight-file change spans Responses request translation, transformer state, tool-name namespace round-tripping, and DeepSeek suffix parsing; current tree has only partial MCP/custom-tool handling, so this open/unmerged broad change needs dedicated protocol-state verification. |
| #1007 | 9router | fix: normalize Codex custom tools (apply_patch) to { input: string } schema | DUPLICATE | `openai-responses.js:218-230` — exactly `tool.type === "custom" → { input: string }` normalization. Bug absent. |
| #976 | 9router | fix(codex): preserve reasoning summary deltas | DUPLICATE | `responsesTransformer.js:123-127` emits `response.reasoning_summary_text.delta`; `openai-responses.js:662-665` maps to `delta.reasoning_content`. Bug absent. |
| #875 | 9router | Fix empty Anthropic thinking blocks | DEFER (default-executor sanitizer) | Adds a new Anthropic history sanitizer in the default executor; requires signed/redacted thinking and tool-ID compatibility coverage in a dedicated PR. |
| #873 | 9router | fix(codex): strip unsupported n8n Responses API params | DEFER (Codex request policy) | System-to-instructions migration plus parameter allowlisting changes Codex request semantics beyond translation; requires n8n/Codex integration coverage. |
| #865 | 9router | feat(cx): add reasoning effort variants for GPT-5.5 and GPT-5.4 | DEFER (provider catalog theme) | Adds provider model aliases/catalog variants; belongs in provider-fixes with current catalog verification, not translator behavior. |
| #628 | 9router | fix: strip default values from tool schema in antigravity-to-openai | DUPLICATE | `open-sse/translator/request/antigravity-to-openai.js:36-43` — same `delete cleaned.default` normalization. Bug absent. |
| #466 | 9router | Fix responses transformer to properly close reasoning before message content | DUPLICATE | `open-sse/transformer/responsesTransformer.js:337` and `open-sse/translator/request/openai-responses.js:111` — `closeReasoning` already called before content handling. Bug absent. |
| #422 | 9router | fix: coerce string numeric JSON Schema constraints to integers | GAP → ported | Added recursive numeric-string coercion across the common OpenAI filter, Claude→OpenAI, and both Responses request converters; regressions in `tests/unit/openai-schema-numeric-constraints.test.js`. |
| #392 | 9router | feat: bypass agent tool-call loops to save GitHub Copilot quota | DEFER (routing/executor feature) | Agent-loop bypass and dynamic `X-Initiator` alter request routing and provider headers across GitHub/xAI; dedicated provider PR required. |

### OmniRoute candidates (7)

| PR | Source | Title | Verdict | Evidence / commit |
|----|--------|-------|---------|-------------------|
| #9437 | OmniRoute | Feat/max reasoning effort | DEFER (shared reasoning policy) | `opencode-go` exists and is registered, but the shared OpenAI-family `thinkingLevels` policy does not allow `max`; this closed/unmerged broad shared-policy change needs dedicated provider/model verification. |
| #9397 | OmniRoute | fix(providers): enforce gemini-web reasoning and tool constraints | DEFER (target absent) | `gemini-web` executor absent from `open-sse/executors/` (grep zero matches). Registry model + Playwright-based guard for non-existent executor. |
| #9163 | OmniRoute | fix(kiro): preserve GPT-5.6 Max reasoning via Responses | DEFER (Kiro native reasoning wire) | Adds native Kiro reasoning fields and Responses normalization across request layers; must land with the broader Kiro wire-format migration and real-provider tests. |
| #9114 | OmniRoute | [TS7] fix(types): preserve thinking signature recovery failure | DEFER (TypeScript-only, no runtime effect) | Pure TS type-widening fix; changes `recoverAnthropicThinkingSignature` parameter union. DD already ports behavioral recovery from OmniRoute #7906. TS-only type fix has no runtime effect in DD's JS target. |
| #9058 | OmniRoute | fix: skills & memory — tool-name encoding, schema normalization, warm-cache, combo id, Ponytail catalog | DEFER (4 subsystems absent) | 7 cherry-picked sub-items; per-sub: (a) GAP — base64url tool-name encoding absent from DD skill injection; (b) GAP — `normalizeInputSchema` for Gemini flat→object schema absent; (c) DEFER — builtin handler fallback needs `src/lib/skills/executor.ts` absent; (d) DEFER — warm-cache needs `src/lib/memory/` absent; (e) DUPLICATE — combo ID already mapped in `combosRepo.js:24-40`; (f) DEFER — Ponytail skill manifest generator needs OmniRoute-specific `skills/ponytail/` absent in DD (RTK bridge uses different architecture); (g) DEFER — memory store reindex needs `src/lib/memory/` absent. Port sub-items (a) and (b) only if skill/memory subsystem adopted. |
| #9004 | OmniRoute | feat(responses): add encrypted reasoning replay opt-in | DEFER (new persisted setting/policy) | Requires connection schema/UI toggle plus shared Responses input policy across chatCore and Codex; a migration-bearing feature, not a compact translator port. |
| #8629 | OmniRoute | [v3.8.50] fix(claude): preserve signed thinking turns during obfuscation | DEFER (obfuscation target absent) | OmniRoute adds `hasSignedThinking` guard in `claudeCodeObfuscation.ts` + `systemTransforms.ts` to skip text mutation on assistant turns with thinking/redacted_thinking. DD `open-sse/utils/claudeCloaking.js` handles only tool-name cloaking (`_cc` suffix) and billing-header injection; no assistant-content text obfuscation exists. Guard has no target in DD. |
|
### Verdict summary

| Verdict | Count | PRs |
|---------|-------|-----|
| GAP → ported | 4 | #3018, #1425, #1337, #422 |
| DUPLICATE | 21 | #2911, #2869, #2831, #2800, #2787, #2770, #2762, #2760, #2706, #2652, #2323, #2312, #2295, #2147, #2001, #1460, #1264, #1007, #976, #628, #466 |
| DEFER | 23 | #2927, #2925, #2691, #2688, #2681, #2369, #1936, #1600, #1599, #1412, #1273, #1193, #875, #873, #865, #392, #9437, #9397, #9163, #9114, #9058, #9004, #8629 |
| **Total** | **48** | |

| Source | GAP → ported | DUPLICATE | DEFER |
|--------|---------------|-----------|-------|
| 9router (41) | 4 | 21 | 16 |
| OmniRoute (7) | 0 | 0 | 7 |
| **Total** | **4** | **21** | **23** |
