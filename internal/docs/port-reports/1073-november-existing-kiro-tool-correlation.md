# #1073 — Compare existing streamed Kiro tool correlation

- Public PR #18780: [PR](https://github.com/cheaper-inference/OmniRoute/pull/18780), head `bb0e39621fbe3f85308d5e143944740278c521e8`; named enclosing patch commit [2b5a61f3789466a0067ed855140c5877f6d08574](https://github.com/cheaper-inference/OmniRoute/commit/2b5a61f3789466a0067ed855140c5877f6d08574). The enclosing source history contains unrelated release changes, so comparison is limited to the PR's Kiro executor, tests, and changelog patch.
- Public PR #18823: [PR](https://github.com/cheaper-inference/OmniRoute/pull/18823), head `8165e45c6e852f1363d45f62a4f198ff6364ce56`; named enclosing patch commit [4bf2a973f652b5bcf0bf6b362c6165f200951314](https://github.com/cheaper-inference/OmniRoute/commit/4bf2a973f652b5bcf0bf6b362c6165f200951314). Comparison is limited to the client tool-name collision changes and their fixture.
- Local comparison base: `0746011f373aee383e3689dff62cd0b91df07027` (`orq/tornf6/audit-omni-november-existing-kiro-tool-correlation-a1`).

## Dispositions

| PR | Disposition | Reason |
| --- | --- | --- |
| #18780 | Already present; no port | The local Kiro executor emits `{}` for started calls whose accumulated arguments are empty or whitespace at the terminal boundary. It tracks emitted arguments by tool ID, leaves nonempty arguments intact, and emits the fill before the finish chunk. |
| #18823 | Already present; no port | The local executor detects a client-declared `tool_call` in the translated current-message tool list and treats that event as an ordinary tool call. The local request translator does not synthesize undeclared tool specifications, so the upstream `_kiroSynthesizedToolNames` marker is unnecessary here. |

## Exact patch comparison and local evidence

### #18780 — argument-less streamed calls

The named upstream patch adds a terminal flush that appends `{}` only when a call has no accumulated argument text; its regression fixtures cover absent/empty input, nonempty input, wrapper calls, idempotence, and ordering before finish. Current local `open-sse/executors/kiro.js:763-772` implements that same narrow stream behavior. It is called at both terminal paths (`:1142-1145`, `:1218-1221`), and checks each call's accumulated text before appending the JSON object.

Fixture evidence: `tests/unit/kiro-toolcall-wrapper.test.js:155-169` streams an empty `status` call beside a populated `read` call, reassembles arguments by call index, verifies `{}` versus `{"path":"/a"}`, and checks the fill precedes finish. This covers the observable behavior from #18780; no new fixture or source change is indicated.

### #18823 — client tool named `tool_call`

The named upstream patch conditions the special nested-MCP-wrapper parser on whether the translated current message declares a client tool with the colliding name. It also records synthesized historical tool names because that upstream translator can synthesize specs when client tools are absent.

The local executor makes the same client-declaration distinction at `open-sse/executors/kiro.js:674-678`, and only routes the name through wrapper validation when no such declaration exists (`:970-994`). It uses the provider's `toolUseId` as the emitted call ID (`:965-966`, `:1017-1038`) and otherwise emits the incoming tool name and arguments through the normal path. The ordinary wrapper validation/error path remains active for undeclared `tool_call` events; `tests/unit/kiro-toolcall-wrapper.test.js:87-152` covers malformed/incomplete wrappers and byte-equivalent handling of a complete wrapper. The client-declaration case at `:171-180` verifies the arguments survive and no invalid-wrapper error is emitted.

The local request translator's policy differs at the input boundary: it explicitly creates specifications only from client-declared tools (`open-sse/translator/request/openai-to-kiro.js:195-218`), rather than synthesizing specs from transcript history. Its tests cover caller-declared schemas and the no-tools flattening policy (`tests/unit/openai-to-kiro.test.js:137-230`). Therefore there is no local synthesized `tool_call` name to misclassify and no need to port the upstream marker/helper. For sanitized client names, the existing `_toolNameMap` round-trip is exercised in `tests/unit/kiro-tool-name-cache-3107.test.js:13-100`; exact incoming call IDs are preserved by the executor.

## Boundary with queued #2447 tool-result content work

These PRs concern response-event argument correlation and dispatch of a client-declared tool whose name collides with the Kiro wrapper. They do not change request-side tool-result body conversion. The current converter maps `tool_call_id` to Kiro `toolUseId` and preserves `is_error` as `status: "error"` (`open-sse/translator/request/openai-to-kiro.js:401-408`); Claude `tool_result` blocks likewise preserve the error status (`:384-396`). The separate OpenAI `role: "tool"` content-array flattening limitation is visible at `:403` and remains in the already queued #2447 scope. Keep its ordinary offline acceptance focused on array-content text extraction while asserting the existing tool ID and error-status mapping; it is not evidence for either PR above and does not justify expanding this comparison.

## Verification

Documentation-only comparison; no source, tests, workflow, registry, baseline, or credentials were changed. Existing fixture evidence was inspected but no test command was run. The requested report-presence and pin checks passed:

```sh
test -s internal/docs/port-reports/1073-november-existing-kiro-tool-correlation.md
rg -q -F bb0e39621fbe3f85308d5e143944740278c521e8 internal/docs/port-reports/1073-november-existing-kiro-tool-correlation.md
rg -q -F 2b5a61f3789466a0067ed855140c5877f6d08574 internal/docs/port-reports/1073-november-existing-kiro-tool-correlation.md
rg -q -F 8165e45c6e852f1363d45f62a4f198ff6364ce56 internal/docs/port-reports/1073-november-existing-kiro-tool-correlation.md
rg -q -F 4bf2a973f652b5bcf0bf6b362c6165f200951314 internal/docs/port-reports/1073-november-existing-kiro-tool-correlation.md
```

Refs #1073
