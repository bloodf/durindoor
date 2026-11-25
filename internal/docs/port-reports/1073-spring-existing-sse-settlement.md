# #1073: existing Responses metadata and stream settlement

Static comparison of three exact OmniRoute pull request heads with the current DurinDoor source and offline fixtures. The listed merge commits are enclosing records; the comparison uses each named PR head's patch, not unrelated first-parent changes. No source or test files were changed and no tests were run.

## Source pins

| PR | Exact head and patch | Enclosing merge |
| --- | --- | --- |
| [OmniRoute #1580](https://github.com/cheaper-inference/OmniRoute/pull/1580) | [`e94d22c8b3d62bc43f1fc610892aefd5c86937b9`](https://github.com/cheaper-inference/OmniRoute/commit/e94d22c8b3d62bc43f1fc610892aefd5c86937b9) | `e64dc3b4316d3b55194e1122592a6cfdb1c11201` |
| [OmniRoute #1798](https://github.com/cheaper-inference/OmniRoute/pull/1798) | [`3496df8b4513403e71c5533a9e8f09701402a2b3`](https://github.com/cheaper-inference/OmniRoute/commit/3496df8b4513403e71c5533a9e8f09701402a2b3) | `13b5a50f80f47054835d17f44adb5a3f0aa6bd3d` |
| [OmniRoute #2190](https://github.com/cheaper-inference/OmniRoute/pull/2190) | [`9234b90418fadf5fa2bedbb6d45a5beec151baef`](https://github.com/cheaper-inference/OmniRoute/commit/9234b90418fadf5fa2bedbb6d45a5beec151baef) | `13f7ebce5a5a10090d4196334cc27348d0ed9d43` |

## Dispositions

### #1580 — Responses lifecycle echo size and terminal output snapshot

The PR adds two narrow transformations in upstream `open-sse/utils/stream.ts`: it removes only `instructions` and `tools` from `response.created`, `response.in_progress`, and `response.completed`; and it collects `response.output_item.done` items to backfill an empty or absent `response.completed.response.output`, without replacing a populated snapshot. Its new fixture tests also pin malformed/no-op cases, preservation of unrelated usage/data, and no mutation of incremental events or Chat Completions chunks. See the [exact PR patch](https://github.com/cheaper-inference/OmniRoute/commit/e94d22c8b3d62bc43f1fc610892aefd5c86937b9.patch).

**Disposition: narrow lifecycle-echo gap; output-snapshot concern is not established as a gap.** Current [`open-sse/utils/stream.js`](../../../open-sse/utils/stream.js) has same-format Responses passthrough, preserves its event/data framing, tracks terminal state and replay, and records a populated `response.completed` snapshot. The offline [`responses-snapshot-source-order.test.js`](../../../tests/unit/responses-snapshot-source-order.test.js) exercises completed-snapshot recovery, repeated terminal snapshots, and tool identity; `omni-passthrough-empty-keepalive-block.test.js` exercises Responses passthrough framing. The inspected passthrough normalizer has no counterpart for lifecycle echo removal, so large echoed instructions/tools remain on those lifecycle frames. The source patch's empty-output backfill is not demonstrated as necessary locally: existing Responses snapshot and completion paths already consume stream events, and no local fixture establishes a client requiring the upstream snapshot workaround. Do not port that backfill based on source rationale alone.

If the lifecycle-size behavior is taken forward, ordinary offline acceptance should add bounded fixtures to the existing passthrough test coverage: remove only those two fields from the three lifecycle events, retain usage and other response fields, and assert incremental events and non-Responses formats are byte/semantically unaffected. Run the focused test file directly from `tests/` with the documented Vitest command. No provider traffic is needed.

### #1798 — pending-stat cleanup on passthrough failure

The exact patch adds `trackPendingRequest(model, provider, connectionId, false)` immediately before `controller.error(...)` on a passthrough `response.failed` path, with a regression fixture that checks the pending count is zero. See the [exact PR patch](https://github.com/cheaper-inference/OmniRoute/commit/3496df8b4513403e71c5533a9e8f09701402a2b3.patch).

**Disposition: pending-stat cleanup is already performed before stream-body passthrough; do not add a stream-local decrement.** DurinDoor starts pending accounting in `open-sse/handlers/chatCore.js` and calls idempotent `finishProviderRequest()` once the provider returns an HTTP response, before downstream handler consumption of the body. That call decrements the pending request and releases its concurrency slot; the stream controller's `onError` is separate request/session/quota settlement. Thus a later in-band `response.failed` body frame cannot leave this pending count stuck. The source patch adds a cleanup on its own passthrough error branch; in the local ownership model a second decrement there would duplicate accounting. The source fixture's `clearPendingRequests`/count assertion does not map directly to local usage state, so no new local regression fixture is warranted absent evidence that the pre-stream decrement is skipped.

### #2190 — Claude `[DONE]` terminal-signal coverage

The PR is test-only: a native Claude passthrough fixture ends with `message_stop` and asserts text and the stop event survive without an OpenAI `[DONE]` sentinel. See the [exact PR patch](https://github.com/cheaper-inference/OmniRoute/commit/9234b90418fadf5fa2bedbb6d45a5beec151baef.patch).

**Disposition: behavior already present; equivalent coverage is substantially present.** The passthrough flush in `open-sse/utils/stream.js` excludes Claude streams from synthetic `[DONE]` and rejects a Claude stream that ends without `message_stop`. Offline evidence includes [`bypass-handler.test.js`](../../../tests/unit/bypass-handler.test.js) for a native Claude stream with `message_stop` and no `[DONE]`, and [`stream-abort-inband-error.test.js`](../../../tests/unit/stream-abort-inband-error.test.js) for Claude error framing without `[DONE]`. The #2190 fixture exercises a particular passthrough helper path, but it does not reveal a distinct product behavior gap in the local terminal contract.

## Boundary notes

The already-ported OmniRoute [#1146 empty-provider-frame correction](1073-keepalive-normal-stream-processing.md) concerns dropping an empty provider `event: keepalive` block while preserving ordinary data-bearing frames. It is separate from #1580 lifecycle metadata size and output snapshots. Likewise, the terminal-only #5496 reference is not evidence for #1580's metadata behavior or #1798's pending-stat settlement; these rows are resolved only against their pinned PR patches above. The local Claude behavior is assessed against #2190's exact head, not inferred from either adjacent item.

Evidence is source inspection plus existing fixture source; no live provider, credentials, paid API, browser, Docker, or e2e activity was used.
