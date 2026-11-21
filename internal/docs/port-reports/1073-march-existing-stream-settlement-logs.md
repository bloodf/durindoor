# #1073 March: existing stream settlement metadata

## Scope and pins

Compared the exact public PR heads and their enclosing merge references, limiting review to ordinary stream usage, error, completion, and settlement behavior. The source was inspected statically alongside existing synthetic/offline fixtures. No real request payloads, credentials, provider traffic, or raw-body logging behavior were inspected or proposed. No payload archival, retention changes, raw body exposure, or logging modes are in scope.

| PR | Exact public head | Enclosing merge | Exact patch |
| --- | --- | --- | --- |
| [OmniRoute #420](https://github.com/cheaper-inference/OmniRoute/pull/420) | `05e568feb03063f95d42b387d4783d35d21fd343` | `cd6eca042437c2f2c68319052638d510b5767a6e` | [head diff](https://github.com/cheaper-inference/OmniRoute/commit/05e568feb03063f95d42b387d4783d35d21fd343) |
| [OmniRoute #603](https://github.com/cheaper-inference/OmniRoute/pull/603) | `35538e6f777a15ff17263a7d4c22153cc7f525c1` | `bb8545b3e1f44d9281187f5f88819b3fdaca1511` | [head diff](https://github.com/cheaper-inference/OmniRoute/commit/35538e6f777a15ff17263a7d4c22153cc7f525c1) |
| [OmniRoute #771](https://github.com/cheaper-inference/OmniRoute/pull/771) | `bb75b73bac888bac1e88aeb389081ae541058fc3` | `370070f48942abee9b0ed14932438403de3ddb82` | [head diff](https://github.com/cheaper-inference/OmniRoute/commit/bb75b73bac888bac1e88aeb389081ae541058fc3) |

For #420 and #603, the merge parents confirm that the listed head is the merged patch. The #771 enclosing merge has a single parent and a different subject (`fix(stream): normalize delta.reasoning alias and separate reasoning in client response (#771)`); it does not contain the listed head as a merge parent. Therefore the #771 comparison below is strictly the supplied head patch, not an inference from that enclosing commit.

## Current behavior and fixture evidence

Current stream code is `open-sse/utils/stream.js` (the public patches target upstream TypeScript `open-sse/utils/stream.ts`). In passthrough handling, the current writer extracts and merges usage receipts before filtering empty chunks. It tracks content and reasoning in ordinary Chat chunks, synthesizes missing usage at completion, logs usage, and invokes the completion callback once. Claude passthrough validates the native `message_stop` terminal and does not append an OpenAI `[DONE]` marker. The existing Claude summary also merges `message_start` input usage with `message_delta` output usage.

Ordinary fixture evidence already in the tree:

- `tests/unit/stream-completion-usage.test.js` exercises synthetic OpenAI finish-plus-late-usage frames and a Claude passthrough sequence of `message_start`, tool input, `message_delta` usage, and `message_stop`; it asserts one completion and the reconstructed provider response usage/tool input.
- `tests/unit/omni-client-terminal-usage-trailer.test.js` checks that a matching adjacent receipt reaches a single Claude `message_delta` terminal and that a neighboring response's receipt is not attributed to it.
- `tests/unit/passthrough-usage-trailer.test.js` covers real-versus-estimated OpenAI usage settlement and no-usage fallback with synthetic frames.
- `tests/unit/omni-claude-cache-write-terminal-usage.test.js` covers Claude terminal cache usage normalization, including aliases and explicit zero. This is translator-side behavior, not proof of Claude-native passthrough estimation.
- `tests/unit/omni-response-mask-reasoning-shape.test.js` has a synthetic combined `reasoning_content` + `content` chunk and asserts both text streams are preserved once through response masking. It does not exercise the passthrough writer's event separation.

No new fixture was run or added for this documentation-only comparison.

## Per-PR disposition

### #420 — Claude SSE usage extraction and format-aware fallback

The head adds Claude event recognition in the upstream passthrough parser, merges nonzero prompt/completion/cache usage from `message_start` and `message_delta`, counts native text/thinking, and uses `sourceFormat` when estimating fallback usage. Current local code already runs generic `extractUsage(parsed)` / `mergeUsage` on passthrough frames, and the Claude completion summary fixture verifies native start/delta usage. However the ordinary passthrough close fallback at `open-sse/utils/stream.js` still calls `estimateUsage(body, totalContentLength, FORMATS.OPENAI)`; the upstream change's format-aware fallback is not present. Its exact effect on cost/token semantics needs an offline regression demonstrating a differing Claude-vs-OpenAI estimate before any implementation is justified.

**Disposition: partial narrow gap; defer implementation pending a deterministic unit fixture.** Ordinary offline acceptance should feed a synthetic Claude-native message start, text/thinking delta, message delta, and stop through the passthrough writer; verify actual usage is preserved without an estimate, and separately omit usage and assert only the format-appropriate estimate is settled once. Include a control proving OpenAI passthrough fallback remains unchanged. No provider call or persistence inspection is needed.

### #603 — ToolCall type and formatting refactor

The exact head introduces a `ToolCall` type, replaces an inline conditional with equivalent key-selection branches, and reformats the normalized log response tool-call mapping. It changes no usage, error, completion, or settlement semantics. Current local source already has typed runtime validation and ordinary tool-call completion coverage, including delayed tool input in `stream-completion-usage.test.js`.

**Disposition: do not port; no behavioral gap.** No acceptance work is warranted for this refactor beyond the existing offline tool-call completion fixture if that source area is later changed.

### #771 — split mixed reasoning/content stream delta

The exact head splits a same-event OpenAI delta containing both `reasoning_content` and `content`: it emits reasoning first with no finish/usage, then leaves content and terminal metadata on the original event. The stated client issue is loss of content for consumers that branch on reasoning presence. Current passthrough normalization has no equivalent split. The existing response-masking fixture confirms mixed fields can occur and validates preservation, but does not establish that passthrough consumers receive separate events. The upstream behavior is narrow stream-wire behavior, not a usage accounting change; it must preserve finish reason and usage exactly once on the content-side event.

**Disposition: narrow candidate gap; require ordinary offline wire acceptance before porting.** Add a synthetic passthrough fixture with one combined delta, followed by a terminal chunk carrying finish reason and usage. Assert two ordered events, reasoning only in the first, content only in the second, unchanged content/reasoning bytes, and terminal/usage metadata emitted exactly once and retained on the content-side event. Include a content-only and reasoning-only control to prove unchanged framing. No live provider, browser, or raw request logging is necessary.

## Summary

#603 is a no-op for the requested settlement scope. #420's generic usage extraction and native Claude completion summary already exist, while format-aware fallback estimation remains unproven and narrowly testable. #771's mixed-delta split is absent and has a concrete synthetic wire-level acceptance shape, but the supplied existing fixture only proves preservation through masking. Any follow-up product change requires its ordinary offline test and an accompanying documentation note under the repository contributor contract.
