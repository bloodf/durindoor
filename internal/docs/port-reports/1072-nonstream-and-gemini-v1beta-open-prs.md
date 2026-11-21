# #1072: 9router #5380 and #5386 — non-streaming projection and Gemini v1beta tools

Reviewed 2026-11-21 against DurinDoor `530139f257e33037f40326da032b4b88aa` (branch `orq/tornf6/audit9r-nonstream-and-gemini-v1beta-open-prs-a1`). Both named upstream records are **open, unmerged** PRs in `decolua/9router`; the comparison uses each PR's final diff at the pinned head, not its title, body, or an earlier commit. Heads can move; recheck before any future implementation. This is a bounded reconciliation of two records, not a claim that the whole upstream inventory was reviewed.

## Pinned source

| Source | State | Head | Base |
| --- | --- | --- | --- |
| [9router #5380](https://github.com/decolua/9router/pull/5380) — `fix(translator): convert non-streaming responses to client format` | open | `03727a07be3a357dc595450c5a61c7847d5bed93` | `1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d` (upstream `master`, v0.5.112) |
| [9router #5386](https://github.com/decolua/9router/pull/5386) — `fix(v1beta): keep tools and tool calls for Gemini-native clients` | open | `980df24be92cd5a5a33934f1346d33a2ef941cd0` | `1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d` (upstream `master`, v0.5.112) |

Both heads were re-confirmed still `open` at exactly these SHAs on 2026-11-21 (`gh api repos/decolua/9router/pulls/{5380,5386}`). The full diffs were read from `repos/decolua/9router/compare/<base>...<head>` and the upstream base copies of the touched files were read at `1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d` so the pre-patch behavior is known, not inferred.

Local ports already in this tree for the same records:

- `2e827b392a0fd421569324111a66d260f8f61605` — `port(upstream): #5380 - project accumulated responses to client format` (`Refs #1072`).
- `551e00697cf4bfc67d204980dde64e2ea86cf367` — `port(upstream): #5386 - preserve Gemini JSON schema declarations` (`Refs #1072`).

## What the exact final patches change

**#5380 (`03727a07be3a357dc595450c5a61c7847d5bed93`)** touches `open-sse/handlers/chatCore/nonStreamingHandler.js` and `tests/unit/nonstream-sse-error.test.js`:

1. `translateNonStreamingResponse()` becomes two explicit steps: step 1 normalizes the upstream transport (`gemini`, `antigravity`, `gemini-cli`, `vertex`, `claude`, `ollama`) into an intermediate OpenAI `chat.completion`; step 2 converts that intermediate into the client's dialect — a Claude Message for `sourceFormat === claude`, a Responses object for `sourceFormat === openai-responses`.
2. `handleNonStreamingResponse()` sets `currentFormat = FORMATS.OPENAI` when the upstream answered with `text/event-stream`, because the SSE accumulator always produces OpenAI completions even when transport and client share a native dialect.

Upstream's own new assertions are: an SSE body with `targetFormat === claude` and `sourceFormat === claude` must return `type: "message"`, and a non-streaming Gemini/Antigravity JSON body with `targetFormat === antigravity` and `sourceFormat === claude` must return `type: "message"` with the text preserved.

**#5386 (`980df24be92cd5a5a33934f1346d33a2ef941cd0`)** touches the two Gemini request translators, `src/app/api/v1beta/models/[...path]/route.js`, a new `src/lib/geminiBridge.js`, and a new `tests/unit/gemini-bridge-tools.test.js`:

1. `func.parameters || { type: "object", properties: {} }` becomes `func.parameters || func.parametersJsonSchema || { … }` in `open-sse/translator/request/gemini-to-openai.js` and `open-sse/translator/request/antigravity-to-openai.js`.
2. The `/v1beta/models/*` route stops using its own text-only `convertGeminiToInternal` and reuses `geminiToOpenAIRequest`, so `tools`, `functionCall`, `functionResponse` and inline images survive the request.
3. Response side: OpenAI `tool_calls` become Gemini `functionCall` parts — in the non-streaming body, and in the stream, where fragments are accumulated per index and emitted whole on the finishing chunk; the upstream `functionCall` part carries the OpenAI tool-call `id`.
4. SSE lines split across network chunks are buffered instead of dropped.
5. `keepAliveGeminiSSE()` is added: 10 s Gemini keep-alive pings while the upstream is slow, and a 504 error event when the upstream stays silent past 240 s.

## Verified existing local behavior

### Non-streaming projection on ordinary JSON requests (upstream #5380 territory)

The fork does not use upstream's two-step rewrite; it reaches the same client-visible outcome with per-branch projections plus an outer Claude-lane projection. Both are in `open-sse/handlers/chatCore/nonStreamingHandler.js`:

- The upstream-SSE half of #5380 is present and is the local port's own change: `responseFormat` starts as `targetFormat` (`:524`) and becomes `FORMATS.OPENAI` when the SSE accumulator produced the body (`:549`, `:579-580`). The fork additionally keeps a JSON document delivered under the event-stream media type in its own dialect (`:562`, `:572-577`), which upstream's patch does not have.
- Claude client: `sourceFormat === claude` with an OpenAI upstream is converted in-function (`:317-321`); every other transport (Gemini family `:372-432`, Claude transport `:435-493`, Ollama `:496-498`, binary transports `:504-506`) produces an OpenAI completion that the outer handler converts to a Claude Message (`:654-660`).
- Responses client: `sourceFormat === openai-responses` is projected for an OpenAI upstream (`:289-295`), a Gemini-family upstream (`:429-431`), a Claude upstream (`:492`) and binary transports (`:504-506`).
- The forced-SSE → JSON lane is separate and already projects to the client dialect (`open-sse/handlers/chatCore/sseToJsonHandler.js:676`, and `:506` for Responses upstreams).

Runtime evidence — `handleNonStreamingResponse()` was driven offline with a synthetic provider body per upstream transport and the client-visible shape was classified. The scratch harness lived outside the repository and imported the fork's own modules; no repository file was added or changed.

| client (`sourceFormat`) | OpenAI upstream | Gemini upstream | Antigravity upstream | Claude upstream | Ollama upstream | decoded binary upstream |
| --- | --- | --- | --- | --- | --- | --- |
| `claude` | `message` | `message` | `message` | `message` | `message` | `message` |
| `openai-responses` | `response` | `response` | `response` | `response` | **`chat.completion`** | `response` |
| `openai` | `chat.completion` | `chat.completion` | `chat.completion` | `chat.completion` | `chat.completion` | `chat.completion` |

Upstream's final #5380 patch returns a Responses object for **every** upstream transport, because its step 2 runs after step 1 regardless of the transport. The fork matches upstream for all transports except one: an Ollama transport with a Responses client.

The existing local assertion for the ported half is `tests/unit/nonstream-client-projection-5380.test.js:6-13` — an SSE body on a Claude transport to a Claude client must return a `tool_use` block that keeps the upstream call `id` and `stop_reason: "tool_use"`. It passes.

### Gemini-native v1beta request/tool/call paths (upstream #5386 territory)

The fork does not route `/v1beta` through `geminiToOpenAIRequest`; it keeps a fork-native bridge at `src/app/api/v1beta/models/[...path]/geminiBridge.js`, imported by the route at `src/app/api/v1beta/models/[...path]/route.js:15-19`. The route calls `convertGeminiToInternal` (`:105`), then `transformOpenAISSEToGeminiSSE` for `:streamGenerateContent` (`:117-121`) and `convertOpenAIResponseToGemini` for `:generateContent` (`:122-125`).

Already covered, verified in the fork's source and by offline probes:

- **Tool declarations survive the request**, including `parametersJsonSchema` when `parameters` is absent, and `parameters` wins when both are present (`geminiBridge.js:55`; `open-sse/translator/request/gemini-to-openai.js:67`; `open-sse/translator/request/antigravity-to-openai.js:77`). This is exactly upstream change 1 and is the subject of the local port `551e00697c`.
- **`functionCall` / `functionResponse` survive the request** and stay paired: the bridge derives a deterministic id per call and matches an id-less `functionResponse` back to the queued id of the preceding model turn (`geminiBridge.js:105-191`, especially `:114-136` and `:156-177`), and it synthesizes unique ids for parallel same-name calls.
- **Inline images survive the request** as `image_url` data-URL parts (`geminiBridge.js:149-151`).
- **`toolConfig.functionCallingConfig` maps to OpenAI `tool_choice`** (`NONE`, `ANY` with an allow-list, `AUTO`/`VALIDATED`) (`geminiBridge.js:62-78`).
- **Streaming `tool_calls` are accumulated per index and emitted as one complete `functionCall` part on the finishing chunk** (`geminiBridge.js:216-240`), and the terminal chunk still carries `usageMetadata` (`geminiBridge.js:258-269`).
- **SSE lines split across network chunks are buffered instead of dropped** (`geminiBridge.js:285-292`). Verified offline with upstream's own cut points (`[7, 61, 140, 230]`): the fragmented stream yields exactly one `functionCall` `{ name: "run_shell", args: { command: "echo hi" } }` and a final `usageMetadata.totalTokenCount` of 8. The fork has no local assertion for the split-chunk case specifically (its streaming test in `tests/unit/v1beta-gemini-tool-calling.test.js:233-255` uses whole lines), so this behavior is implemented and probed but not regression-locked.
- **Non-streaming `message.tool_calls` become `functionCall` parts**, and no empty text part is emitted when the turn carries only a call (`geminiBridge.js:380-397`), matching upstream change 3.

Established local assertions, all passing (23 tests over 5 files, run offline on this head with `node node_modules/vitest/vitest.mjs run … --maxWorkers=2`):

- `tests/unit/v1beta-gemini-tool-calling.test.js` — tools/functionCall/functionResponse mapping, unique ids for parallel same-name calls, explicit-id reuse, uppercase Gemini schema normalization, every `toolConfig` mode, non-stream `tool_calls` → `functionCall`, streaming accumulation, SSE transformer.
- `tests/unit/gemini-parameters-json-schema.test.js` — `parametersJsonSchema` through the Gemini translator, the Antigravity translator and the v1beta bridge, plus "`parameters` wins when both exist".
- `tests/unit/v1beta-gemini-inline-data.test.js` and `tests/unit/v1beta-gemini-gateway-conformance-1089.test.js` — the surrounding v1beta request/response contract.

## Remaining repair: one client-format pair on the ordinary JSON route

**Gap.** For a Responses client (`/v1/responses`, `sourceFormat === openai-responses`) whose request routes to an Ollama transport (`targetFormat === ollama`), the non-streaming JSON body is returned as a raw `chat.completion` instead of a Responses object. The Responses client receives a body its own contract cannot read — the same symptom class upstream #5380 was opened for.

Local cause: `open-sse/handlers/chatCore/nonStreamingHandler.js:496-498` returns `ollamaBodyToOpenAI(responseBody)` and stops there. Every other upstream transport in that function ends in a client-format projection (`:289-295`, `:429-431`, `:492`, `:504-506`); the Ollama branch is the only one that returns the raw intermediate. Upstream's final #5380 patch closes it through its step 2.

Reachability is established from the fork's own routing code, not assumed: `getTargetFormat("ollama")` and `getTargetFormat("ollama-local")` both return `ollama`; the Ollama registry entries expose only a Claude alternative transport (`open-sse/providers/registry/ollama.js:37-47`, `open-sse/providers/registry/ollama-local.js:30-39`), so a Responses client falls back to the provider default transport, and the request path `openai-responses → openai → ollama` is registered (`open-sse/translator/request/openai-responses.js:1061`, `open-sse/translator/request/openai-to-ollama.js:208`). No live call was made, so this is a static-plus-offline-harness conclusion.

**Proposed repair (small, one branch, no route or credential change).** In the Ollama branch of `translateNonStreamingResponse`, normalize the Ollama body to an OpenAI completion and project it to the client dialect only when the client is a Responses client, mirroring the structure the sibling branches already use (`:429-431`, `:492`):

```js
  // Ollama
  if (targetFormat === FORMATS.OLLAMA) {
    const openAICompletion = ollamaBodyToOpenAI(responseBody);
    return responsesClient
      ? projectCompletionToClientFormat(openAICompletion, sourceFormat, projectionOptions())
      : openAICompletion;
  }
```

Why this shape: the Claude lane must keep using the outer `translateOpenAIToClaudeIfNeeded` conversion (`:654-660`), which carries the fork's own cache-token and `tool_use` stop-reason rules; routing Claude through `projectCompletionToClientFormat` would swap in a different Claude projector. Leaving non-Responses clients on the current return value keeps the OpenAI and Claude lanes byte-identical.

**Precise offline acceptance test** (no credentials, no provider traffic, no browser). Extend `tests/unit/nonstream-client-projection-5380.test.js`, which already mocks `@/lib/usageDb.js` and drives `handleNonStreamingResponse` with a synthetic provider body:

```js
const ollamaBody = {
  model: "llama3",
  message: {
    role: "assistant",
    content: "hello",
    tool_calls: [{ function: { name: "run_shell", arguments: { command: "ls" } } }],
  },
  done: true,
};
```

1. **New behavior — Responses client, Ollama transport.** Call `handleNonStreamingResponse` with `providerResponse` = `new Response(JSON.stringify(ollamaBody), { headers: { "content-type": "application/json" } })`, `provider: "ollama-local"`, `sourceFormat: FORMATS.OPENAI_RESPONSES`, `targetFormat: FORMATS.OLLAMA`, `stream: false`, plus the same `trackDone` / `appendLog` / `reqLogger` / `onRequestSuccess` stubs the existing case uses. Assert on the parsed JSON body:
   - `body.object === "response"`;
   - `body.output[0].type === "message"` and `body.output[0].content[0].text === "hello"`;
   - the tool call survives with its identity: one `body.output` entry with `type === "function_call"`, `name === "run_shell"`, `arguments === "{\"command\":\"ls\"}"`, and `call_id` equal to the OpenAI tool-call id carried by `ollamaBodyToOpenAI` (`call_0_<created>` in the current implementation);
   - `body.usage.input_tokens`, `body.usage.output_tokens` and `body.usage.total_tokens` are present (numbers).
2. **Regression — Claude lane unchanged.** The same Ollama body with `sourceFormat: FORMATS.CLAUDE` must still return `body.type === "message"` with the text block and a `tool_use` block that keeps the call id, i.e. the current output of `translateOpenAIToClaudeIfNeeded` (`:654-660`).
3. **Regression — OpenAI lane unchanged.** The same Ollama body with `sourceFormat: FORMATS.OPENAI` must still return `body.object === "chat.completion"` with the tool call id intact.
4. **Regression — the ported #5380 half still passes.** The existing case in the same file (`tests/unit/nonstream-client-projection-5380.test.js:6-13`) must stay green.
5. **Regression — the v1beta lane is untouched.** `tests/unit/v1beta-gemini-tool-calling.test.js`, `tests/unit/gemini-parameters-json-schema.test.js`, `tests/unit/v1beta-gemini-inline-data.test.js` and `tests/unit/v1beta-gemini-gateway-conformance-1089.test.js` must stay green.

The repaired branch must not change tool-call identity, the client format of any other lane, error handling (the coherence gate and the empty-content 502 stay where they are), credential handling, or route scope. Because the change lives in the shared projection helper, it also needs the doc update the contributor contract requires for a behavior change (the earlier #5386 port recorded its note in `internal/docs/translators.mdx`; the projection change belongs with the non-streaming/translator response references or in a port note beside this report).

## Divergences recorded but not repaired here

- **The v1beta bridge keeps its own request converter** instead of reusing `geminiToOpenAIRequest` as upstream's final #5386 route does. This is deliberate and richer in this fork: deterministic per-call ids with name-queue pairing for id-less `functionResponse`, uppercase Gemini schema normalization, `toolConfig` handling, and inline images. It is a fork-native implementation of the same contract, not a missing behavior.
- **Gemini `thought` parts are flattened into assistant text by the v1beta bridge** (`geminiBridge.js:142-145`), while the fork's own Gemini translator maps `thought: true` to `reasoning_content` (`open-sse/translator/request/gemini-to-openai.js:146-150`) and upstream's final #5386 route inherits that mapping through the translator. Verified offline: the bridge turns a replayed thought part into `content: "thinking...\nanswer"`, the translator into `content: "answer", reasoning_content: "thinking..."`. The bridge can itself emit `thought: true` parts (`geminiBridge.js:377-379`), so a Gemini-native client that replays a thinking turn gets that text back as assistant-visible content. This is a fidelity gap, not a protocol break, and it is a candidate follow-up with its own acceptance test rather than part of this reconciliation.
- **The v1beta bridge does not emit the tool-call `id` on `functionCall` parts** (`geminiBridge.js:237`, `:384-396`), while upstream's final patch copies the OpenAI tool-call id into the part. The bridge accepts an `id` on input (`geminiBridge.js:120`, `:160`) and pairs id-less responses by name and turn order, so parallel same-name calls still pair correctly; the id is lost only for clients that want to echo it verbatim. Recorded as a deliberate divergence, not repaired here.
- **`keepAliveGeminiSSE` is not ported.** Upstream's keep-alive pings and 240 s idle → 504 guard are new upstream scope rather than a repair of an existing fork contract: they change stream timing, add a client-visible ping chunk and add an error envelope on the Gemini-native lane. Any adoption needs its own decision on interval, idle budget, the 504 error shape and the interaction with the fork's existing stream watchdog and TTFT/stall deadlines. Deferred, not silently ignored.

## Unresolved evidence and limits

- Both upstream PRs are open and their heads can move; the SHAs above are the pinned evidence, recheck before any future implementation.
- The comparison is static plus an offline harness. No provider traffic, no credentials, no paid API, no e2e, no browser and no Docker were used, so reachability of the Ollama lane is established from routing code and request-translation probes rather than a live call.
- The harness that produced the projection matrix and the v1beta probes ran outside the repository (a scratch Vitest project with the fork's aliases); it added no repository file, and the repository tree was clean before and after.
- The upstream keep-alive behavior cannot be evaluated from the diff alone: its 100 s proxy-timeout premise is deployment-specific, and the fork's own stream watchdog already bounds TTFT and stalls, so the interaction is unverified here.
- The `thought`-part fidelity gap in the v1beta bridge was observed, but the client-visible severity depends on whether a Gemini-native client replays thought parts, which was not measured against a real Gemini CLI.

## Verification performed

- Read both final upstream diffs and the upstream base copies of every touched file at `1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d`.
- Read the fork's current projection and v1beta sources and the two local port commits.
- Ran the established local assertions for both records: `tests/unit/nonstream-client-projection-5380.test.js`, `tests/unit/v1beta-gemini-tool-calling.test.js`, `tests/unit/gemini-parameters-json-schema.test.js`, `tests/unit/v1beta-gemini-inline-data.test.js`, `tests/unit/v1beta-gemini-gateway-conformance-1089.test.js` — 5 files, 23 tests, all passing offline on this head.
- Ran an offline harness (outside the repository) that classified the client-visible body shape for every client/transport pair on the ordinary JSON route, exercised the v1beta bridge with upstream's own fragmented-stream cut points, and compared the bridge's request conversion with the fork's Gemini translator.

This report is documentation-only: no product code, test, `AGENTS.md`, workflow, baseline or credential was changed. The remaining repair is specified, not implemented, and lands only with its own acceptance test.
