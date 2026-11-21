# #1073 Preserve Cursor Composer answers and protocol framing

**Status: adapted.** This report records the complete boundary-preserving port of OmniRoute [#4842](https://github.com/cheaper-inference/OmniRoute/pull/4842), replacing the earlier withdrawn global-stripping proposal.

## Exact source and prior work

| Item | Reference |
|---|---|
| Upstream PR | OmniRoute [#4842](https://github.com/cheaper-inference/OmniRoute/pull/4842) (`fix(sse): strip Composer <｜final｜> sentinel markers leaking after Composer reasoning`) |
| Pinned PR head | [`66aa394b53a6b4b34ac57f7ba453f968aff310f4`](https://github.com/cheaper-inference/OmniRoute/commit/66aa394b53a6b4b34ac57f7ba453f968aff310f4) |
| Enclosing merge | [`7d2501b2862cf58cce5a2fad9e1f692f5c35edcd`](https://github.com/cheaper-inference/OmniRoute/commit/7d2501b2862cf58cce5a2fad9e1f692f5c35edcd) |
| Prior unpublished candidate | `be88c41bb06a05a503b762a3cef3d978f6bb1d91` (carried forward useful test framing; rejected global marker deletion and fallback changes) |
| Withdrawal record | `92981e8922ae9561e738f9c387b31b49bc65e959` ([the withdrawal report](1073-cursor-composer-marker-withdrawal.md)) |

## Scope

Allowed and modified files:

- [`open-sse/executors/cursor.js`](../../../open-sse/executors/cursor.js)
- [`tests/unit/cursor-composer-thinking.test.js`](../../../tests/unit/cursor-composer-thinking.test.js)
- [`tests/unit/cursor-agent-exec-request.test.js`](../../../tests/unit/cursor-agent-exec-request.test.js)
- [This report](1073-cursor-composer-markers-complete-4842.md) and disposition updates in [the #4842 candidate record](1073-cursor-composer-final-markers-4842.md), [the source audit](1073-late-june-existing-cursor-visible-output.md), and [the withdrawal report](1073-cursor-composer-marker-withdrawal.md)

No new product feature, rendering mode, or tool was added. No baseline, workflow, or unrelated provider file was modified.

## Why upstream #4842 and candidate `be88c41bb06` were adapted

1. Upstream [#4842](https://github.com/cheaper-inference/OmniRoute/pull/4842) used broad regular expressions (`^\s*<(?![｜|/])` and `^\s*<[｜|][^>]*$`) that matched any `<`-prefixed visible answer such as HTML markup (`<div>...</div>`) or `<|finish>` and withheld it indefinitely, while `.trim()` stripped intended answer whitespace.
2. Unpublished candidate `be88c41bb06a05a503b762a3cef3d978f6bb1d91` replaced all four literal tokens everywhere in the visible suffix via `.split(marker).join("")`. That deleted quoted marker literals inside ordinary answer bodies and altered `flushThinkingFallback` so fallback emission could still fire after native output.

## Implemented behavior

[`open-sse/executors/cursor.js`](../../../open-sse/executors/cursor.js) now routes Composer thinking output in `executeAgent`, `transformProtobufToSSE`, and `visibleComposerContentFromThinking` (`transformProtobufToJSON`) through a bounded state-machine helper `createComposerThinkingExtractor()`:

- **Private reasoning containment (`thinking` phase):** Scans for `</think>` using at most a 7-character tail (`COMPOSER_THINK_END.length - 1`). Unclosed reasoning never leaves the extractor and is never buffered unboundedly.
- **Boundary-only opening detection (`opening` phase):** After `</think>`, trims leading whitespace only before non-whitespace starts arriving, then checks strictly against the two recognizable opening sentinels `<|final|>` (ASCII U+007C) and `<｜final｜>` (full-width U+FF5C). Proper prefixes (at most 8 characters) wait for the next chunk; non-matching markup or text (such as `<b>keep</b>`, `<div>ok</div>`, `< 5`, or `<|finish>`) switches immediately to unframed passthrough (`expectedClose = null`) without altering whitespace or interior literals.
- **Paired closing boundary masking (`body` phase):** Only when an opening sentinel was stripped does the extractor watch for its matching closing sentinel (`<|/final|>` for `<|final|>`, `<｜/final｜>` for `<｜final｜>`), holding at most a 10-character suffix (`expectedClose.length`) that matches a prefix of that closing tag. Any interior quoted opening or closing marker followed by additional content is flushed on the following chunk with zero replay and O(1) bounded memory. Unframed responses and mismatched closing tags emit immediately with zero holdback.
- **Clean EOF and tool boundary flush (`finish()`):** On normal turn end (`turn_ended`, clean protobuf stream EOF, or MCP `tool_call` emission in `executeAgent`), an exact pending `expectedClose` is stripped as closing framing, while an incomplete opening or closing prefix (such as `<|/fin`) is emitted as literal text.
- **Preserved controls:**
  - Native `text_delta` / `result.text` output bypasses the Composer thinking extractor and suppresses Composer thinking fallback (`emittedNativeText`).
  - Non-Composer models (such as Grok and Codex) keep their existing reasoning/fallback contracts unchanged.
  - Abort/cancellation throws before `finishTurn()` without flushing held partial markers or emitting a synthetic `stop` chunk.

## Offline verification

Executed offline after the implementation and test additions (no live provider traffic, no credentials, no skipped or weakened assertions):

```bash
test -s internal/docs/port-reports/1073-cursor-composer-markers-complete-4842.md && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/cursor-composer-thinking.test.js unit/cursor-agent-exec-request.test.js)
```

Offline fixtures in [`tests/unit/cursor-composer-thinking.test.js`](../../../tests/unit/cursor-composer-thinking.test.js) and [`tests/unit/cursor-agent-exec-request.test.js`](../../../tests/unit/cursor-agent-exec-request.test.js) cover buffered and fragmented true-framing responses with interior quoted markers (including 1-character fragmentation and adjacent boundary markers), earlier partial-marker and markup controls, incremental streaming without replay, hidden reasoning without `</think>`, untouched native output, protobuf and MCP tool calls alongside framed/unclosed thinking, and mid-stream cancellation/abort. They do not establish live provider behavior.
