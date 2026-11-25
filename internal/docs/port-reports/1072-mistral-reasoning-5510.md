# #1072: Mistral request and response reasoning contracts (upstream #5510)

Compared 2026-11-21 against DurinDoor base `530139f257e33037f40326da032b4cf25b4b88aa` (branch `orq/tornf6/audit9r-mistral-reasoning-5510-a1`).

## Pinned source

[9router PR 5510](https://github.com/decolua/9router/pull/5510), head `78e917a476ccf4b165620b3e17122493f6677a22`, open and unmerged at review, `mergeable_state: clean`, one commit, eight files, +111 / −11, base `decolua/9router` `master` at `1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d`. The upstream head SHA is `78e917a476ccf4b165620b3e17122493f6677a22`; the patch was read as the final source diff of that commit and compared against runtime behavior, not as a path list. The PR title is "fix(mistral): normalize reasoning requests and responses". Upstream's own PR body reports live Mistral DeepSeek v4.1 Flash gateway runs; none of that is reproduced here, and no provider traffic was issued during this reconciliation.

## Verdict

**Already in. No Mistral residual remains, and no port is required.** All eight upstream paths are present in the fork with equivalent runtime behavior, but they were arrived at through different local commits and in a different file layout. The upstream patch was already ported here as `b4d0dadd2d` "port(upstream): #5510 - normalize Mistral reasoning" and `66a106ba74` "fix(stream): serialize normalized Mistral content" (both `Refs #1072`), on top of the earlier Mistral lanes `678479981c` (typed content-part arrays), `7c2b1fe3e1` (#4220) and `c23f5db5b8` (#4143).

The remaining differences are deliberate fork adaptations or different-provider effects of upstream's blanket change. They are recorded below; none of them is a Mistral request or response contract gap, and none was ported.

## Path-by-path reconciliation

| Upstream path (head `78e917a476ccf4b165620b3e17122493f6677a22`) | Local counterpart | Disposition and evidence |
| --- | --- | --- |
| `open-sse/executors/default.js` | `open-sse/executors/default.js:513-516` | Equivalent for Mistral. Upstream moves `stripUnsupportedParams` to run after `injectReasoningContent` for every provider. The fork keeps the pre-injection strip at line 466 and adds a Mistral-scoped post-injection strip at line 515, so a Mistral body is stripped → injected → stripped. Verified: the assistant turn keeps no `reasoning_content` and the body keeps no `thinking` object (see request evidence below). |
| `open-sse/handlers/chatCore/nonStreamingHandler.js` | `open-sse/handlers/chatCore/nonStreamingHandler.js:554` and `:614` | Equivalent. Upstream threads `provider` into `parseSSEToOpenAIResponse` and normalizes `choice.message` on the raw provider body. The fork passes `provider` through the options object at line 554 and normalizes `choice.message` at line 614, before the coherence check and before any client projection. Upstream's third argument is positional; the fork's is the options bag `{ format, providerBody, provider }`. |
| `open-sse/handlers/chatCore/sseToJsonHandler.js` | `open-sse/handlers/chatCore/sseToJsonHandler.js:233` and `:247` | Equivalent. `parseSSEToOpenAIResponse` accepts `provider` and normalizes `choice.delta` while accumulating chunks; `handleForcedSSEToJson` (line 559) passes it. Both call sites in the fork were updated; no third call site exists. |
| `open-sse/providers/registry/mistral.js` | `open-sse/providers/registry/mistral.js:23` | Present. `transport.thinkingFormat: "openai"` is already declared, added locally by `c23f5db5b8` (upstream #4143). `open-sse/providers/index.js:16-22` copies it onto `PROVIDERS.mistral`, and `open-sse/translator/concerns/thinkingUnified.js:145` reads it, so a DeepSeek-named model routed to Mistral resolves to the OpenAI reasoning shape rather than a vendor-native one. |
| `open-sse/translator/concerns/reasoning.js` | `open-sse/utils/arrayContentDelta.js:72-77` (normalizer) and `open-sse/translator/concerns/reasoning.js:27-28` (reasoning extraction) | Equivalent, relocated. Upstream adds `normalizeMistralContent` to the reasoning concern; the fork keeps that concern for extraction (its `extractReasoningText` already has a Mistral array branch) and puts the normalizer next to the shared typed-content-array lane it was folded into. See "Adaptations" for the two semantic differences. |
| `open-sse/utils/stream.js` | `open-sse/utils/stream.js:564`, `:970-972`, `:1226`, `:1529` | Equivalent, and wider. Upstream gates normalization on `provider === "mistral"` at three sites (passthrough chunk, translate chunk, unterminated tail). The fork normalizes every OpenAI-shaped chunk through `normalizeArrayContentChunk` / `normalizeOpenAIPassthroughChunk`, which covers the same three paths and additionally covers any other upstream that emits typed content-part arrays. `66a106ba74` fixed the specific upstream gap of a normalized chunk that already had every standard field not being re-serialized (`fieldsInjected` equivalent at line 971). |
| `tests/__baseline__/providers-baseline.json` | `tests/__baseline__/providers-baseline.json:1438-1445` | No local change needed, and none was made. Upstream adds `"thinkingFormat": "openai"` to the Mistral entry. The fork's `tests/__baseline__/verify-providers.mjs` lists `thinkingFormat` in `ADDED_FIELDS` and drops it from both sides before comparing, so the field is deliberately outside the byte-baseline. Running the verifier reports no `mistral` line. It does report pre-existing `+ provider added` drift for other providers (`writer`, `xiaomi-mimo-token-plan`, `xkiro`, `y-api`, `zerolimitai`); that drift predates this reconciliation and is unrelated to Mistral. |
| `tests/unit/mistral-thinking.test.js` | `tests/unit/mistral-nonstream-5510.test.js`, `tests/unit/mistral-array-content-delta-15757.test.js`, `tests/unit/mistral-claude-stream.test.js` | Covered by three existing local files rather than one upstream file. The upstream file's eight assertions were replayed against the fork's APIs during this reconciliation and all eight pass; the source is in "Acceptance" below. |

## Verified existing local behavior

**Request configuration.** `new DefaultExecutor("mistral").transformRequest("deepseek-v4-1-flash-1017", …)` with `reasoning_effort: "high"`, a stray `thinking: { type: "enabled" }` and an assistant turn replaying `reasoning_content` produces the wire body:

```json
{"model":"deepseek-v4-1-flash-1017","messages":[{"role":"user","content":"hi"},{"role":"assistant","content":"answer"}],"reasoning_effort":"high","temperature":0.2}
```

The replayed assistant reasoning is gone (`open-sse/translator/concerns/paramSupport.js:103`), the native `thinking` object is gone (`paramSupport.js:124`), `reasoning_effort` survives, and unrelated sampling fields are untouched. A provider that *requires* the replayed field is unaffected: the same request for `opencode-go` keeps `reasoning_content: " "`, matching upstream's own expectation that only strict providers drop it.

**Chat (non-streaming) projection.** A Mistral JSON completion whose `message.content` is `[{ type: "thinking", thinking: [{ type: "text", text: "think" }] }, { type: "text", text: "answer" }]` is normalized before projection and returned to an OpenAI client as `{"role":"assistant","content":"answer","reasoning_content":"think"}`. Reasoning and text coexist: the fork replaced upstream's unconditional "strip `reasoning_content` when content is non-empty" rule with an opt-in model (`open-sse/utils/reasoningVisibility.js`, added by `8c5c8d76be`, upstream #2774), so the upstream patch's `provider !== "mistral"` exception is redundant here — the fork preserves reasoning for every provider by default and only strips it on an explicit `x-9router-reasoning: off` request header or a truthy `STRIP_REASONING_CONTENT`. This is the previously shipped reasoning-duplication fix and it subsumes the upstream guard.

**Streaming projection.** Both client dialects were exercised offline with a Mistral-shaped upstream stream.

- OpenAI passthrough: `data: {"…","choices":[{"index":0,"delta":{"content":"answer","reasoning_content":"think"},"finish_reason":null}]}` — a string `content` and a separate `reasoning_content`, satisfying the OpenAI chat-chunk contract.
- Claude Messages translation: `content_block_start`/`content_block_delta` with `{"type":"thinking_delta","thinking":"think"}` followed by `{"type":"text_delta","text":"answer"}` — thinking stays out of the visible text block.
- Forced-SSE → JSON accumulation (`parseSSEToOpenAIResponse`) yields `{"message":{"role":"assistant","content":"answer","reasoning_content":"think"},"finish_reason":"stop"}`, preserving tool calls and the finish reason alongside the folded content.
- An unterminated final frame (`data: {…}` with no trailing newline) is normalized on both the passthrough and the translate path, including the case where the chunk already carried every standard field.

**Reasoning-only replies.** A Mistral reply carrying a thinking part and no text part is not treated as an empty completion: the non-stream handler returns the completion with `reasoning_content` set rather than a 502, the OpenAI passthrough emits the reasoning-only chunk instead of dropping it, and the Claude projection emits a thinking block with no text block.

**Local regression evidence.** The Mistral, reasoning, param-support, streaming and SSE unit files (181 files, 1605 tests) pass on this tree. No provider call, browser, Docker or e2e run was performed.

## Adaptations and unresolved differences

1. **Normalizer location and mutation style.** Upstream's `normalizeMistralContent` returns a new object (`{ ...message, content: text || null }`); the fork's (`open-sse/utils/arrayContentDelta.js:72-77`) mutates in place and returns `undefined`, and it shares one implementation with the typed-content-array lane. Every upstream call site in the fork was rewritten for the mutating contract, and all eight upstream assertions pass against it. The fork additionally appends thinking text to an existing `reasoning_content` instead of replacing it.
2. **`content: null` versus an omitted key.** For a reasoning-only Mistral message, upstream emits `content: null`; the fork omits the `content` key. No client-visible defect was observed: the non-stream completion is returned with `reasoning_content` only, the OpenAI passthrough chunk carries `reasoning_content` only, and the Claude projection produces a thinking-only message. Adopting upstream's spelling would mean either changing the shared array-content normalizer used by every provider or adding a Mistral-only null-assignment, neither of which has evidenced demand. Left as is, and flagged here rather than changed.
3. **Unknown content parts.** Upstream's normalizer leaves the whole content array untouched when it contains a part type it does not recognize; the fork's shared array normalizer folds the recognized parts and drops the unrecognized ones. This is the pre-existing fork behavior from `678479981c` and is asserted by `tests/unit/mistral-claude-stream.test.js` ("ignores non-text content"). It is wider than upstream's rule, but it is not a regression against the fork's own contract and it applies to all providers, so it was not narrowed here.
4. **Upstream's blanket post-injection strip (different providers, not ported).** Upstream's final head runs `stripUnsupportedParams` after `injectReasoningContent` for *every* provider; the fork scopes the post-injection strip to Mistral and keeps the pre-injection strip for everyone else. The two orders produce the same Mistral wire body, so Mistral is unaffected. The difference is observable for Groq and Cerebras, which share Mistral's `dropMessageFields` rule: the fork still sends the injected `reasoning_content: " "` placeholder to them for a `/deepseek/i`-named model, while upstream's final head would remove it. Verified locally: `mistral` → no placeholder, `groq` / `cerebras` / `opencode-go` → `reasoning_content: " "`. This is a different-provider effect of an upstream change whose title and tests are Mistral-scoped; it was deliberately not ported here (no blanket upstream replacement), and no Groq or Cerebras acceptance evidence exists in this reconciliation. It belongs to the provider-residual record for #800/#1072, not to the Mistral contract.
5. **Not independently verifiable here.** The upstream PR body claims live Mistral DeepSeek v4.1 Flash gateway runs for Claude and OpenAI, streaming and non-streaming. Nothing in this reconciliation reproduces or refutes that claim: no provider traffic was issued, no credentials were used, and the fork's own Mistral model catalog (`mistral-large-latest`, `codestral-latest`, `mistral-medium-latest`, `mistral-embed`) does not include the DeepSeek-family models the upstream tests name. The upstream fixtures are treated as request/response shapes to reconcile, not as models to add.

## Acceptance

No code port is needed, so no product code, test, baseline, workflow or documentation change accompanies this report. The parity gate below is the upstream test file's eight assertions replayed against the fork's APIs — the precise offline acceptance test for this reconciliation. It was run against this tree and all eight assertions pass; it is offered to the integration owner as the durable regression pin and was not committed here.

```js
// tests/unit/mistral-5510-parity.test.js  (offline; no provider traffic)
import { describe, it, expect, vi } from "vitest";
import { createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { parseSSEToOpenAIResponse } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateNonStreamingResponse, handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { normalizeMistralContent } from "../../open-sse/utils/arrayContentDelta.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import "../translator/registerAll.js";

vi.mock("@/lib/usageDb.js", () => ({ appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveUsageStats: vi.fn(async () => {}) }));

const delta = { content: [{ type: "thinking", thinking: [{ type: "text", text: "think" }], closed: true }, { type: "text", text: "answer" }] };
const chunk = { id: "chatcmpl-12345678", object: "chat.completion.chunk", model: "deepseek", choices: [{ index: 0, delta, finish_reason: null }] };
const end = { ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
const sse = [chunk, end].map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
const render = async (transform, data = sse) => {
  const input = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(data)); c.close(); } });
  return new Response(input.pipeThrough(transform)).text();
};

describe("Mistral reasoning contracts (upstream #5510 parity)", () => {
  it("strips unsupported reasoning history only for strict providers", () => {
    const model = "deepseek-v4-1-flash-1017";
    const messages = [{ role: "assistant", content: "hello" }, { role: "assistant", content: "answer", reasoning_content: "prior thought" }];
    const mistral = new DefaultExecutor("mistral").transformRequest(model, { model, messages: structuredClone(messages) });
    expect(mistral.messages).toEqual([{ role: "assistant", content: "hello" }, { role: "assistant", content: "answer" }]);
    const go = new DefaultExecutor("opencode-go").transformRequest(model, { model, messages: [messages[0]] });
    expect(go.messages[0].reasoning_content).toBe(" ");
  });

  it("sends reasoning effort without DeepSeek's unsupported thinking field", () => {
    const body = { reasoning_effort: "high" };
    applyThinking(FORMATS.OPENAI, "deepseek-v4-1-flash-1017", body, "mistral");
    expect(body).toEqual({ reasoning_effort: "high" });
  });

  it("streams thinking and text to Claude", async () => {
    const out = await render(createSSETransformStreamWithLogger(FORMATS.OPENAI, FORMATS.CLAUDE, "mistral"));
    expect(out).toContain('"thinking":"think"');
    expect(out).toContain('"text":"answer"');
  });

  it("streams reasoning_content and text to OpenAI clients", async () => {
    const out = await render(createPassthroughStreamWithLogger("mistral", null, null, null, null, null, null, null, FORMATS.OPENAI));
    expect(out).toContain('"reasoning_content":"think"');
    expect(out).toContain('"content":"answer"');
  });

  it("normalizes a final SSE chunk without a newline", async () => {
    const tail = `data: ${JSON.stringify(chunk)}`;
    const openai = await render(createPassthroughStreamWithLogger("mistral", null, null, null, null, null, null, null, FORMATS.OPENAI), tail);
    const claude = await render(createSSETransformStreamWithLogger(FORMATS.OPENAI, FORMATS.CLAUDE, "mistral"), tail);
    expect(openai).toContain('"reasoning_content":"think"');
    expect(claude).toContain('"thinking":"think"');
    expect(claude).toContain('"text":"answer"');
  });

  it("aggregates forced SSE with reasoning and text", () => {
    const result = parseSSEToOpenAIResponse(sse, "deepseek", { provider: "mistral" });
    expect(result.choices[0].message).toMatchObject({ content: "answer", reasoning_content: "think" });
  });

  it("preserves reasoning alongside text in non-stream OpenAI responses", async () => {
    const providerResponse = new Response(JSON.stringify({ choices: [{ message: { role: "assistant", ...delta }, finish_reason: "stop" }] }), { headers: { "Content-Type": "application/json" } });
    const result = await handleNonStreamingResponse({ providerResponse, provider: "mistral", model: "deepseek", sourceFormat: FORMATS.OPENAI, targetFormat: FORMATS.OPENAI, body: {}, requestStartTime: Date.now(), reqLogger: { logProviderResponse() {}, logConvertedResponse() {} }, trackDone() {}, appendLog() {} });
    const out = await result.response.json();
    expect(out.choices[0].message).toMatchObject({ content: "answer", reasoning_content: "think" });
  });

  it("translates normalized non-stream messages to Claude", () => {
    const raw = { role: "assistant", ...delta };
    normalizeMistralContent(raw); // fork normalizes in place
    const result = translateNonStreamingResponse({ model: "deepseek", choices: [{ message: raw, finish_reason: "stop" }] }, FORMATS.OPENAI, FORMATS.CLAUDE);
    expect(result.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "thinking", thinking: "think" }),
      expect.objectContaining({ type: "text", text: "answer" })
    ]));
  });
});
```

Two adaptation notes for whoever pins this test locally: the fork's `createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider)` takes the *provider* wire format first, so a Mistral upstream serving a Claude client is `(FORMATS.OPENAI, FORMATS.CLAUDE, "mistral")`; and the fork's `parseSSEToOpenAIResponse` takes an options bag (`{ format, providerBody, provider }`) rather than upstream's positional third argument.

## Scope

No product code, tests, `AGENTS.md`, GitHub Actions, baseline entries, provider traffic, paid APIs, e2e, browser or Docker work was performed or changed. The only file written by this reconciliation is this report. The commit is local; nothing was pushed and no upstream PR or issue was modified.
