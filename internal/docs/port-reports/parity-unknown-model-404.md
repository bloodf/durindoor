# Unknown bare model 404 parity: OmniRoute #21349 (KEA-9627)

## Source and local base

- Upstream PR: [cheaper-inference/OmniRoute#21349](https://github.com/cheaper-inference/OmniRoute/pull/21349) (`fix(sse): return 404 model_not_found for unknown models on inference routes (KEA-9627)`, state `open` when fetched via read-only `gh api` on 2026-11-27).
- Exact upstream head inspected: `b3ea831f1b9a2ddb5fc809f026d79cc49a932b02` (base `c71f0065a7efe9230ec23b96a12253b050c4d7ad`; commits `73dacc7a24a7e91be11efc74a5029a2ed4ad876c`, `780e88e9245dc95271f9b7daf06170474367d956`, `3a4944089d0eb411d3920a89f03199171c29ab7f`, and `b3ea831f1b9a2ddb5fc809f026d79cc49a932b02`). Upstream files inspected via read-only `gh api`: `src/sse/handlers/chatHelpers.ts` (the `resolveModelOrError` `model_not_found` branch, `BAD_REQUEST` -> `NOT_FOUND`), `open-sse/services/model.ts` (`resolveModelByProviderInference`, which already returned `errorType: "model_not_found"` instead of falling back to `"openai"`), `tests/unit/kea-9627-unknown-model-404.test.ts`, `tests/unit/chat-helpers.test.ts`, `docs/reference/API_REFERENCE.md`, and `changelog.d/fixes/0000-kea-9627-unknown-model-404.md`.
- Local `origin/main`: `29490b783e83176d4d6a4162f76ee3dc79db66ea`.
- Local base for this unit: `ead7e830744e949a619f85158e5e139ce291a270` (integration merge of `e1d23b48a762c69b5b5a136764af3e23b63ba4d8` into `orq/tp5znk/integration`).
- Branch: `orq/tp5znk/unknown-model-inference-404-a1-l3`. The implementation commit `4a2a65dd2a6dd9d9c9192e1585429b43dfb8634e` (produced on `orq/tp5znk/unknown-model-inference-404-a3-l2`) was retained by cherry-pick onto this base as `b9d014adcf39`; it applied without conflict.
- Scope authority: Order 2 (`parity-unknown-model-404`) in `internal/docs/port-reports/provider-next-gap-scope-nov27.md`.

## Regression test file (evidence selector)

The regression file is `tests/unit/unknown-model-404.test.js`.

A prior gate run failed only because its evidence selector pointed at a nonexistent parity-prefixed path (`tests/unit/parity-unknown-model-404.test.js`). That path never existed. The orchestrator corrected the selector to the actual regression file above, preserving every assertion and the tested behavior. The parity-prefixed name survives only as the unit identifier (`parity-unknown-model-404`) and as this report's filename; neither is a test path.

## Upstream patch vs local adaptation

In OmniRoute #21349, `resolveModelByProviderInference` already returned `errorType: "model_not_found"` instead of falling back to `"openai"`, and `resolveModelOrError` in `src/sse/handlers/chatHelpers.ts` changed only the `model_not_found` branch from `HTTP_STATUS.BAD_REQUEST` to `HTTP_STATUS.NOT_FOUND`.

In DurinDoor:
1. `open-sse/services/model.js` (`getModelInfoCore` -> `inferProviderFromModelName`) is outside Order 2's owned files and is directly pinned by `tests/unit/review-b-proto-keys.test.js` (`getModelInfoCore(key, {})` returns `{ provider: "openai", model: key }`).
2. Because of that fallback, a bare unknown model like `kea-9627-nonexistent-model` on `POST /v1/chat/completions`, `POST /v1/messages`, or `POST /v1/responses` previously resolved to `{ provider: "openai", model: "kea-9627-nonexistent-model" }` and either dispatched upstream to OpenAI when an active OpenAI connection existed or returned `404 provider_not_configured` when none existed.
3. All three inference routes share `handleChat` -> `dispatchChat` -> `handleSingleModelChat` -> `resolveModel`.
4. Upstream's `resolveModelOrError` also auto-resolves `ambiguous_model` through family prefixes (`PREFERRED_BY_FAMILY`) before rejecting it. DurinDoor has no `errorType` contract in `getModelInfo` today, so the local adaptation reads `errorType` defensively (when a resolver supplies one) and additionally detects the unresolvable bare model directly, which is the case upstream reaches through its own inference layer.

## Behavior changes (plan-owned files only)

- `src/sse/handlers/chat/singleModel/resolveModel.js`:
  - Added `unknownBareModelResponse(modelStr, message)` reusing `errorResponse(HTTP_STATUS.NOT_FOUND, ...)` (`type: "invalid_request_error"`, `code: "model_not_found"`) and tagging `response[LOCAL_REQUEST_ERROR] = true`.
  - Preserved HTTP 400 for `modelInfo.errorType === "ambiguous_model"` and for empty model segments (`provider/` with `!model`, returning `"Invalid model format"`).
  - Handled `modelInfo.errorType === "model_not_found"` with HTTP 404 `model_not_found`.
  - Detected bare models (`!modelStr.includes("/")`) that fell through `inferProviderFromModelName`'s default `"openai"` fallback (not matching `/^(?:gpt-|o[134])/i`, not in OpenAI's `REGISTRY` catalog, and not a configured operator alias via `resolveModelAlias`) and returned `unknownBareModelResponse(modelStr)` before credential lookup or upstream dispatch.
  - Preserved all valid prefixed models, recognized bare prefixes (`gpt-*`, `o1/o3/o4*`, `claude-*`, `gemini-*`, `deepseek-*`, `codex-auto-review`), bare operator aliases, bare OpenAI non-chat/image-only catalog models (`chatgpt-image-latest`, `text-embedding-3-small`, `tts-1` -> HTTP 400), and explicit unknown-provider 404 wording in `src/sse/handlers/chat/singleModel/credentials.js` (no edit needed there).
