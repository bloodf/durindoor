# 9router Open PR Audit — 2026-08-11

**Query**: `gh pr list --repo decolua/9router --state open --limit 50`
  - `gh search prs` with `repo:decolua/9router is:pr is:open updated:>=2026-08-09` is unusable via this gh token (returns "resources do not exist or you do not have permission")
  - Date window enforced by filtering returned rows on `updatedAt >= 2026-08-09`; all 50 PRs satisfy this
  - `--limit 50`: cap did not truncate; open PR set has exactly 50 PRs in this window
  - Sort: default (`--sort updated --order desc` matches gh pr list default)
**Window**: `updatedAt` 2026-08-09 – 2026-08-11 (50/50 PRs within window)
**Anchor**: PR range 3169–3238
**Policy**: Per `docs/UPSTREAM_SYNC.md` — unmerged changes stay watchlisted until their final merged diff is available.
**Classification allowed values**: WATCH | ACTIVE-EVALUATION | DUPLICATE | DEFER | N/A

---

## Ledger

| PR# | Title | URL | Updated | Classification | Evidence / Recommendation |
|------|-------|-----|---------|----------------|---------------------------|
| 3169 | Fix/executors model state leak | https://github.com/decolua/9router/pull/3169 | 2026-08-09 | ACTIVE-EVALUATION | durindoor PR #408 open. Executor state-isolation fix. Port trigger: upstream merge. |
| 3170 | Fix/security credential metadata isolation | https://github.com/decolua/9router/pull/3170 | 2026-08-09 | ACTIVE-EVALUATION | durindoor PR #409 open. Credential metadata isolation. Port trigger: upstream merge. |
| 3171 | Fix/mimo free session affinity | https://github.com/decolua/9router/pull/3171 | 2026-08-09 | ACTIVE-EVALUATION | durindoor PR #405 open. MiMo session affinity hardening. Port trigger: upstream merge. |
| 3172 | Fix/executors cancel sse readers | https://github.com/decolua/9router/pull/3172 | 2026-08-09 | ACTIVE-EVALUATION | durindoor PR #407 open. SSE reader cancellation on executor abort. Port trigger: upstream merge. |
| 3173 | feat(federation): multi-node edge→central federation (proxy, replication, failover) | https://github.com/decolua/9router/pull/3173 | 2026-08-09 | WATCH | New federation feature. DurinDoor has no federation infrastructure. Scout if multi-node DurinDoor is on the roadmap. |
| 3174 | fix(openai): handle Luna function tools on Chat Completions | https://github.com/decolua/9router/pull/3174 | 2026-08-09 | WATCH | OpenAI/Luna function tool handling. Scout DurinDoor OpenAI executor for Luna tool support. |
| 3175 | fix(stream): finalize interrupted streaming request details | https://github.com/decolua/9router/pull/3175 | 2026-08-09 | WATCH | Streaming request detail finalization on interruption. Scout DurinDoor stream error finalization behavior. |
| 3178 | fix(codex): route standalone web search requests | https://github.com/decolua/9router/pull/3178 | 2026-08-09 | WATCH | Codex standalone web-search routing. DurinDoor has Codex executor; scout whether standalone web-search routing gap exists. |
| 3179 | fix(runtime): coordinate graceful shutdown flushes | https://github.com/decolua/9router/pull/3179 | 2026-08-09 | WATCH | Runtime shutdown flush coordination. Scout DurinDoor runtime shutdown behavior. |
| 3181 | fix(fallback): do not rotate accounts for request errors | https://github.com/decolua/9router/pull/3181 | 2026-08-09 | WATCH | Account fallback rotation logic change: do not rotate on request errors. Scout DurinDoor fallback rotation policy. |
| 3182 | fix(providers): report active after cooldown expires | https://github.com/decolua/9router/pull/3182 | 2026-08-09 | WATCH | Provider cooldown expiry reporting. Scout DurinDoor provider status reporting after cooldown. |
| 3183 | fix(translator): serialize reasoning effort for Responses API | https://github.com/decolua/9router/pull/3183 | 2026-08-09 | WATCH | Reasoning effort serialization for Responses API. Scout DurinDoor translator Responses API reasoning handling. |
| 3184 | fix: batch of community bug fixes (SSRF guard, Fusion stream_options, reasoning test probe) | https://github.com/decolua/9router/pull/3184 | 2026-08-09 | DEFER | SSRF guard evaluated in `.omc/wt-port-3184-ssrf`; not shipped. Security review found the guards validate hostname text only, so an attacker-controlled public hostname can still resolve or rebind to a private/metadata address before the socket. Port trigger: resolved-address pinning at the transport boundary, then upstream merge. |
| 3185 | fix(kiro): pin API keys to detected Amazon Q region | https://github.com/decolua/9router/pull/3185 | 2026-08-10 | WATCH | Kiro/Amazon Q region pinning. DurinDoor fork has kiro.ts; scout whether API key region pinning is needed. |
| 3186 | fix: Codex request hardening (custom provider params, replayed tool-call IDs) | https://github.com/decolua/9router/pull/3186 | 2026-08-09 | WATCH | Codex request hardening: custom provider params, replayed tool-call IDs. Scout DurinDoor Codex executor hardening state. |
| 3187 | fix: request translation hardening (combo prefix, OpenAI gpt-5 tokens, Codex IDs) | https://github.com/decolua/9router/pull/3187 | 2026-08-09 | WATCH | Request translation hardening: combo prefix, GPT-5 tokens, Codex IDs. Scout DurinDoor translator hardening state. |
| 3188 | fix: strip Qwen thinking params for OpenAI-compatible passthrough (#2752) | https://github.com/decolua/9router/pull/3188 | 2026-08-09 | WATCH | Qwen thinking param stripping for OpenAI-compatible passthrough. Scout DurinDoor OpenAI passthrough handling. |
| 3189 | fix(fusion): trim trailing assistant messages so panel ends on user turn (#2876) | https://github.com/decolua/9router/pull/3189 | 2026-08-09 | WATCH | Fusion panel trailing message trimming. Scout DurinDoor fusion/chat panel behavior. |
| 3190 | fix(kimi): route API-key connections to Moonshot Open Platform | https://github.com/decolua/9router/pull/3190 | 2026-08-09 | WATCH | Kimi/Moonshot API-key routing. Scout DurinDoor kimi.ts routing logic. |
| 3191 | fix(providers): add TokenRouter connection test support | https://github.com/decolua/9router/pull/3191 | 2026-08-10 | WATCH | TokenRouter connection test support in provider testing. Scout DurinDoor provider test harness for TokenRouter. |
| 3192 | feat(providers): add model search + batch model test to dashboard | https://github.com/decolua/9router/pull/3192 | 2026-08-10 | WATCH | Dashboard model search + batch test feature. Scout DurinDoor dashboard provider testing UI. |
| 3193 | feat(providers): add Kimchi API key support (dual OAuth + API key) | https://github.com/decolua/9router/pull/3193 | 2026-08-10 | WATCH | Kimchi provider: dual OAuth + API key auth. Scout DurinDoor Kimchi provider support. |
| 3194 | fix(codex): quarantine invalidated OAuth profiles | https://github.com/decolua/9router/pull/3194 | 2026-08-10 | WATCH | Codex OAuth profile invalidation quarantine. Scout DurinDoor Codex OAuth lifecycle handling. |
| 3196 | feat(commandcode): support Muse reasoning effort | https://github.com/decolua/9router/pull/3196 | 2026-08-10 | WATCH | Muse reasoning effort support for commandcode. Scout whether DurinDoor Muse/executor has reasoning effort handling. |
| 3197 | feat(combos): add per-model test button in combo create/edit modal | https://github.com/decolua/9router/pull/3197 | 2026-08-10 | WATCH | Dashboard combo modal per-model test button. Scout DurinDoor combo dashboard UI. |
| 3201 | fix(providers): add llm7 to provider test support | https://github.com/decolua/9router/pull/3201 | 2026-08-10 | WATCH | Provider test support for llm7. Scout DurinDoor provider test harness for llm7. |
| 3203 | feat(fallback): per-account RPM cap, default 40 for NVIDIA | https://github.com/decolua/9router/pull/3203 | 2026-08-10 | WATCH | Per-account RPM cap with NVIDIA default 40. Scout DurinDoor per-account rate-limiting. |
| 3204 | fix(system-inject): use chat-compatible content part type for array system messages (#3202) | https://github.com/decolua/9router/pull/3204 | 2026-08-10 | WATCH | System message content part type for array messages. Scout DurinDoor system-inject behavior. |
| 3205 | feat(keys): per-key rate limits, budget, model allowlist and expiry | https://github.com/decolua/9router/pull/3205 | 2026-08-10 | WATCH | Per-key rate limits, budgets, model allowlist, key expiry. Scout DurinDoor key management feature set. |
| 3206 | feat(server): optional API-only port | https://github.com/decolua/9router/pull/3206 | 2026-08-10 | WATCH | Optional API-only server port. Scout DurinDoor server port configuration. |
| 3208 | Fix resolve 429 resource exhausted by switching to production api endpoint and optimizing request size | https://github.com/decolua/9router/pull/3208 | 2026-08-10 | WATCH | 429 resolution via production endpoint switch and request size optimization. Scout DurinDoor 429 handling in affected providers. |
| 3210 | feat(dashboard): show effective Codex plan badges | https://github.com/decolua/9router/pull/3210 | 2026-08-10 | WATCH | Dashboard Codex plan badge display. Scout DurinDoor Codex dashboard UI. |
| 3211 | feat(providers): add Novita AI provider support | https://github.com/decolua/9router/pull/3211 | 2026-08-10 | WATCH | Novita AI provider. Scout DurinDoor provider registry for Novita AI. |
| 3213 | fix(auto-ping): select Codex model from live catalog | https://github.com/decolua/9router/pull/3213 | 2026-08-10 | WATCH | Auto-ping Codex model selection from live catalog. Scout DurinDoor Codex auto-ping behavior. |
| 3214 | fix(antigravity): harden Gemini streaming and 3.6 handling | https://github.com/decolua/9router/pull/3214 | 2026-08-11 | WATCH | Antigravity/Gemini streaming and 3.6 hardening. Scout DurinDoor antigravity.ts Gemini handling. |
| 3215 | Fix CORS for preflight OPTIONS method | https://github.com/decolua/9router/pull/3215 | 2026-08-10 | WATCH | CORS preflight OPTIONS handling. Scout DurinDoor CORS middleware for OPTIONS. |
| 3217 | fix(translator): preserve Responses prompt cache key | https://github.com/decolua/9router/pull/3217 | 2026-08-10 | WATCH | Responses prompt cache key preservation. Scout DurinDoor translator cache key handling. |
| 3218 | fix(models): expose snake_case token limits on /v1/models | https://github.com/decolua/9router/pull/3218 | 2026-08-10 | WATCH | snake_case token limits on /v1/models. Scout DurinDoor models endpoint field naming. |
| 3219 | fix(auth): stop truncating upstream error text mid-reason | https://github.com/decolua/9router/pull/3219 | 2026-08-10 | WATCH | Upstream error text truncation fix. Scout DurinDoor auth error handling. |
| 3220 | fix(chatCore): bound non-streaming body reads, return 504 on stall | https://github.com/decolua/9router/pull/3220 | 2026-08-10 | WATCH | Non-streaming body read bounds + 504 on stall. Scout DurinDoor chatCore streaming fallback behavior. |
| 3221 | fix(chat): key error state to its model, and preserve the upstream status class | https://github.com/decolua/9router/pull/3221 | 2026-08-11 | WATCH | Error state keying by model + upstream status class preservation. Scout DurinDoor chat error state handling. |
| 3222 | fix(stream): synthesize a terminal when upstream drops mid-response | https://github.com/decolua/9router/pull/3222 | 2026-08-10 | WATCH | Mid-stream upstream drop: synthesize terminal chunk. Scout DurinDoor stream error recovery. |
| 3223 | fix: Sanitize competitive system prompts to prevent 429 quota errors. (Fix resource exhausted issue for Antigravity models in Zed IDE) | https://github.com/decolua/9router/pull/3223 | 2026-08-11 | WATCH | Competitive system prompt sanitization to prevent 429s for Antigravity in Zed. Scout DurinDoor Antigravity Zed IDE handling. |
| 3225 | feat(auth): Add native SAML 2.0 Single Sign-On (SSO) integration | https://github.com/decolua/9router/pull/3225 | 2026-08-11 | WATCH | SAML 2.0 SSO integration. New auth surface for enterprise. Scout DurinDoor SSO roadmap. |
| 3227 | fix(qoder): detect billing blocks at stream start, return 403 for failover | https://github.com/decolua/9router/pull/3227 | 2026-08-11 | WATCH | Qoder billing block detection at stream start, 403 for failover. Scout DurinDoor Qoder provider handling. |
| 3231 | feat: Add fallback cmodel (Cantus) for Qoder provider | https://github.com/decolua/9router/pull/3231 | 2026-08-11 | WATCH | Qoder Cantus fallback model. Scout DurinDoor Qoder model catalog. |
| 3235 | fix(hermes): add api_key parameter to model block in YAML configuration | https://github.com/decolua/9router/pull/3235 | 2026-08-11 | WATCH | Hermes YAML model block api_key parameter. Scout DurinDoor Hermes provider YAML config. |
| 3236 | fix(responses): don't close message on empty tool_calls array | https://github.com/decolua/9router/pull/3236 | 2026-08-11 | ACTIVE-EVALUATION | durindoor PR #410 open. Responses API message close logic on empty tool_calls. Port trigger: upstream merge. |
| 3237 | docs(i18n): add Brazilian Portuguese documentation | https://github.com/decolua/9router/pull/3237 | 2026-08-11 | N/A | Docs-only: Brazilian Portuguese documentation additions. DurinDoor docs language policy is English-only (docs/README.md). No action. |
| 3238 | fix(kiro): comment out systemPrompt field causing REQUEST_BODY_INVALID | https://github.com/decolua/9router/pull/3238 | 2026-08-11 | WATCH | Kiro systemPrompt field causing REQUEST_BODY_INVALID — commented out upstream. Scout DurinDoor kiro.ts whether systemPrompt is sent and triggers the same error. Port trigger: upstream merge. |

---

## Summary Tally

| Classification | Count |
|----------------|-------|
| WATCH | 43 |
| ACTIVE-EVALUATION | 5 |
| DEFER | 1 |
| N/A | 1 |
| **Total** | **50** |

## Active Evaluation Cross-References

| 9router PR | DurinDoor PR | Status |
|------------|--------------|--------|
| #3169 | durindoor #408 (open) | Active port in progress |
| #3170 | durindoor #409 (open) | Active port in progress |
| #3171 | durindoor #405 (open) | Active port in progress |
| #3172 | durindoor #407 (open) | Active port in progress |
| #3236 | durindoor #410 (open) | Active port in progress |

## Already Tracked in Existing Worktrees / PRs

| Worktree / PR | 9router PR | Notes |
|---------------|------------|-------|
| durindoor PR #404 (open) | OmniRoute #10053 | Strip encrypted Gemini schema annotations — cross-repo |
| durindoor PR #408 (open) | #3169 | Executor state isolation |
| durindoor PR #409 (open) | #3170 | Credential metadata isolation |
| durindoor PR #405 (open) | #3171 | MiMo session affinity |
| durindoor PR #407 (open) | #3172 | SSE reader cancellation |
| durindoor PR #410 (open) | #3236 | Responses empty tool_calls |
| `.omc/wt-port-3184-ssrf` (no PR) | #3184 | Deferred: unresolved DNS-rebinding exposure |
