# Payload Admission and Pressure Shedding

## Overview

DurinDoor provides process-local, bounded payload-aware admission and held-stream management in `open-sse/services/payloadAdmission.js`, integrated alongside the existing hierarchical concurrency gate in `open-sse/services/concurrencyGate.js`.

This primitive protects against memory exhaustion, event-loop starvation, and unconstrained SSE socket holding caused by large request bodies and long-lived client streaming sessions (ports OmniRoute #13762, #14457, #14566, DurinDoor issue #1106).

## Resource Bounds

The admission controller enforces four distinct deterministic bounds:

1. **Process-wide Byte Budget** (`MAX_PAYLOAD_ADMISSION_BYTES`, default `67108864` / 64 MB):
   The maximum aggregate in-flight request payload bytes permitted across all concurrent active requests in the serving Node process.
2. **Single Payload Limit** (`MAX_SINGLE_PAYLOAD_BYTES`, default `16777216` / 16 MB):
   Hard ceiling for any single request body. Requests exceeding this are rejected immediately with HTTP 413 `PAYLOAD_TOO_LARGE` without queueing.
3. **Concurrent Held Streams** (`MAX_HELD_STREAMS`, default `100`):
   Maximum number of long-lived active streaming connections (SSE `text/event-stream`). Non-streaming requests bypass this check.
4. **Queue Depth and Pressure Shedding** (`MAX_ADMISSION_QUEUE_DEPTH`, default `50`):
   When active capacity is exhausted, new requests enter a bounded FIFO queue. If the queue depth reaches the configured limit, incoming requests are shed immediately with HTTP 503 `QUEUE_FULL` rather than queueing indefinitely.
5. **Wait Timeout** (`CONCURRENCY_GATE_TIMEOUT_MS`, default `120000` / 2 minutes):
   Waiters in the queue that do not acquire capacity before the timeout expires are rejected with HTTP 503 `TIMEOUT`.

## Lifecycle and Exactly-Once Release Guarantees

Every admitted request receives an idempotent lease. Capacity is released exactly once across all lifecycle completion paths:

- **Client Abort While Queued**: Removed from queue immediately; timer and signal listeners are cleaned up; no capacity is leaked.
- **Client Abort While Pending**: If the client disconnects while the upstream provider handler is still executing (`releaseAdmissionWhenDone`), the lease is released immediately without waiting for the slow/hung handler to finish (OmniRoute fix #14566).
- **Early or Non-Streaming Response**: If an error (e.g. 4xx/5xx) or non-streaming response is returned, the lease is released immediately.
- **Handler Failure / Exception**: Uncaught errors in upstream processing automatically trigger lease release and rethrow.
- **Streaming Completion / Disconnect**: For streaming responses, the body stream is wrapped to release the lease upon EOF (`done: true`), stream error (`controller.error`), client stream cancellation (`reader.cancel`), or abort signal.

## Concurrency Gate Integration

`open-sse/services/concurrencyGate.js` exports `acquireMany(tiers, timeoutMs, signal, payloadOptions)`.
When `payloadOptions` is passed, `acquirePayloadAdmission` runs before gate slot acquisition. If any subsequent tier fails or times out, the acquired payload lease is rolled back immediately alongside any acquired gate keys, ensuring all-or-nothing atomicity.

## Environment Configuration

| Variable | Default | Description |
|---|---|---|
| `MAX_PAYLOAD_ADMISSION_BYTES` | `67108864` (64 MB) | Process-wide total active payload byte budget |
| `MAX_SINGLE_PAYLOAD_BYTES` | `16777216` (16 MB) | Maximum size in bytes for a single request payload |
| `MAX_HELD_STREAMS` | `100` | Maximum concurrent active long-lived SSE streams |
| `MAX_ADMISSION_QUEUE_DEPTH` | `50` | Maximum queue depth before immediate pressure shedding |
| `CONCURRENCY_GATE_TIMEOUT_MS` | `120000` (2 min) | Maximum wait time in queue before timing out |
