# Port batch 1: open upstream PR candidates

Source: [open-prs-nov25-08.md](open-prs-nov25-08.md), port candidates 1–8 in table order. All are `decolua/9router` PRs. On 2026-11-25 each was still open, and its changed files were read with the GitHub API at the head SHA in the source report. No live provider was called.

Overall status: **partial**. All eight rows were checked. Four ship changes here, and #4511 and #4490 are broad PRs with parts that were not ported or remain open. Those parts are listed below the table.

| Source row | PR | Final disposition | Evidence |
|---:|---:|---|---|
| 281 | [#4534](https://github.com/decolua/9router/pull/4534) | ported in this change | Chat requests already stream only for `stream: true` ([streamFlag.js](../../../open-sse/handlers/chatCore/streamFlag.js)). [bypassHandler.js](../../../open-sse/utils/bypassHandler.js) still streamed when the flag was omitted, and now follows the same rule. Test: [bypass-stream-default-4534.test.js](../../../tests/unit/bypass-stream-default-4534.test.js). The warmup expectation in [stream-absent-json-response-port.test.js](../../../tests/unit/stream-absent-json-response-port.test.js) changed from SSE to JSON on purpose. Row 311 (#4427) changes the same line. |
| 285 | [#4522](https://github.com/decolua/9router/pull/4522) | already present | `startServer` in [cli.js](../../../cli/cli.js) calls `attachServerEvents()` in the headless branch, in the tray-only branch before the tray starts (the in-code note cites #2205), and for the menu path at the end of the function. That last call runs synchronously, before the readiness callback that starts the tray. |
| 286 | [#4518](https://github.com/decolua/9router/pull/4518) | already present | The request translator in [openai-responses.js](../../../open-sse/translator/request/openai-responses.js) moves tool-output images into a following user message and limits how many are kept. [responsesApi.js](../../../open-sse/translator/formats/responsesApi.js) also lifts them into image blocks. It deliberately keeps its serialized tool text, and a search of `src`, `open-sse` and `cli` finds no caller outside that file. Test: [openai-responses-tool-image-output.test.js](../../../tests/unit/openai-responses-tool-image-output.test.js). |
| 289 | [#4513](https://github.com/decolua/9router/pull/4513) | already present | [chatCore.js](../../../open-sse/handlers/chatCore.js) passes every Claude response through `applyClaudeResponseModelEcho`, which writes the client's original model into `message_start`. [chat.js](../../../src/sse/handlers/chat.js) captures that value before routing. Tests: [codex-compact-chatcore.test.js](../../../tests/unit/codex-compact-chatcore.test.js), [omni-client-model-echo-combos.test.js](../../../tests/unit/omni-client-model-echo-combos.test.js). |
| 291 | [#4511](https://github.com/decolua/9router/pull/4511) | ported in this change | See the #4511 breakdown below. Test: [claude-tool-state-4511.test.js](../../../tests/unit/claude-tool-state-4511.test.js). |
| 295 | [#4492](https://github.com/decolua/9router/pull/4492) | already present | Landed as `port(upstream): #4492 - pin model tests to the selected connection (#1033)`, commit `11c7d1040b0`. The model-test route forwards `connectionId` as `x-connection-id` for operators only, and chat admission pins that connection. Test: [model-test-routing.test.js](../../../tests/unit/model-test-routing.test.js). |
| 296 | [#4490](https://github.com/decolua/9router/pull/4490) | ported in this change | Two parts ported. See the #4490 breakdown below. Test: [responses-tool-contracts-4490.test.js](../../../tests/unit/responses-tool-contracts-4490.test.js). |
| 297 | [#4486](https://github.com/decolua/9router/pull/4486) | ported in this change | In-band errors and prompt blocks were already handled. A translated Gemini-family stream that ended with no finish reason still ended as a success and released buffered tool calls. [stream.js](../../../open-sse/utils/stream.js) now ends it with `incomplete_upstream_stream`, records it as failed and keeps usage accounting. Claude clients still get this fork's `stop_reason` mapping for `content_filter`; upstream's `refusal` mapping was not taken. Test: [gemini-stream-terminal-4486.test.js](../../../tests/unit/gemini-stream-terminal-4486.test.js). |

## #4511 breakdown

Ported:

- [openai-to-claude.js](../../../open-sse/translator/response/openai-to-claude.js): calls with a reused or missing index stay apart. Named calls with no id and arguments sent before the id are kept. A tool block with complete arguments closes before text or thinking opens. A block with partial arguments stays open so nothing is lost.
- [toolCall.js](../../../open-sse/translator/concerns/toolCall.js): a `tool_use` with no id gets one.
- [antigravity-to-openai.js](../../../open-sse/translator/request/antigravity-to-openai.js): parallel calls to one tool get distinct ids, and the calling message comes before results in the same content.
- [sseToJsonHandler.js](../../../open-sse/handlers/chatCore/sseToJsonHandler.js): indexless calls stay apart, and a `stop` turn with tool calls reports `tool_calls`.
- Repeated tool names: that handler, [openai-to-antigravity.js](../../../open-sse/translator/response/openai-to-antigravity.js) and [ollamaTransform.js](../../../open-sse/utils/ollamaTransform.js) skip an exact repeat. Upstream keeps only the first fragment; this fork still joins split names.
- [claude-to-openai.js](../../../open-sse/translator/request/claude-to-openai.js): a model with a higher published output limit is no longer cut to 64000. The ceiling is only ever raised.
- [codebuddy-cn.js](../../../open-sse/executors/codebuddy-cn.js): adds a leading system message when there is none. The expectation in [codebuddy-system-prompt-len-3339.test.js](../../../tests/unit/codebuddy-system-prompt-len-3339.test.js) changed on purpose. [CodeBuddy quota requests](../../../open-sse/services/usage/codebuddy-cn.js) retry 5xx and network errors, three attempts in total.

Already present: closing a Claude stream on the final flush, ignoring a repeated finish chunk, a single `[DONE]` on passthrough, clearing Antigravity calls after they are sent, keeping the tool-error flag through translation and RTK, keeping caller system prompts in CodeBuddy, and limiting effort to the levels a model declares.

Not ported:

- **Thought-signature bare key.** Upstream stops writing and reading the unscoped alias, so one session cannot read another's signature. [thoughtSignatureStore.js](../../../open-sse/services/thoughtSignatureStore.js) documents that alias as intended, for replay when the scope is unknown or changes. A maintainer should decide whether to change that contract.
- **Synthetic `stop` on a truncated passthrough stream.** It would report truncation as success, which conflicts with this fork's stream-error handling.
- **Not taken:** RTK truncation marker format, case-insensitive provider aliases (custom prefixes are user data), and a cap on retained log text.

Not applicable (new upstream features with no local counterpart): model and capability catalogue updates, automatic 1M context markers in the Claude settings route, the context-overflow log line and the quota UI change.

## #4490 breakdown

Ported:

- [claudeInputSchema.js](../../../open-sse/translator/concerns/claudeInputSchema.js): root `oneOf`, `allOf` and `anyOf` are merged into one object schema; nested unions stay. The combinator expectation in [tool-schema-validation-1334-1353.test.js](../../../tests/translator/tool-schema-validation-1334-1353.test.js) changed on purpose.
- [stream.js](../../../open-sse/utils/stream.js): a Responses stream translated to another format that has no terminal event now ends with an error instead of `stop` or `end_turn`.

Already present: distinct, restorable aliases for same-named namespace tools sent to Chat; incomplete and failed Responses results in translated streams; Chat `length` and `content_filter` reported as incomplete; distinct output indices for reasoning, text and parallel tool calls.

Not ported:

- **Tool-name rewriting from Chat and Claude to Responses.** The conformance tests for #1089 and #1329 require names such as `ns.search` to arrive unchanged. This leaves two known gaps: invalid characters are forwarded, and two long names can become identical when cut to 128 characters. A maintainer should decide.
- **Hiding `defer_loading` namespace tools** until `additional_tools` loads them. Local code still offers them to Chat providers.

Remaining:

- A Chat stream with no finish reason still becomes `response.completed`.
- Chat `refusal` deltas are dropped from translated Responses output (reproduced: completed with empty output).
- Not checked: failing reasoning-only or malformed-call completions, tool-name handling in native Codex passthrough and the Codex executor, and upstream's stricter non-stream and forced-SSE rules.
