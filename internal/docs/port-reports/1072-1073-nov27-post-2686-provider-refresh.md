# Provider and connection intake refresh post-#2686, November 27, 2026

Status: DONE for provider/connection intake refresh, #2686 landing ledger, and post-review report corrections. Docs-only correction; no product or test code modified. This report tracks bounded provider/connection intake items only and makes no global parity claim.

## Snapshot and coverage

Sequential read-only GitHub REST snapshots completed on 2026-11-27 between 14:19 and 14:24 UTC. Upstream sources are `decolua/9router` and `cheaper-inference/OmniRoute` (redirected from `diegosouzapw/OmniRoute`). The local repository is `bloodf/durindoor`.

- **Local base (`origin/main`, `origin/HEAD`)**: `f7514b9ba3d0b341e0b5b422486049cf4f851a17` (`port(upstream): #5904 - preserve agent messages and quota usage (#2686)`).
- **Reviewed integration head**: `a9a5deb4f2a30f152cad747e8cb7123261e417fb` (merges `da15a3ae5c65f8e588628bc33333d4629cfddb9a`, `eb13a16128faecc3b247ad51ee05fedefe70e4ce`, and `83eca11dffc0aa32eae7a3ad0b27d06efef38e89` onto `f7514b9ba3d0b341e0b5b422486049cf4f851a17`).
- **Correction target**: this report updates the intake ledger on top of `a9a5deb4f2a30f152cad747e8cb7123261e417fb` following independent review against base `f7514b9ba3d0b341e0b5b422486049cf4f851a17`.

### Pinned baseline comparison

| Source | Default branch | Pinned census head | Observed live head | Commit time (UTC) | Status / delta commits | Open PRs |
| --- | --- | --- | --- | --- | --- | ---: |
| decolua/9router | master | `5ae63d22847e07042e235b40e1d926b65e509013` | `5ae63d22847e07042e235b40e1d926b65e509013` | 2026-11-23T02:13:33Z | identical (0 commits ahead) | 1,375 |
| cheaper-inference/OmniRoute | release/v3.8.55 | `c71f0065a7efe9230ec23b96a12253b050c4d7ad` | `c71f0065a7efe9230ec23b96a12253b050c4d7ad` | 2026-11-27T07:45:21Z | identical (0 commits ahead) | 627 |

Total open upstream PRs across both repositories: **2,002** (1,375 in 9router + 627 in OmniRoute).

### Delta against full-parity census (2026-11-27-full-parity-refresh.md)

