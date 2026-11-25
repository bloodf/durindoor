# #1073 — November existing streamed tool identity

## Scope and pins

Compared the public PR changes at their exact pinned heads and enclosing merge commits. The enclosing merges are used only as source snapshots; the comparison is their first-parent PR patch, avoiding other merge contents.

- [OmniRoute #18024](https://github.com/cheaper-inference/OmniRoute/pull/18024): head `842f71875bafaa9dcf8ceba58f695318614a8964`; enclosing merge `4c4cc3e52c9c588215f2d8dd8c94d9239bfdda63`. The exact PR patch adds a Dots Studio `<dots_function_call>` content dialect and parser, then feeds its results into Claude stream tool emission and the OpenAI sanitizer. It includes JSON argument normalization and parser/stream tests. This is a provider/model-specific text dialect, not ordinary OpenAI `tool_calls` or Claude `tool_use` identity handling.
- [OmniRoute #19250](https://github.com/cheaper-inference/OmniRoute/pull/19250): head `5eb6ecd5a02e51598d78a43e0cca64632ea76c9f`; enclosing merge `b49b5d3253154d491c6e7e35abeead86e9c790e2`. The exact PR patch records Gemini provider call IDs already emitted and drops later full snapshots with those IDs, while allowing distinct and id-less calls; its fixture checks each case.

## Current local behavior and fixture evidence

- **Claude-facing dotted names:** Chat→Claude request translation aliases names such as `ns.search` to Claude-safe names while preserving the map back to the caller spelling. Signed conversation history is translated through the same map, and Claude→Chat non-stream and stream responses restore the original dotted spelling. `tests/unit/chat-tool-name-sanitize-1343.test.js` covers declarations, `tool_choice`, assistant `tool_calls` plus tool results in history, and response name restoration in both paths. Caller IDs such as `c1` are retained by the fixture. Therefore the ordinary dotted-name identity behavior is already covered; #18024’s additional Dots Studio text dialect is outside the requested supported surface.
- **Gemini-to-Chat snapshot deduplication:** `open-sse/translator/response/gemini-to-openai.js` tracks emitted provider call IDs in `state.emittedGeminiCallIds`; an already-seen ID returns without emitting a second delta. New IDs get their own index, and calls without provider IDs remain emitted. `tests/unit/gemini-snapshot-dedup.test.js` feeds a repeated ID with changed arguments, two distinct IDs, and two anonymous calls, asserting four emitted calls and sequential indexes. `tests/translator/golden-response-stream.test.js` also has an ordinary Gemini `functionCall` stream fixture. Existing IDs are not replaced in the repeated-snapshot case.

## Disposition

- **#18024 — Do not port.** Its general parser and sanitizer changes implement the added Dots Studio markup dialect, which is not already-supported ordinary route behavior. The narrow caller-declared dotted-name requirement is already met by the name-map round trip and signed-history fixture. No ordinary-route gap is demonstrated, so no acceptance test addition is warranted.
- **#19250 — Already present; no port needed.** Current Gemini response translation already deduplicates by provider call ID, preserves distinct calls, and leaves anonymous calls alone. The ordinary offline snapshot fixture verifies this behavior. No remaining narrow gap or additional acceptance test is warranted.

## Offline acceptance

Existing ordinary offline coverage: `tests/unit/chat-tool-name-sanitize-1343.test.js`, `tests/unit/gemini-snapshot-dedup.test.js`, and `tests/translator/golden-response-stream.test.js`. This is evidence review only; no product or test files were changed.
