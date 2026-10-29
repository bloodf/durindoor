# Issue #1089: OpenAI Chat Completions client matrix

Status counts: already-present 39; failing 27; unsupported-by-contract 0; upstream-pending 0.

Every row maps 1:1 to a test in `tests/translator/v5-conformance-matrix-chat.test.js`. Failing rows are `it.skip` markers with a `// #1089 failing: #<issue> …` reason; no source fixes land in this slice. Two already-present Gemini schema rows are labeled as known or deliberate degradations, not full conformance.

| Direction | Feature | Target | Status | Covering test |
|---|---|---|---|---|
| Request | Namespaced tool, keyword schema, strict false, named choice, parallel false | Chat | already-present | `preserves namespaced tool, keyword schema, strict false, named choice, and parallel false in Chat` |
| Request | Namespaced tool, keyword schema, named choice | Claude | already-present | `translates namespaced tool, keyword schema, and named choice to Claude` |
| Request | Namespaced tool, keyword schema, named choice | Gemini | already-present | `translates namespaced tool, keyword schema, and named choice to Gemini` |
| Request | Namespaced tool, strict false | Responses | already-present | `translates namespaced tool and strict false to Responses` |
| Request | strict true | Claude | already-present | `preserves explicit strict=true through Claude` |
| Request | strict false | Claude | already-present | `preserves explicit strict=false through Claude` |
| Request | strict true | Responses | already-present | `preserves explicit strict=true through Responses` |
| Request | strict false | Responses | already-present | `preserves explicit strict=false through Responses` |
| Request | strict true schema without OpenAI strict field | Gemini | already-present | `delivers schema to Gemini without an OpenAI strict field when strict is true` |
| Request | tool_choice auto | Claude | already-present | `maps tool_choice auto to Claude` |
| Request | tool_choice none | Claude | already-present | `maps tool_choice none to Claude` |
| Request | tool_choice required | Claude | already-present | `maps tool_choice required to Claude` |
| Request | tool_choice named function | Gemini | already-present | `maps named tool_choice to Gemini ANY with allowedFunctionNames` |
| Request | tool_choice auto | Gemini | failing | `maps tool_choice auto to Gemini AUTO mode` |
| Request | tool_choice none | Gemini | failing | `maps tool_choice none to Gemini NONE mode` |
| Request | tool_choice required | Gemini | failing | `maps tool_choice required to Gemini ANY mode` |
| Request | tool_choice auto | Responses | failing | `preserves tool_choice auto on Chat to Responses` |
| Request | tool_choice none | Responses | failing | `preserves tool_choice none on Chat to Responses` |
| Request | tool_choice required | Responses | failing | `preserves tool_choice required on Chat to Responses` |
| Request | tool_choice named function | Responses | failing | `preserves named tool_choice on Chat to Responses` |
| Request | parallel_tool_calls false | Claude | already-present | `carries parallel_tool_calls false as Claude disable_parallel_tool_use` |
| Request | parallel_tool_calls true | Claude | already-present | `leaves Claude unrestricted when parallel_tool_calls is true` |
| Request | parallel_tool_calls false/true | Responses | already-present | `preserves parallel_tool_calls false and true on Chat to Responses` |
| Request | max_tool_calls numeric ceiling | Claude | already-present | `does not invent a Claude parallel ban from max_tool_calls` |
| Non-stream | length terminal | Claude | already-present | `maps non-stream length to Claude max_tokens with text` |
| Non-stream | length terminal | Gemini | already-present | `maps non-stream length to Gemini MAX_TOKENS with text` |
| Non-stream | length → incomplete/max_output_tokens | Responses | failing | `maps non-stream length to Responses incomplete with max_output_tokens` |
| Non-stream | content_filter terminal | Gemini | already-present | `maps non-stream content_filter to Gemini SAFETY` |
| Non-stream | content_filter → incomplete/content_filter | Responses | failing | `maps non-stream content_filter to Responses incomplete with content_filter` |
| Non-stream | error → failed with error object | Responses | failing | `maps non-stream error finish to Responses failed with error object` |
| Non-stream | error terminal | Claude | failing | `maps non-stream error finish to a Claude error terminal` |
| Non-stream | error terminal | Gemini | failing | `maps non-stream error finish to a Gemini abort finishReason` |
| Stream | length terminal | Claude | already-present | `emits Claude stream length as message_delta max_tokens` |
| Stream | length terminal | Gemini | already-present | `emits Gemini stream length as MAX_TOKENS with text` |
| Stream | content_filter terminal | Gemini | already-present | `emits Gemini stream content_filter as SAFETY with text` |
| Stream | error terminal | Claude | already-present | `emits Claude stream error as an Anthropic error event` |
| Stream | error terminal | Gemini | already-present | `emits Gemini stream error as OTHER finishReason` |
| Stream | incomplete/length terminal | Responses | failing | `emits Responses stream incomplete for Chat length finish` |
| Stream | error terminal | Responses | failing | `emits Responses stream failed for Chat error finish` |
| Non-stream | tool call identity | Chat | already-present | `keeps tool call identity and finish_reason in Chat non-stream` |
| Stream | tool call identity | Chat | already-present | `keeps tool call identity and finish_reason in Chat stream` |
| Non-stream | tool call | Claude | already-present | `projects non-stream tool calls to Claude tool_use` |
| Non-stream | tool call | Gemini | already-present | `projects non-stream tool calls to Gemini functionCall` |
| Non-stream | tool call | Responses | already-present | `projects non-stream tool calls to Responses function_call` |
| Stream | tool call | Claude | already-present | `streams tool calls to Claude with tool_use stop` |
| Stream | tool call | Gemini | already-present | `streams tool calls to Gemini with functionCall name and args` |
| Stream | tool call | Responses | already-present | `streams tool calls to Responses with call identity and completed arguments` |
| Request | tool-result image media | Claude | failing | `converts tool-result image_url media to Claude image blocks` |
| Request | tool-result image media | Gemini | already-present | `keeps tool-result image URL visible through Gemini functionResponse` |
| Request | tool-result image media | Responses | failing | `preserves tool-result image media on Chat to Responses` |
| Request | turn-scoped tool pairing | Claude | repaired (#1335) | `pairs Claude tool results only within the current assistant turn` |
| Request | turn-scoped tool pairing | Gemini | repaired (#1335) | `pairs Gemini tool results only within the current assistant turn` |
| Request | turn-scoped tool pairing | Responses | repaired (#1335) | `pairs Responses tool results only within the current assistant turn` |
| Request | non-string object description (#1091) | Kiro | failing | `coerces object tool descriptions before Kiro trim` |
| Request | non-string numeric description (#1091) | Kiro | failing | `coerces numeric tool descriptions before Kiro trim` |
| Request | empty description fallback (#1091) | Kiro | already-present | `fills empty Kiro descriptions with a Tool: name fallback` |
| Request | tuple prefixItems (lossy Gemini degradation) (#1091) | Gemini | already-present (known degradation) | `converts Gemini tuple prefixItems into items` |
| Request | free-form schema (#1091) | Claude | already-present | `preserves free-form object schemas on Claude` |
| Request | empty schema reason placeholder (deliberate Gemini workaround) (#1091) | Gemini | already-present (deliberate degradation) | `fills empty schemas for Gemini with a reason placeholder` |
| Request | keyword-named properties (#1091) | Claude/Gemini/Responses | already-present | `preserves keyword-named properties through Claude, Gemini, and Responses` |
| Request | string numeric constraints (#1091) | Claude | failing | `coerces string numeric schema constraints for Claude` |
| Request | string numeric constraints (#1091) | Gemini | failing | `coerces string numeric schema constraints for Gemini` |
| Request | string numeric constraints (#1091) | Responses | failing | `coerces string numeric schema constraints for Responses` |
| Request | malformed schema rejection (#1091) | Claude | failing | `rejects malformed tool schemas for Claude` |
| Request | malformed schema rejection (#1091) | Gemini | failing | `rejects malformed tool schemas for Gemini` |
| Request | malformed schema rejection (#1091) | Responses | failing | `rejects malformed tool schemas for Responses` |

## Failing reasons (tracked issues)

1. #1328 — Gemini string `tool_choice` auto/none/required are dropped; only named `{type:function}` is mapped.
2. #1329 — Chat→Responses never copies `tool_choice`.
3. #1330 — Chat JSON `finish_reason: error` becomes Claude `end_turn` / Gemini `STOP` instead of an abort terminal.
4. #1331 — Chat→Responses non-stream copies finish reasons into invalid `status` values (`length` / `content_filter` / `error`) instead of `incomplete`/`failed`; stream flush emits `response.completed` after `length` and never `response.failed` after `error`.
5. #1332 — Chat→Claude leaves OpenAI `image_url` inside `tool_result`; Chat→Responses stringifies image parts into output text.
6. #1335 — Cross-turn `tool_call_id` reuse broke current-turn pairing on Claude, Gemini, and Responses (repaired: pair by call id within the current assistant turn; drop strays).
7. #1333 — Kiro `description.trim` throws `TypeError` for object/number descriptions.
8. #1334 — String `minimum`/`maximum` stay strings; malformed schemas are forwarded instead of rejected.

## Known / deliberate degradations (not conformance)

1. Gemini tuple `prefixItems` → single `items: { type: "string" }` drops later tuple positions and `items: false` (lossy Gemini schema workaround).
2. Empty Gemini schemas are filled with a required `reason` placeholder string (intentional Antigravity/Gemini empty-schema workaround).
