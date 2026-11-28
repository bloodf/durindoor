# Review: OmniRoute #21355 — keep `length` and `content_filter` on truncated tool calls (KEA-9626)

Review only. No production edits, no issues, no PR, label, link or watch actions. Verdict is from Git objects and read-only `gh api` reads. Nothing was installed or executed.

## Upstream identity

Read with read-only `gh api` on 2026-11-27.

- PR: [cheaper-inference/OmniRoute#21355](https://github.com/cheaper-inference/OmniRoute/pull/21355), "fix(sse): keep length and content_filter finish reasons on truncated tool calls (KEA-9626)".
- State: open, not merged. Created 2026-11-26T18:21:37Z, last updated 2026-11-26T21:12:47Z.
- Base: `release/v3.8.55` @ `0a1fe5ef8f5cbc5496200314bcec11aba9d545f0`.
- Head: `fix/kea-9626-truncated-tool-call-length` @ `9716e927cf95b966072ce70dd448150e1bf304b5`.
- Changed files (8): `open-sse/handlers/chatCore/passthroughToolNames.ts` (+3/−3), `open-sse/handlers/responseSanitizer.ts` (+7/−4), `open-sse/handlers/responseTranslator.ts` (+8/−1), `open-sse/handlers/sseParser.js` (+2/−1), `open-sse/utils/finishReason.ts` (+4/−0), `open-sse/utils/stream.ts` (+4/−2), `tests/unit/kea-9626-truncated-tool-call-length.test.ts` (new, +173), `changelog.d/fixes/0000-kea-9626-truncated-tool-call-length.md` (new).
- Stated behaviour change: an upstream `finish_reason` of `length` or `content_filter` on a turn that carries tool calls is forwarded as-is. Every other reason (`stop`, missing, `function_call`, `end_turn`, …) is still promoted to `tool_calls`.

Scope note: I used the PR description and file list for upstream intent. I did not check the upstream patch text line by line. The verdict rests on DurinDoor's code, traced directly.

## DurinDoor baseline

- `origin/main` @ `29490b783e83176d4d6a4162f76ee3dc79db66ea`. Fetched from `https://github.com/bloodf/durindoor.git`.
- Frozen train tree `32a783d76d45d90bf0517015442f43fadd96106c`.
- Upstream file names do not exist here. DurinDoor uses `.js`, not `.ts`, and a different layout. There is no `responseSanitizer`, `sseParser`, `passthroughToolNames` or `concerns/…` counterpart by those names. The responsibilities map as shown below.
- Frozen train vs `origin/main` on the finish-reason paths: the promotion lines are identical. The only difference in `open-sse/utils/stream.js` is a refactor that moved quirk handling into `open-sse/utils/streamQuirks.js`. That module still calls `normalizeOpenAIFinish` (which maps Claude literals only) and contains no `tool_calls` promotion. The gap below therefore exists in both trees.

## Prior dispositions and claims

- `internal/docs/port-reports/omni-review-transport.md:181` marks #21355 **Out of scope** as "SSE response framing, not provider connection or retry". This review corrects that for the JSON path. The upstream change is about the `finish_reason` a client receives for a provider response, and that is the gap found below.
- `internal/docs/port-reports/2026-11-27-full-parity-refresh.md:1724` (O0056) records **Unrecorded at this head; review required**. This report resolves that row.
- `internal/docs/port-reports/1073-november-recovered-5-dispositions.md:64` (#19601, unresolved) covers a different PR that touched the stream length finish reason. It is not a disposition of #21355 and is not changed here.
- `internal/docs/port-reports/1073-existing-response-stop-reasons.md:4` (#16501) is already covered for Claude `length` mapping via `fromOpenAIFinish`. That is consistent with the Claude-client rows below.
- No active claim covers #21355 or the promotion sites. The auth lane and sync lane lists do not include this PR. Remote and local refs with finish-reason names (`origin/fix/1330-error-finish-claude-gemini`, `origin/orq/tows9a/*`, `orq/tp2x00/r17-gemini-claude-finish-a1`) diverge from `origin/main` by thousands of unrelated files and do not change any line listed below.
- #21390 (`review-omni-21390-length-continuation.md`) is a separate, related review. It confirms DurinDoor forwards a genuine `length` finish unchanged and does not re-send. It does not address the tool-call promotion.

## Path-by-path comparison

| Upstream rewrite | DurinDoor counterpart | Verdict |
| --- | --- | --- |
| `sanitizeOpenAIResponse`, `stream: false`, upstream JSON | `open-sse/handlers/chatCore/nonStreamingHandler.js:873-880` | **Missing / wrong behaviour** (finding 1) |
| `terminal-chunk T18`, `stream: true`, upstream SSE | `open-sse/utils/stream.js:1126-1129`, `open-sse/translator/concerns/finishReason.js:16-22` | **Present.** No `tool_calls` promotion on live OpenAI chunks. `normalizeOpenAIFinish` only maps Claude literals (`CLAUDE_STOP_VALUES`), so `length` and `content_filter` pass unchanged. |
| `parseSSEToOpenAIResponse`, `stream: false`, buffered upstream SSE | `open-sse/handlers/chatCore/sseToJsonHandler.js:257-260` | **Present.** Promotes only a plain `stop` (`(accumulator.finishReason \|\| "stop") === "stop"`), so `length` is kept. |
| `passthroughToolNames` keeps `length` / adds `content_filter` | No such module. Claude-client projection keeps non-ordinary reasons through `claudeStopReasonWithToolCalls` (`open-sse/translator/concerns/finishReason.js:137-146`) and `fromOpenAIFinish` maps `length` to `max_tokens`. | **Present in equivalent form.** No `tool_calls` promotion for `length` on the Claude path. |
| `responseTranslator` keeps #18460 recovery | `open-sse/handlers/chatCore/sseToJsonHandler.js:418-421` drops incomplete tool blocks only when the stop is `max_tokens`. It does not add a `tool_calls` promotion. | **Nothing to narrow.** The `length` result for a cut stream is the correct one here. |
| Gemini non-stream `stop` + tool calls | `open-sse/handlers/chatCore/nonStreamingHandler.js:479` | **Present.** Promotes only `stop`. |
| SSE synthesis from a JSON completion (client wants SSE, upstream returned JSON) | `open-sse/handlers/chatCore/nonStreamingHandler.js:984-986` | **Missing / wrong behaviour** (finding 1, same root cause) |

## Finding 1 — truncated tool call reports `tool_calls` on the JSON path (important)

Upstream stops inside a tool call with `finish_reason: "length"`. DurinDoor forwards `tool_calls` with arguments that do not parse as JSON.

Trace for an OpenAI Chat client with `stream: false` and an OpenAI-compatible upstream that returns JSON:

1. Upstream body: `choices[0].message.tool_calls` is non-empty, `choices[0].finish_reason` is `"length"`.
2. `handleNonStreamingResponse` (`open-sse/handlers/chatCore/nonStreamingHandler.js:768`) calls `translateNonStreamingResponse` (`nonStreamingHandler.js:329`). For `targetFormat === FORMATS.OPENAI` it returns `responseBody` unchanged (`if (targetFormat === FORMATS.OPENAI) return responseBody;`).
3. At `nonStreamingHandler.js:877-879`:
   ```js
   const hasToolCalls = Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0;
   if (hasToolCalls && choice.finish_reason !== "tool_calls") {
     choice.finish_reason = "tool_calls";
   }
   ```
   `"length"` is overwritten. The same applies to `"content_filter"`.
4. `nonStreamingHandler.js:896` runs `normalizeOpenAIFinish("tool_calls")`, which is a no-op. The client receives `finish_reason: "tool_calls"`.

The comment above the block (`nonStreamingHandler.js:873`) says it fixes "non-standard values (e.g. "other")". It does not mention truncation, and `length` is a standard value. This is not an intentional design choice.

The SSE-synthesis branch has the same unconditional overwrite at `nonStreamingHandler.js:984-986`:
```js
if (Array.isArray(intermediateChoice?.message?.tool_calls) && intermediateChoice.message.tool_calls.length > 0) {
  intermediateChoice.finish_reason = "tool_calls";
}
```

Upstream counts the JSON path and the SSE-synthesis path under the same rule, so both are in scope.

Reproduction (static, not executed). Feed this body through `handleNonStreamingResponse` with `sourceFormat === targetFormat === "openai"` and `stream: false`, then assert the client body's `choices[0].finish_reason`:

```json
{"id":"c1","object":"chat.completion","created":1,"model":"m",
 "choices":[{"index":0,"finish_reason":"length",
   "message":{"role":"assistant","tool_calls":[{"id":"t1","type":"function","function":{"name":"lookup","arguments":"{\"q"}}]}}]}
```

Current result: `"tool_calls"`. Expected: `"length"`.

Suggested test location for the port: a new file under `tests/unit/`, with the same six-case matrix as upstream (`length`, `content_filter`, `stop`→`tool_calls`, missing, `function_call`, `end_turn`), run for both the JSON and SSE-synthesis paths. Run it with `cd tests && pnpm run test:ci` only after dependencies are installed. That step was not run here.

Severity: important. A client that acts on `tool_calls` runs a tool with truncated arguments. The upstream PR body reports the failure as reproduced in 20 of 20 trials for a `gpt-5.4-nano` tool call at low `max_tokens`. I did not reproduce it here.

## Adjacent observation (not part of #21355's verdict)

The Ollama response translator promotes a truncated `done_reason` to `tool_calls` in the same way:

- `open-sse/translator/response/ollama-to-openai.js:69-71` (streaming final chunk): `if (chunk.done_reason === OPENAI_FINISH.TOOL_CALLS || state.hadToolCalls) finishReason = OPENAI_FINISH.TOOL_CALLS;`
- `open-sse/translator/response/ollama-to-openai.js:120-121` (non-stream): `let finishReason = toOpenAIFinish(body.done_reason, "ollama"); if (toolCalls.length > 0) finishReason = OPENAI_FINISH.TOOL_CALLS;`

This is outside the three paths #21355 changes and is not covered by any claim found here. It is recorded for a separate decision. It is not part of this port's verdict.

## Verdict

- **#21355 as a whole: missing / wrong behaviour in DurinDoor.** The live SSE path, buffered SSE path, Claude-client projection and Gemini path already preserve the non-ordinary reasons. The JSON path (`nonStreamingHandler.js:877-879`) and the SSE-synthesis path (`nonStreamingHandler.js:984-986`) promote `length` and `content_filter` to `tool_calls`.
- **Claimed:** no.
- **Intentional / inapplicable:** no. The JSON-path rewrite is not justified by its own comment, and nothing in the repo documents `length` → `tool_calls` as intended.
- **Smallest correct port:** narrow the two unconditional assignments to the same rule upstream uses: promote only when the reason is `stop` or missing, and keep the rest. A helper on the lines of upstream's `isIncompleteFinishReason` can sit in `open-sse/translator/concerns/finishReason.js`. Keep the existing `nonStreamingHandler.js:479` and `sseToJsonHandler.js:257` behaviour unchanged.
- **Blocking:** none. This review is static, and a port needs the test run above before it lands.
