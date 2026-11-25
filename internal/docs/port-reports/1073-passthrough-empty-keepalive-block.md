# #1073: provider empty keepalive blocks are dropped on existing Chat and Responses passthrough

Source: [OmniRoute #1146](https://github.com/cheaper-inference/OmniRoute/pull/1146), PR head `1e7df542df2e5ed17cb49195ccdeab4b7ec9bf51` (`fix(stream): tighten keepalive cleanup`, on top of `3c9ba43fb90cfcf541df458a3bb976057bcabd5f` `fix(stream): harden responses SSE keepalives`), squash-merged upstream as `bd33b53805cc69f90a161383273f921f8b71d3ff` (`fix(stream): harden responses SSE keepalives (#1146)`). The upstream comparison used the merge's exact first-parent diff (`bd33b53805cc69f90a161383273f921f8b71d3ff^` = `1d6739b6833b8f8f4c3f02c0ba2ef1b6227fca1d` → `bd33b53805cc69f90a161383273f921f8b71d3ff`) (read-only metadata and diff; no provider traffic, no credentials).

Disposition: **partial port, adapted to local contracts.** The integrated local correction is recorded in commit `26b63702ea023de10b5436c8147fc0635b7be42c` and [1073-keepalive-normal-stream-processing.md](1073-keepalive-normal-stream-processing.md). It filters only the exact empty provider keepalive frame. The upstream heartbeat timer is not ported.

## What the source changes

The upstream PR has two halves:

1. **The pinned upstream implementation.** In `open-sse/utils/stream.ts` the upstream passthrough line loop drops a whole provider keepalive event block through its terminating blank line. Its tightened head commit also covers a `data:` line with an empty payload and a stream tail ending inside such a block. This describes the pinned source implementation, not the final local implementation.
2. **A Responses heartbeat timer (not ported).** `open-sse/utils/sseHeartbeat.ts` (new) injects `: keepalive <iso>\n\n` comments every 15 s into Responses streams, and `open-sse/handlers/responsesHandler.ts` threads an `AbortSignal` so the timer is cleared when the request aborts. This is new protocol behavior, not a bug fix, and is out of scope for this port.

## Integrated local behavior

The local correction in `26b63702ea023de10b5436c8147fc0635b7be42c` buffers a candidate exact `event: keepalive` frame and sends data-bearing or otherwise nonempty candidates through the regular existing Chat and Responses passthrough processing. That path retains normal usage accounting and related stream handling. Only the exact empty provider keepalive frame is filtered. Prefix or similarly named labels, including `keepalives`, and data-bearing `keepalive` events follow the normal path. See [1073-keepalive-normal-stream-processing.md](1073-keepalive-normal-stream-processing.md) for the focused correction evidence.

## Local trace

| Source path | Local owner | Finding |
| --- | --- | --- |
| Passthrough keepalive block removal | `createSSEStream` in [open-sse/utils/stream.js](../../../open-sse/utils/stream.js) | **Corrected.** Only the exact empty provider `event: keepalive` frame is filtered. Before the correction, an empty `data:` line made the frame appear to carry data: Chat held the label in the 9router #5441 field buffer, while Responses held it in `pendingSSEFields`. The integrated correction now filters this exact empty frame before it can reach strict SDK JSON parsing; data-bearing frames proceed through normal processing. |
| Field-only SSE frames (9router #5441) | `filterEmptyOpenAIFrames` in [open-sse/utils/stream.js](../../../open-sse/utils/stream.js) | Already covered, and kept as is. A label with no data line is still dropped. The keepalive block was the one case it did not cover, because the empty `data:` line counts as data. |
| Upstream `sseHeartbeat.ts` + `responsesHandler.ts` signal plumbing | [open-sse/utils/earlyStreamKeepalive.js](../../../open-sse/utils/earlyStreamKeepalive.js), `SSE_KEEPALIVE_MS` in [open-sse/config/runtimeConfig.js](../../../open-sse/config/runtimeConfig.js), `pipeWithDisconnect` in [open-sse/utils/streamHandler.js](../../../open-sse/utils/streamHandler.js) | **Not ported.** DurinDoor already generates its own client-facing keepalives (an SSE comment for Chat clients, a real `event: ping` for Anthropic clients) downstream of the provider transform. Adding the upstream timer would introduce a heartbeat option and a new timer, which this port does not do. |
| Anthropic ping frames | `ANTHROPIC_PING_FRAME` in [open-sse/utils/earlyStreamKeepalive.js](../../../open-sse/utils/earlyStreamKeepalive.js), Claude passthrough | Untouched. `event: ping` is a different frame from `event: keepalive` and is still forwarded, including the gateway-generated ping shape. |
| Provider dispatch | [open-sse/handlers/chatCore/streamingHandler.js](../../../open-sse/handlers/chatCore/streamingHandler.js) | Untouched. The correction reads no provider metadata and adds no routing rule. |

## Change

- New [open-sse/utils/providerKeepalive.js](../../../open-sse/utils/providerKeepalive.js): `isProviderKeepaliveEvent(line)` matches the provider's own `event: keepalive` label (`^event:\s*keepalive\b`, case-insensitive, so `keepalives` does not match), and `createProviderKeepaliveFilter()` owns the block boundaries — it drops the label and the block body up to the blank line that terminates the frame.
- [open-sse/utils/stream.js](../../../open-sse/utils/stream.js): the stream loop buffers a possible exact empty keepalive frame and releases nonempty content through normal Chat (`FORMATS.OPENAI`) and Responses (`FORMATS.OPENAI_RESPONSES`) processing. Only an exact empty frame is suppressed.

Preserved by construction and asserted by the tests: the payload that follows the block and its order, genuine Anthropic `event: ping` frames, SSE comments, error and terminal frames (`data: [DONE]`, `response.completed`), the gateway-generated keepalives (which never travel through this transform), and the 9router #5441 field-only-frame rule.

## Deliberately not changed

- **No timer, heartbeat option, provider dispatch or other protocol behavior.** The upstream `sseHeartbeat.ts` transform and the `AbortSignal` plumbing in `responsesHandler.ts` are not ported.
- **No provider routing or registry change.** The filter is a property of the passthrough framing, not of a provider.
- **Claude and Gemini passthrough are untouched**, so Anthropic clients keep their native `event: ping` frames and the Claude terminal contract is unchanged.
- **No public documentation change.** The visible difference is that a frame which carried no payload is no longer forwarded; the operator- and client-visible contract is otherwise the same.
- **No existing test assertion was changed.** `tests/unit/passthrough-sse-field-only-5441.test.js` and the other stream suites are untouched and still pass.

## Verification

Offline only, with bounded synthetic fixtures (no provider traffic, no credentials, no browser, no Docker, no e2e, no whole-suite run):

```bash
rg -q -F 1e7df542df2e5ed17cb49195ccdeab4b7ec9bf51 internal/docs/port-reports/1073-passthrough-empty-keepalive-block.md && \
rg -q -F bd33b53805cc69f90a161383273f921f8b71d3ff internal/docs/port-reports/1073-passthrough-empty-keepalive-block.md && \
(cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-passthrough-empty-keepalive-block.test.js)
```

The historical unit checks in `tests/unit/omni-passthrough-empty-keepalive-block.test.js` had 12 cases: the keepalive block is dropped in Chat passthrough, in Responses passthrough, in a 3-byte-chunked fixture, in a CRLF fixture, and in a stream that ends inside the block; the payload after the block and the completion order are kept; the Anthropic ping frame, the SSE comment, the error frame, the `[DONE]` terminal and the 9router #5441 field-only rule are preserved; and the filter's own label matching is unit-tested. These are historical checks for the earlier implementation. The integrated correction and expanded current behavior are documented in [1073-keepalive-normal-stream-processing.md](1073-keepalive-normal-stream-processing.md).

Adjacent suites also pass: 25 files / 207 tests covering the passthrough decloak and normalization paths, the Responses sequence-replay suppression, the empty-stream terminal guard, the pending-SSE-line limit, the Antigravity terminal drain, the Responses snapshot and completion watchdogs, and the keepalive error frame and early-stream keepalive configuration.

Limits: no real provider, credential, browser, Docker or whole-suite run. The upstream Codex CLI replay check was not reproduced. Dependencies for the run were installed from the frozen lockfiles into this worktree only.
