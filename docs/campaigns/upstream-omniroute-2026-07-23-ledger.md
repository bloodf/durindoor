# Upstream/OmniRoute port campaign — 2026-07-23

Triage of `decolua/9router` + `diegosouzapw/OmniRoute` PRs from the last 5 days, verified against the DurinDoor fork. Every candidate was checked against live fork source before classifying. Priority ask from the maintainer: **fully remove Google Analytics and any tracking** (upstream #2775 only made it opt-in — we removed it entirely).

## Shipped in this PR

| Item | Source | Change | Files |
|---|---|---|---|
| **Remove Google Analytics + tracking** | ask + 9router #2775 (stronger) | Deleted the `<GoogleAnalytics gaId="G-LC959F603F">` beacon, its `@next/third-parties` import, and the dependency from `package.json`/`package-lock.json`. Full removal, not opt-in. | `src/app/layout.js`, `package.json`, `package-lock.json` |
| Force OpenAI thinking format for compatible gateways | 9router #2800 | A Qwen model behind a dynamic `openai-compatible-*` gateway now emits `reasoning_effort`, not native `enable_thinking`/`thinking_budget` (which strict OpenAI-compatible upstreams reject 400). | `open-sse/translator/concerns/thinkingUnified.js` |
| Drop `HARM_CATEGORY_CIVIC_INTEGRITY` | OmniRoute #8238 | Removed from Gemini `DEFAULT_SAFETY_SETTINGS`; some Gemini endpoints 400 on that category. | `open-sse/translator/formats/gemini.js` |
| Clean staged CLI build | 9router #2748 | Remove any stale `.next-cli-build` before compiling so stale modules never survive across CLI builds. | `cli/scripts/build-cli.js` |
| Proxy-pool relay test hardening | 9router #2798 | Relay test timeout 10s → 30s; replaced flaky `httpbin.org` target with `api.ipify.org`. | `src/app/api/proxy-pools/[id]/test/route.js` |

Tests: `tests/unit/no-google-analytics.test.js` (privacy invariant), `tests/unit/port-tracking-fixes.test.js` (#2800 + #8238).

## Verified DUPLICATE (already in the fork — no action)

| PR | reason (fork evidence) |
|---|---|
| 9router #2762 | pricing.js:505-517 already subtracts reasoning from output (no double-bill) |
| 9router #2725 | custom-server.js:54 already binds `HOSTNAME=127.0.0.1` by default (cites #2725) |
| 9router #2787 | thinkingUnified.js:227 already preserves `max` when the model's capability matrix allows it (GPT-5.6 Sol/Terra include `max`) |
| 9router #2776 | fork's per-field AES-256-GCM + master key (connectionsRepo.js) is stronger than the PR's whole-column machine-id fallback |
| 9router #2777 | providers/[id]/page.js:1625-1651 already has bulk enable/disable |
| 9router #2760 | capabilities.js:406 already has claude-adaptive + 1M context for fable/mythos |
| 9router #2731 | executors/kiro.js already transport-only (messageStopEvent terminal, no text heuristics) |
| 9router #2709 | utils/requestLogger.js:72-145 already redacts headers/query/fields + 0700/0600 modes |
| OmniRoute #8275, #8232 | tokenRefresh.js:127,212 already has full gemini-cli OAuth refresh |

## Deferred to follow-up PRs (real PORTs, too large/hot-path for this tranche)

These are genuine gaps but each warrants its own reviewed PR — they add new modules or touch streaming hot paths:

**9router — High impact**
- #2801 Ollama terminal stream message content dropped (`ollama-to-openai.js`, `stream.js`)
- #2799 Anthropic prefill 400 in combo fusion (`combo.js` role mapping + trailing-user guard)
- #2796 Codex `additional_tools` passthrough strip (`chatCore.js`)
- #2783 Structured Output across Chat⇄Responses hop (`openai-responses.js`, new `jsonFence.js`)
- #2761 GitHub Claude-native routing via `resolveTargetFormat` (`executors/github.js`, `provider.js`)
- #2780 Claude Code Auto Mode GPT fallback (new `claudeMessageResponse.js` + suffix helpers)

**9router — Med impact**
- #2747 / #2713 OpenAI Responses stream reconstruction (new `responsesAccumulator.js`, ~880 lines)
- #2736 opt-in cache-affinity account selection (new `cacheAffinity.js`)
- #2710 provider request correlation/observability (new `requestTiming.js`)
- #2774 keep `reasoning_content` by default, opt-in strip (new `reasoningVisibility.js`)
- #2770 surface Claude thinking token counts (`claude-to-openai.js`, `usageTracking.js`)
- #2769 multi-reference image gen + Antigravity quota failover
- #2764 API-only bootstrap listening-probe (`custom-server.js`)
- #2756 GitHub Claude prompt limits (`copilotModels.js`, count_tokens preflight)
- #2755 Cursor real PKCE OAuth (full `cursor.js` rewrite + OAuthModal branch)
- #2786 OpenCode `/v1/models` resolution (`buildModelsList.js`)
- #2794 exact embedding token usage (`embeddingsCore.js`)
- #2793 provider-neutral route attribution headers
- #2784 configurable error cooldown policies (new engine)
- #2724 grok current-day request usage; #2723 quota tracker UI (dashboard-only)
- #2789 kiro dashboard thinking-intensity suffix normalize; #2792 Jina Reader POST + recovery

**OmniRoute — High/Med**
- #8287 strip zero-width chars from Anthropic-native streaming (hot path — needs the right claude-native passthrough hook)
- #8252 combo advance on model-scoped 400 (`combo.js`, `accountFallback.js`)
- #8241 grok-web Cloudflare anti-bot classification (`grok-web.js`, gated browser path)
- #8240 catalog-filtered family fallback (`modelFallback.js`)
- #8296 structure-aware chat admission (gated middleware)
- #8293 image-gen API-key call-log attribution

## N-A (not applicable to the fork)

i18n/docs/banner/readme PRs; Gemini 3.6 model-catalog additions (fork manages its own catalog); `next` version bumps (fork pins its own); OmniRoute base-red CI test slices; needs-vps kiro/devin-desktop; CloakBrowser plugin extraction; OmniRoute modules with no fork equivalent (claude-web modular transport, tokenHealthCheck sweep, claudeClassifierCompat, versionCheck singleflight, Poe registry, KimiExecutor moonshot path).
