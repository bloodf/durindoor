# Upstream Port Ledger — PR #3172

Scope: `decolua/9router` PR #3172, `fix/executors cancel sse readers`.

| PR | Verdict | Evidence | Action |
| --- | --- | --- | --- |
| #3172 `fix(executors): cancel SSE readers` | PORTED | Upstream adds cancellation before releasing `ReadableStreamDefaultReader` locks in Grok and Perplexity web cleanup. DurinDoor had equivalent private reader loops. A direct awaited cancellation can itself never settle and then leave the lock retained; Codex cleanup semantics bound best-effort cancellation to 250ms before release. | Added private `cancelAndReleaseReader` helpers in both executors. Each invokes `reader.cancel()`, swallows rejection, waits at most 250ms, clears its timer, then releases the lock while swallowing an already-released-lock error. |

## Regression coverage

`tests/unit/perplexity-web.test.js` — `describe("PerplexityWebExecutor reader cleanup", …)` exercises the public `PerplexityWebExecutor.execute` only, no private reader export:

- `releases a reader when cancellation never settles` — mocks a reader whose `cancel()` never resolves; asserts `execute()` resolves under a 350ms race window and that both `cancel()` and `releaseLock()` are each called exactly once.
- `cancels before releasing the reader lock on normal completion` — mocks a reader whose `cancel()` resolves immediately; pushes a tag into a shared `callOrder` array from each `vi.fn`, then asserts the recorded order is exactly `["cancel", "release"]` and the response is 200.

## Verification

- GREEN: focused `tests/unit/perplexity-web.test.js` passed 26/26; full `tests && npm run test:ci` reported `Raw failures: 0`; lint and production build exited 0; docs integrity passed; `tests/__baseline__/known-fails.txt` was unchanged.
