# Issue #1089: OpenAI Chat Completions client matrix

Status counts: already-present 5; failing 0; unsupported-by-contract 0; upstream-pending 0.

Existing coverage is linked rather than duplicated where an existing test already asserts behavior.

| Direction | Feature | Target | Status | Covering test |
|---|---|---|---|---|
| Request | Custom namespaced tool, schema keyword properties, strict false, tool choice, parallel false | Chat | already-present | `tests/translator/v5-conformance-matrix-chat.test.js` |
| Request | Custom tool and explicit choice | Claude | already-present | `tests/translator/v5-conformance-matrix-chat.test.js` |
| Request | Custom tool | Gemini | already-present | `tests/translator/v5-conformance-matrix-chat.test.js` |
| Non-stream | Tool call and terminal reason | Chat | already-present | `tests/translator/v5-conformance-matrix-chat.test.js` |
| Stream | Tool call and terminal reason | Chat | already-present | `tests/translator/v5-conformance-matrix-chat.test.js` |
| Request | strict true/false and parallel limits through Responses | Responses | already-present | `tests/translator/v5-protocol-tool-flags.test.js`, `tests/translator/v5-conformance-responses-json.test.js` |
| Request | parallel_tool_calls false to Claude | Claude | already-present | `tests/translator/v5-conformance-parallel-limits.test.js` |
| Non-stream | Incomplete and filtered terminal handling | Responses | already-present | `tests/translator/v5-conformance-responses-json.test.js` |
| Stream | Error and incomplete terminal handling | Responses | already-present | `tests/translator/v5-conformance-error-terminals.test.js` |
| Request | Namespaced tool conversion | Responses | already-present | `tests/translator/v5-conformance-responses-json.test.js` |
