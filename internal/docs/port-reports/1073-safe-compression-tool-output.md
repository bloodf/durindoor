# 1073: Safe compression keeps ordinary tool output

Checked 2026-11-20 against DurinDoor `a325dfb5c382536eeaf829e8b8a626e51ce534ed`.

Source (upstream OmniRoute, merged, read-only metadata): [OmniRoute #18818](https://github.com/cheaper-inference/OmniRoute/pull/18818) `fix(sse): preserve tool output in safe compression plans`, head `b58edc66134c626eb4850941fc21ff6a5212f3c2`, merge `222e3f9cbed57b1bfc489414598b63153a4a63e1`, merged 2026-11-04.

## Disposition

**Already covered — no application code changed.** Acceptance coverage added.

## What the source fixed

OmniRoute's default plan ran Lite with tool-result clipping on (about 2 KB per historical result) and Lite still folded whitespace inside tool messages. #18818:

1. adds a request-local `preserveToolWhitespace` step option so safe/default Lite leaves `role:"tool"` text verbatim;
2. makes the safe default Lite step, the Lite-only plan and the retained stacked Lite step carry `compressToolResults: false` plus that option (`lossyRequestPolicy.ts`);
3. makes the Responses WebSocket bridge and the offline eval runner pass the whole selected plan (including `stackedPipeline`) instead of the stored pipeline;
4. extracts a per-case eval helper (a lint-length refactor).

## Comparison with the fork

| Source change | Fork state |
| --- | --- |
| Safe Lite folds tool whitespace | Not applicable by construction. `engines/lite.js` skips every `role:"tool"` message in `collapseWhitespace` and `removeRedundantContent`, and `cleanMessage` only touches `text`/`input_text` parts, so `tool_result` blocks are never rewritten. Whitespace handling never depended on a clipping option. |
| Default clipping on, needs `compressToolResults:false` | Not applicable. The fork has no `compressToolResults`, no `preserveToolWhitespace` and no `lossyRequestPolicy`/`downgradeUnrequestedLossy` layer. Clipping is the opt-in `truncateToolResults` step option, default `false` (the config schema pins it), and `maxToolLength` alone is inert. It never clips error (`is_error`), JSON, fenced-code or current-turn results. |
| Caveman rewrites tool text | Not applicable. `compressRoles` defaults to `["user"]`; tool messages are never in scope. |
| Session dedup | Unchanged by the source and here. It replaces repeated blocks only; a unique result is never touched. |
| Responses WebSocket bridge discards the selected plan | No counterpart. The fork has no Responses-over-WebSocket compression bridge (no `codex-responses-ws`, no `selectCompressionPlan`). `/v1/responses` converts to the chat core, and `runCompressionSeam` derives the plan from the request's `compressionEngines` map and forwards each step (including `intensity` and declared per-engine options) as `stepConfig`; it never reads a second stored pipeline. |
| Offline eval discards the selected plan | No counterpart. `eval/runFidelityEval.js` applies each engine directly with `stepConfig: { engine }` and makes no provider call; there is no plan selection to drop. |
| Eval helper extraction | Not applicable. No such function exists here. |

Shared-state check: the seam builds new step objects per request and never writes to `compressionEngines`; the new test freezes the map and asserts it is unchanged after Chat and Responses runs.

## Confirmed repairs

None. No transport or option drift was found for ordinary (string/array) tool output:

- Responses `function_call_output` and `custom_tool_call_output`, plus `reasoning.encrypted_content`, `function_call.arguments`, `custom_tool_call.input`, `call_id`s and `instructions`, round-trip through `bodyAdapter.js` unchanged.
- Chat `tool_calls`, `tool_call_id` and signed `thinking` blocks are unchanged.
- Kiro `toolResults` (success and `status:"error"`) are unchanged by safe Lite/Caveman; opted-in clipping reaches the success result only.

## Observation left as is

`bodyAdapter.js` serializes an **object-valued** Responses tool output to a JSON string on restore (the documented #1998 behavior, kept so engines can process the text). When a Responses body is rewritten for another reason (for example a messy user item), that object output reaches the provider as its JSON string. This is not ordinary string output, predates the source, is intentional, and is outside #18818. It was not changed and is not pinned by the new test (which uses string outputs). If it ever needs to be repaired, restore only items whose adapted content changed.

## Acceptance coverage

`tests/unit/omni-safe-compression-tool-output.test.js` (offline: synthetic structured bodies, no provider, network or database; 43 cases):

- Chat Completions and Responses bodies with whitespace-sensitive, non-repeating 10,800 / 16,000 / 100,000-byte tool results stay byte-identical under Lite alone, Caveman alone, Lite + Caveman, session-dedup + Lite, and Lite with an un-opted `maxToolLength`; tool metadata, signed thinking, encrypted reasoning, function-call arguments and `instructions` are unchanged and the caller body is not mutated;
- array-shaped tool content, a tool-only whitespace case (no compression reported), Kiro success and error results;
- ordinary user whitespace is still folded (non-tool processing unchanged);
- explicit opt-in lossy behavior: `truncateToolResults` clips an older Chat, Responses and Kiro success result, while error, JSON, fenced and current-turn results are excluded; RTK still filters a successful result and skips an error result;
- the Lite schema defaults clipping to off and exposes no extra tool-output option.

Mutation check (reverted afterwards): letting Lite fold tool messages fails 28 cases; defaulting clipping on fails 27.

```
test -s internal/docs/port-reports/1073-safe-compression-tool-output.md && (cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-safe-compression-tool-output.test.js)
```

43 passed.
