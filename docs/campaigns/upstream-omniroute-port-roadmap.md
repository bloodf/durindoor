# Upstream / OmniRoute port roadmap (planned, not just quick wins)

Living plan for porting the remaining compatible upstream (`decolua/9router`) and
OmniRoute (`diegosouzapw/OmniRoute`) work into DurinDoor. Each item is scoped as an
**independently shippable PR** — files, effort, risk, dependencies, and a done-state.
Ordered by tier; within a tier, do the higher-impact/lower-risk ones first.

Verification rule (non-negotiable): re-verify every item against live fork source
before implementing — the fork tracks upstream closely and several "PORT" candidates
turn out DUPLICATE-by-architecture on inspection (see the DUPLICATE section).

Companion ledger with per-PR fork evidence: `upstream-omniroute-2026-07-23-ledger.md`.

---

## Already shipped (for context)
- GA removal (#2775, stronger), #2800 openai-compatible thinking, #8238 gemini civic-integrity, #2748 CLI clean build, #2798 proxy-pool relay — PR #381.
- #8304 combo family/provider invariants — this PR.

---

## Tier 1 — High impact, self-contained (do next)

### T1.1 — Ollama terminal stream content (9router #2801)
- **Problem:** terminal Ollama stream chunk drops `message.content`/`message.thinking`.
- **Files:** `open-sse/translator/response/ollama-to-openai.js` (extract `chunk.message` before the `done` return), `open-sse/utils/stream.js` (accumulate native fields).
- **Effort:** S. **Risk:** low (one translator + accumulator). **Test:** translator unit asserting final delta carries content+thinking.

### T1.2 — Structured Output across Chat⇄Responses (9router #2783)
- **Problem:** `response_format` is dropped Chat→Responses, so Codex answers prose instead of JSON; mirror leak Responses→Chat.
- **Files:** `open-sse/translator/request/openai-responses.js` (map `response_format`↔`text.format`; delete `text` on reverse), new `open-sse/utils/jsonFence.js` (strip a single ```json fence in JSON mode), wire into `chatCore.js` non-stream + `sseToJsonHandler.js` final aggregation.
- **Effort:** M. **Risk:** medium (touches both directions). **Test:** round-trip json_schema + json_object; fence-strip unit.

### T1.3 — GitHub Claude-native routing (9router #2761)
- **Problem:** Claude models via GitHub Copilot go through a hand-rolled `executeWithMessagesEndpoint` instead of the native `/messages` format resolved by `resolveTargetFormat`.
- **Files:** `open-sse/executors/github.js` (delete `executeWithMessagesEndpoint`; `isClaudeModel` via `resolveTargetFormat`; `buildUrl` → messages URL for Claude), `open-sse/providers/registry/github.js` + `provider.js` (`resolveDynamicTargetFormat`), honest target format in `chatCore.js`.
- **Effort:** M. **Risk:** medium (Copilot path). **Test:** github executor routes claude→messages, others→chat.

### T1.4 — Codex additional_tools passthrough (9router #2796)
- **Problem:** Codex CLI `additional_tools` items carry a `content` field the Codex API rejects (“Unknown parameter input[0].content”).
- **Files:** `open-sse/handlers/chatCore.js` (post-translation, provider==="codex": strip `content` from `additional_tools` items only).
- **Effort:** S. **Risk:** low. **Test:** codex passthrough strips content, keeps type/name/tools.

### T1.5 — Anthropic prefill 400 in combo fusion (9router #2799)
- **Problem:** combo maps tool/function roles → assistant; newer Claude rejects assistant prefill on fan-out.
- **Files:** `open-sse/services/combo.js` (tool/function role → user; add `ensureTrailingUserTurn` before panel fan-out).
- **Effort:** S–M. **Risk:** medium (combo hot path). **Test:** trailing-assistant combo closes with a user turn.

---

## Tier 2 — Medium impact, contained new modules

### T2.1 — keep reasoning_content by default, opt-in strip (9router #2774)
- New `open-sse/utils/reasoningVisibility.js` + `REASONING_HEADER` in `runtimeConfig.js`; shared `applyReasoningVisibility` replacing inline strips in `nonStreamingHandler.js` + `sseToJsonHandler.js`. Effort M, risk low.

### T2.2 — surface Claude thinking token counts (9router #2770)
- Mirror `reasoning_tokens`/`completion_tokens_details` in `claude-to-openai.js`; add `output_tokens_details` to `usageTracking.js` filter+extract. Effort S–M, risk low.

### T2.3 — GitHub Claude prompt limits (9router #2756)
- Merge `limits`/`supports` in `copilotModels.js expandCatalog`; `/v1/messages/count_tokens` preflight in `github.js`. Effort M. Depends on T1.3 (same executor).

### T2.4 — OpenCode /v1/models resolution (9router #2786)
- Expand `OPENAI_MODELS_FETCHER_TYPES` + add `LIVE_MODEL_RESOLVERS["opencode"]` in `buildModelsList.js`. Effort S, risk low.

### T2.5 — exact embedding token usage (9router #2794)
- Persist provider-reported embedding usage in `embeddingsCore.js`; replace char/4 estimate in `src/sse/handlers/embeddings.js`. Effort S, risk low (fail-open).

### T2.6 — provider-neutral route attribution headers (9router #2793)
- New `open-sse/services/routeAttribution.js` emitting `X-9Router-*`; wire in `combo.js` + expose via CORS in `chat.js`. Effort M, risk low. (Rebrand headers to `X-DurinDoor-*`.)

### T2.7 — Jina Reader POST + recovery (9router #2792, merged upstream)
- `open-sse/handlers/fetch/index.js runJina` → POST JSON; parse `Title:` metadata; wire `onRequestSuccess`→`clearAccountError`. Effort S, risk low.

### T2.8 — kiro dashboard thinking-intensity suffix normalize (9router #2789, merged)
- Strip trailing `(high)/(medium)/(none)` before variant resolve in `claude-to-kiro.js`/`openai-to-kiro.js` + `kiroConstants.resolveKiroModel`. Effort S, risk low.

### T2.9 — grok current-day request usage (9router #2724) + quota tracker UI (#2723)
- Dashboard-only: `usageRepo.getTodayRequestCount`, `usage/[connectionId]/route.js`, ProviderLimits UI. Effort M, risk low, no wire-format change.

---

## Tier 3 — Large / architectural (plan carefully, own PR each)

### T3.1 — OpenAI Responses stream reconstruction (9router #2747 + #2713)
- New `open-sse/translator/concerns/responsesAccumulator.js` (~550 lines): stable output_index allocation, custom_tool_call lifecycle, exactly-once terminal, fragmented tool-call correlation. Touches `openai-responses.js` (req+resp), `stream.js`, `sseToJsonHandler.js`, `chatCore.js`. Effort L, risk high (Codex/Droid streaming). Prereq for anything else touching Responses streaming.

### T3.2 — opt-in cache-affinity account selection (9router #2736)
- New `src/sse/services/cacheAffinity.js` (LRU TTL, terminal-gated pinning) + affinity-key derivation in `chatCore.js` + dashboard toggle. Effort M–L, risk medium.

### T3.3 — provider request correlation / observability (9router #2710)
- New `open-sse/utils/requestTiming.js` (per-attempt IDs, phase timing, latency) + wiring across chatCore/streaming/nonStreaming/sseToJson/requestDetail. Effort L, risk medium (touches every handler).

### T3.4 — Cursor real PKCE OAuth (9router #2755)
- Rewrite `src/lib/oauth/services/cursor.js` (PKCE verifier/challenge, loginDeepControl, poll), OAuthModal cursor branch, `/api/oauth/cursor/authorize`+`/poll`, tokenRefresh dispatch. Effort L, risk medium (auth surface). Verify against fork's current cursor executor first.

### T3.5 — configurable error cooldown policies (9router #2784)
- New rule-engine `open-sse/services/errorCooldownPolicy.js` (status+code+substring → duration), wired into `base.js` retry. NOTE: fork already has Codex originator, MiniMax base_resp, Qwen thinking preservation — port only the missing engine core. Effort L, risk medium.

### T3.6 — multi-reference image gen + Antigravity quota failover (9router #2769)
- New `open-sse/services/antigravityRuntime.js`; multi-image loop in `imageProviders/antigravity.js` + `codex.js`; quota wiring in `src/sse/services/auth.js`. Effort L, risk medium. NOTE: fork's image account-fallback loop already exists (see #8307 DUPLICATE) — scope this to the multi-image + antigravity-runtime parts only.

### T3.7 — Codex image account-fallback (OmniRoute #8307) — REVISIT ONLY
- The retry + model-scoped lockout + connection attribution are **already present** in the fork's generic image loop (`imageGeneration.js` + `markAccountUnavailable` model-scoped locking + `usageHistory.connectionId`). Do NOT port the Codex-specific path — it would duplicate/diverge. Only revisit if a concrete Codex-image incident shows the generic loop missing a case.

### T3.8 — combo family invariants dashboard UI (OmniRoute #8304 follow-up)
- The validator + persistence shipped in this PR (server-side). A follow-up MAY add a dashboard editor for `allowedProviders`/`allowedModelFamilies` on the combo form. Effort S–M, risk low, optional.

---

## DUPLICATE-by-architecture (verified — do NOT port)
These upstream/OmniRoute PRs fix problems the fork's design already avoids; porting would add a conflicting second convention.
- 9router #2762 (pricing double-bill), #2725 (loopback bind), #2787 (GPT-5.6 max), #2776 (per-field AES-256-GCM already stronger), #2777, #2760, #2731, #2709.
- OmniRoute #8309 (`</think>` — fork never injects the marker), #8308 (CPA pool isolation — fork uses per-account `accountFallback`), #8306/#8293 (image API-key auth already enforced), #8275/#8232 (gemini-cli OAuth refresh present), #8307 (image account-fallback present — see T3.7).

## N-A (not applicable)
i18n/docs/banner/readme; model-catalog additions (fork owns its catalog); `next` bumps (fork pins); OmniRoute CI base-red slices; needs-vps items; OmniRoute modules with no fork equivalent (claude-web modular transport, tokenHealthCheck sweep, claudeClassifierCompat, versionCheck singleflight, Poe registry, KimiExecutor moonshot path, CloakBrowser plugin).

---

## Suggested execution order
1. Tier 1 (5 PRs) — one PR each, highest value, low/medium risk.
2. Tier 2 (grouped: translator T2.1–2.2, github T2.3, models T2.4–2.5, then T2.6–2.9).
3. Tier 3 — start with T3.1 (unblocks Responses-streaming work), then pick by need.
Each PR: worktree off origin/main → implement + test → Node-20 gate → PR + CI → squash-merge → deploy. Never bundle unrelated tiers.
