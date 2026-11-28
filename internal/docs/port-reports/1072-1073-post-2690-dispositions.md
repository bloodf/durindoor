# Provider and connection intake refresh post-#2690, November 27, 2026

Status: DONE for provider/connection intake refresh, #2690 landing ledger, and post-integration branch status. Documentation-only update; no product or test code modified. This report tracks bounded provider/connection intake items only and makes no global parity claim.

## Snapshot and coverage

Sequential read-only GitHub REST snapshots completed on 2026-11-27 between 15:56 and 15:58 UTC. Upstream sources are `decolua/9router` and `cheaper-inference/OmniRoute` (redirected from `diegosouzapw/OmniRoute`). The local repository is `bloodf/durindoor`.

- **Local base (`origin/main`, `origin/HEAD`)**: `29490b783e83176d4d6a4162f76ee3dc79db66ea` (`fix(usage): reconcile observed quotas and cache creation aliases (#2690)`).
- **Current integration head**: `29d143ee80e22e70508da63d8253e750b71753dc` (merges `84dfb5a15f546aef436f97aa75f170cdf0bbe786`, `22048f71188a9966e5a0cc062b11ad6dd003af76`, `29490b783e83176d4d6a4162f76ee3dc79db66ea`, `d3b2c176f365afabcd831a5b54bb3b12adac6edc` onto `origin/main`).
- **Target scope**: records landed PR #2690 ledger, integrated candidate batch `29d143ee80e22e70508da63d8253e750b71753dc`, running bounded units (`parity-unknown-model-404` and `parity-abort-refresh-scope`), closed out-of-lane review (#5906), and upstream live deltas.

### Pinned baseline comparison

| Source | Default branch | Pinned census head | Observed live head | Commit time (UTC) | Status / delta commits | Open PRs |
| --- | --- | --- | --- | --- | --- | ---: |
| decolua/9router | master | `5ae63d22847e07042e235b40e1d926b65e509013` | `5ae63d22847e07042e235b40e1d926b65e509013` | 2026-11-23T02:13:33Z | identical (0 commits ahead) | 1,375 |
| cheaper-inference/OmniRoute | release/v3.8.55 | `c71f0065a7efe9230ec23b96a12253b050c4d7ad` | `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523` | 2026-11-27T14:40:38Z | 2 merge-train commits ahead | 634 |

Total open upstream PRs across both repositories: **2,009** (1,375 in 9router + 634 in OmniRoute).

### Delta against pinned census

