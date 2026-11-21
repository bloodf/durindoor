# #1073 late-June Cursor visible output and reasoning replay

## Exact public pins

Each row records the requested PR head and enclosing merge. For #4554, the head commit itself only changes the quality baseline; the relevant source patch is visible in the enclosing merge diff.

| OmniRoute PR | Exact PR head | Enclosing merge | Patch scope |
|---|---|---|---|
| [#4554](https://github.com/cheaper-inference/OmniRoute/pull/4554) | `0e6e4db2774547aab333e484a028921ad7ed311f` | `3ffd6ffff1d3887ee3ac22c6cdf692e8f8c61527` | Merge adds Composer `</think>` visible-suffix extraction in the Cursor executor; the named head only raises the `cursor.ts` size baseline. |
| [#4842](https://github.com/cheaper-inference/OmniRoute/pull/4842) | `66aa394b53a6b4b34ac57f7ba453f968aff310f4` | `7d2501b2862cf58cce5a2fad9e1f692f5c35edcd` | Cursor executor strips full-width/ASCII `<final>` markers, including partial opening markers during streaming. |
| [#5122](https://github.com/cheaper-inference/OmniRoute/pull/5122) | `bcbb7d1aade3ef3a40a3fe455d3a6b139e6ad02c` | `58d942829f05179412f879b338538e963cf9d4fd` | Translator helper change preserves `reasoning_content` on assistant tool-call history when reasoning replay is required; merge also carries unrelated release-green test and changelog work. |

## Local behavior and ordinary fixtures

The local translator has ordinary provider-neutral reasoning/content stream fixtures. `tests/translator/golden-response-stream.test.js` covers separate visible `content` and `reasoning_content` deltas, including a Claude stream with both; `tests/translator/bugs-claude-thinking-tags.test.js` asserts thinking arrives as `reasoning_content` and answer text as `content`. These fixtures do not model Cursor Composer's proprietary executor frames, model-family detection, `</think>` delimiter, or `<final>` sentinel syntax. No local Cursor Composer executor or exact Composer symptom is present in the inspected translator surface.

For request history, `open-sse/translator/formats/openai.js` returns assistant messages with non-empty `tool_calls` before filtering message fields. That preserves `reasoning_content` on such messages as they pass through `filterToOpenAIFormat`. `tests/translator/port-3254-empty-tool-calls.test.js` records the local tool-call preservation boundary; `tests/translator/port-2401-reasoning-history-bridge.test.js` covers ordinary reasoning history round-trips. Neither shows a local replay failure for a reasoning-replay target. This evidence is limited to the helper behavior and ordinary offline fixtures; it does not claim live provider validation.

## Dispositions

### #4554 — do not port

The actual merge patch decodes Composer `thinking` as user-visible text after the final `</think>` and keeps the prefix out of reasoning output. That logic is in OmniRoute's Cursor executor pipeline, which is source-only app behavior excluded by this review. Existing local fixtures establish the ordinary distinction between reasoning and answer fields, but do not demonstrate a corresponding runtime gap on a local Cursor route. No runtime adaptation is proposed.

### #4842 — do not port

This is the follow-up cleanup for Composer executor output, removing `<｜final｜>` / `<|final|>` framing and holding partial opening-marker fragments until complete. Those marker spellings are not represented in local ordinary offline translator fixtures, and the changed source path is the excluded Cursor executor. The evidence does not establish that these markers occur in a local translator input or leak from a local route. No runtime adaptation is proposed.

### #5122 — no demonstrated gap; do not port

The PR-specific change is about replaying client-supplied `reasoning_content` alongside assistant tool calls for models requiring reasoning replay. Local `filterToOpenAIFormat` already returns tool-call assistant messages intact, so it does not strip that field at the normalizer step targeted by the patch. Existing ordinary request fixtures cover reasoning history and tool-call preservation, and there is no failing local fixture or exact current symptom showing loss of replay reasoning. The release-only test repairs and changelog entry in the merge are outside scope. No runtime adaptation is proposed.

## Offline acceptance

No narrow runtime gap was demonstrated, so no test change or new acceptance case is warranted. Existing offline coverage remains the acceptance evidence: separate visible/reasoning response deltas and Composer-independent reasoning tags in `golden-response-stream.test.js` and `bugs-claude-thinking-tags.test.js`, plus assistant tool-call/reasoning-history preservation in `port-3254-empty-tool-calls.test.js` and `port-2401-reasoning-history-bridge.test.js`. Any future Cursor-specific adaptation would first need an exact local failing symptom and an ordinary offline fixture asserting hidden reasoning, visible answer text, marker handling, and replay behavior.