- **decolua/9router**: 1,375 live open PRs. Exactly matches the 1,375 census rows (`90001` through `91375` in [2026-11-27-full-parity-refresh.md](2026-11-27-full-parity-refresh.md#decolua9router)). Zero new PRs, zero changed heads, zero closed PRs.
- **cheaper-inference/OmniRoute**: 627 live open PRs. Census recorded 626 open PRs (`O0001` through `O0626` in [2026-11-27-full-parity-refresh.md](2026-11-27-full-parity-refresh.md#cheaper-inferenceomniroute)). Live delta shows **3 new PRs**, **2 closed PRs**, and **8 changed PR heads** (net +1, yielding 627). All 616 other rows remain unchanged at their census heads.

#### New OmniRoute PRs (3)

| PR | Current head SHA | Title | Domain | Disposition and evidence |
| --- | --- | --- | --- | --- |
| [#21427](https://github.com/cheaper-inference/OmniRoute/pull/21427) | `af7b59d871fc3ac6ed2f69c410fe5db644eded0f` | fix(sse): propagate client abort to token refresh retries and quota-share pre-hook | connections / abort handling | **candidate (needs scope verification)**: `BaseExecutor` alone does not establish global refresh-abort equivalence. Locally, [BaseExecutor.execute](../../../open-sse/executors/base.js#L288) checks `signal?.aborted` and wraps intra-URL retries in `waitForRetryDelay(waitMs, signal)` ([base.js#L83](../../../open-sse/executors/base.js#L83), [base.js#L420](../../../open-sse/executors/base.js#L420), [base.js#L621](../../../open-sse/executors/base.js#L621)), and chat OAuth refresh via [refreshAndUpdateCredentials](../../../src/shared/services/providerCredentials.js#L285) / `callerWait` ([providerCredentials.js#L98-L130](../../../src/shared/services/providerCredentials.js#L98-L130)) propagates `signal` from [credentials.js#L183-L192](../../../src/sse/handlers/chat/singleModel/credentials.js#L183-L192), [dispatch.js#L125-L135](../../../src/sse/handlers/chat/singleModel/dispatch.js#L125-L135), and [chatCore.js#L1734-L1740](../../../open-sse/handlers/chatCore.js#L1734-L1740) while detaching background persistence. However, [tokenRefresh.js#L445-L454](../../../open-sse/services/tokenRefresh.js#L445-L454) (`refreshWithRetry`) accepts no `signal` and sleeps via uninterruptible `setTimeout`, [mediaRefresh.js#L14-L19](../../../open-sse/handlers/mediaRefresh.js#L14-L19) (`refreshMediaCredentials`, called by [imageGenerationCore.js#L118](../../../open-sse/handlers/imageGenerationCore.js#L118) and [embeddingsCore.js#L116](../../../open-sse/handlers/embeddingsCore.js#L116)) omits `signal`, standalone [chatCore.js#L1741](../../../open-sse/handlers/chatCore.js#L1741) falls back to `executor.refreshCredentials(credentials, log, proxyOptions)` without abort racing, and [src/sse/services/tokenRefresh.js#L244](../../../src/sse/services/tokenRefresh.js#L244) (`checkAndRefreshToken`) takes no `signal`. Upstream's `quotaSharePreHook` and `tokenRefresh/circuitBreaker` abstractions do not exist locally, and overlap with open local PR #2633 requires verification before implementation. Queued as unit `parity-abort-refresh-scope`. |
| [#21426](https://github.com/cheaper-inference/OmniRoute/pull/21426) | `0e9de9d529554344f3c1dfd6083e8115355476e0` | fix(sse): add the remaining sourced recurring quotas for existing providers | provider catalog / quotas | **candidate (verified bounded gap)**: adds published recurring free-tier allowances for existing providers (MegaNova, Free.ai, Kenari, and Aion card-gated daily allowance). Upstream edits `open-sse/config/freeModelCatalog.data.ts`, `freeTierCatalog.ts`, `aion/index.ts`, and `gateways.ts`; locally `freeTierCatalog.js` and `src/shared/constants/providers/apikey/gateways.js` do not exist, and the responsible files are [freeModelCatalog.data.js](../../../open-sse/config/freeModelCatalog.data.js), [freeModelCatalog.js](../../../open-sse/config/freeModelCatalog.js), and the provider registry entries ([meganova-ai.js](../../../open-sse/providers/registry/meganova-ai.js), [free-ai.js](../../../open-sse/providers/registry/free-ai.js), [kenari.js](../../../open-sse/providers/registry/kenari.js), [aion.js](../../../open-sse/providers/registry/aion.js)). Queued as unit `parity-free-catalog-recurring-allowances`. |
| [#21425](https://github.com/cheaper-inference/OmniRoute/pull/21425) | `dddd4064620e452c1bcee4dc681fcf37a4cebd5a` | fix(catalog): keep LLM7's last published quota in the retired ledger | provider catalog / retired | **candidate (verified bounded gap)**: tracks LLM7's last published quota (100k tokens/day, 3M/month) in `open-sse/config/freeModelCatalog.retired.data.ts` so historical row-sum accounting captures ended LLM7 offers. Queued as unit `parity-retired-free-catalog-llm7`. |

#### Closed OmniRoute PRs (2)

| PR | Last observed head SHA | Title | Status / reason |
| --- | --- | --- | --- |
| [#21036](https://github.com/cheaper-inference/OmniRoute/pull/21036) | `23a068f0b61bf9206fab7d45c2f25434fb6dcfc9` | fix(security,ci): harden Bun lockfile, pin CI/build tools, block high advisories, and close secret-scan gaps (#21014) | Closed upstream; out of lane (security/CI tooling, Bun lockfile). |
| [#20848](https://github.com/cheaper-inference/OmniRoute/pull/20848) | `765122cc1c379ecb347770d36f94b9103d335674` | fix(ci): restore the original CodeQL alert ceiling | Closed upstream; out of lane (CI CodeQL alert baseline). |

#### Changed OmniRoute PR heads (8)

| PR | New head SHA | Prior census head | Title | Domain / Disposition |
| --- | --- | --- | --- | --- |
| [#21422](https://github.com/cheaper-inference/OmniRoute/pull/21422) | `0f6b0b9fb04fefaa670c682b0ad86f908f647626` | `eac6f4d62956064d7ddf8d3c37f380030c522799` | feat(antigravity): add unsuffixed models for Claude Code effort | **reserved Review-lane claim**: overlaps with active local PR [#2678](https://github.com/bloodf/durindoor/pull/2678) / issues #2640 and #2676 (`fix(thinking): respect synced Claude effort settings`). Excluded from sync intake. |
| [#21349](https://github.com/cheaper-inference/OmniRoute/pull/21349) | `b3ea831f1b9a2ddb5fc809f026d79cc49a932b02` | `780e88e9245dc95271f9b7daf06170474367d956` | fix(sse): return 404 model_not_found for unknown models on inference routes (KEA-9627) | **candidate (verified bounded gap)**: [open-sse/config/errorConfig.js#L21](../../../open-sse/config/errorConfig.js#L21) maps HTTP 404 to `model_not_found` and [chat.js#L56-L59](../../../src/sse/handlers/chat.js#L56-L59) rejects schema-invalid payloads as 400, but that does not prove local unknown-model inference-route parity. When `getModelInfo(modelStr)` resolves no provider (e.g., an unknown bare model ID that is not a combo), [combo.js#L497-L498](../../../src/sse/handlers/chat/combo.js#L497-L498) returns HTTP 400 `"Invalid model format"` rather than HTTP 404 `model_not_found` (only explicit `unknown-provider/model` reaches 404 at [credentials.js#L80-L83](../../../src/sse/handlers/chat/singleModel/credentials.js#L80-L83)). Other inference handlers share the same 400 branch when `!modelInfo.provider`: [stt.js#L101-L102](../../../src/sse/handlers/stt.js#L101-L102), [tts.js#L127-L128](../../../src/sse/handlers/tts.js#L127-L128), [systemone.js#L96-L99](../../../src/sse/handlers/systemone.js#L96-L99), and [media/pipeline.js#L62-L63](../../../src/sse/handlers/media/pipeline.js#L62-L63). Queued as bounded unit `parity-unknown-model-404`. |
| [#21301](https://github.com/cheaper-inference/OmniRoute/pull/21301) | `a84ae4da81dfea08bee13dad772395d7a359ff13` | `988db478634b2d5174053959b214942bb0a7f9fe` | chore(quality): add the live-mode merge-train rule to the merge-gates template | **out of lane**: CI / quality templates for merge-train automation; no gateway or provider effect. |
| [#21300](https://github.com/cheaper-inference/OmniRoute/pull/21300) | `13df89f5ebc4775f559a3226c2f6f5c86ba49d7a` | `f785930c07ff123fbd73f04b063332cecb256241` | chore(release): credit each member of a merge train landed by omni-queue | **out of lane**: release tooling and contributor credit automation. |
| [#21264](https://github.com/cheaper-inference/OmniRoute/pull/21264) | `51558aa1c1be4df6267874b91703051e320134e2` | `29532e772ecce08b898701212419ac9ea728ed87` | docs(readme): dark-theme polish to match the site's use of the kit palette | **out of lane**: README SVG palette styling. |
| [#21159](https://github.com/cheaper-inference/OmniRoute/pull/21159) | `d69ffaa22b48f70ce05b57a898efae0a8c5cf444` | `a0c75e54f06d23bd673eae30e8ffe5efafc2552d` | db: release an exclusive SQLite lock by closing the holder | **out of lane**: database transaction locking; DurinDoor uses isolated SQLite / Postgres adapters without this holder abstraction. |
| [#20868](https://github.com/cheaper-inference/OmniRoute/pull/20868) | `855a147a41572b7d3f526c95e99185c8c813b5c0` | `72e2a448da7e14f2e936261a5d4723ad37c509e4` | docs(i18n): refresh drifted mirrors (scheduled) | **out of lane**: scheduled translation mirror synchronization. |
| [#19713](https://github.com/cheaper-inference/OmniRoute/pull/19713) | `a53da31f949a63cf18fb18e7f1719150fd84efbf` | `45937d8cd82a4ed2bafbcdd4f5b55c16ffaf8584` | fix: stream utils: 5 fixes | **already present / not applicable**: non-SSE keepalive body reading deadline and reader cancellation already exist in [open-sse/utils/earlyStreamKeepalive.js#L308](../../../open-sse/utils/earlyStreamKeepalive.js#L308) (`readBoundedText(upstreamReader, bodyTimeoutMs)`) and line 352 (`upstreamReader?.cancel().catch(() => {})`); other 4 fixes touch OmniRoute-only sinks (`sseOutputSink`, `streamReadiness`, `streamFailureBoundary`, `usageEstimation`). |

## Landed PR #2686 verification and ledger update

Local PR [#2686](https://github.com/bloodf/durindoor/pull/2686) was squashed and merged into `bloodf/durindoor:main` on 2026-11-27 at 14:00:10 UTC.

- **Merge commit**: `f7514b9ba3d0b341e0b5b422486049cf4f851a17`
- **Merge base**: `a6cb6dea80a4a769dea77208975d24b0d6e40412` (from #2687)
- **Tested integration head**: `80eed7dbed1214de2e4f393d0b81bbdb90f72b65`
- **Independent CI gates**: 76/76 checks passed on the integration head against base `a6cb6dea80a4`
- **Cross-family review**: NO FINDINGS verdict recorded on PR #2686 by independent review

### Implemented scope and source link

1. **OmniRoute [#21417](https://github.com/cheaper-inference/OmniRoute/pull/21417)** (`6e31eb343273b8a2913424089d0c1469c42d937e`):
   - Scope: Normalized Responses agent messages (plaintext tasks and replies) as user turns with `[Agent message from AUTHOR to RECIPIENT]` provenance at the Chat translation boundary (`normalizeResponsesInputForChat` in [responsesApi.js](../../../open-sse/translator/formats/responsesApi.js) and `convertResponsesApiFormat` in [openai-responses.js](../../../open-sse/translator/request/openai-responses.js)).
   - Native executor isolation: Preserved native Responses items and role-based normalization in Codex, OpenCode, and Grok CLI executors without user-turn flattening.
   - Regression tests: [parity-agent-message-input.test.js](../../../tests/unit/parity-agent-message-input.test.js) and [parity-agent-native-executors.test.js](../../../tests/unit/parity-agent-native-executors.test.js). Report: [parity-agent-message-input.md](parity-agent-message-input.md).

2. **OmniRoute [#21406](https://github.com/cheaper-inference/OmniRoute/pull/21406)** (`6dae88bfe2b38403a86454c704f2adcedc5cb4f3`):
   - Scope: Credential-isolated, per-window Claude OAuth response quota-header observations (`5h`, `7d`, `7d_oi` with 15-minute observation TTL) in [base.js](../../../open-sse/executors/base.js#L500) and read-time overlay in `getClaudeUsage` ([claude.js](../../../open-sse/services/usage/claude.js)).
   - Contract hardening: Returned usable fresh observation table without blocking rate-limit message during usage endpoint 429 cold-starts, while preserving escalating cooldowns and endpoint polling strikes.
   - Regression tests: [claude-usage-response-headers.test.js](../../../tests/unit/claude-usage-response-headers.test.js) (16 tests). Report: [parity-claude-quota-headers.md](parity-claude-quota-headers.md).

3. **9router [#5904](https://github.com/decolua/9router/pull/5904)** (`b2b7ce1c6f9437ea344c9e05d1cd743d79892eea`):
   - Scope: Accepted top-level `cache_creation_tokens` alias for streamed shared usage normalization in [usageTracking.js](../../../open-sse/utils/usageTracking.js) and OpenAI-to-Claude conversion in [openai-to-claude.js](../../../open-sse/translator/response/openai-to-claude.js), preserving canonical fields and explicit zero.
   - Regression tests: [parity-stream-cache-creation-alias.test.js](../../../tests/unit/parity-stream-cache-creation-alias.test.js). Report: [parity-stream-cache-creation-alias.md](parity-stream-cache-creation-alias.md).

### Implemented follow-up units from #2686 (awaiting PR and full validation)

Both deferred follow-ups from #2686 are implemented on the reviewed integration head `a9a5deb4f2a30f152cad747e8cb7123261e417fb` (over base `f7514b9ba3d0b341e0b5b422486049cf4f851a17`) and removed from the remaining unimplemented backlog below:

1. **`parity-nonstreaming-responses-cache-alias`** — **implemented** in `eb13a16128faecc3b247ad51ee05fedefe70e4ce` (`fix(usage): retain cache creation alias through response extraction`), awaiting PR creation and full local CI validation:
   - Scope: Accepts top-level finite nonnegative `cache_creation_tokens` in non-streaming Chat/Responses JSON extraction and Responses SSE event extraction in [usageTracking.js](../../../open-sse/utils/usageTracking.js), preserving canonical precedence and explicit zero.
   - Regression tests and report: [provider-usage-alias-extraction.test.js](../../../tests/unit/provider-usage-alias-extraction.test.js) and [parity-provider-usage-alias-extraction.md](parity-provider-usage-alias-extraction.md).

2. **`parity-claude-fable-precedence-reset`** — **implemented** in `da15a3ae5c65f8e588628bc33333d4629cfddb9a` (`fix(claude): reconcile observed quota freshness and reset invalidation`), awaiting PR creation and full local CI validation:
   - Scope (Claude-only): Reconciles matching-window (`5h`, `7d`, `7d_oi`) observation freshness precedence over older endpoint cached rows (removing permanent endpoint Fable precedence) and invalidates cached rows and observations only on `res.ok && data.result === "reset"` in [claude.js](../../../open-sse/services/usage/claude.js). Non-streaming/Responses alias accounting belongs solely to `eb13a16128faecc3b247ad51ee05fedefe70e4ce`, not this Claude-only scope.
   - Regression tests and report: [claude-usage-response-headers.test.js](../../../tests/unit/claude-usage-response-headers.test.js) and [parity-claude-observation-consistency.md](parity-claude-observation-consistency.md).

Independent review of `a9a5deb4f2a30f152cad747e8cb7123261e417fb` against base `f7514b9ba3d0b341e0b5b422486049cf4f851a17` verified that the implementation code is correct and tests were not weakened (130 passing assertions on the reviewed head; base source produces 17 failures on the same assertions). Full local CI and PR merge gates remain pending.

## Reserved Review-lane claims and active local PRs

Per coordinator policy and plan decisions, do not propose work or duplicate implementation for the following reserved Review-lane PRs and issues:

| Local PR | Issue(s) | Active reserved scope |
| --- | --- | --- |
| [#2672](https://github.com/bloodf/durindoor/pull/2672) | #2642 | port(omniroute): add TrustedRouter provider |
| [#2673](https://github.com/bloodf/durindoor/pull/2673) | #2638 | port(omniroute): fix Cursor proxy IP handling |
| [#2674](https://github.com/bloodf/durindoor/pull/2674) | #2639 | port(omniroute): update Liquid AI endpoint and catalog |
| [#2675](https://github.com/bloodf/durindoor/pull/2675) | #2644 | port(omniroute): add Liquid System One decisions |
| [#2677](https://github.com/bloodf/durindoor/pull/2677) | #2637 | port(omniroute): include OpenRouter decision models |
| [#2678](https://github.com/bloodf/durindoor/pull/2678) | #2640, #2676 | fix(thinking): respect synced Claude effort settings |
| [#2668](https://github.com/bloodf/durindoor/pull/2668) | #2641 | fix(auto): skip unavailable Devin CLI candidates |
| [#2635](https://github.com/bloodf/durindoor/pull/2635) | #2626 | fix: retain reasoning for unlisted OpenAI models |
| [#2680](https://github.com/bloodf/durindoor/pull/2680) | #2648 | fix(thinking): reject reasoning on none-only models |
| [#2683](https://github.com/bloodf/durindoor/pull/2683) | #2684 | fix(ci): tighten browser checkpoint isolation |
| — | #2661 | reserved review lane claim |

### Active open local PRs snapshot

Inspected via `gh api repos/bloodf/durindoor/pulls?state=open` at 14:20 UTC (17 open PRs):

1. **#2689** (`dcf41df94a29002570f8f6d904f457534efe1b8c`): feat(providers): enable Fal and KIE media, preserve auth contracts
2. **#2688** (`bdb60a60b3fd84975ea9ee7ef74de19fe54b1783`): refactor: architecture review part 2 for streams, executors and catalogs
3. **#2683** (`5e0420fec70e36950849b6b3999133caf60d36e8`): fix(ci): tighten browser checkpoint isolation
4. **#2680** (`c0c03bf6ac0146b49f15dd7208074311441cbeb8`): fix(thinking): reject reasoning on none-only models
5. **#2678** (`8be9333422f2e481045e13a003f604d5d6db09c0`): fix(thinking): respect synced Claude effort settings
6. **#2677** (`cd4f8b003da76bdcc2efc28f096be15ac32fb640`): port(omniroute): include OpenRouter decision models
7. **#2675** (`997d8f1c40932511f98fbf860768c1bcd6d6c452`): port(omniroute): add Liquid System One decisions
8. **#2674** (`603cc01ebbc752a289d33ddf297ff54252a1f04b`): port(omniroute): update Liquid AI endpoint and catalog
9. **#2673** (`3eef88f3d43996e34b03764a803f461be25fe587`): port(omniroute): fix Cursor proxy IP handling
10. **#2672** (`0e789ef84ecc6a782631e151f94ca150435f4b8c`): port(omniroute): add TrustedRouter provider
11. **#2670** (`49486009b98290cfc3079c577e3d73df9e545cdb`): fix(image): handle cancellation while reading edit responses
12. **#2668** (`b87878891e9ca0329d7ab68dc07cac6997b24ecf`): fix(auto): skip unavailable Devin CLI candidates
13. **#2663** (`a9ef0958563372b3263ab7567f0b91c926f9409c`): fix(ci): harden browser test discovery
14. **#2635** (`e67cde3bad28c38fcbd5c07100f959a845ff0747`): fix: retain reasoning for unlisted OpenAI models
15. **#2633** (`11de5827d1ebc79b31707da39df86e3294d86480`): fix: propagate client cancellation through media and Gemini
16. **#2632** (`8f472d883efd894dc0fe0d116e2b5ed0b973e9f7`): docs: regenerate provider catalog model counts
17. **#2627** (`f339a2575870d4ae462e36c2f5f1cda4951fb1a7`): fix: resolve upstream port review findings

No proposed work duplicates any reserved Review-lane claim; candidate unit `parity-abort-refresh-scope` requires explicit overlap verification against open PR #2633 before any implementation.

## Actionable remaining provider/connection port units

At most 8 (exactly 6: 4 verified bounded gaps and 2 candidates needing scope verification) remaining unimplemented units are listed below with exact source heads, verified scope boundaries, and `test -e`-verified owned local files. The two #2686 follow-ups (`eb13a16128faecc3b247ad51ee05fedefe70e4ce` and `da15a3ae5c65f8e588628bc33333d4629cfddb9a`) are already implemented on the integration branch and are excluded from this remaining count and table.

| Unit | Exact source head | Status / scope boundary | Verified owned local files | Acceptance boundary |
| --- | --- | --- | --- | --- |
| `parity-cache-ttl` | 9router [#5884](https://github.com/decolua/9router/pull/5884) `d363dd0365d6ba523d97dead76180e5127d05cbb` | **verified bounded gap**: operator-configurable `claudeCacheTtl` setting and `CLAUDE_CACHE_TTL` default in gateway config. Preserving client 1h cache marker is partial parity; upstream adds operator default conversation TTL. | `open-sse/translator/formats/claude.js`, `open-sse/config/runtimeConfig.js`, `open-sse/handlers/chatCore.js`, `src/sse/handlers/chat.js` | Preserve explicit client markers; define env/settings precedence; test passthrough and translated paths. |
| `parity-unknown-model-404` | OmniRoute [#21349](https://github.com/cheaper-inference/OmniRoute/pull/21349) `b3ea831f1b9a2ddb5fc809f026d79cc49a932b02` | **verified bounded gap**: unknown bare models on inference routes currently return HTTP 400 `"Invalid model format"` at `src/sse/handlers/chat/combo.js#L497-L498` (chat/messages/responses) and equivalents in `src/sse/handlers/stt.js#L101-L102`, `src/sse/handlers/tts.js#L127-L128`, `src/sse/handlers/systemone.js#L96-L99`, and `src/sse/handlers/media/pipeline.js#L62-L63`, instead of HTTP 404 `model_not_found`. | `src/sse/handlers/chat/combo.js`, `src/sse/handlers/chat/singleModel/resolveModel.js`, `src/sse/handlers/stt.js`, `src/sse/handlers/tts.js`, `src/sse/handlers/systemone.js`, `src/sse/handlers/media/pipeline.js`, `open-sse/config/errorConfig.js` | Return 404 `model_not_found` for unknown models on chat/messages/responses with zero upstream calls; keep 400 for schema/malformed payloads; keep combo fallback non-cooling; confirm scope for `stt.js`/`tts.js`/`pipeline.js` before changing non-chat contracts. |
| `parity-abort-refresh-scope` | OmniRoute [#21427](https://github.com/cheaper-inference/OmniRoute/pull/21427) `af7b59d871fc3ac6ed2f69c410fe5db644eded0f` | **candidate (needs scope verification)**: `BaseExecutor` and `refreshAndUpdateCredentials` (`callerWait`) handle abort on chat OAuth refresh, but `refreshWithRetry` (`tokenRefresh.js#L445-L454`) uses uninterruptible `setTimeout`, `mediaRefresh.js#L14-L19` omits `signal`, standalone `chatCore.js#L1741` does not race `executor.refreshCredentials` against abort, and `src/sse/services/tokenRefresh.js#L244` (`checkAndRefreshToken`) takes no `signal`. Verify overlap with open PR #2633 before implementation. | `open-sse/services/tokenRefresh.js`, `open-sse/handlers/mediaRefresh.js`, `open-sse/handlers/chatCore.js`, `open-sse/handlers/imageGenerationCore.js`, `open-sse/handlers/embeddingsCore.js`, `src/sse/services/tokenRefresh.js`, `src/shared/services/providerCredentials.js` | Confirm exact non-overlapping scope with PR #2633; make `refreshWithRetry` backoff and refresh calls abort-aware while detaching in-flight OAuth persistence safely; add offline abort regression tests. |
| `parity-free-catalog-recurring-allowances` | OmniRoute [#21426](https://github.com/cheaper-inference/OmniRoute/pull/21426) `0e9de9d529554344f3c1dfd6083e8115355476e0` & [#21412](https://github.com/cheaper-inference/OmniRoute/pull/21412) `69316eceb73f4192d237e8c323ba1277ceeb57bf` | **verified bounded gap**: add published recurring free-tier allowances and updated provider notices for existing providers (MegaNova, Free.ai, Kenari, and Aion card-gated daily allowance). Replaces non-existent upstream paths `freeTierCatalog.js` and `src/shared/constants/providers/apikey/gateways.js` with local owners. | `open-sse/config/freeModelCatalog.data.js`, `open-sse/config/freeModelCatalog.js`, `open-sse/providers/registry/meganova-ai.js`, `open-sse/providers/registry/free-ai.js`, `open-sse/providers/registry/kenari.js`, `open-sse/providers/registry/aion.js`, `docs/providers/free-and-local.mdx` | Update recurring token/request allowances and provider notices; run free-catalog consistency tests; no external network requests. |
| `parity-retired-free-catalog-llm7` | OmniRoute [#21425](https://github.com/cheaper-inference/OmniRoute/pull/21425) `dddd4064620e452c1bcee4dc681fcf37a4cebd5a` | **verified bounded gap**: add LLM7 last published free quota (100k tokens/day, 3M/month) to `RETIRED_FREE_ROWS` in retired catalog data for row-sum historical counting. | `open-sse/config/freeModelCatalog.retired.data.js`, `open-sse/config/freeModelCatalog.js`, `open-sse/config/freeModelCatalog.data.js` | Row-sum test verification; keep entries zeroed in active catalog; maintain evidence metadata. |
| `parity-spend-observability-review` | 9router [#5906](https://github.com/decolua/9router/pull/5906) `409f7623346382a3d544d0f32bf559d409e7a3fe` | **candidate (needs scope verification)**: reopen review of pricing fallback presentation and connection metrics hooks against DurinDoor's existing `apiKeyLimits.js` and `apiKeyPolicy.js`. | `open-sse/providers/pricing.js`, `open-sse/handlers/chatCore/requestDetail.js`, `open-sse/handlers/chatCore.js` | Confirm whether pricing fallback presentation requires local adaptation or remains fully out of lane. |

## Verification and execution evidence

### Initial snapshot check (`83eca11dffc0aa32eae7a3ad0b27d06efef38e89`)

Executed from `tests/` using credential-free environment with private temporary directories:

```sh
test -s internal/docs/port-reports/1072-1073-nov27-post-2686-provider-refresh.md && cd tests && timeout 300 node node_modules/vitest/vitest.mjs run unit/upstream-intake-ledger.test.js --maxWorkers=2
```

Result: **1 file passed, 33 tests passed, 0 failures**.

### Post-review docs-only correction checks

- Verified git history of `a9a5deb4f2a30f152cad747e8cb7123261e417fb` over base `f7514b9ba3d0b341e0b5b422486049cf4f851a17`, including `eb13a16128faecc3b247ad51ee05fedefe70e4ce` and `da15a3ae5c65f8e588628bc33333d4629cfddb9a`.
- Verified every owned file path in the remaining units table with `test -e` (confirming `open-sse/config/freeTierCatalog.js` and `src/shared/constants/providers/apikey/gateways.js` do not exist locally and replacing them with actual responsible files).
- Verified all repository-relative Markdown links from `internal/docs/port-reports/`: the directory is 3 levels below the repository root (`internal/docs/port-reports` -> `../../../`), so every `../../../` link resolves to an existing repository file (`../../../../` would resolve outside the repository root).
- Verified `git diff --check` is clean and only `internal/docs/port-reports/1072-1073-nov27-post-2686-provider-refresh.md` is modified. No product code, test files, full suite/build, GitHub writes, or live provider calls were executed in this correction.
