# #1073 — OmniRoute #14681 buffered verdict and watchdog diagnostics

## Source identities and diff

Compared both requested source pins against the current DurinDoor integration:

- [`f0427e45b2de5b067b0a989311342de6f6a61fc0`](https://github.com/cheaper-inference/OmniRoute/commit/f0427e45b2de5b067b0a989311342de6f6a61fc0), commit `fix(sse): log buffered verdict with correlation and report watchdog stall evidence`, parent `7d23bcf8ecb3b43c00c024e317af9c39384a1bee`.
- [`9455fec4e0066e1e859b842f233a1e8b56bea567`](https://github.com/cheaper-inference/OmniRoute/commit/9455fec4e0066e1e859b842f233a1e8b56bea567), commit `fix(sse): log buffered verdict with correlation and report watchdog stall evidence (#14681)`, first parent `cace37aa4e9b12966814c55308bec101cde46809`.

Read the first-parent diff for each identity in `/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git`. Both diffs contain the same five changed paths and patch: `open-sse/handlers/chatCore.ts`, `open-sse/utils/emptyTurnRetry.ts`, `open-sse/utils/streamHandler.ts`, `tests/unit/buffered-verdict-watchdog-log.test.ts`, and the one-line fix note.

The patch formats buffered verdict logs as one bounded line with verdict kind, idle-pass flag, correlation ID, trace ID, and a clipped reason; only an idle pass is raised to warning level. At the content-stall watchdog tap, it adds byte/event counts, up to five frequent SSE event types, and a best-effort open-reasoning indicator. It adds no new retry, recovery, or cancellation decision. In the upstream change, the summary is diagnostic evidence attached to a content-stall error and a debug log line. The raw stream text is scanned for structural labels and reasoning state; body text is not included in the diagnostic summary.

## Current DurinDoor behavior

- `open-sse/utils/streamHandler.js` (`pipeWithDisconnect`) already runs a first-byte/TTFT timer and an inter-chunk stall timer on raw upstream bytes. It tracks chunk count and total bytes, reports those counts and elapsed time through the existing stream debug logger, and classifies the timeout as TTFT or stall. `tests/unit/stream-first-chunk-timeout.test.js` covers the no-byte deadline, empty chunks, and timer disarm after the first byte.
- `open-sse/handlers/chatCore/emptyStreamGuard.js` implements Antigravity empty-attempt retries and a one-shot bounded terminal drain. The drain deadline starts at the first confirmed terminal, is checked before reads, does not extend on repeated terminal frames, and cancels the upstream reader after completion. Its comments document the timeout/cancellation semantics and `tests/unit/empty-stream-terminal-1073.test.js` covers terminal handling, late usage, and reader cancellation.
- `open-sse/utils/emptyStreamTerminal.js` guards empty successful terminal frames across OpenAI, Responses, and Claude formats. It delays a terminal only for its short grace interval, emits a format-specific error for a confirmed empty result, and releases held data on cancellation; the same `empty-stream-terminal-1073` suite covers those outcomes.
- Request lifecycle correlation already exists in `open-sse/handlers/chatCore.js`: a session-derived `reqTag` is used for request and completion logging, and an OTel `timelineTraceId` is passed to streaming. `open-sse/handlers/chatCore/streamingHandler.js` classifies abandoned streams and records the resulting request detail. `open-sse/utils/streamLifecycle.js` distinguishes stall timeout, TTFT timeout, transport termination, and generic stream error. These provide correlated outcome/reason records; they do not currently emit the proposed per-verdict line or upstream event-type census.

## Assessment

No independently useful runtime fix remains for buffered empty-turn recovery, phase deadlines, or cancellation: the current implementation already has those controls in the relevant paths. The source change is primarily new telemetry. Existing DurinDoor debug logs already expose byte/chunk counts and timeout category, while existing request details and trace tags correlate stream outcomes. What is absent is the additional content-stall snapshot of SSE event types and open reasoning state, plus an explicit one-line buffered verdict with correlation and trace IDs.

That telemetry could make a stalled stream easier to diagnose, but it does not change runtime behavior and is not required to close a known recovery or deadline gap in this integration. Do not port the runtime code solely for parity. This assessment is based on source and test inspection; no test suite was run because this report-only change does not alter behavior.

## Local evidence

- `open-sse/utils/streamHandler.js`: TTFT/stall timers, byte/chunk accounting, and cleanup on stream termination.
- `tests/unit/stream-first-chunk-timeout.test.js`: TTFT behavior and first-byte timer cleanup.
- `open-sse/handlers/chatCore/emptyStreamGuard.js` and `tests/unit/empty-stream-terminal-1073.test.js`: empty completion handling, bounded terminal drain, usage preservation, and cancellation.
- `open-sse/utils/emptyStreamTerminal.js` and `tests/unit/empty-stream-terminal-1073.test.js`: buffered terminal verdict and cancellation behavior.
- `open-sse/utils/streamLifecycle.js`, `open-sse/handlers/chatCore.js`, and `open-sse/handlers/chatCore/streamingHandler.js`: timeout classification and request-correlated lifecycle tracing/details.