- **decolua/9router**: 1,375 live open PRs. Exactly matches census rows `90001` through `91375` in [2026-11-27-full-parity-refresh.md](2026-11-27-full-parity-refresh.md#decolua9router). Zero new PRs, zero changed heads, zero closed PRs. Newest open PR remains [#5906](https://github.com/decolua/9router/pull/5906) (`409f7623346382a3d544d0f32bf559d409e7a3fe`).
- **cheaper-inference/OmniRoute**: 634 live open PRs. Live head moved to `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523` via Omni-Queue merge train batches b66 & b67 (PR [#21360](https://github.com/cheaper-inference/OmniRoute/pull/21360) `44812b66fdff9e420d92aee4645a61546fe89f43` catalog drift probes, and PR [#21331](https://github.com/cheaper-inference/OmniRoute/pull/21331) `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523` docs version checks). Neither commit modifies gateway runtime, executor routing, or translator logic. Unchanged defaults on 9router and non-runtime commits on OmniRoute do **NOT** imply complete parity.
- **New upstream OmniRoute PRs inspected**:
  - [#21436](https://github.com/cheaper-inference/OmniRoute/pull/21436) (`6a154fec4aa9e1e20aab544ba62573b366fbfe57`): `fix(api): keep the system API key secret out of downloadable backups (KEA-9523)` — out of lane (backup credential hygiene).
  - [#21435](https://github.com/cheaper-inference/OmniRoute/pull/21435) (`3bf2bcf3b4ad9c5540d4acbdb6be516b80dfd349`): `fix(sse): align existing providers with their current free quotas and model lists` — provider catalog / free quotas.
  - [#21434](https://github.com/cheaper-inference/OmniRoute/pull/21434) (`ccff9d79db3fa3f49453269844404a104c0c3870`): `chore(release): diegosouzapw-queued train of 13 PRs for v3.8.55` — release automation.
  - [#21433](https://github.com/cheaper-inference/OmniRoute/pull/21433) (`51315bea24c743dea91f604a5b74828ddedbcea1`): `feat: three-state model visibility (visible / combos_only / hidden)` — model visibility feature.
  - [#21432](https://github.com/cheaper-inference/OmniRoute/pull/21432) (`8f2d9f4c37b5f81ad82291dfffaf6e0882ee1946`): `fix(sse): drop signup credits the providers no longer publish` — provider catalog / credits.
  - [#21431](https://github.com/cheaper-inference/OmniRoute/pull/21431) (`a86ed0200c736bc546f310ac703929806528f8ce`): `fix(middleware): load persisted pre-request hooks at startup and registry init` — middleware lifecycle.
  - [#21428](https://github.com/cheaper-inference/OmniRoute/pull/21428) (`6042543264c15f2ca1a22b6d91ded459b1feb519`): `chore(release): diegosouzapw-all train of 26 PRs for v3.8.55` — release automation.
- **Changed OmniRoute candidate PR heads**:
  - [#21427](https://github.com/cheaper-inference/OmniRoute/pull/21427): head updated to `ac29c6493b2f2cb8c01f4a0d5cb8c27aee371aa6` (earlier pin `af7b59d871fc3ac6ed2f69c410fe5db644eded0f`).
  - [#21426](https://github.com/cheaper-inference/OmniRoute/pull/21426): head updated to `df378e84fdbd5f4a6a4dad2da210f70f0110c21b` (earlier pin `0e9de9d529554344f3c1dfd6083e8115355476e0`).
  - [#21412](https://github.com/cheaper-inference/OmniRoute/pull/21412): head updated to `ab0046f2ba9f78c4aff88d22c1d27b186860f41b` (earlier pin `69316eceb73f4192d237e8c323ba1277ceeb57bf`).
  - [#21425](https://github.com/cheaper-inference/OmniRoute/pull/21425): unchanged at `dddd4064620e452c1bcee4dc681fcf37a4cebd5a`.
  - [#21349](https://github.com/cheaper-inference/OmniRoute/pull/21349): unchanged at `b3ea831f1b9a2ddb5fc809f026d79cc49a932b02`.

---

## 1. Landed PR #2690 verification and ledger update

Local PR [#2690](https://github.com/bloodf/durindoor/pull/2690) was squashed and merged into `bloodf/durindoor:main` on 2026-11-27 at 12:44:41 -0300 (15:44:41 UTC).

- **Merge commit**: `29490b783e83176d4d6a4162f76ee3dc79db66ea`
- **Merge base**: `e183a6945892866e518309161b22db09107d88dd` (from PR [#2663](https://github.com/bloodf/durindoor/pull/2663) `fix(ci): harden browser test discovery`)
- **Tested integration head**: `97c5b58b6f6f9ba5251c3bf79973b5c871c1c40e`
- **Landed scope (bounded usage/quota followups from #2686)**:
  1. 9router [#5904](https://github.com/decolua/9router/pull/5904) (`b2b7ce1c6f9437ea344c9e05d1cd743d79892eea`):
     - `parity-nonstreaming-responses-cache-alias`: commit `eb13a16128faecc3b247ad51ee05fedefe70e4ce` (`fix(usage): retain cache creation alias through response extraction`) and `b9cee522ad729b59c6c6b3536116569f3baf9177` (`fix(usage): fall back to creation alias for null canonical usage`).
     - Accepts top-level `cache_creation_tokens` alias in non-streaming Chat/Responses JSON extraction and Responses SSE event extraction in [open-sse/utils/usageTracking.js](../../../open-sse/utils/usageTracking.js), preserving canonical precedence, explicit zero, and falling back to creation alias for null canonical usage.
     - Tests: [tests/unit/provider-usage-alias-extraction.test.js](../../../tests/unit/provider-usage-alias-extraction.test.js). Report: [parity-provider-usage-alias-extraction.md](parity-provider-usage-alias-extraction.md).
  2. OmniRoute [#21406](https://github.com/cheaper-inference/OmniRoute/pull/21406) (`6dae88bfe2b38403a86454c704f2adcedc5cb4f3`):
     - `parity-claude-fable-precedence-reset`: commit `da15a3ae5c65f8e588628bc33333d4629cfddb9a` (`fix(claude): reconcile observed quota freshness and reset invalidation`).
     - Reconciles matching-window (`5h`, `7d`, `7d_oi`) observation freshness precedence over older endpoint cached rows (removing permanent endpoint Fable precedence) and invalidates cached rows and observations only on `res.ok && data.result === "reset"` in [open-sse/services/usage/claude.js](../../../open-sse/services/usage/claude.js).
     - Tests: [tests/unit/claude-usage-response-headers.test.js](../../../tests/unit/claude-usage-response-headers.test.js). Report: [parity-claude-observation-consistency.md](parity-claude-observation-consistency.md).
- **Independent CI gates and review verdicts**:
  - Independent clean base 76/76 receipt: `/var/tmp/dddiag-LeVoMH/out/evidence.json`, sha256 `fbdaeaae7a114f3edd07eb6471122421d0069f54dfe0e3c954c414e9e245ce40`.
  - Exact head cross-family verdict: **APPROVE** (409 targeted / 174 changed / base 29 failures).
  - Supplementary Cortex browser runner execution: encountered timeout on `tests/docs.spec.mjs:535:1 › tunnel packets animate within each track and stop for reduced motion` (test timeout 60000ms exceeded on `page.goto("/")`, call log `navigating to "http://127.0.0.1:44297/", waiting until "networkidle"`). This is **NOT PASS** and is reported separately as an advisory runner timeout, not a regression of the 76/76 gating clean base receipt.

---

## 2. Next batch integrated on `orq/tp5znk/integration` (`29d143ee80e22e70508da63d8253e750b71753dc`)

Integration commit `29d143ee80e22e70508da63d8253e750b71753dc` merges the next batch of scoped provider/connection work onto the integration branch. Status is **PENDING** independent review, full local CI gate, and PR creation. **NO CLAIM LANDED**.

Constituents integrated on `29d143ee80e22e70508da63d8253e750b71753dc`:

1. **`parity-exclusive-cache-alias`**:
   - Commits: `dac72fae503af4ee908154a6f92167b2ca9a0b7c` (`fix(usage): resolve creation aliases for exclusive cache reads`) and `22048f71188a9966e5a0cc062b11ad6dd003af76` (`fix(usage): exclude stale nested creation from exclusive accounting`).
   - Scope: Resolves creation aliases for exclusive cache reads in [open-sse/utils/usageTracking.js](../../../open-sse/utils/usageTracking.js). The gate correction excludes stale nested creation from exclusive accounting, ensuring canonical exclusive creation resolves only canonical creation, `cache_write_tokens`, and validated `cache_creation_tokens` without incorrectly folding nested details into exclusive Claude input.
   - Tests: [tests/unit/exclusive-cache-read-alias.test.js](../../../tests/unit/exclusive-cache-read-alias.test.js) (67 tests) and verified against 43 selected files (544 tests passing).
   - Report: [parity-provider-usage-alias-extraction.md](parity-provider-usage-alias-extraction.md).
2. **`parity-free-catalog-recurring-allowances`**:
   - Commit: `550402d4d7195a7264618da3236b6eca96adb776` (`port(omniroute): add sourced recurring provider allowances`).
   - Source pins: OmniRoute [#21426](https://github.com/cheaper-inference/OmniRoute/pull/21426) full pin `0e9de9d529554344f3c1dfd6083e8115355476e0` and [#21412](https://github.com/cheaper-inference/OmniRoute/pull/21412) full pin `69316eceb73f4192d237e8c323ba1277ceeb57bf`.
   - Scope: Adds published recurring free-tier allowances for existing providers (MegaNova: 50 req/day; Free.ai: 30k tokens/day, 1,000 req/mo; Kenari: 50 req/day; Aion: 20k tokens/day with card verification) in [open-sse/config/freeModelCatalog.data.js](../../../open-sse/config/freeModelCatalog.data.js). Shared pool keys preserve conservative aggregation.
   - Tests: [tests/unit/port-omniroute-recurring-allowances.test.js](../../../tests/unit/port-omniroute-recurring-allowances.test.js) (38 tests).
   - Report: [2026-11-27-recurring-retired-catalog.md](2026-11-27-recurring-retired-catalog.md).
   - Note on source drift: OmniRoute PR #21426 live head moved to `df378e84fdbd5f4a6a4dad2da210f70f0110c21b`; PR #21412 live head moved to `ab0046f2ba9f78c4aff88d22c1d27b186860f41b`. The local port strictly adheres to the evidenced pins `0e9de9d529554344f3c1dfd6083e8115355476e0` and `69316eceb73f4192d237e8c323ba1277ceeb57bf`.
3. **`parity-retired-free-catalog-llm7`**:
   - Commit: `d3b2c176f365afabcd831a5b54bb3b12adac6edc` (`port(omniroute): record LLM7 historical free quota`).
   - Source pin: OmniRoute [#21425](https://github.com/cheaper-inference/OmniRoute/pull/21425) full pin `dddd4064620e452c1bcee4dc681fcf37a4cebd5a`.
   - Scope: Records LLM7's last published free quota (100k tokens/day, 3M tokens/30 days) in [open-sse/config/freeModelCatalog.retired.data.js](../../../open-sse/config/freeModelCatalog.retired.data.js) so historical row-sum accounting captures ended offers. LLM7 remains discontinued and contributes no active capacity.
   - Tests: [tests/unit/port-omniroute-free-catalog-retired.test.js](../../../tests/unit/port-omniroute-free-catalog-retired.test.js).
   - Report: [2026-11-27-recurring-retired-catalog.md](2026-11-27-recurring-retired-catalog.md).
4. **`provider-next-gap-scope-nov27`**:
   - Commit: `84dfb5a15f546aef436f97aa75f170cdf0bbe786` (`docs(intake): resolve remaining provider gap scopes`).
   - Scope: Documents verified bounded implementation orders for remaining candidate units.
   - Report: [provider-next-gap-scope-nov27.md](provider-next-gap-scope-nov27.md).

---

## 3. Remaining candidate and bounded units disposition

| Unit | Exact source head | Status / execution state | Scope and local file ownership |
| --- | --- | --- | --- |
| `parity-unknown-model-404` | OmniRoute [#21349](https://github.com/cheaper-inference/OmniRoute/pull/21349) `b3ea831f1b9a2ddb5fc809f026d79cc49a932b02` | **RUNNING / ACTIVE BOUNDED UNIT** (`orq/tp5znk/unknown-model-inference-404-a1`) | Return HTTP 404 `model_not_found` for unknown bare models on `/v1/chat/completions`, `/v1/messages`, and `/v1/responses`, advancing combo fallback without cooling connections. Preserves 400 for malformed/ambiguous payloads and retains existing 400 on STT/TTS/Media routes. Files: [src/sse/handlers/chat/combo.js](../../../src/sse/handlers/chat/combo.js), [src/sse/handlers/chat/singleModel/resolveModel.js](../../../src/sse/handlers/chat/singleModel/resolveModel.js), [src/sse/handlers/chat/singleModel/credentials.js](../../../src/sse/handlers/chat/singleModel/credentials.js), [open-sse/config/errorConfig.js](../../../open-sse/config/errorConfig.js). |
| `parity-abort-refresh-scope` | OmniRoute [#21427](https://github.com/cheaper-inference/OmniRoute/pull/21427) (pinned `af7b59d871fc3ac6ed2f69c410fe5db644eded0f`; live head `ac29c6493b2f2cb8c01f4a0d5cb8c27aee371aa6`) | **RUNNING / ACTIVE BOUNDED UNIT** (`orq/tp5znk/abort-refresh-waits-a1`) | Propagate client cancellation signal to `refreshWithRetry` backoff delay sleeps and executor refresh calls while detaching background OAuth persistence. Excludes upstream-only `quotaSharePreHook` and `circuitBreaker`. Verified zero overlap with local PR [#2633](https://github.com/bloodf/durindoor/pull/2633). Files: [open-sse/services/tokenRefresh.js](../../../open-sse/services/tokenRefresh.js), [open-sse/services/tokenRefresh/cursor.js](../../../open-sse/services/tokenRefresh/cursor.js), [open-sse/handlers/mediaRefresh.js](../../../open-sse/handlers/mediaRefresh.js), [open-sse/handlers/chatCore.js](../../../open-sse/handlers/chatCore.js), [open-sse/executors/base.js](../../../open-sse/executors/base.js). |
| `parity-cache-ttl` | 9router [#5884](https://github.com/decolua/9router/pull/5884) `d363dd0365d6ba523d97dead76180e5127d05cbb` | **PENDING BOUNDED UNIT** | Operator-configurable Claude prompt-cache conversation TTL (`CLAUDE_CACHE_TTL` env, `claudeCacheTtl` setting), raising conversation message breakpoints to `1h` while preserving 1h system/tools head anchors and client markers. Files: [open-sse/config/runtimeConfig.js](../../../open-sse/config/runtimeConfig.js), [open-sse/translator/formats/claude.js](../../../open-sse/translator/formats/claude.js), [open-sse/handlers/chatCore.js](../../../open-sse/handlers/chatCore.js), [src/sse/handlers/chat.js](../../../src/sse/handlers/chat.js). |
| `parity-spend-observability-review` | 9router [#5906](https://github.com/decolua/9router/pull/5906) `409f7623346382a3d544d0f32bf559d409e7a3fe` | **CLOSED / ZERO REMAINING GAP** | Out-of-lane dashboard metrics / OpenTelemetry and API key spend limits. Per-key policy handled in [src/sse/services/apiKeyPolicy.js](../../../src/sse/services/apiKeyPolicy.js). [open-sse/providers/pricing.js](../../../open-sse/providers/pricing.js) already provides full pricing parity via `getPricingForModel`; `resolvePricing` returns match source solely for an unported dashboard price chip. Zero code changes authorized. |

### Reserved Review-lane claims and active local PRs

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
| — | #2661 | macOS platform claim |

### Active open local PRs snapshot

Inspected via `gh api repos/bloodf/durindoor/pulls?state=open` at 15:57 UTC (17 open PRs):

1. **#2692** (`c82c529ffcea55bae8216bd83a95afe7977892fc`): docs: remove duplicate OpenAI batch input limits section
2. **#2689** (`96492497944674d5f2da8f8bd9f062185dead112`): feat(providers): expand native media and session routing
3. **#2688** (`0ca01511f7b65a520490b9077bd09dc500e63199`): refactor: architecture review part 2 for streams, executors and catalogs (updated lock)
4. **#2683** (`5e0420fec70e36950849b6b3999133caf60d36e8`): fix(ci): tighten browser checkpoint isolation
5. **#2680** (`c0c03bf6ac0146b49f15dd7208074311441cbeb8`): fix(thinking): reject reasoning on none-only models
6. **#2678** (`8be9333422f2e481045e13a003f604d5d6db09c0`): fix(thinking): respect synced Claude effort settings
7. **#2677** (`cd4f8b003da76bdcc2efc28f096be15ac32fb640`): port(omniroute): include OpenRouter decision models
8. **#2675** (`997d8f1c40932511f98fbf860768c1bcd6d6c452`): port(omniroute): add Liquid System One decisions
9. **#2674** (`603cc01ebbc752a289d33ddf297ff54252a1f04b`): port(omniroute): update Liquid AI endpoint and catalog
10. **#2673** (`3eef88f3d43996e34b03764a803f461be25fe587`): port(omniroute): fix Cursor proxy IP handling
11. **#2672** (`0e789ef84ecc6a782631e151f94ca150435f4b8c`): port(omniroute): add TrustedRouter provider
12. **#2670** (`49486009b98290cfc3079c577e3d73df9e545cdb`): fix(image): handle cancellation while reading edit responses
13. **#2668** (`b87878891e9ca0329d7ab68dc07cac6997b24ecf`): fix(auto): skip unavailable Devin CLI candidates
14. **#2635** (`e67cde3bad28c38fcbd5c07100f959a845ff0747`): fix: retain reasoning for unlisted OpenAI models
15. **#2633** (`11de5827d1ebc79b31707da39df86e3294d86480`): fix: propagate client cancellation through media and Gemini
16. **#2632** (`8f472d883efd894dc0fe0d116e2b5ed0b973e9f7`): docs: regenerate provider catalog model counts
17. **#2627** (`e6aed9ddb640135b55664ebb5244e735ebf27620`): fix: resolve upstream port review findings

No proposed work duplicates any reserved Review-lane claim; local PR [#2688](https://github.com/bloodf/durindoor/pull/2688) has been updated to head `0ca01511f7b65a520490b9077bd09dc500e63199` and preserved as an active lock.

---

## 4. Ready-to-post issue disposition text sections

The following sections provide concise, formatted text ready to be posted to issues [#1072](https://github.com/bloodf/durindoor/issues/1072) and [#1073](https://github.com/bloodf/durindoor/issues/1073). No GitHub writes are performed.

### Ready-to-post update for Issue #1072 (9router)

```markdown
### Provider and connection intake disposition update (post-#2690)

- **Landed upstream port**:
  - [#5904](https://github.com/decolua/9router/pull/5904) (`b2b7ce1c6f9437ea344c9e05d1cd743d79892eea`): Landed in DurinDoor PR [#2690](https://github.com/bloodf/durindoor/pull/2690) (merge commit `29490b783e83176d4d6a4162f76ee3dc79db66ea` over base `e183a6945892866e518309161b22db09107d88dd`, tested head `97c5b58b6f6f9ba5251c3bf79973b5c871c1c40e`). Followup unit `parity-nonstreaming-responses-cache-alias` completed: extracts top-level `cache_creation_tokens` alias in non-streaming Chat/Responses and Responses SSE, falling back to creation alias for null canonical usage in `open-sse/utils/usageTracking.js`. Verification: clean base 76/76 receipt (`/var/tmp/dddiag-LeVoMH/out/evidence.json`, sha256 `fbdaeaae7a114f3edd07eb6471122421d0069f54dfe0e3c954c414e9e245ce40`), exact head APPROVE (409 targeted / 174 changed / base 29 failures). Supplementary Cortex browser runner timeout on tunnel packet animation is recorded separately as advisory NOT PASS.
- **Next batch on integration branch (`29d143ee80e22e70508da63d8253e750b71753dc`)**:
  - `parity-exclusive-cache-alias` (commits `dac72fae503af4ee908154a6f92167b2ca9a0b7c` and `22048f71188a9966e5a0cc062b11ad6dd003af76`): resolves creation aliases for exclusive cache reads in `open-sse/utils/usageTracking.js` and excludes stale nested creation from exclusive accounting (`tests/unit/exclusive-cache-read-alias.test.js`). Status: pending independent review / full CI / PR creation.
- **Remaining candidate units**:
  - [#5884](https://github.com/decolua/9router/pull/5884) (`d363dd0365d6ba523d97dead76180e5127d05cbb`): `parity-cache-ttl` pending bounded unit. Configurable Claude prompt-cache conversation TTL (`CLAUDE_CACHE_TTL` env / `claudeCacheTtl` setting), raising conversation message breakpoints to `1h` while preserving 1h system/tools head anchors and explicit client markers.
  - [#5906](https://github.com/decolua/9router/pull/5906) (`409f7623346382a3d544d0f32bf559d409e7a3fe`): `parity-spend-observability-review` closed with zero remaining gap. Out-of-lane dashboard metrics / OpenTelemetry and API key spend limits. `getPricingForModel` already provides pricing parity; `resolvePricing` is unused metadata for an unported dashboard price chip.
- **Upstream master status**:
  - `decolua/9router` master is unchanged at `5ae63d22847e07042e235b40e1d926b65e509013` (2026-11-23T02:13:33Z). Total open PRs remain 1,375. Unchanged master does not imply complete parity.
```

### Ready-to-post update for Issue #1073 (OmniRoute)

```markdown
### Provider and connection intake disposition update (post-#2690)

- **Landed upstream port**:
  - [#21406](https://github.com/cheaper-inference/OmniRoute/pull/21406) (`6dae88bfe2b38403a86454c704f2adcedc5cb4f3`): Landed in DurinDoor PR [#2690](https://github.com/bloodf/durindoor/pull/2690) (merge commit `29490b783e83176d4d6a4162f76ee3dc79db66ea` over base `e183a6945892866e518309161b22db09107d88dd`, tested head `97c5b58b6f6f9ba5251c3bf79973b5c871c1c40e`). Followup unit `parity-claude-fable-precedence-reset` completed: reconciles matching-window (`5h`, `7d`, `7d_oi`) observation freshness over older cached rows and invalidates cached rows and observations on `res.ok && data.result === "reset"` in `open-sse/services/usage/claude.js`. Verification: clean base 76/76 receipt (`/var/tmp/dddiag-LeVoMH/out/evidence.json`, sha256 `fbdaeaae7a114f3edd07eb6471122421d0069f54dfe0e3c954c414e9e245ce40`), exact head APPROVE (409 targeted / 174 changed / base 29 failures).
- **Next batch on integration branch (`29d143ee80e22e70508da63d8253e750b71753dc`)**:
  - [#21426](https://github.com/cheaper-inference/OmniRoute/pull/21426) (pin `0e9de9d529554344f3c1dfd6083e8115355476e0`) & [#21412](https://github.com/cheaper-inference/OmniRoute/pull/21412) (pin `69316eceb73f4192d237e8c323ba1277ceeb57bf`): `parity-free-catalog-recurring-allowances` in commit `550402d4d7195a7264618da3236b6eca96adb776`. Sourced recurring allowances for MegaNova, Free.ai, Kenari, and Aion in `open-sse/config/freeModelCatalog.data.js` (`tests/unit/port-omniroute-recurring-allowances.test.js`). Note: upstream PR #21426 head moved to `df378e84fdbd5f4a6a4dad2da210f70f0110c21b`; #21412 moved to `ab0046f2ba9f78c4aff88d22c1d27b186860f41b`.
  - [#21425](https://github.com/cheaper-inference/OmniRoute/pull/21425) (pin `dddd4064620e452c1bcee4dc681fcf37a4cebd5a`): `parity-retired-free-catalog-llm7` in commit `d3b2c176f365afabcd831a5b54bb3b12adac6edc`. Sourced historical LLM7 free quota in `open-sse/config/freeModelCatalog.retired.data.js` (`tests/unit/port-omniroute-free-catalog-retired.test.js`).
  - Status: pending independent review / full CI / PR creation. No claim landed.
- **Active / running bounded units**:
  - [#21349](https://github.com/cheaper-inference/OmniRoute/pull/21349) (`b3ea831f1b9a2ddb5fc809f026d79cc49a932b02`): `parity-unknown-model-404` active in branch `orq/tp5znk/unknown-model-inference-404-a1`. Returns HTTP 404 `model_not_found` for unknown bare models on inference routes (`/v1/chat/completions`, `/v1/messages`, `/v1/responses`), advancing combo fallback without cooling connections.
  - [#21427](https://github.com/cheaper-inference/OmniRoute/pull/21427) (pinned `af7b59d871fc3ac6ed2f69c410fe5db644eded0f`; live head `ac29c6493b2f2cb8c01f4a0d5cb8c27aee371aa6`): `parity-abort-refresh-scope` active in branch `orq/tp5znk/abort-refresh-waits-a1`. Propagates client abort to `refreshWithRetry` backoff delay sleeps and executor refresh calls while detaching background OAuth persistence. Zero collision with open PR [#2633](https://github.com/bloodf/durindoor/pull/2633).
- **Reserved Review-lane claims & active locks**:
  - Review-lane reservations preserved (PRs #2678, #2672, #2673, #2674, #2675, #2677, #2668, #2635, #2680, #2683, and issue #2661). PR [#2688](https://github.com/bloodf/durindoor/pull/2688) updated to head `0ca01511f7b65a520490b9077bd09dc500e63199` and preserved as an active lock.
- **Upstream live state (`cheaper-inference/OmniRoute`)**:
  - Default branch `release/v3.8.55` moved to `b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523` (2026-11-27T14:40:38Z) via merge-train batches b66 and b67 (PR #21360 catalog drift probes and PR #21331 docs version checks). Total open PRs: 634. Newest PRs: #21436 (backup secrets, out of lane), #21435 (catalog free quotas), #21434 (release train), #21433 (three-state model visibility), #21432 (stale signup credits), #21431 (startup pre-request hooks), #21428 (release train).
```

---

## 5. Verification and evidence

### Markdown link verification

Every repository-relative Markdown link in this report uses `../../../` from `internal/docs/port-reports/`, resolving to tracked files from the repository root:

- `test -e open-sse/utils/usageTracking.js` -> OK
- `test -e open-sse/services/usage/claude.js` -> OK
- `test -e open-sse/config/freeModelCatalog.data.js` -> OK
- `test -e open-sse/config/freeModelCatalog.retired.data.js` -> OK
- `test -e open-sse/config/runtimeConfig.js` -> OK
- `test -e open-sse/translator/formats/claude.js` -> OK
- `test -e open-sse/executors/base.js` -> OK
- `test -e open-sse/services/tokenRefresh.js` -> OK
- `test -e src/sse/handlers/chat.js` -> OK
- `test -e src/sse/handlers/chat/combo.js` -> OK
- `test -e src/sse/handlers/chat/singleModel/resolveModel.js` -> OK
- `test -e src/sse/services/apiKeyPolicy.js` -> OK
- `test -e tests/unit/exclusive-cache-read-alias.test.js` -> OK
- `test -e tests/unit/provider-usage-alias-extraction.test.js` -> OK
- `test -e tests/unit/claude-usage-response-headers.test.js` -> OK
- `test -e tests/unit/port-omniroute-recurring-allowances.test.js` -> OK
- `test -e tests/unit/port-omniroute-free-catalog-retired.test.js` -> OK
- Sibling report links (`1072-1073-nov27-post-2686-provider-refresh.md`, `provider-next-gap-scope-nov27.md`, `parity-provider-usage-alias-extraction.md`, `parity-claude-observation-consistency.md`, `2026-11-27-recurring-retired-catalog.md`) resolve to files in `internal/docs/port-reports/`.

### Safety and constraint check

- No product code, test suites, CLI code, or website code modified (`src/**`, `open-sse/**`, `tests/**`, `cli/**`, `website/**` untouched).
- No GitHub writes performed (all API queries were read-only `GET`).
- No broad web searches, secrets exposure, or background processes created.
- `git diff --check` clean.