- `src/sse/handlers/chat/combo.js`:
  - In `dispatchNestedCombo`, when a non-combo reaches the miss branch, bare non-empty strings without `"/"` reuse `unknownBareModelResponse(modelStr)` (HTTP 404 `model_not_found`), while slash-malformed inputs (`/`, `/gpt-4o`, ` / model `) keep HTTP 400 `"Invalid model format"`.
- `open-sse/config/errorConfig.js`:
  - Added `"could not be resolved to a known provider"` to `WRONG_MODEL_TEXT` so `checkFallbackError` returns `{ shouldFallback: false, cooldownMs: 0 }` and `open-sse/services/combo.js` treats local 404 resolution misses as model rejections that advance combo fallback without cooling accounts or applying smart-scoring health penalties, while preserving the 404 `model_not_found` envelope if every combo candidate is unknown.
- Out-of-scope boundaries respected:
  - Non-chat routes (`stt.js`, `tts.js`, `systemone.js`, `media/pipeline.js`), generated files, `open-sse/handlers/chatCore.js`, `open-sse/services/tokenRefresh.js`, `cli/**`, `website/**`, and `tests/__baseline__/known-fails.txt` were not touched.
- Test seam:
  - `resolveModel` accepts an optional `ctx.resolveModelInfo` resolver override, defaulting to the real `getModelInfo`. The seam is server-side only: `createSingleModelContext` in `src/sse/handlers/chat/singleModel/context.js` builds `ctx` from handler options, never from the request body, so a client cannot inject a resolver. It exists only so the regression test can exercise the `ambiguous_model` 400 branch that the current local resolver never produces on its own.

## Documentation evidence

- Updated JSDoc and inline contract comments in `src/sse/handlers/chat/singleModel/resolveModel.js` and `open-sse/config/errorConfig.js` documenting the HTTP 404 `model_not_found` inference contract and non-cooling combo behavior.
- Recorded source, behavior, and test evidence in this report (`internal/docs/port-reports/parity-unknown-model-404.md`). Published `docs/` files are outside Order 2's owned file list and were not modified.

## Verification evidence

All commands ran in an isolated environment (`env -i` with private temporary `HOME`, `DATA_DIR`, `XDG_CACHE_HOME`, and `TMPDIR`, no credentials, 300s ceiling).

