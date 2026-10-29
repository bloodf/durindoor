# #1089 OpenAI Responses client conformance matrix

Counts: already-present 22; failing 5; unsupported-by-contract 0; upstream-pending 0.

Every row maps 1:1 to a test in `tests/translator/v5-conformance-matrix-responses.test.js`.

| Direction | Feature | Target | Status | Covering test |
|---|---|---|---|---|
| Request | Strict false, explicit tool choice, parallel limit | OpenAI Chat | already-present | `preserves strict false, explicit tool choice, and parallel limit to Chat` |
| Request | Strict true | OpenAI Chat, Claude | already-present | `preserves strict true through Responses to Chat and Claude` |
| Request | Strict true (schema without strict field) | Gemini | already-present | `delivers schema to Gemini without an OpenAI strict field` |
| Request | Parallel limit (`parallel_tool_calls: false`) | Claude | already-present | `maps parallel_tool_calls false to Claude disable_parallel_tool_use` |
| Request | Namespaced `tool_choice` | Gemini | already-present | `forces namespaced tool_choice on Gemini with aliased allowedFunctionNames` |
| Request | Custom and namespaced tools, strict, parallel | OpenAI Chat | already-present | `lowers custom and namespaced tools to Chat with strict and parallel policy` |
| Request | Custom and namespaced tools, alias map, parallel | Claude | already-present | `lowers custom and namespaced tools to Claude with alias map and parallel ban` |
| Request | `function_call` / `function_call_output` pairing | OpenAI Chat, Claude, Gemini | already-present | `keeps function_call and function_call_output pairing to Chat, Claude, and Gemini` |
| Request | Pairing scoped to assistant turn | OpenAI Chat | failing | `does not pair function_call_output across assistant turns` |
| Request | Text tool-result media | OpenAI Chat, Claude, Gemini | already-present | `preserves text tool-result media to Chat, Claude, and Gemini` |
| Request | `input_image` tool-result media | OpenAI Chat, Claude | already-present | `lifts input_image tool-result media beside text for Chat and Claude` |
| Request | Unsupported tool-result file/audio media | OpenAI Chat, Claude, Gemini | already-present | `rejects unsupported tool-result file and audio media with HTTP 400` |
| Request | 64-char tool-name clamp + original round-trip | Claude, Gemini | already-present | `clamps overlong tool names to 64 chars for Claude and Gemini with round-trip map` |
| Request | 64-char tool-name clamp + original round-trip | OpenAI Chat | failing | `clamps overlong tool names to 64 chars for Chat with round-trip map` |
| Stream | `response.incomplete` terminal | OpenAI Chat, Claude, Gemini | already-present | `translates stream response.incomplete to length/max_tokens terminals` |
| Stream | Incomplete with tool call in progress | OpenAI Chat, Claude, Gemini | already-present | `translates stream incomplete with a tool call in progress for Chat, Claude, and Gemini` |
| Stream | `response.failed` terminal | OpenAI Chat, Claude, Gemini | already-present | `translates stream response.failed error text for Chat, Claude, and Gemini` |
| Non-stream | Incomplete status with tool call | OpenAI Chat, Claude | already-present | `projects non-stream incomplete status with a tool call to Chat and Claude` |
| Non-stream | Failed status | OpenAI Chat, Claude | already-present | `projects non-stream failed status to Chat and Claude error text` |
| Non-stream | Incomplete status with tool call | Gemini | already-present | `projects non-stream incomplete Responses body to Gemini MAX_TOKENS with the tool call` |
| Request | Non-string tool description (#1091) | Kiro | already-present | `translates non-string tool descriptions to a string for Kiro without TypeError` |
| Request | Keyword-named schema properties (#1091) | OpenAI Chat, Claude, Gemini | already-present | `preserves keyword-named schema properties through Chat, Claude, and Gemini` |
| Request | Tuple `prefixItems` / items (#1091) | OpenAI Chat, Claude, Gemini | already-present | `converts tuple prefixItems to Gemini items while Chat and Claude keep the tuple` |
| Request | Free-form / empty schemas (#1091) | OpenAI Chat, Claude (`type:"object"`), Gemini | already-present | `coerces free-form and empty object schemas for Gemini and leaves Chat/Claude empty` |
| Request | Free-form `parameters:{}` → typed empty object schema | Claude | failing | `normalizes Claude free-form parameters {} to a typed empty object schema` |
| Request | String numeric schema constraints (#1091) | OpenAI Chat, Claude, Gemini | failing | `coerces string numeric schema constraints to integers for Chat, Claude, and Gemini` |
| Request | Malformed tool schemas (#1091) | OpenAI Chat, Claude, Gemini | failing | `rejects malformed tool schemas with HTTP 400 for Chat, Claude, and Gemini` |

## Failing cases

| Test | Reason |
|---|---|
| `relocates function_call_output after an intervening assistant message by call id` | Repaired (#1335): a tool-only turn is flushed as its own assistant message; late real outputs relocate next to it by call id. |
| `clamps overlong tool names to 64 chars for Chat with round-trip map` | Responses→Chat direct route skips `normalizeOpenAIToolNames`, so names stay longer than 64 (Refs #1345). |
| `normalizes Claude free-form parameters {} to a typed empty object schema` | Responses→Claude leaves free-form `parameters:{}` as `input_schema:{}`; Anthropic requires `type:"object"` (Refs #1350). |
| `coerces string numeric schema constraints to integers for Chat, Claude, and Gemini` | String numeric JSON Schema constraints stay strings on Chat/Claude and are stripped on Gemini instead of coerced to integers (Refs #1334). |
| `rejects malformed tool schemas with HTTP 400 for Chat, Claude, and Gemini` | Malformed tool schemas are forwarded instead of rejected with a predictable 400 (Refs #1334). |
