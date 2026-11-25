# #1073: Chat history translated to Responses must stay valid

Source: [OmniRoute #231](https://github.com/cheaper-inference/OmniRoute/pull/231) "fix: omit synthesized reasoning items in Chat→Responses translation (#224)", reviewed head `51a2354197816c859a4f3c67ee043f0f16380403`, merge commit `3f5096c41fdc62a0d57f6741854958edaf38fa86` (merged, base `main`, upstream file `open-sse/translator/request/openai-responses.ts`, `+4/−23`). Local comparison base: this worktree's `main` integration head. No provider request, live account, browser, Docker or paid API was used; every statement below comes from the upstream diff, the official Responses schema and documentation, this repository's code, and offline fixtures.

This resolves the row recorded as UNRESOLVED in [the March recovered dispositions](1073-march-recovered-dispositions.md) (`#231`, same head and merge pins) and the title-survey row in [the first-quarter dispositions](1073-first-quarter-row-dispositions.md).

## Disposition: confirmed residual — the synthesized reasoning item is gone

**The local shape was not already compatible.** Upstream #231 removed two client-side reasoning items from `openaiToOpenAIResponsesRequest()`: the one built from `msg.reasoning_content` and the one built from `thinking`/`redacted_thinking` blocks in array content. Both carried a client-made id (`reasoning_${input.length}`), and upstream's stated reason is that the Responses API requires server-generated `rs_*` ids and that client-side ids made Responses-compatible upstreams answer `400 Invalid Request`.

The local assembler emitted the same kind of item *without* any id:

```js
// before — open-sse/translator/request/openai-responses.js:874-882
if (msg.role === ROLE.ASSISTANT && msg.reasoning_content) {
  result.input.push({
    type: RESPONSES_ITEM.REASONING,
    summary: [{ type: RESPONSES_ITEM.SUMMARY_TEXT, text: msg.reasoning_content }]
  });
}
```

A missing id is not a valid alternative to a fabricated one. Primary protocol evidence:

- The official Responses schema types the only reasoning-shaped input item as `ResponseReasoningItem`, whose `id: string` is a **required** field (`id`, `summary`, `type` are the required trio); `ResponseInputItem` is the union that contains it, and no other member of that union carries reasoning (`openai/openai-node`, `src/resources/responses/responses.ts`). `{type:"reasoning", summary:[…]}` without `id` is therefore not a valid request item under the protocol the target speaks.
- The OpenAI reasoning guide states that reasoning items stay opaque ("the API does not return their reasoning text"), that continuity comes either from `previous_response_id` or from replaying the **original output items** of each response, and that in stateless mode (`store: false`, Zero Data Retention) those replayed items carry `encrypted_content`. A summary string is a display projection, not the reasoning state, so the local item carried no continuity either.

The local item was also unreachable as a continuity carrier: the fork's Responses → Chat direction keeps only the reasoning *text* (`open-sse/translator/request/openai-responses.js:415-426` and `:598-603`), dropping the item id and `encrypted_content`, and the Chat → Responses assembler never read `encrypted_content` back. A Chat-format history can therefore never carry a usable reasoning item, so the synthesized item was a fabricated protocol object with no continuity value. The fork never fabricates a server-generated id; the id-less item is removed instead.

### Change

`open-sse/translator/request/openai-responses.js`, `openaiToOpenAIResponsesRequest()` (the Chat → Responses assembler) no longer synthesizes a `reasoning` input item from Chat `reasoning_content`. The comment at `:876-883` records the reason.

### What is preserved

- **Native Responses reasoning history.** A request that already carries `input` items is untouched by this change: the `body.input` branch (`:836-840`) and `stripOrphanedToolOutputs` still pass server-issued reasoning items through byte for byte, including `id` and `encrypted_content`.
- **Continuity.** `pairHistoricalToolCalls`, `stripOrphanedToolOutputs`, `ensureResponsesInputOrContinuity` (`:815-826`) and the tool-call/tool-output pairing are unchanged; an empty history still gets the continuity placeholder.
- **Ordinary assistant content.** The assistant message, its text parts and its tool calls are unchanged; only the fabricated reasoning item is gone.
- **Reasoning on the routes that carry it.** The change is confined to the Chat → Responses assembler. Claude thinking blocks, Gemini thought parts, Ollama `message.thinking`, CommandCode reasoning blocks, the Responses → Chat direction (native reasoning still becomes `reasoning_content`) and every native Responses item are untouched.

### Not ported from this source

Upstream #231 also removed the synthesis of `thinking`/`redacted_thinking` blocks found in Chat array content. The local assembler never produced that item — Chat array content is lowered through `chatPartToResponses()` — so there is no local counterpart to remove.

The fork's own upstream (`decolua/9router` `master` `1855aa44473e88feac9d3f131b9c0c5fc9706b68`) keeps a reasoning item in the same function, but its `buildReasoningInputItem()` re-emits `encrypted_content` when the Chat message carries one, so its item can be a real continuity token. The local assembler has no such path. Porting that upstream behavior is a separate 9router change and was not attempted here.

## Target-specific evidence and its limits

The affected existing target is the Responses transport (`transport.format: "openai-responses"`: `codex`, `grok-cli`, `openai`, `minimax`, `xai`, `muse-code`, `opencode*`, and the other Responses-compatible registry entries). Offline fixtures in this tree show what the local executors do with reasoning items that reach them:

- `tests/unit/grok-cli-foreign-reasoning.test.js` — Grok Build **tolerates** an id-less summary-only reasoning item and keeps it. That is tolerance of a malformed item, not a route that depends on it: the same fixture shows Grok Build's own reasoning is identified by its `rs_<uuid>` id, and the executor's job there is to strip foreign `encrypted_content`, not to require a summary item.
- `tests/unit/azure-codex-request-compat-1072.test.js` — Codex drops Grok-sealed reasoning and keeps reasoning of unknown provenance, including summary-only items. Those are **native** items replayed from a Responses client, not items this assembler builds.
- `tests/unit/opencode-muse-tool-choice-and-reasoning-strip.test.js` — the OpenCode/OpenCode Go executors strip prior-turn reasoning items outright on the affected models.

No executor, registry entry or fixture in this tree requires a synthesized reasoning item to be present in a Chat → Responses request, so no supported route loses a reasoning item it uses. What is *lost* by the change is a display-only summary string that the OpenAI Responses protocol cannot accept as an input item and cannot use for continuity.

**Uncertainty that cannot be resolved offline.** No provider request was made, so the exact upstream failure text (`400 Invalid Request`) was not reproduced here, and it is upstream's own claim about a client-made id. Whether a specific Responses-compatible provider tolerates the id-less shape (Grok Build's fixture says one does) is not evidence of validity for the OpenAI Responses API, and each provider's tolerance would have to be established with a live request against that provider. If an operator later shows that a named target depends on the summary item, the fix is to carry a real server-issued item (id plus `encrypted_content`) through the Chat pivot, not to restore a client-built id.

## Offline acceptance

`tests/unit/omni-chat-responses-reasoning-history.test.js` (new) covers the residual: a Chat history with `reasoning_content` produces no reasoning item and keeps the assistant answer; no reasoning id is ever invented (`rs_`, `reasoning_`, `summary_text` absent from the serialized input); the assistant turn, its tool call and the paired tool output survive; a native server-issued reasoning item (with `id` and `encrypted_content`) is preserved unchanged; an empty history still gets the continuity placeholder; and reasoning still rides on Claude, Ollama and the Responses → Chat direction.

`tests/unit/reasoning-history-bridge.test.js` — the `openai -> openai-responses` row was updated from "reasoning_content becomes a reasoning item" to the new contract (no synthesized item, assistant content preserved). The other rows of that file are unchanged.

`open-sse/utils/openaiToClaudeReasoningHistorySelfCheck.mjs` — check 9 was updated to the same contract so the standalone self-check does not assert a removed behavior.

Focused run:

```bash
cd tests && node node_modules/vitest/vitest.mjs run --maxWorkers=2 unit/omni-chat-responses-reasoning-history.test.js
```

Refs #1073
