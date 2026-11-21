# #1073: Claude terminal status matches emitted tool calls

Checked 2026-11-20 against DurinDoor `e2605ebb141071d0dd532f815d0f11ee65f624e4`.

## Source

- [OmniRoute #18280](https://github.com/cheaper-inference/OmniRoute/pull/18280) — "fix(api): override stop_reason to tool_use when tool_calls arrive with finish_reason stop (#18270)".
- Head: `b6a1beabec061dfee18f4b5bff3a81196c559530` (branch `fix/claude-code-stop-reason-override`).
- Merge commit: `e429ae792586a040d8cf20d8cd11186ed891cd3f` (base `release/v3.8.53`, base head `f000c11ab6e2b3bbf9f303e2e5ad86ce6bbb23c4`). Merged, 3 commits, 3 changed files.
- Upstream files: `open-sse/handlers/responseTranslator.ts` (non-streaming `convertOpenAINonStreamingToClaude`), `open-sse/translator/response/openai-to-claude.ts` (streaming `openaiToClaudeResponse`), `tests/unit/openai-claude-stop-reason-tools-18270.test.ts` (new, 5 cases).

Upstream behavior, in both projections: when the turn emitted tool calls and the mapped Claude `stop_reason` would be `end_turn`, the terminal becomes `tool_use`. Upstream's shared mapping (`open-sse/utils/finishReason.ts`, `openAIFinishReasonToClaudeStopReason`) sends `content_filter` to `refusal`, so a safety stop never reaches the `end_turn` branch; truncation (`length` → `max_tokens`) and every other reason are left alone.

## Local result

DurinDoor keeps the same two OpenAI → Claude projections under different names, and the defect was present in both: an upstream `finish_reason: "stop"` carrying `tool_calls` produced `stop_reason: "end_turn"` next to `tool_use` blocks, so an agentic Claude client (Claude Code) read the turn as final and stopped after one step.

| Local file | Role | Change |
| --- | --- | --- |
| `open-sse/translator/concerns/finishReason.js:137` | shared rule | new `claudeStopReasonWithToolCalls(reason, hasToolCalls)` — the single source of truth for all OpenAI → Claude projections, mirroring upstream's decision to share one mapping so the paths cannot drift |
| `open-sse/translator/response/openai-to-claude.js:388` | streaming projection (upstream parity: `openai-to-claude.ts`) | terminal `message_delta.stop_reason` promotes an ordinary stop to `tool_use` when the tracked tool-call map is non-empty |
| `open-sse/translator/response/openai-to-claude-json.js:87` | buffered projection (upstream parity: `handlers/responseTranslator.ts`) | same promotion for `translateOpenAIToClaudeIfNeeded`, the non-stream Claude body built from an OpenAI-shaped response |
| `open-sse/translator/response/completionProjector.js:86` | fork-specific additional adapter path | `openAICompletionToClaudeMessage` — the projection used by the forced stream-to-JSON handler and the Responses-client branch — aligned with the same rule |
| `tests/unit/omni-claude-tool-use-terminal.test.js` (new) | scoped offline evidence | 9 cases over synthetic OpenAI-shaped input |

The rule is deliberately narrow (`open-sse/translator/concerns/finishReason.js:115`): a tool call must have been emitted, the mapped reason must be `end_turn`, and the raw reason must be an ordinary clean stop (`stop`, or the Claude literal `end_turn`). Anything else is returned unchanged.

### Deliberate adaptations

1. **Promotion is gated on the raw finish reason, not on "mapped is `end_turn`".** Upstream can gate on the mapped value because its mapping sends `content_filter` to `refusal`. This fork deliberately maps `content_filter` to `end_turn` (`open-sse/translator/concerns/finishReason.js:96`, asserted by `tests/unit/omni-existing-response-stop-reasons.test.js:27`), because OpenAI's `content_filter` is a provider moderation block and not an Anthropic model refusal. Gating on the mapped value would have relabelled a safety stop as a tool turn, so the local rule promotes only an ordinary clean stop and keeps a safety stop at `end_turn`.
2. **No XML tool-call extraction.** Upstream also counts tool calls extracted from `<invoke>` markup in the response text (`state._pendingXmlToolCalls`); this fork has no such extractor in the OpenAI → Claude streaming translator, so the condition is the tracked `state.toolCalls` map — the same map that emits the `tool_use` blocks. The fork's DSML decoding is a different mechanism and already rewrites the buffered `finish_reason` to `tool_calls` on its own (`open-sse/translator/concerns/dsml.js:69`), so those turns already reached `tool_use` before this port.
3. **Tool-call registration is id-gated here.** The fork registers a streamed tool call only when the chunk carries an id (`open-sse/translator/response/openai-to-claude.js:305`), so a call without an id never produced a `tool_use` block and never promotes the terminal. The promotion therefore keys off "a tool block was emitted", not "the upstream mentioned tool calls".
4. **`state.finishReason` follows the promoted value.** Upstream stores the overridden `tool_calls` reason in the shared state; the fork does the same (`open-sse/translator/response/openai-to-claude.js:395`). The fork reads that field only as a truthy marker for the usage injection in `open-sse/utils/stream.js:1419`, so the value change does not alter usage handling.
5. **The upstream test file was replaced, not imported.** Upstream's `tests/unit/openai-claude-stop-reason-tools-18270.test.ts` uses `node:test` and imports upstream's TypeScript modules, which do not exist in this fork. Its five cases (streaming and non-streaming promotion, text-only `end_turn`, `content_filter` → `refusal`) are re-expressed in this fork's Vitest setup in `tests/unit/omni-claude-tool-use-terminal.test.js`, with the refusal expectation replaced by this fork's `content_filter` → `end_turn` mapping.

### Scope of the additional adapter path

Upstream has no counterpart for `open-sse/translator/response/completionProjector.js`: its tree at the merge commit contains no forced stream-to-JSON Claude projection (no `sseToJson`/`completionProjector` module). In this fork the OpenAI → Claude projection is split in three, and the third one is a real client path:

- `openAICompletionToClaudeMessage` is reached from `open-sse/handlers/chatCore/sseToJsonHandler.js:489` and `:630` — a Claude client that asked for a buffered answer while the upstream only offered a stream (forced SSE → JSON) — and from `open-sse/handlers/chatCore/nonStreamingHandler.js:292` (Responses-client branch).
- Before this port it produced the same defect as the other two paths: an upstream `finish_reason: "stop"` with `tool_calls` became `stop_reason: "end_turn"` next to `tool_use` blocks.
- It was aligned deliberately rather than left divergent, because the ported rule is a property of the Claude projection, not of one file. The change is the same one-line promotion through the same shared helper; content blocks, tool identity and usage are untouched. The rule was not extended to the OpenAI → Responses or OpenAI → Gemini projections (different client contracts), nor to the Responses-source → Claude projections (their source rows already carry `tool_calls` / `refusal` semantics of their own).

### Preserved behavior

- Plain text completion stays `end_turn` on all three paths.
- Truncation stays `max_tokens` (`length` and the `max_tokens` literal).
- Safety stays `end_turn` (this fork's `content_filter` mapping), refusal stays `refusal`.
- An upstream `error` finish stays an error: the streaming path still emits the `api_error` event and no `message_delta`.
- A duplicated finish chunk still produces exactly one terminal `message_delta` and one `message_stop` (the `state.claudeFinishHandled` guard is untouched).
- Tool argument identity is untouched: block id, tool name and the sanitized `input_json_delta` payload are produced by the same code as before; only the terminal reason changed.
- Usage is untouched: `input_tokens` / `output_tokens` in the terminal `message_delta` and in the buffered body are unchanged.

## Evidence

- New scoped test: `cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-claude-tool-use-terminal.test.js` → 1 file, 9 tests passed. Before the change the same file failed 4 of 9 cases (`end_turn` instead of `tool_use` on the streaming, duplicated-finish, buffered and adapter paths); the five no-regression cases passed before and after.
- Neighbouring translator suites: `cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 translator/` → 92 files passed, 9 skipped, 1820 tests passed, 34 skipped.
- Neighbouring unit suites: the 47 unit files that reference `stop_reason` (625 tests) and the 143 unit files that reference `tool_calls` (2645 tests, 2 files skipped) all pass.
- No provider traffic, no credentials, no network calls, no browser, no e2e and no whole-suite run: the evidence is synthetic OpenAI-shaped input only. The live Claude Code agent loop is not reproduced offline; the port is argued from the wire contract and covered by the scoped cases above.

## Not ported

- Upstream's `openAIFinishReasonToClaudeStopReason` rewrite as a whole: this fork keeps its own finish-reason table, including its deliberate `content_filter` → `end_turn` mapping, so only the tool-call promotion was lifted.
- Upstream's XML `<invoke>` tool-call extraction, which does not exist in this fork.
- Upstream's `tool_use` fallback for Gemini/Antigravity abort reasons (`malformed_function_call`, `unexpected_tool_call`, …): those are Gemini-source concerns, and this fork's Gemini path handles them in its own error-finish mapping.
