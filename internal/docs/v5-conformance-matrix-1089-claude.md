# Issue #1089 Claude Messages client conformance

Counts: already-present 3; failing 0; unsupported-by-contract 0; upstream-pending 0.

| Direction | Feature | Target | Status | Covering test |
|---|---|---|---|---|
| Request | input_schema and cache_control | Claude | already-present | `tests/translator/v5-conformance-matrix-claude.test.js` |
| Non-stream response | max_tokens stop_reason | OpenAI Chat | already-present | `tests/translator/v5-conformance-matrix-claude.test.js` |
| Stream response | end_turn terminal | OpenAI Chat | already-present | `tests/translator/v5-conformance-matrix-claude.test.js` |
