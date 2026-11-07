# Payload admission and pressure shedding

The upstream dispatch boundary in `open-sse/handlers/chatCore.js` always calls
`acquireMany`, including when global and provider concurrency limits are disabled.
It reserves process-local payload bytes and streaming request capacity before
upstream dispatch. This does not bound JSON parsing or translation memory, which
happen before admission. Multiple server processes each have their own budget.

| Environment variable | Default | Bound |
|---|---|---|
| `MAX_PAYLOAD_ADMISSION_BYTES` | 67108864 | Aggregate admitted request bytes |
| `MAX_SINGLE_PAYLOAD_BYTES` | 16777216 | Individual serialized request bytes |
| `MAX_HELD_STREAMS` | 100 | Admitted requests with `stream` enabled |
| `MAX_ADMISSION_QUEUE_DEPTH` | 50 | Requests waiting for payload capacity |
| `CONCURRENCY_GATE_TIMEOUT_MS` | 120000 | Wait timeout per admission stage |

Configure these positive integer values before server startup. Requests larger
than either byte ceiling receive HTTP 413. Requests that cannot fit wait in a
bounded FIFO queue. A full queue or expired wait receives HTTP 503. Retry 503
responses with backoff; reduce payload size for 413 responses.

The existing provider completion/disconnect path releases the combined lease.
Provider errors, non-streaming completion, streaming completion and cancellation
retain that lifecycle. Payload capacity also releases on the request abort signal.
A failed or aborted concurrency-tier acquisition rolls back payload capacity and
all previously acquired tiers. Releases are idempotent. Concurrency tier queues
remain separate from the payload queue; sequential acquisition can hold payload
capacity while waiting for a provider slot.

Stream reservations follow the resolved upstream dispatch mode. Providers that
force streaming reserve stream capacity even when the client requests JSON;
hard non-streaming overrides do not reserve it. Local admission rejections carry
`admission_error` and the rejection code. The gateway returns that original
response without account cooldown, circuit failure accounting or sibling-account
rotation, because all accounts in the process share the same admission queue.

Concurrency-tier wait timeouts also carry the local admission marker. They return
503 without upstream dispatch and follow the same terminal gateway handling as
payload queue pressure; ordinary upstream 503 responses retain account fallback.
The gateway preserves the explicit local-admission marker as internal response
metadata for the outer transient retry loop. That loop returns the same response
without retrying. This metadata is not an upstream header or a client input;
unmarked upstream 502/503/504 responses retain transient retries.
