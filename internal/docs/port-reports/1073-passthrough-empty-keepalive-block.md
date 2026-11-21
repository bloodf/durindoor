# #1073: provider empty keepalive blocks are dropped on existing Chat and Responses passthrough

Source: [OmniRoute #1146](https://github.com/cheaper-inference/OmniRoute/pull/1146), PR head `1e7df542df2e5ed17cb49195ccdeab4b7ec9bf51` (`fix(stream): tighten keepalive cleanup`, on top of `3c9ba43fb90cfcf541df458a3bb976057bcabd5f` `fix(stream): harden responses SSE keepalives`), squash-merged upstream as `bd33b53805cc69f90a161383273f921f8b71d3ff` (`fix(stream): harden responses SSE keepalives (#1146)`). The upstream comparison used the merge's exact first-parent diff (`bd33b53805cc69f90a161383273f921f8b71d3ff^` = `1d6739b6833b8f8f4c3f02c0ba2ef1b6227fca1d` → `bd33b53805cc69f90a161383273f921f8b71d3ff`) read in the local mirror `/var/tmp/durindoor-omniroute-source.4eUb6QtM/source.git` (read-only metadata and diff; no provider traffic, no credentials).

Disposition: **partial port, adapted to local contracts.** Only the removal of a provider's empty `event: keepalive` block is ported. The upstream heartbeat timer is not.

## What the source changes

The upstream PR has two halves:

1. **A passthrough filter (ported).** In `open-sse/utils/stream.ts` the passthrough line loop drops a whole provider keepalive event block: the `event: keepalive` label is consumed, and every line of that block is dropped until the blank line that terminates it. The upstream head commit is the tightened form of the first commit (which dropped only a bare `event: keepalive` label); the tightened form also covers `event: keepalive` followed by a `data:` line with an empty payload, and drops a stream tail that ends inside such a block. The upstream test asserts the Responses delta after the block still arrives and that no empty `data:` line survives.
2. **A Responses heartbeat timer (not ported).** `open-sse/utils/sseHeartbeat.ts` (new) injects `: keepalive <iso>\n\n` comments every 15 s into Responses streams, and `open-sse/handlers/responsesHandler.ts` threads an `AbortSignal` so the timer is cleared when the request aborts. This is new protocol behavior, not a bug fix, and is out of scope for this port.

## Local trace

| Source path | Local owner | Finding |
| --- | --- | --- |
| Passthrough keepalive block removal | `createSSEStream` in [open-sse/utils/stream.js](../../open-sse/utils/stream.js) | **Gap.** A provider `event: keepalive` block with an empty `data:` payload reached the client verbatim in both passthrough shapes: in Chat passthrough the label is held by the 9router #5441 field buffer and the empty data line marks the frame as *having* data, so the pair was emitted as `event: keepalive\ndata: `; in Responses passthrough the label is held in `pendingSSEFields` and flushed in front of the same empty data line. Strict OpenAI-compatible SDKs `JSON.parse` that empty payload and crash. |
| Field-only SSE frames (9router #5441) | `filterEmptyOpenAIFrames` in [open-sse/utils/stream.js](../../open-sse/utils/stream.js) | Already covered, and kept as is. A label with no data line is still dropped. The keepalive block was the one case it did not cover, because the empty `data:` line counts as data. |
| Upstream `sseHeartbeat.ts` + `responsesHandler.ts` signal plumbing | [open-sse/utils/earlyStreamKeepalive.js](../../open-sse/utils/earlyStreamKeepalive.js), `SSE_KEEPALIVE_MS` in [open-sse/config/runtimeConfig.js](../../open-sse/config/runtimeConfig.js), `pipeWithDisconnect` in [open-sse/utils/streamHandler.js](../../open-sse/utils/streamHandler.js) | **Not ported.** DurinDoor already generates its own client-facing keepalives (an SSE comment for Chat clients, a real `event: ping` for Anthropic clients) downstream of the provider transform. Adding the upstream timer would introduce a heartbeat option and a new timer, which this port does not do. |
| Anthropic ping frames | `ANTHROPIC_PING_FRAME` in [open-sse/utils/earlyStreamKeepalive.js](../../open-sse/utils/earlyStreamKeepalive.js), Claude passthrough | Untouched. `event: ping` is a different frame from `event: keepalive` and is still forwarded, including the gateway-generated ping shape. |
| Provider dispatch | [open-sse/handlers/chatCore/streamingHandler.js](../../open-sse/handlers/chatCore/streamingHandler.js) | Untouched. The port reads no provider metadata and adds no routing rule. |

## Change

- New [open-sse/utils/providerKeepalive.js](../../open-sse/utils/providerKeepalive.js): `isProviderKeepaliveEvent(line)` matches the provider's own `event: keepalive` label (`^event:\s*keepalive\b`, case-insensitive, so `keepalives` does not match), and `createProviderKeepaliveFilter()` owns the block boundaries — it drops the label and the block body up to the blank line that terminates the frame.
- [open-sse/utils/stream.js](../../open-sse/utils/stream.js): the passthrough line loop consults the filter **before** the framing decisions (the event-label handling and the pending field buffers), so a keepalive label never enters `pendingSSEFields` and never reaches the client. The filter runs for Chat (`FORMATS.OPENAI`) and Responses (`FORMATS.OPENAI_RESPONSES`) passthrough only. The flush path drops a tail that ends inside a dropped block or on the keepalive label itself.

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

`tests/unit/omni-passthrough-empty-keepalive-block.test.js` has 12 cases: the keepalive block is dropped in Chat passthrough, in Responses passthrough, in a 3-byte-chunked fixture, in a CRLF fixture, and in a stream that ends inside the block; the payload after the block and the completion order are kept; the Anthropic ping frame, the SSE comment, the error frame, the `[DONE]` terminal and the 9router #5441 field-only rule are preserved; and the filter's own label matching is unit-tested. With the two production edits reverted, the 5 removal cases fail and the 7 preservation cases still pass; with the edits applied all 12 pass.

Adjacent suites also pass: 25 files / 207 tests covering the passthrough decloak and normalization paths, the Responses sequence-replay suppression, the empty-stream terminal guard, the pending-SSE-line limit, the Antigravity terminal drain, the Responses snapshot and completion watchdogs, and the keepalive error frame and early-stream keepalive configuration.

Limits: no real provider, credential, browser, Docker or whole-suite run. The upstream Codex CLI replay check was not reproduced. Dependencies for the run were installed from the frozen lockfiles into this worktree only.