1. **Pre-fix failure proof** (`tests/unit/unknown-model-404.test.js`, source reverted to the pre-fix state, test file unchanged):
   - Exit 1: **9 failed, 4 passed (13 total)**.
   - Failing: the three inference routes (`/v1/chat/completions`, `/v1/messages` stream + non-stream, `/v1/responses` stream + non-stream) did not return 404 `model_not_found`; the malformed/schema/syntax 400 case did not hold; the `ambiguous_model` 400 case did not hold; the combo fallback did not advance past an unknown bare candidate; and the all-unknown combo did not return 404.
   - Passing (already correct before the fix): explicit unknown-provider 404 wording, valid prefixed `openai/gpt-4o`, valid bare `gpt-4o`, and valid bare configured alias `kea-9627-bare-alias`.
   - Observed unpatched behavior: `kea-9627-nonexistent-model` resolved through `inferProviderFromModelName`'s default `"openai"` fallback and dispatched upstream to `https://api.openai.com/v1/chat/completions` on every inference route, including inside combos.
2. **Post-fix evidence and regression run** (the corrected exact evidence command):
   - `cd tests && node node_modules/vitest/vitest.mjs run unit/unknown-model-404.test.js unit/chat-quota-fallback.test.js unit/chat-policy-sequence.test.js unit/port-20683-codex-model-not-found-scope.test.js unit/omni-nov21-account-admission.test.js unit/omni-model-reference-whitespace.test.js unit/omni-github-gemini-aliases.test.js unit/review-b-proto-keys.test.js unit/vision-bridge-chat.test.js unit/combo-token-saver-no-double-count.test.js unit/review-b-fallback-timeout.test.js --maxWorkers=2`
   - Exit 0: **11 test files passed, 132 tests passed** (13/13 in `tests/unit/unknown-model-404.test.js`, 119/119 across the existing chat/model/fallback/combo regression tests).
   - Covers public route handlers (`POST /v1/chat/completions`, `POST /v1/messages` non-stream and stream, `POST /v1/responses` non-stream and stream) against real model resolution and SQLite storage with mocked `globalThis.fetch`; literal 404 `model_not_found` / `invalid_request_error` assertions with zero fetch calls; preserved 400 malformed JSON, schema violations, invalid slash syntax, ambiguous model, image-only, and non-chat checks; preserved explicit unknown-provider 404 wording; unchanged valid prefixed/bare/alias dispatch; and combo fallback advancing past an unknown bare candidate with zero cooldowns, zero active model locks, and healthy smart-scoring state.
3. **Wider bare-model and routing regression sweep** (confirms valid model routing is unchanged):
   - `cd tests && node node_modules/vitest/vitest.mjs run unit/port9r-3871-bare-model-lookup.test.js unit/claude-bare-model-fallback.test.js unit/model-routing.test.js unit/model-metadata-resolution.test.js unit/codex-auto-review-routing.test.js unit/model-connid-prefix-normalization.test.js unit/omni-auto-scope.test.js unit/omni-client-model-echo-combos.test.js unit/ponytail-routing.test.js unit/port9r-custom-provider-prefix-5786.test.js --maxWorkers=2`
   - Exit 0: 10 test files passed, 128 tests passed.
4. **Repository scoped checks** (selected from the changed files against the local base `ead7e830744e949a619f85158e5e139ce291a270`):
   - `ORQ_BASE_SHA=ead7e830744e949a619f85158e5e139ce291a270 sh scripts/checks.sh unit`: exit 0.
   - Root lint, the oxlint anti-slop gate (0 diagnostics across 3398 files), and the selected test inventory passed: **140 test files passed, 3055 tests passed**.
   - The scoped run regenerated the tracked build artifact `tools/oxlint/anti-slop/index.bundle.js` with a machine-local pnpm store path; that generated edit was reverted and is not part of this unit.
5. **Scoped lint, diff check, and CodeGraph sync**:
   - `pnpm exec eslint open-sse/config/errorConfig.js src/sse/handlers/chat/singleModel/resolveModel.js src/sse/handlers/chat/combo.js tests/unit/unknown-model-404.test.js`: exit 0.
   - `git diff --check`: exit 0.
   - `sh scripts/codegraph.sh init --yes` (this worktree had no index), then `sh scripts/codegraph.sh sync && sh scripts/codegraph.sh status --json`: exit 0, `pendingChanges: { added: 0, modified: 0, removed: 0 }`, `state: "complete"`, 6867 files indexed.

## Remaining merge gates

Full local CI (`scripts/local-ci.mjs --mode full`) and independent model-family review remain merge gates outside this scoped task.
