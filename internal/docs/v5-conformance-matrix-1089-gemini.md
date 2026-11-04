# Issue #1089 Gemini client conformance matrix

Counts: already-present 11; repaired 20; repaired (known degradation) 1; failing 0; unsupported-by-contract 0; upstream-pending 0.

Every request row maps to a test in `tests/translator/v5-conformance-matrix-gemini.test.js` unless another file is named. Gemini-client reply rows (Chat to Gemini) and the usage rows link existing tests. Counts are computed from the rows below.

| Direction | Feature | Target | Status | Covering test |
|---|---|---|---|---|
| Request | Namespaced `ns.search` aliased to `^[a-zA-Z0-9_-]{1,64}$` with round-trip map, keyword-named properties kept | Chat | repaired | `aliases the namespaced tool for Chat and keeps keyword-named properties` |
| Request | Same, declaration and history share one alias | Claude | repaired | `aliases the namespaced tool for Claude and keeps keyword-named properties` |
| Request | Same | Responses | repaired | `aliases the namespaced tool for Responses` |
| Request | `functionResponse` paired with its `functionCall` | Chat, Claude, Responses | already-present | `pairs functionResponse with its functionCall for Chat, Claude and Responses` |
| Request | `toolConfig` AUTO/NONE/ANY to `tool_choice`; single allowed name to named choice | Chat | repaired | `maps toolConfig mode %s to Chat tool_choice`, `maps a single allowedFunctionNames entry to a named Chat tool_choice` |
| Request | `toolConfig` forced choice | Claude, Responses | repaired | `carries toolConfig forced choice to Claude and Responses` |
| Stream | length, content_filter, stop terminals | Gemini | already-present | `streams Chat %s as Gemini %s` |
| Non-stream | length, content_filter terminals | Gemini | already-present | `tests/translator/v5-conformance-matrix-chat.test.js`: `maps non-stream length to Gemini MAX_TOKENS with text`, `maps non-stream content_filter to Gemini SAFETY` |
| Non-stream | error finish returns incoherent 502 | Gemini | already-present | `tests/translator/v5-conformance-matrix-chat.test.js`: `returns 502 for non-stream error finish for a Gemini client` |
| Stream | error terminal as OTHER | Gemini | already-present | `tests/translator/v5-conformance-matrix-chat.test.js`: `emits Gemini stream error as OTHER finishReason` |
| Usage | stream and JSON thought/candidate accounting | Gemini | already-present | `tests/translator/v5-conformance-gemini-usage.test.js`, `v5-conformance-gemini-stream-usage.test.js` |
| Request | OpenAI string `tool_choice` to Gemini modes | Gemini | already-present | `tests/translator/v5-conformance-gemini-tool-choice.test.js` |
| Request | generated call ids sanitized (no dots) | Claude | repaired | `sanitizes generated call ids so Claude tool_use ids stay legal` |
| Request | `toolConfig` ANY with several allowed names declares only those tools | Chat | repaired | `declares only allowed tools when ANY lists several names` |
| Request | `toolConfig` VALIDATED maps to auto (no OpenAI equivalent) | Chat | repaired (known degradation) | `maps VALIDATED to auto` |
| Request | gemini-cli source aliasing | Chat | repaired | `aliases dotted names for gemini-cli sources too` |
| Non-stream | alias restored to `ns.search` in functionCall (Chat and Responses upstreams) | Gemini | repaired | `restores ns.search from a Chat upstream`, `restores ns.search from a Responses upstream` |
| Request | `ns.search` and `ns_search` get distinct sanitized call ids | Claude | repaired | `keeps ns.search and ns_search ids distinct and legal` |
| Request | explicit client ids sanitized on both sides of the pair | Claude | repaired | `sanitizes explicit client ids on both sides of the pair` |
| Forced SSE to JSON | alias restored (Responses and Chat upstream; GEMINI and GEMINI_CLI) | Gemini | repaired | `tests/unit/forced-sse-gemini-name-restore.test.js` |
| Request | `toolConfig` ANY naming no declared tool keeps every tool and sends `required` | Chat | repaired | `keeps every tool and required when ANY names match no declared tool` |
| Request | two idless same-turn calls to one function get distinct paired ids | Chat | repaired | `gives two idless same-turn calls to one function distinct paired ids` |
| Public route | namespaced tool aliased upstream, `ns.search` restored in the JSON reply (`POST /v1beta/models/*:generateContent` through real `handleChatCore`) | Gemini | already-present | `tests/unit/v1beta-gemini-gateway-conformance-1089.test.js`: `aliases a namespaced tool upstream and restores ns.search in the JSON reply` |
| Public route | `ns.search` restored in the streamed reply (`:streamGenerateContent`) | Gemini | already-present | `restores ns.search in the streamed reply` |
| Public route | ANY naming no declared tool keeps every tool (`/v1beta` bridge) | Gemini | repaired | `does not send required with an empty tool list when allowedFunctionNames match nothing` |
| Public route | two idless same-turn calls get distinct paired ids (`/v1beta` bridge) | Gemini | already-present | `gives two idless same-turn calls to one function distinct paired ids` |
| Request | reply pairs with the call of the turn just before it after an unanswered call | Chat | repaired | `pairs a reply with the call in the turn just before it` |
| Public route | same, through the `/v1beta` bridge | Gemini | repaired | `pairs a reply with the call in the turn just before it after an unanswered call` |
| Non-stream | Claude, Gemini-CLI and Chat upstream JSON returns top-level candidates (native) or `{response}` (gemini-cli) | Gemini | repaired | `native Gemini client from a %s gets top-level candidates`, `Gemini-CLI client from a %s keeps the { response } envelope` in `tests/translator/v5-conformance-gemini-client-shape.test.js` |
| Forced SSE to JSON | Responses and Chat streams return top-level candidates (native) or `{response}` (gemini-cli) | Gemini | repaired | `native Gemini client from a %s stream gets top-level candidates`, `Gemini-CLI client keeps the { response } envelope` |
| Request | unanswered `functionCall` gets a synthetic tool_result / tool message | Claude, Chat, Responses | repaired | `answers an unanswered functionCall with a synthetic tool_result for Claude`, `answers an unanswered functionCall with a tool message for Chat and Responses` |
| Request | Namespaced tool, strict, malformed schema from Chat | Gemini | already-present | see `v5-conformance-matrix-1089-chat.md` |

Gateway rows drive the real `/v1beta` route and `handleChatCore`; only the upstream executor is faked.

Buffered and forced-SSE JSON replies to a Gemini client are projected by `projectCompletionToGeminiClient` in every upstream dialect. Before, Claude and Gemini-family upstream JSON reached the client as `chat.completion`, and the forced-SSE path wrapped native clients in a `{response}` envelope.

Repaired in this change: Gemini-source requests previously ignored `toolConfig` and sent dotted tool names unaliased to Chat, Claude and Responses upstreams.
