# Provider and connection next gap scopes, November 27, 2026

Status: SCOPED. Bounded implementation orders produced for remaining candidate units post-#2686. Documentation-only evidence report; no product or test files modified.

## 1. Upstream source diff inspection

Exact upstream commits and diffs analyzed from read-only GitHub snapshots:

1. **9router [#5884](https://github.com/decolua/9router/pull/5884)** (`d363dd0365d6ba523d97dead76180e5127d05cbb`): `feat(translator): configurable Claude prompt-cache TTL`
   - Scope: adds operator-configurable Claude prompt-cache conversation TTL (`claudeCacheTtl` setting and `CLAUDE_CACHE_TTL` environment variable), raising conversation breakpoints from `5m` to `1h` while preserving system/tools head anchors at `1h`.
   - Upstream diff touches 12 files (+291, -32), notably:
     - `open-sse/config/runtimeConfig.js`: introduces `CLAUDE_CACHE_TTL` enum (`SHORT: "5m"`, `LONG: "1h"`), `parseClaudeCacheTtl(raw)`, and `DEFAULT_CLAUDE_CACHE_TTL`.
     - `open-sse/translator/formats/claude.js`: updates `markLastCacheableBlock`, `markFinalToolResults`, `anchorClaudeCache`, and `prepareClaudeRequest` to accept `messageCacheTtl`.
     - `open-sse/translator/index.js` & `open-sse/handlers/chatCore.js`: threads `claudeCacheTtl` option from `handleChatCore` into request preparation and translation.
     - `src/sse/handlers/chat.js`: extracts `claudeCacheTtl` from settings/env to pass to `handleChatCore`.
     - `src/lib/db/repos/settingsRepo.js` & `src/app/(dashboard)/dashboard/endpoint/endpointConstants.js` & `src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.js` (locally `.jsx`): adds UI and settings persistence.
     - `.env.example` & `README.md`: documents `CLAUDE_CACHE_TTL`.

2. **9router [#5906](https://github.com/decolua/9router/pull/5906)** (`409f7623346382a3d544d0f32bf559d409e7a3fe`): `feat(metrics): per-key spend-limit usage gauge and refusal counter`
   - Scope: introduces OpenTelemetry metrics (`recordFailedRequestMetrics`, `recordUnsavedRequestMetrics`), per-key day/month spend enforcement (`checkSpendLimit`), and exposing the pricing match source in `open-sse/providers/pricing.js`.
   - Upstream diff touches 56 files (+3,439, -58), notably:
     - `open-sse/config/pricingSources.js`: defines `PRICING_SOURCE` constants (`"override"`, `"provider"`, `"free"`, `"model"`, `"pattern"`, `"none"`).
     - `open-sse/providers/pricing.js`: adds `resolvePricing(provider, model)` returning `{ pricing, source }`.
     - `open-sse/handlers/chatCore.js` & `open-sse/handlers/chatCore/requestDetail.js`: inserts OpenTelemetry metrics recording on failed and unsaved requests.
     - `src/lib/observability/metrics.js`, `metricsConfig.js`, `src/sse/services/keyAccess.js`, `keySpendLimit.js`, UI and DB schemas: creates metrics and spend enforcement infrastructure.

3. **OmniRoute [#21349](https://github.com/cheaper-inference/OmniRoute/pull/21349)** (`b3ea831f1b9a2ddb5fc809f026d79cc49a932b02`): `fix(sse): return 404 model_not_found for unknown models on inference routes (KEA-9627)`
   - Scope: changes unknown bare model resolution on `/v1/chat/completions`, `/v1/messages`, and `/v1/responses` from HTTP 400 `bad_request` to HTTP 404 `model_not_found`, matching `GET /v1/models/{id}` semantics. In combos, ensures an unknown model advances fallback without triggering cooldowns or circuit breakers.
   - Upstream diff touches 8 files (+161, -31), notably:
     - `src/sse/handlers/chatHelpers.ts`: in `resolveModelOrError`, when a model cannot be resolved to a known provider, returns HTTP 404 `model_not_found` instead of HTTP 400. Ambiguous models (`errorType === "ambiguous_model"`) remain HTTP 400.
     - `docs/openapi.yaml` & `docs/reference/API_REFERENCE.md`: documents HTTP 404 response on inference routes.
     - `tests/unit/kea-9627-unknown-model-404.test.ts`: verifies 404 `model_not_found` for Chat Completions, Messages, and combo non-cooling fallback.

4. **OmniRoute [#21427](https://github.com/cheaper-inference/OmniRoute/pull/21427)** (`af7b59d871fc3ac6ed2f69c410fe5db644eded0f`): `fix(sse): propagate client abort to token refresh retries and quota-share pre-hook`
   - Scope: checks client cancellation signal before and during token refresh retries and quota-share pre-hooks, aborting delay sleeps immediately rather than waiting out timeouts.
   - Upstream diff touches 8 files (+630, -117), notably:
     - `open-sse/utils/clientAbort.ts`: provides `createClientAbortError`, `isClientAbortError`, `raceClientAbort`, and `sleepWithAbort(ms, signal)`.
     - `open-sse/executors/base.ts`: checks `if (signal?.aborted) throw createClientAbortError(signal);` before proactive refresh and races `refreshCredentials` against `signal`.
     - `open-sse/handlers/chatCore.ts`, `quotaSharePreHook.ts`, `circuitBreaker.ts`: races quota hooks and retry backoff against client abort.

---

## 2. Local paths, callers, and test comparisons

### 2.1 Refresh abort analysis (#21427)

Locally, [BaseExecutor.execute](../../../open-sse/executors/base.js#L288) checks `signal?.aborted` and uses [waitForRetryDelay(waitMs, signal)](../../../open-sse/executors/base.js#L83) for intra-retry delays. Furthermore, chat OAuth refresh via [refreshAndUpdateCredentials](../../../src/shared/services/providerCredentials.js#L285) / [callerWait](../../../src/shared/services/providerCredentials.js#L98-L130) propagates `signal` from [credentials.js](../../../src/sse/handlers/chat/singleModel/credentials.js#L183-L192), [dispatch.js](../../../src/sse/handlers/chat/singleModel/dispatch.js#L125-L135), and [chatCore.js](../../../open-sse/handlers/chatCore.js#L1734-L1740) while detaching background persistence.

However, specific refresh execution and retry paths omit client abort handling:
1. **`refreshWithRetry`** in [open-sse/services/tokenRefresh.js#L445-L454](../../../open-sse/services/tokenRefresh.js#L445-L454):
   - Signature is `refreshWithRetry(refreshFn, maxRetries = 3, log = null)`.
   - Accepts no `signal` parameter.
   - At line 453, backoff sleeps using uninterruptible `await new Promise((r) => setTimeout(r, delay));`. A cancelled client must wait out the full backoff sequence (up to 3,000ms delay).
2. **`mediaRefresh`** in [open-sse/handlers/mediaRefresh.js#L14-L19](../../../open-sse/handlers/mediaRefresh.js#L14-L19):
   - `refreshMediaCredentials({ provider, executor, credentials, refreshCredentials, log, proxyOptions })` omits `signal`.
   - Line 18 calls `refreshWithRetry(() => executor.refreshCredentials(credentials, log, proxyOptions), 3, log)`.
   - Callers in [open-sse/handlers/embeddingsCore.js#L116](../../../open-sse/handlers/embeddingsCore.js#L116) and [open-sse/handlers/imageGenerationCore.js#L118](../../../open-sse/handlers/imageGenerationCore.js#L118) pass options without `signal`.
3. **Cursor refresh** in [open-sse/services/tokenRefresh/cursor.js](../../../open-sse/services/tokenRefresh/cursor.js):
   - `refreshCursorToken(token, log, proxyOptions = null)` creates its own internal `const signal = AbortSignal.timeout(15000);` and ignores caller cancellation.
   - Transient failure backoff uses uninterruptible `setTimeout`.
4. **Standalone `chatCore.js` fallback** in [open-sse/handlers/chatCore.js#L1741](../../../open-sse/handlers/chatCore.js#L1741):
   - When `refreshCredentials` is not a function, falls back to `await executor.refreshCredentials(credentials, log, proxyOptions)`.
   - Does not pass `providerSignal` or race against `providerSignal?.aborted`.
5. **Media pipeline pre-refresh** in [src/sse/services/tokenRefresh.js#L244](../../../src/sse/services/tokenRefresh.js#L244):
   - `checkAndRefreshToken(provider, credentials, proxyOptions = null, options = {})` is called by [src/sse/handlers/media/pipeline.js#L47](../../../src/sse/handlers/media/pipeline.js#L47) (`refreshMediaCredentials`), taking no cancellation signal.
6. **Non-existent upstream abstractions**:
   - Upstream's `quotaSharePreHook.ts` and `tokenRefresh/circuitBreaker.ts` do not exist in DurinDoor and are excluded.
7. **Local PR #2633 overlap check**:
   - Local PR [#2633](https://github.com/bloodf/durindoor/pull/2633) (`11de5827d1ebc79b31707da39df86e3294d86480`: `fix: propagate client cancellation through media and Gemini`) touches:
     - [open-sse/handlers/imageEditCore.js](../../../open-sse/handlers/imageEditCore.js): abort handling during upstream error-body vs 2xx text reads.
     - [src/app/api/v1beta/models/[...path]/route.js](../../../src/app/api/v1beta/models/[...path]/route.js): chaining `request.signal` via `keepAbortChain`.
     - `tests/unit/port-omniroute-21275-abort-chain.test.js` and `tests/unit/review-s-media-pipeline.test.js`.
   - **Verdict**: PR #2633 touches zero files in `open-sse/services/tokenRefresh.js`, `mediaRefresh.js`, `cursor.js`, `base.js`, or `chatCore.js`. There is **zero file or semantic collision** between PR #2633 and the token refresh abort scope.
8. **Persistence decoupling invariant**:
   - When a client aborts during refresh, the caller must reject promptly with `AbortError` / HTTP 499.
   - However, following the pattern in [callerWait](../../../src/shared/services/providerCredentials.js#L98-L130), in-flight credential exchanges and database credential updates must be allowed to complete to prevent tearing rotated refresh tokens.

### 2.2 Unknown model 404 vs 400 analysis (#21349)

Distinguishing error categories on inference routes:
1. **Invalid syntax (HTTP 400 `bad_request`)**:
   - Malformed JSON body or non-object payloads.
   - Missing or non-array `messages` property (e.g., [src/sse/handlers/chat.js#L56-L59](../../../src/sse/handlers/chat.js#L56-L59)).
   - Ambiguous model name (`errorType === "ambiguous_model"`).
   - Image-only models directed to chat (`isImageOnlyModel` in [resolveModel.js#L48-L55](../../../src/sse/handlers/chat/singleModel/resolveModel.js#L48-L55)).
   - Non-chat models directed to chat (`isNonChatModel` in [resolveModel.js#L57-L63](../../../src/sse/handlers/chat/singleModel/resolveModel.js#L57-L63)).
2. **Unknown provider (HTTP 404 `not_found`)**:
   - Model string specifies an explicit provider prefix that is not registered (e.g., `unknown-provider/model-x`).
   - Handled at [src/sse/handlers/chat/singleModel/credentials.js#L80-L84](../../../src/sse/handlers/chat/singleModel/credentials.js#L80-L84): returns HTTP 404 `"Unknown provider \"unknown-provider\" in model \"unknown-provider/model-x\". See /v1/models for what this router serves."`.
3. **Unknown model (HTTP 404 `model_not_found`)**:
   - Model string is a bare ID (e.g., `kea-9627-nonexistent-model`) that matches no registered provider model and is not a configured combo.
   - **Current local behavior**: [resolveModel.js#L42](../../../src/sse/handlers/chat/singleModel/resolveModel.js#L42) delegates bare models to `ctx.dispatchNestedCombo`, which in [combo.js#L497-L498](../../../src/sse/handlers/chat/combo.js#L497-L498) returns HTTP 400:
     `return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format");`.
   - **Upstream change (#21349)**: returns HTTP 404 with code `model_not_found` and message matching `Model '${modelStr}' could not be resolved to a known provider.`.
   - **Target routes**:
     - `POST /v1/chat/completions` (Chat Completions)
     - `POST /v1/messages` (Claude Messages)
     - `POST /v1/responses` (Responses API)
   - **Combo fallback behavior**:
     - When a combo target encounters HTTP 404 `model_not_found`, it advances to the next model in the priority list without cooling the connection or tripping circuit breakers.
   - **Non-chat routes boundary**:
     - [src/sse/handlers/stt.js#L101-L102](../../../src/sse/handlers/stt.js#L101-L102), [src/sse/handlers/tts.js#L127-L128](../../../src/sse/handlers/tts.js#L127-L128), [src/sse/handlers/systemone.js#L96-L99](../../../src/sse/handlers/systemone.js#L96-L99), and [src/sse/handlers/media/pipeline.js#L62-L63](../../../src/sse/handlers/media/pipeline.js#L62-L63) also return HTTP 400 `"Invalid model format"` when `!modelInfo.provider`.
     - Upstream KEA-9627 explicitly scoped this change to Chat Completions, Messages, and Responses. Changing non-chat contracts without upstream precedent risks breaking specialized client expectations.

---

## 3. Configuration, precedence, and scope proofs

### 3.1 Claude cache TTL precedence and marker preservation (#5884)

From source examination and local precedents:
1. **Configuration and Environment Precedence**:
   - `DB Settings` (`settingsRepo.js` / `settings.claudeCacheTtl`): highest priority. Saved on the Token Saver dashboard.
   - `Environment Variable` (`CLAUDE_CACHE_TTL` in `runtimeConfig.js`): second priority. Read at startup via `parseClaudeCacheTtl(process.env.CLAUDE_CACHE_TTL)`.
   - `Default Fallback`: `"5m"`. Any unrecognized value or missing setting/env resolves to `"5m"`.
   - Parsing contract: `parseClaudeCacheTtl(raw)` trims whitespace and lowercases; `"1h"` resolves to `"1h"`, everything else (including `"60m"`, `""`, `null`) resolves to `"5m"`.
2. **Explicit Client Marker Preservation**:
   - Local DurinDoor already preserves client-requested 1h cache markers in `clientMessageCacheControl` and [open-sse/translator/formats/claude.js#L329-L332](../../../open-sse/translator/formats/claude.js#L329-L332):
     ```js
     const lastHour = marked.findLastIndex((block) => block.cache_control.ttl === "1h");
     for (const block of marked.slice(0, Math.max(0, lastHour))) {
       if (block.cache_control.ttl !== "1h") block.cache_control = { ...CACHE_CONTROL_1H };
     }
     ```
   - Upstream #5884 respects Anthropic's rule that longer-TTL breakpoints must precede shorter ones:
     - Head anchors (system prompts and tools) always use `1h` (`CACHE_CONTROL_1H`).
     - When operator setting is `1h`: conversation breakpoints are anchored at `1h`. If the client already populated the 4-breakpoint budget, surviving message markers are raised to `1h`. Since head anchors are `1h`, all breakpoints are `1h`, satisfying Anthropic ordering.
     - When operator setting is `5m` (default): client's own markers (including client-specified `1h`) remain untouched.

### 3.2 Pricing fallback and observability review (#5906)

Proof of present vs remaining scope:
1. **OpenTelemetry Metrics Hooks**:
   - Upstream #5906 inserts `recordFailedRequestMetrics` in `chatCore.js` and `recordUnsavedRequestMetrics` in `requestDetail.js`, importing from `@/lib/observability/metrics.js`.
   - In DurinDoor, [src/lib/observability/redact.js](../../../src/lib/observability/redact.js) exists, but `src/lib/observability/metrics.js` does NOT exist. DurinDoor contains no OpenTelemetry dependencies or metric exporters.
2. **Per-Key Spend Limits**:
   - Upstream adds `src/sse/services/keyAccess.js` and `keySpendLimit.js`.
   - DurinDoor implements key policy in [src/sse/services/apiKeyPolicy.js](../../../src/sse/services/apiKeyPolicy.js). API key spend limits are outside provider transport/connection parity.
3. **Pricing Fallback Function**:
   - In [open-sse/providers/pricing.js](../../../open-sse/providers/pricing.js), `getPricingForModel(provider, model)` already exists locally and returns the identical pricing object.
   - Upstream #5906 adds `resolvePricing(provider, model)` returning `{ pricing, source }` solely to power a dashboard UI chip (`PriceChip.js`).
   - In DurinDoor, no backend or frontend consumers exist for `PRICING_SOURCE` or `resolvePricing`.
4. **Scope Conclusion**:
   - No defect, regression, or missing capability exists in provider catalogs, provider authentication, or connection handling.
   - Importing or porting unused pricing sources or metric stubs would be speculative feature expansion.
   - Confirmed **OUT OF SCOPE / ZERO REMAINING GAP**.

---

## 4. Local open PRs and review-lane claims

Active local PRs and review-lane reservations checked to prevent duplicate work:

| PR / Issue | Scope | Status / Relationship |
| --- | --- | --- |
| [#2690](https://github.com/bloodf/durindoor/pull/2690) | `fix(usage): reconcile observed quotas and cache creation aliases` | Currently in full CI / merge queue; no overlap with scoped units. |
| [#2689](https://github.com/bloodf/durindoor/pull/2689) | `feat(providers): enable Fal and KIE media` | Active provider media PR; no overlap. |
| [#2688](https://github.com/bloodf/durindoor/pull/2688) | `refactor: architecture review part 2` | Active architecture review; no overlap. |
| [#2633](https://github.com/bloodf/durindoor/pull/2633) | `fix: propagate client cancellation through media and Gemini` | Verified non-overlapping with token refresh abort scope. |
| [#2678](https://github.com/bloodf/durindoor/pull/2678) / #2640, #2676 | `fix(thinking): respect synced Claude effort settings` | Reserved Review lane claim. Excluded. |
| [#2672](https://github.com/bloodf/durindoor/pull/2672) / #2642 | TrustedRouter provider | Reserved Review lane claim. Excluded. |
| [#2673](https://github.com/bloodf/durindoor/pull/2673) / #2638 | Cursor proxy IP handling | Reserved Review lane claim. Excluded. |
| [#2674](https://github.com/bloodf/durindoor/pull/2674) / #2639 | Liquid AI endpoint & catalog | Reserved Review lane claim. Excluded. |
| [#2675](https://github.com/bloodf/durindoor/pull/2675) / #2644 | Liquid System One decisions | Reserved Review lane claim. Excluded. |
| [#2677](https://github.com/bloodf/durindoor/pull/2677) / #2637 | OpenRouter decision models | Reserved Review lane claim. Excluded. |
| [#2668](https://github.com/bloodf/durindoor/pull/2668) / #2641 | Devin CLI candidates | Reserved Review lane claim. Excluded. |
| [#2635](https://github.com/bloodf/durindoor/pull/2635) / #2626 | Reasoning for unlisted models | Reserved Review lane claim. Excluded. |
| [#2680](https://github.com/bloodf/durindoor/pull/2680) / #2648 | None-only reasoning | Reserved Review lane claim. Excluded. |
| [#2683](https://github.com/bloodf/durindoor/pull/2683) / #2684 | Browser checkpoint isolation | Reserved Review lane claim. Excluded. |
| — / #2661 | macOS platform claim | Reserved Review lane claim. Excluded. |

---

## 5. Bounded implementation orders

### Order 1: `parity-cache-ttl`

- **Goal**: Make Claude prompt-cache conversation breakpoint TTL operator-configurable via environment variable and dashboard setting, while preserving explicit client markers and 1h system/tools head anchors.
- **Exact Upstream Source**: 9router [#5884](https://github.com/decolua/9router/pull/5884) (`d363dd0365d6ba523d97dead76180e5127d05cbb`).
- **Verified Owned Local Files**:
  - [open-sse/config/runtimeConfig.js](../../../open-sse/config/runtimeConfig.js)
  - [open-sse/translator/formats/claude.js](../../../open-sse/translator/formats/claude.js)
  - [open-sse/translator/index.js](../../../open-sse/translator/index.js)
  - [open-sse/handlers/chatCore.js](../../../open-sse/handlers/chatCore.js)
  - [src/sse/handlers/chat.js](../../../src/sse/handlers/chat.js)
  - [src/lib/db/repos/settingsRepo.js](../../../src/lib/db/repos/settingsRepo.js)
  - <a href="../../../src/app/(dashboard)/dashboard/endpoint/endpointConstants.js">src/app/(dashboard)/dashboard/endpoint/endpointConstants.js</a>
  - <a href="../../../src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.jsx">src/app/(dashboard)/dashboard/token-saver/TokenSaverClient.jsx</a>
  - [../../../.env.example](../../../.env.example)
- **Acceptance Tests**:
  - `tests/unit/claude-cache-ttl.test.js`:
    - Case 1: `parseClaudeCacheTtl` parses `"1h"`, `" 1H "` case-insensitively, falling back to `"5m"` on `"5m"`, `"60m"`, `""`, and `undefined`.
    - Case 2: Precedence: DB settings `claudeCacheTtl` overrides env `CLAUDE_CACHE_TTL`; env overrides default `"5m"`.
    - Case 3: Passthrough (`anchorClaudeCache`): when `claudeCacheTtl === "1h"`, conversation breakpoint is 1h; when client has 4 markers, client message markers are raised to 1h; when `claudeCacheTtl === "5m"`, client markers are preserved untouched.
    - Case 4: Translated (`prepareClaudeRequest` & `translateRequest`): system/tools head anchors always use 1h; conversation message turns use operator TTL (`1h` vs `5m`).
- **Unresolved Product Decisions**:
  - None remaining. Upstream behavior, settings precedence, and marker preservation rules are fully aligned with local precedents.

---

### Order 2: `parity-unknown-model-404`

- **Goal**: Return HTTP 404 with error code `model_not_found` when an unresolvable bare model is requested on inference routes (`/v1/chat/completions`, `/v1/messages`, `/v1/responses`), matching `GET /v1/models/{id}` behavior. Ensure combo fallback treats 404 as a model advance without cooling the connection.
- **Exact Upstream Source**: OmniRoute [#21349](https://github.com/cheaper-inference/OmniRoute/pull/21349) (`b3ea831f1b9a2ddb5fc809f026d79cc49a932b02`).
- **Verified Owned Local Files**:
  - [src/sse/handlers/chat/combo.js](../../../src/sse/handlers/chat/combo.js)
  - [src/sse/handlers/chat/singleModel/resolveModel.js](../../../src/sse/handlers/chat/singleModel/resolveModel.js)
  - [src/sse/handlers/chat/singleModel/credentials.js](../../../src/sse/handlers/chat/singleModel/credentials.js)
  - [open-sse/config/errorConfig.js](../../../open-sse/config/errorConfig.js)
- **Acceptance Tests**:
  - `tests/unit/unknown-model-404.test.js`:
    - Case 1: `POST /v1/chat/completions` with an unknown bare model returns HTTP 404 with `{ error: { code: "model_not_found", type: "invalid_request_error" } }` and zero upstream network dispatches.
    - Case 2: `POST /v1/messages` and `POST /v1/responses` with an unknown bare model return HTTP 404 `model_not_found`.
    - Case 3: Distinguish:
      - Malformed payload (missing messages, bad JSON) -> HTTP 400.
      - Ambiguous model -> HTTP 400.
      - Image-only model on chat -> HTTP 400.
      - Non-chat model on chat -> HTTP 400.
      - Explicit unknown provider prefix (`unknown-provider/foo`) -> HTTP 404 with unknown provider message.
      - Unknown bare model -> HTTP 404 `model_not_found`.
    - Case 4: Combo fallback advances past a 404 model to the next available model without cooling the connection or tripping circuit breakers.
- **Unresolved Product Decisions**:
  - Non-chat routes scope: [stt.js](../../../src/sse/handlers/stt.js), [tts.js](../../../src/sse/handlers/tts.js), [systemone.js](../../../src/sse/handlers/systemone.js), and [pipeline.js](../../../src/sse/handlers/media/pipeline.js) currently return HTTP 400 `"Invalid model format"`. Upstream KEA-9627 scoped this strictly to Chat Completions, Messages, and Responses. Recommended decision: restrict 404 behavior to chat/messages/responses inference routes, retaining 400 on STT/TTS/Media to avoid breaking client contracts.

---

### Order 3: `parity-abort-refresh-scope`

- **Goal**: Make token refresh backoff delays and executor refresh calls responsive to client abort signals, preventing unneeded delays while preserving in-flight OAuth persistence integrity.
- **Exact Upstream Source**: OmniRoute [#21427](https://github.com/cheaper-inference/OmniRoute/pull/21427) (`af7b59d871fc3ac6ed2f69c410fe5db644eded0f`).
- **Verified Owned Local Files**:
  - [open-sse/services/tokenRefresh.js](../../../open-sse/services/tokenRefresh.js)
  - [open-sse/services/tokenRefresh/cursor.js](../../../open-sse/services/tokenRefresh/cursor.js)
  - [open-sse/handlers/mediaRefresh.js](../../../open-sse/handlers/mediaRefresh.js)
  - [open-sse/handlers/chatCore.js](../../../open-sse/handlers/chatCore.js)
  - [open-sse/executors/base.js](../../../open-sse/executors/base.js)
- **Acceptance Tests**:
  - `tests/unit/token-refresh-abort.test.js`:
    - Case 1: Pre-aborted signal passed to `refreshWithRetry` rejects immediately without invoking the refresh function or sleeping.
    - Case 2: Signal triggered during backoff delay in `refreshWithRetry` aborts sleep immediately without waiting for the timeout.
    - Case 3: `refreshMediaCredentials` in `mediaRefresh.js` accepts `signal` and propagates it to `refreshWithRetry`.
    - Case 4: Standalone `chatCore.js` fallback races `executor.refreshCredentials` against `providerSignal`.
    - Case 5: When client abort fires during an in-flight refresh request, the caller receives an abort rejection, but the underlying token refresh promise is detached and allowed to persist valid rotated tokens to the database.
- **Unresolved Product Decisions**:
  - Upstream OmniRoute-specific `quotaSharePreHook.ts` and `circuitBreaker.ts` are excluded because those abstractions do not exist in DurinDoor.

---

### Order 4: `parity-spend-observability-review` (Conclusive Disposition: Zero Remaining Scope)

- **Goal**: Conclude review of 9router #5906 and record zero remaining gap in the provider/connection lane.
- **Exact Upstream Source**: 9router [#5906](https://github.com/decolua/9router/pull/5906) (`409f7623346382a3d544d0f32bf559d409e7a3fe`).
- **Verified Scope Proof**:
  - Upstream #5906 is an API-key spend limit and OpenTelemetry metrics feature.
  - DurinDoor does not maintain OpenTelemetry observability infrastructure.
  - DurinDoor handles API key policy and rate limits in `src/sse/services/apiKeyPolicy.js`.
  - Upstream additions to `open-sse/providers/pricing.js` (`resolvePricing`) only expose matching source metadata for a dashboard price chip. DurinDoor has no consumers for this metadata.
  - No provider catalog, provider authentication, or connection transport capability is broken or missing.
- **Verdict**: Retain disposition from `internal/docs/port-reports/1072-nov27-e.md`. **Zero code changes authorized; unit is closed without implementation.**
