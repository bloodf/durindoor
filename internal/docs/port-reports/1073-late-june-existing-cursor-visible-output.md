# #1073 late-June Cursor visible output and reasoning replay

## Exact public pins

Each row records the requested PR head and enclosing merge. For #4554, the head commit itself only changes the quality baseline; the relevant source patch is visible in the enclosing merge diff.

| OmniRoute PR | Exact PR head | Enclosing merge | Patch scope |
|---|---|---|---|
| [#4554](https://github.com/cheaper-inference/OmniRoute/pull/4554) | `0e6e4db2774547aab333e484a028921ad7ed311f` | `3ffd6ffff1d3887ee3ac22c6cdf692e8f8c61527` | Merge adds Composer `</think>` visible-suffix extraction in the Cursor executor; the named head only raises the `cursor.ts` size baseline. |
| [#4842](https://github.com/cheaper-inference/OmniRoute/pull/4842) | `66aa394b53a6b4b34ac57f7ba453f968aff310f4` | `7d2501b2862cf58cce5a2fad9e1f692f5c35edcd` | Cursor executor strips full-width/ASCII `<final>` markers, including partial opening markers during streaming. |
| [#5122](https://github.com/cheaper-inference/OmniRoute/pull/5122) | `bcbb7d1aade3ef3a40a3fe455d3a6b139e6ad02c` | `58d942829f05179412f879b338538e963cf9d4fd` | Translator helper change preserves `reasoning_content` on assistant tool-call history when reasoning replay is required; merge also carries unrelated release-green test and changelog work. |

## Local behavior and ordinary fixtures

The local Cursor executor already includes AgentService and buffered protobuf adapters. `visibleComposerContentFromThinking` extracts the visible suffix after `</think>`, and `tests/unit/cursor-composer-thinking.test.js` and `tests/unit/cursor-agent-exec-request.test.js` exercise these paths directly. The earlier report incorrectly overlooked this executor and its fixtures.

For request history, `open-sse/translator/formats/openai.js` returns assistant messages with non-empty `tool_calls` before filtering message fields. That preserves `reasoning_content` on such messages as they pass through `filterToOpenAIFormat`. `tests/translator/port-3254-empty-tool-calls.test.js` records the local tool-call preservation boundary; `tests/translator/port-2401-reasoning-history-bridge.test.js` covers ordinary reasoning history round-trips. Neither shows a local replay failure for a reasoning-replay target. This evidence is limited to the helper behavior and ordinary offline fixtures; it does not claim live provider validation.

## Dispositions

### #4554 — already covered

The installed Cursor executor extracts Composer's visible suffix after the last `</think>` while keeping the preceding reasoning private. Direct offline tests cover AgentService and buffered responses, so no separate #4554 port is needed.

### #4842 — adapted

The previous report incorrectly concluded there was no local Cursor path, and an earlier unpublished candidate (`be88c41bb06a05a503b762a3cef3d978f6bb1d91`) was withdrawn in [the withdrawal report](1073-cursor-composer-marker-withdrawal.md) because it deleted quoted interior markers and altered fallback behavior.

The port is now complete via a bounded boundary-preserving extractor in [`open-sse/executors/cursor.js`](../../../open-sse/executors/cursor.js) that strips recognizable opening (`<|final|>`, `<｜final｜>`) and paired closing (`<|/final|>`, `<｜/final｜>`) boundary framing while preserving interior marker literals, normal markup, native text deltas, hidden reasoning, tools, and cancellation. The completed adaptation and its offline fixtures are recorded in [the complete #4842 report](1073-cursor-composer-markers-complete-4842.md), with historical context in [the #4842 candidate record](1073-cursor-composer-final-markers-4842.md) and [the withdrawal report](1073-cursor-composer-marker-withdrawal.md).

### #5122 — no demonstrated gap; do not port

The PR-specific change is about replaying client-supplied `reasoning_content` alongside assistant tool calls for models requiring reasoning replay. Local `filterToOpenAIFormat` already returns tool-call assistant messages intact, so it does not strip that field at the normalizer step targeted by the patch. Existing ordinary request fixtures cover reasoning history and tool-call preservation, and there is no failing local fixture or exact current symptom showing loss of replay reasoning. The release-only test repairs and changelog entry in the merge are outside scope. No runtime adaptation is proposed.

## Offline acceptance

Composer acceptance for #4554 and the boundary-preserving #4842 adaptation uses [`tests/unit/cursor-composer-thinking.test.js`](../../../tests/unit/cursor-composer-thinking.test.js) and [`tests/unit/cursor-agent-exec-request.test.js`](../../../tests/unit/cursor-agent-exec-request.test.js), which exercise buffered and fragmented boundary framing, interior quoted markers, partial markers, hidden reasoning, native text deltas, tool calls, and cancellation. The independent #5122 disposition remains supported by the request-history fixtures described above; no live provider validation is claimed.
