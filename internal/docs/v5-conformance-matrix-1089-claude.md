# Issue #1089 Claude Messages client conformance

Counts: already-present 4; failing 0; unsupported-by-contract 0; upstream-pending 0.

| Direction | Feature | Target | Status | Covering test |
|---|---|---|---|---|
| Request | input_schema and cache_control | Claude | already-present | `tests/translator/v5-conformance-matrix-claude.test.js` |
| Request | OpenAI-source cache_control | Claude | already-present | `tests/translator/v5-conformance-matrix-claude.test.js` |
| Stream response (message_delta) | max_tokens stop_reason | OpenAI Chat | already-present | `tests/translator/v5-conformance-matrix-claude.test.js` |
| Stream response (delta + message_stop) | end_turn terminal, single finish chunk | OpenAI Chat | already-present | `tests/translator/v5-conformance-matrix-claude.test.js` |

Note: user-block `cache_control` is stripped by `prepareClaudeRequest` by design; only system, tools and the last assistant block keep it.
Counts reflect `vitest run translator/v5-conformance-matrix-claude.test.js`: 4 passed, 0 failed.
