# OmniRoute #21427: abort-aware refresh caller waits parity

Status: assembled for [DurinDoor #2710](https://github.com/bloodf/durindoor/pull/2710). Unit evidence below is historical; the PR records the current exact-head review and full local CI status.

## Source and local base

- **Exact upstream source**: OmniRoute [#21427](https://github.com/diegosouzapw/OmniRoute/pull/21427), pinned commit `af7b59d871fc3ac6ed2f69c410fe5db644eded0f` (`fix(sse): propagate client abort to token refresh retries and quota-share pre-hook`), inspected via read-only `gh api`. Subsequent upstream head `ac29c6493b2f2cb8c01f4a0d5cb8c27aee371aa6` (`fix(sse): persist proactive refresh on abort and preserve deadline abort reasons`) was also inspected read-only: its detached persistence fix is already satisfied locally (in untouched `providerCredentials.js` and our detached `chatCore.js` fallback), its hedge/passive-Codex changes are upstream-only, and deadline-reason (`BodyTimeoutError`) preservation in `sendRequest.js` remains out of this unit's planpaths.
- **Exact local base**: `29d143ee80e22e70508da63d8253e750b71753dc` (`orq/tp5znk/integration`), scoped under Order 3 (`parity-abort-refresh-scope`) of [the historical scope report on its unmerged source branch](https://github.com/bloodf/durindoor/blob/24810ec5b3eab0cb7c00e7d4fbddf0a80e66e3e4/internal/docs/port-reports/provider-next-gap-scope-nov27.md).

## Scope and architectural contract

The implementation follows the caller-wait and detached persistence contract while leaving `src/shared/services/providerCredentials.js` untouched. Refresh-specific wait helpers were added; this report does not claim they reuse a shared helper. No general `open-sse/utils/clientAbort.js` framework was added.

Changed owned source files:

1. `open-sse/services/tokenRefresh.js`:
   - `refreshWithRetry(refreshFn, maxRetries = 3, log = null, options = null)` accepts an optional backward-compatible fourth argument (`{ signal }` or bare `AbortSignal`).
   - Rejects immediately with `AbortError` before invoking `refreshFn` when pre-aborted.
   - Replaces uninterruptible backoff `setTimeout` sleeps with abort-aware delay cleanup so aborting during backoff rejects promptly without launching the next retry or leaking timers/listeners.
   - Races in-flight `refreshFn()` caller waits against `signal` without cancelling an already-started refresh, absorbing late rejections from detached promises.
   - Preserves exact no-signal retry behavior (including synchronous first-attempt invocation, transient immediate retries, and internal `AbortError` retries when no caller signal is supplied).
2. `open-sse/services/tokenRefresh/cursor.js`:
   - `refreshCursorToken(token, log, proxyOptions = null, options = null)` accepts optional `{ signal }` or bare `AbortSignal`.
   - Rejects immediately before entering `dedupRefresh` on pre-abort.
   - Races only the caller's wait on the shared `dedupRefresh` promise against `callerSignal` so a disconnecting caller unblocks promptly during in-flight fetch or retry backoff while keeping the shared network exchange and retry loop alive for concurrent callers.
3. `open-sse/handlers/mediaRefresh.js`:
   - `refreshMediaCredentials({ ..., signal = null })` rejects immediately when pre-aborted.
   - Propagates `{ signal }` to `refreshWithRetry` on executor fallback and passes `{ signal }` plus `raceCallerAbort` around caller-injected `refreshCredentials` without altering no-signal call signatures.
4. `open-sse/handlers/chatCore.js`:
   - Reactive 401/403 refresh wraps both injected `refreshCredentials` and standalone `executor.refreshCredentials` + `onCredentialsRefreshed` persistence in `raceCallerAbort(..., providerSignal)`.
   - Client abort returns HTTP 499 promptly without retrying upstream while allowing an already-started standalone refresh and `onCredentialsRefreshed` persistence callback to finish cleanly in the background.
5. `open-sse/executors/base.js`:
   - Exports `raceCallerAbort(pending, signal = null)` alongside `waitForRetryDelay(delayMs, signal = null)` with synchronous listener removal and detached rejection absorption.
   - Normalizes non-`AbortError` throws (including string abort reasons) caught while `signal?.aborted` is true into `AbortError` tagged `errorKind: "aborted"`.

Explicit exclusions:

- Upstream-only `open-sse/handlers/chatCore/quotaSharePreHook.ts` and `open-sse/services/tokenRefresh/circuitBreaker.ts` do not exist in DurinDoor and were not introduced.
- Local PR #2633 files (`open-sse/handlers/imageEditCore.js`, `src/app/api/v1beta/models/[...path]/route.js`, `tests/unit/port-omniroute-21275-abort-chain.test.js`, `tests/unit/review-s-media-pipeline.test.js`) remain untouched (verified non-overlap).
- Protected files (`tests/__baseline__/known-fails.txt`, `open-sse/providers/registry/index.js`, `open-sse/AGENT-INDEX.md`, `cli/**`, `website/**`, `src/sse/handlers/chat/**`, `src/shared/services/providerCredentials.js`) remain untouched.

## Verification

All checks ran in an isolated temporary `HOME`, `DATA_DIR`, and `XDG_CACHE_HOME` with a sanitized `env -i` environment and 300-second command ceiling:

- Focused Vitest run (9 files, 145 tests passed):
  - `tests/unit/parity-abort-refresh-waits.test.js` (17 tests): pre-abort skips refresh (`refreshWithRetry`, `refreshMediaCredentials`, `refreshCursorToken`); abort during backoff rejects promptly via fake timers with no next retry (`refreshWithRetry`, `mediaRefresh`, `BaseExecutor.execute`); no-signal retry behavior unchanged; standalone `chatCore` fallback abort returns 499 while active refresh completes and persists rotated tokens; late detached rejections emit zero `unhandledRejection` events; concurrent Cursor (`dedupRefresh`) and `providerCredentials` callers succeed after first caller aborts; zero leaked `"abort"` listeners.
  - Regression suites passed: `unit/token-refresh-transient.test.js` (2), `unit/provider-credentials.test.js` (36), `unit/agy-refresh-lease-media.test.js` (4), `unit/image-abort-signal.test.js` (13), `unit/port-omniroute-21275-abort-chain.test.js` (8), `unit/codex-compact-chatcore.test.js` (10), `unit/omni-nov21-chatcore-request-a.test.js` (13), `unit/embeddingsCore.test.js` (42).
- Scoped lint & hygiene:
  - `pnpm run lint:anti-slop`: passed (0 diagnostics across 3398 files).
  - `pnpm exec oxlint` and `pnpm exec eslint` on all 6 changed JS files: 0 warnings, 0 errors.
  - `git diff --check`: passed.

Full local CI (`scripts/local-ci.mjs --mode full`) and independent review remain separate merge gates.

## Caller wiring review correction, 2026-11-27

This follow-up addresses OmniRoute #21427 at `ac29c6493b2f2cb8c01f4a0d5cb8c27aee371aa6`, tracked locally by #1073. The earlier 145-test evidence covered helpers but did not prove the embeddings, image-generation, or Cursor dispatch callsites. It is not evidence of full parity.

The new `tests/unit/parity-refresh-abort-caller-wiring.test.js` reproduced the gaps before implementation. The original eight cases all failed. The final eleven-case file also failed against unchanged local base `ab387ffba56d618071a6a3c50384b554a1706571` in a private environment. Embeddings and real image-generation 401 handlers remained unsettled after abort during pending refresh or retry backoff. Cursor dispatch ignored caller cancellation. The real image-handler failures confirm the narrow image callsite gap; no speculative image behavior was changed.

Embeddings and image generation now pass their request signal into media refresh, return 499 when that wait aborts, and avoid later credential mutation or retry dispatch. Fallback OAuth refresh and `onCredentialsRefreshed` persistence run as one detached operation. An injected refresher continues to own durable persistence. A persistence error does not trigger another token rotation. The open-sse Cursor provider dispatch forwards optional caller options; Cursor still uses its independent runtime deadline for the shared network exchange, so one caller leaving cannot cancel another caller's refresh.

Coverage includes both handlers with injected and fallback refresh, pending refresh and retry backoff, abort during pending persistence, late durable token persistence, no retry dispatch or request credential mutation after abort, real `providerCredentials` injection, Cursor dispatch pre-abort, and two Cursor callers sharing one credential. Deferred promises and fake timers replace network calls and sleep-based timing.

No changes were made to image accounting, credential fencing, edit cancellation, the protected abort test files, the failure baseline, or the refresh serialization backend. No GitHub write or full local-CI/parity claim is made. Confirmed reproduction is ready for the orchestrator to record on #1073.

Follow-up validation: eight focused files passed, 133 tests total: `parity-refresh-abort-caller-wiring` (11), `parity-abort-refresh-waits` (17), `embeddingsCore` (42), `image-abort-signal` (13), `agy-refresh-lease-media` (4), `token-refresh-transient` (2), `provider-credentials` (36), and `port-omniroute-21275-abort-chain` (8). Scoped ESLint passed for the six changed JavaScript files, and the anti-slop gate passed with zero diagnostics. Final checks used sanitized `env -i`, private `HOME`/`DATA_DIR`/cache paths, two Vitest workers and a 300-second command ceiling. The pnpm-linked ESLint configuration required `NODE_PATH` pointing at this worktree's `node_modules`; no installation or host setting was changed to resolve it.

Gate correction: restored `src/sse/services/tokenRefresh.js` exactly to its pre-follow-up contents because that path is forbidden for this task. The dashboard wrapper remains unchanged. The allowed open-sse dispatch and real-handler caller tests retain the bounded fix.
