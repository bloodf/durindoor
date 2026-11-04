# Issue #1089 Claude Messages client conformance

Counts: already-present 15; repaired 6; failing 0; unsupported-by-contract 1; upstream-pending 0.

Request rows from a Claude Messages client map to tests in `tests/translator/v5-conformance-matrix-claude.test.js` unless another file is named. Reply rows that reuse the Chat and Responses matrices point at those docs. Counts are computed from the rows below.

| Direction | Feature | Target | Status | Covering test |
|---|---|---|---|---|
| Request | input_schema and cache_control | Claude | already-present | `tests/translator/v5-conformance-matrix-claude.test.js` |
| Request | OpenAI-source cache_control | Claude | already-present | `tests/translator/v5-conformance-matrix-claude.test.js` |
| Request | Tool name, keyword-named properties, strict true | Chat, Responses | already-present | `keeps the tool name, keyword-named properties and strict true for %s` |
| Request | Tool name and keyword-named properties | Gemini | already-present | `keeps the tool name and keyword-named properties for Gemini` |
| Request | tool_choice auto, any, none | Chat, Responses, Gemini | repaired | `maps tool_choice %j to Chat/Responses %s and Gemini %s` (none was mapped to auto, Gemini dropped all non-named choices) |
| Request | Named tool_choice | Chat, Responses, Gemini | already-present | `maps a named tool_choice to Chat, Responses and Gemini` |
| Request | disable_parallel_tool_use | Chat, Responses | repaired | `carries disable_parallel_tool_use as parallel_tool_calls false for Chat and Responses` |
| Request | disable_parallel_tool_use | Claude (OpenAI source) | already-present | `tests/translator/v5-conformance-parallel-limits.test.js` |
| Request | tool_use / tool_result pairing | Chat, Responses, Gemini | already-present | `pairs tool_result with tool_use for Chat, Responses and Gemini` |
| Request | Malformed tool schema rejected with HTTP 400 | Chat, Gemini | repaired | `rejects malformed tool schemas with HTTP 400 for %s` |
| Request | Malformed tool schema rejected with HTTP 400 | Responses | already-present | `rejects malformed tool schemas with HTTP 400 for %s` |
| Request | String numeric schema constraints coerced | Chat, Gemini | repaired | `coerces string numeric schema constraints for Chat and Gemini` |
| Request | Inline base64 tool_result image | Chat, Responses | unsupported-by-contract | `replaces inline tool_result image bytes with a media-type label for Chat and Responses (by contract)`; the translator keeps only a bounded label so binary payloads never enter the upstream request |
| Request | Tool_result document and URL media | Chat | already-present | `tests/translator/v5-conformance-tool-media-ceilings.test.js`, `tests/translator/claude-url-image-source.test.js` |
| Stream response (message_delta) | max_tokens stop_reason | Chat | already-present | `tests/translator/v5-conformance-matrix-claude.test.js` |
| Stream response (delta + message_stop) | end_turn terminal, single finish chunk | Chat | already-present | `tests/translator/v5-conformance-matrix-claude.test.js` |
| Stream response | functionCall to tool_use, tool_use stop_reason | Claude (Gemini upstream) | already-present | `emits tool_use for a functionCall and a tool_use stop_reason` |
| Stream response | MAX_TOKENS to max_tokens | Claude (Gemini upstream) | already-present | `maps MAX_TOKENS to max_tokens` |
| Non-stream and forced-SSE reply | request-side tool alias restored to `ns.search` in `tool_use` | Claude (Chat upstream) | repaired | `restores ns.search from a Chat JSON upstream`, `restores ns.search from a forced-SSE Chat stream` in `tests/translator/v5-conformance-gemini-client-shape.test.js` |
| Public route `POST /v1/messages` | alias upstream, named choice and parallel false kept, name restored; malformed schema 400 | Claude | repaired | `tests/unit/public-route-tool-conformance-1089.test.js` |
| Non-stream and stream replies | Chat upstream tool call, length, content_filter, error | Claude | already-present | see `v5-conformance-matrix-1089-chat.md` rows with target Claude |
| Non-stream and stream replies | Responses upstream incomplete, failed, tool call | Claude | already-present | see `v5-conformance-matrix-1089-responses.md` rows with target Claude |

Note: user-block `cache_control` is stripped by `prepareClaudeRequest` by design; only system, tools and the last assistant block keep it.
Repaired in the follow-up to #1549: Claude-source `tool_choice` none/auto/any (Chat and Responses mapped none to auto; Gemini ignored everything but a named choice), `disable_parallel_tool_use` (dropped for Chat and Responses), and malformed or numeric-string tool schemas (accepted unchanged by the direct Claude to Chat and Claude to Gemini translators).
