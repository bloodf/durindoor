# #1073 — abandoned rate-limit queue cleanup

## Source change

OmniRoute PR [#18526](https://github.com/cheaper-inference/OmniRoute/pull/18526), pinned at final head `2e21f067697768f152eed56caed18e969c2ef941` (merged as `bf6faf91599dd38ce02a1597073ad489eaef2d4c`), changes `rateLimitManager.ts` and adds `queuedJobCancel.ts`. It removes waiting Bottleneck `RECEIVED` submissions synchronously from `_submitLock._queue`, settles the submission promise, and removes already-`QUEUED` jobs under `_registerLock`. It never removes running/executing jobs. On abort or queue timeout it rejects the caller-facing promise with the original abort reason / queue-timeout error before cleanup can expose Bottleneck's internal drop message. The accompanying tests target submission storms, blocked submission tails, FIFO/counters and cancellation cause custody.

## Local comparison and disposition

There is no local `open-sse/services/rateLimitManager.ts`, Bottleneck dependency-backed request queue, or rate-limit scheduler corresponding to that implementation. Local request-cap handling is separate: `rateLimitManager/requestCap.js` parses prose caps, and `learnedRequestCap.js` records the per-connection learned RPM (TTL one hour, bounded state); this is cap learning, not queued-job scheduling or cleanup.

The nearest behavior is `open-sse/services/concurrencyGate.js`, called by `chatCore.js` through `acquireMany` for global/provider concurrency admission. Its per-key FIFO queue removes an aborted waiter or timed-out waiter from the array, clears its timer/listener, and hands off slots in order. `tests/unit/concurrency-gate.test.js` covers cancellation removal without leaking/consuming a slot and timeout removal. Thus the user-visible concern of canceled local admission waiters lingering ahead of live waiters already has a matching local behavior for this gate; the upstream Bottleneck `RECEIVED`/`QUEUED` internals do not map to a local request-rate queue.

Smallest defensible residual: local concurrency-gate cancellation preserves queue cleanup but rejects with a new generic `AbortError` (`Concurrency wait aborted`) rather than the supplied `signal.reason`. The upstream change explicitly preserves native error identity and wraps non-Error abort reasons with cause. Existing local concurrency-gate coverage checks the error name and cleanup, not cancellation-reason identity. This narrow difference is established by static implementation and ordinary local test evidence; it does not establish a need to change policy or add a queue.

**Disposition: no queue port.** Keep current request caps, throttling and queue limits unchanged. Record the cancellation-reason fidelity difference as a separate, low-scope observation only; do not transplant Bottleneck-specific cleanup into the local FIFO gate based on this source change.

## Evidence collected

- Source PR final merged diff and description: [PR #18526](https://github.com/cheaper-inference/OmniRoute/pull/18526/files), specifically `rateLimitManager.ts` and `rateLimitManager/queuedJobCancel.ts`; commit pinned above.
- Local source: `open-sse/services/concurrencyGate.js` (`acquireSlot`, abort/timeout removal, and `acquireMany`); `open-sse/handlers/chatCore.js` (global/provider gate call); `open-sse/services/learnedRequestCap.js` and `open-sse/services/rateLimitManager/requestCap.js` (learned cap parsing/storage).
- Existing focused assertions: `tests/unit/concurrency-gate.test.js` (aborted waiter removal and timeout removal). No tests were run for this documentation-only disposition.
- Required evidence: `test -s internal/docs/port-reports/1073-abandoned-rate-queue-scope.md && rg -q -F 2e21f067697768f152eed56caed18e969c2ef941 internal/docs/port-reports/1073-abandoned-rate-queue-scope.md`.
