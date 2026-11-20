# 1073: Responses historical tool pairing (Chat → Responses)

Port of OmniRoute [#15231](https://github.com/cheaper-inference/OmniRoute/pull/15231)
("fix(translator): pair unpaired Responses function_call items with synthesized outputs (#15216)").
Inspected 2026-11-20.

## Upstream sources and disposition

- [#15231](https://github.com/cheaper-inference/OmniRoute/pull/15231): **merged** 2026-10-02,
  base `release/v3.8.52`, head `60e84fdd38a6a355187571f28179537755135316`, merge commit
  `fca2f868129964a71004c185c1453864d5c2503f`, +189/−1 over two files
  (`open-sse/translator/request/openai-responses/toResponses.ts` and a new unit test).
  **Ported, adapted** — see below.
- Upstream commit `87a753439` named in the work order is **not** the #15231 change. It is
  "fix(translator): drop unsigned reasoning on Claude output (#12917)"
  (`87a753439fdaf15ee0c48e859bd3d518e3de082d`, 2026-10-02), which touches
  `open-sse/handlers/chatCore/passthroughHelpers.ts` and adds
  `tests/unit/claude-passthrough-unsigned-thinking-12917.test.ts`. It is a different feature
  on a different surface (Claude response passthrough) and carries no historical tool-pairing
  logic, so nothing of it applies here. **Not applicable.**

Upstream behavior, in `openaiToOpenAIResponsesRequest`:

1. existing pass — drop `function_call_output` items whose `call_id` has no matching
   `function_call` (the orphan-output filter);
2. new pass — for every `function_call` with no matching output, insert
   `{ type: "function_call_output", call_id, output: "", status: "completed" }` immediately
   after that call. The call is repaired, never dropped; real outputs are never touched.

Upstream states the scope limit that its translator never emits `custom_tool_call`,
`local_shell_call` or `apply_patch_call` items, so only `function_call` /
`function_call_output` need the repair.

## Local port

Files changed:

- `open-sse/translator/request/openai-responses.js` — new `pairHistoricalToolCalls()` and its
  call in `openaiToOpenAIResponsesRequest()`.
- `open-sse/translator/concerns/toolCall.js` — `EMPTY_TOOL_RESULT_TEXT` exported so the Chat-shaped
  and Responses-shaped compatibility results share one value.
- `tests/unit/responses-historical-tool-pairing.test.js` — new fixtures.

### Adaptations, and why

- **Empty compatibility result.** Upstream writes `output: ""` with `status: "completed"`. This
  fork already has an established empty compatibility result for a tool call whose output never
  arrived: `"[No response received]"`, produced by `syntheticToolResult()` in
  `open-sse/translator/concerns/toolCall.js` for the Chat-shaped repair. The port reuses that
  value (now the shared `EMPTY_TOOL_RESULT_TEXT`) instead of an empty string plus a
  `status: "completed"` marker, because a completed-status empty result can be read as "the tool
  ran and returned nothing", while the established marker states that no result was received and
  therefore never implies a tool execution that did not happen.
- **No `status` field.** This fork's Responses items never carry a `status` field
  (`function_call` / `function_call_output` are emitted as `{type, call_id, …}`), and strict
  Responses upstreams already accept that shape on every request. The synthesized output keeps
  the same shape as the surrounding items.
- **Custom tool calls are covered.** Unlike upstream, this fork's translator *does* emit
  `custom_tool_call` items (a declared custom tool is lowered to one), so upstream's scope
  rationale does not hold here. The repair pairs an unpaired `custom_tool_call` with a
  `custom_tool_call_output` counterpart; the same strict-protocol rejection applies to an
  unanswered custom call.
- **Call ids are matched on the wire value.** The counterpart carries the same `call_id` the
  call item carries, i.e. the clamped id that actually reaches the upstream, not the client's
  original id.

### Preserved behavior

- **Real results and ids are never overwritten.** The set of answered call ids is collected from
  the whole input first, so a call whose real output appears later in the history keeps that
  output and gets no synthesized item.
- **The fill lands at the correct position** — immediately after the call it answers, so the
  position of every other item is unchanged.
- **The orphan-output cleanup still runs first**, so an output whose call is gone is still
  dropped and is never counted as a real answer.
- **Ordinary pending-tool behavior stays intact** where the protocol allows it: the Chat-shaped
  repair in `open-sse/translator/concerns/toolCall.js` (`fixMissingToolResponses`) and the
  Responses→Chat direction are untouched, so a pending tool call in a Chat-shaped history is
  still repaired exactly as before, and no direction gained a second synthesis for a call the
  Chat-shaped repair already paired.
- **Native passthrough is untouched.** A request body that already carries a Responses `input[]`
  is still forwarded as-is (with the existing orphan-output cleanup only); a pending call in a
  native Responses history remains the native client's own protocol business.
- **Tool-choice semantics are untouched** — `tool_choice` allowlisting, namespace qualification
  and the "omit the field when no tool survived" rule are unchanged.

## Local gap this closes

The fork's Chat-shaped repair (`fixMissingToolResponses`) runs on the *source* body before the
Responses hop, and again after the Gemini-family source conversion, so a Chat-, Claude- or
Gemini-sourced history is already paired when it reaches the Responses wire. It does not run for
every source: `isGeminiRequestSource()` covers only `gemini` and `gemini-cli`, and the
Antigravity source body carries `contents[]`, not `messages[]`, so no Chat-shaped repair applies
to it. An Antigravity history with an unanswered `functionCall` therefore reached the Responses
wire as an unpaired `function_call` item — exactly the shape strict Responses upstreams reject
with `400 No tool output found for function call <id>`. The Responses-side repair closes that
path, and it is the last hop before the wire, so it covers every source that targets Responses.

## Verification

- New fixtures: `tests/unit/responses-historical-tool-pairing.test.js` (12 tests) — paired
  history untouched, unpaired trailing call, mid-history unpaired call repaired in place,
  interleaved calls with only the missing counterpart filled, two interleaved turns with
  exactly one output per call, several missing counterparts at once, orphan-output cleanup
  preserved, custom tool call pairing, no double pairing of a Chat history the Chat-shaped
  repair already paired, native passthrough preserved, non-Chat (Antigravity) source pairing,
  and the counterpart carrying the clamped wire id.
- Focused command: `unit/responses-historical-tool-pairing.test.js`,
  `translator/v5-conformance-tool-choice-responses.test.js` and
  `unit/responses-prefixed-flat-tool-identity.test.js` — 3 files, 49 tests, all passing.
- Scoped regression set over the affected translator and unit suites (Responses request
  lowering, tool-result pairing, custom tool history, namespace tools, Responses field
  stripping, apply-patch precedence, salvage of orphans, tool-output media, Gemini turn
  normalization) — 25 files, 310 tests, all passing.
- Root lint: `npm run lint` (`eslint src` + the anti-slop gate) — exit 0, anti-slop gate 0
  diagnostics across 2678 files.

## Environment note (not a code issue)

While this port was in progress the shared dependency tree of this machine was broken: the main
checkout's root `node_modules` held 48 top-level symlinks that pointed into a worktree whose
`node_modules` an unrelated session had removed, so `vite`, `playwright`, `eslint` and `oxlint`
no longer resolved and `tests/vitest.config.js` could not be loaded. No dependency was installed,
deleted or modified for this port. Intermediate runs were made possible by a private scratch
resolver (`/tmp`, outside the repository) that redirected those specifiers to the copies already
present in the main checkout's pnpm store, plus a private `open-sse/node_modules/undici` symlink
inside this worktree for the one package the Vite resolver needed; both were removed again.

Another session repaired the shared tree afterwards (the 48 links resolve again), and every
verification command below was then re-run verbatim, with no scratch resolver and no overlay:

- the work-order command (`test -s` on the report and the test file, then the three Vitest files)
  — exit 0;
- root lint (`npm run lint`: `eslint src` plus the anti-slop gate) — exit 0, "anti-slop gate OK
  (0 diagnostics across 2678 files)";
- the scoped regression set — 25 files, 310 tests, all passing.

`tools/oxlint/anti-slop/index.bundle.js` is rebuilt by the lint run. In this worktree the rebuild
rewrites only the source-path comment of that generated file (`node_modules` is a symlink to the
main checkout here), so the artifact was restored afterwards and carries no diff.

