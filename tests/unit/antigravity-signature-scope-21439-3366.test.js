import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

// #2034: OmniRoute PR 21439 (head 35e01594ad13a7ffc0cd44d6598f6d862dfcff9f) and
// 9router PR 3366 (head 829f2a88ea2069d2455ef0004bf29e70e793b3c8), both MIT.
// Real handleChatCore, real translators and the real AntigravityExecutor; only the
// outbound HTTP transport is mocked. Synthetic credentials, no provider account.
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), agy: null, queue: [] }));

vi.mock("../../open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: mocks.fetch,
}));
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: (options) => mocks.agy.execute(options) }),
}));
vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
  isCodexOriginatedHeaders: vi.fn(() => false),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn(),
  }),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}), saveUsageStats: vi.fn(async () => {}),
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");
const store = await import("../../open-sse/services/thoughtSignatureStore.js");
const { decodeToolCallId } = await import("../../open-sse/translator/concerns/signatureTransport.js");
const { isGeminiTrailingModelTurnRejectingModel } = await import("../../open-sse/translator/concerns/geminiTrailingModelTurn.js");

const GEMINI = "gemini-4-argon";
const SIG_A = "Rsynthetic-signature-A";
const SIG_B = "Rsynthetic-signature-B";
let seq = 0;
const uid = (name) => `${name}-${Date.now()}-${seq++}`;
const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const usage = { promptTokenCount: 5, candidatesTokenCount: 7, totalTokenCount: 12 };
const envelope = (parts, finishReason = "STOP") => ({
  response: { responseId: "r1", candidates: [{ content: { role: "model", parts }, finishReason }], usageMetadata: usage },
});
const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const sse = (body) => new Response(`data: ${JSON.stringify(body)}\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } });
const call = (name, id, args = {}) => ({ functionCall: { name, id, args } });

// countTokens is the executor's context preflight; only generation calls are scripted.
const isGeneration = (url) => !String(url).includes(":countTokens");
const generation = () => mocks.fetch.mock.calls.filter(([url]) => isGeneration(url));
const sent = () => generation().map(([, init]) => JSON.parse(init.body));
const upstream = (...responses) => mocks.queue.push(...responses);
const lastSent = () => sent().at(-1);
const sentCalls = (body = lastSent()) => body.request.contents.flatMap((c) => c.parts).filter((p) => p.functionCall);
const sentResponses = (body = lastSent()) => body.request.contents.flatMap((c) => c.parts).filter((p) => p.functionResponse);

const TOOLS = ["read", "list"].map((name) => ({
  type: "function",
  function: { name, parameters: { type: "object", properties: { p: { type: "string" } } } },
}));
const CLAUDE_TOOLS = ["read", "list"].map((name) => ({
  name, input_schema: { type: "object", properties: { p: { type: "string" } } },
}));

function run({ body, format = "openai", account = "acct-A", model = GEMINI, signal = null, forceStream = false }) {
  const credentials = { accessToken: "synthetic-token", projectId: "synthetic-project", ...(account && { connectionId: account }) };
  return handleChatCore({
    body,
    modelInfo: { provider: "antigravity", model },
    credentials,
    connectionId: account || undefined,
    sourceFormatOverride: format,
    abortSignal: signal,
    ...(forceStream && { executorOverride: { noAuth: true, forceStream: true, execute: (options) => mocks.agy.execute(options) } }),
    clientRawRequest: { endpoint: format === "claude" ? "/v1/messages" : "/v1/chat/completions", headers: {} },
    log,
  });
}

const openaiTurn1 = (stream = false) => ({
  model: GEMINI, stream, max_tokens: 256, tools: TOOLS, messages: [{ role: "user", content: "inspect" }],
});
// A client that keeps only the raw upstream ids (no transport-encoded signature).
const openaiTurn2 = (calls, { model = GEMINI } = {}) => ({
  model, stream: false, max_tokens: 256, tools: TOOLS,
  messages: [
    { role: "user", content: "inspect" },
    { role: "assistant", content: null, tool_calls: calls.map(({ id, name }) => ({ id, type: "function", function: { name, arguments: "{}" } })) },
    ...calls.map(({ id, name }) => ({ role: "tool", tool_call_id: id, content: `${name}-ok` })),
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  store.clearThoughtSignatureMemory();
  mocks.agy = new AntigravityExecutor();
  mocks.queue.length = 0;
  mocks.fetch.mockImplementation(async (url) => {
    if (!isGeneration(url)) return json({ totalTokens: 5 });
    const next = mocks.queue.shift();
    if (!next) throw new Error(`unscripted upstream call ${url}`);
    return next;
  });
  delete process.env.ANTIGRAVITY_ALLOW_SIGNATURE_BYPASS;
});
afterEach(() => {
  delete process.env.ANTIGRAVITY_ALLOW_SIGNATURE_BYPASS;
});

describe("OmniRoute 21439: nonstream signature capture is account and family scoped", () => {
  it("persists only the signed call, clears pending before the unsigned sibling and replays it next turn", async () => {
    const [a, b] = [uid("call-a"), uid("call-b")];
    upstream(json(envelope([
      { thought: true, text: "plan", thoughtSignature: SIG_A },
      call("read", a, { p: "x" }),
      call("list", b),
    ])));
    const first = await run({ body: openaiTurn1() });
    expect(first.success).toBe(true);
    const out = await first.response.json();
    const ids = out.choices[0].message.tool_calls.map((tc) => decodeToolCallId(tc.id));
    expect(ids).toEqual([{ id: a, signature: SIG_A }, { id: b, signature: null }]);
    expect(out.choices[0].message.reasoning_content).toBe("plan");
    expect(out.usage).toMatchObject({ completion_tokens: 7 });

    expect(store.getAccountThoughtSignatureSync(a, "acct-A", GEMINI)).toBe(SIG_A);
    expect(store.getAccountThoughtSignatureSync(b, "acct-A", GEMINI)).toBeNull();
    // Never a shared bare-id row: the session API cannot read it without the account.
    expect(store.getGeminiThoughtSignatureSync(a, null, GEMINI)).toBeNull();
    expect(await store.getGeminiThoughtSignature(a, null, GEMINI)).toBeNull();

    upstream(json(envelope([{ text: "done" }])));
    const second = await run({ body: openaiTurn2([{ id: a, name: "read" }, { id: b, name: "list" }]) });
    expect(second.success).toBe(true);
    const calls = sentCalls();
    expect(calls.map((p) => [p.functionCall.id, p.functionCall.name])).toEqual([[a, "read"], [b, "list"]]);
    expect(calls[0].thoughtSignature).toBe(SIG_A);
    expect(calls[1].thoughtSignature).not.toBe(SIG_A);
    expect(sentResponses().map((p) => [p.functionResponse.id, p.functionResponse.name])).toEqual([[a, "read"], [b, "list"]]);
    expect(JSON.stringify(lastSent())).not.toContain("skip_thought_signature_validator");
  });

  it("binds split signatures to their own calls, including snake_case", async () => {
    const [a, b] = [uid("split-a"), uid("split-b")];
    upstream(json(envelope([
      { thoughtSignature: SIG_A }, call("read", a), { thought_signature: SIG_B }, call("list", b),
    ])));
    expect((await run({ body: openaiTurn1() })).success).toBe(true);
    expect(store.getAccountThoughtSignatureSync(a, "acct-A", GEMINI)).toBe(SIG_A);
    expect(store.getAccountThoughtSignatureSync(b, "acct-A", GEMINI)).toBe(SIG_B);
  });

  it("does not write a terminal signature, a nameless call or an error body", async () => {
    const a = uid("terminal");
    upstream(json(envelope([call("read", a), { text: "after", thoughtSignature: SIG_A }])));
    expect((await run({ body: openaiTurn1() })).success).toBe(true);
    expect(store.getAccountThoughtSignatureSync(a, "acct-A", GEMINI)).toBeNull();

    const before = store.getThoughtSignatureMemorySize();
    upstream(new Response(JSON.stringify({ error: { code: 400, message: "bad", status: "INVALID_ARGUMENT" } }), {
      status: 400, headers: { "content-type": "application/json" },
    }));
    const failed = await run({ body: openaiTurn1() });
    expect(failed.success).toBe(false);
    expect(store.getThoughtSignatureMemorySize()).toBe(before);
  });

  it("isolates accounts, model families and an unknown account", async () => {
    const a = uid("iso");
    upstream(json(envelope([{ thoughtSignature: SIG_A }, call("read", a)])));
    await run({ body: openaiTurn1() });
    expect(store.getAccountThoughtSignatureSync(a, "acct-A", GEMINI)).toBe(SIG_A);
    expect(store.getAccountThoughtSignatureSync(a, "acct-B", GEMINI)).toBeNull();
    expect(store.getAccountThoughtSignatureSync(a, "acct-A", "claude-sonnet-4-6")).toBeNull();

    // Next turn routed to another account: no cross-account replay.
    upstream(json(envelope([{ text: "ok" }])));
    await run({ body: openaiTurn2([{ id: a, name: "read" }]), account: "acct-B" });
    expect(sentCalls()[0].thoughtSignature).not.toBe(SIG_A);

    // Same account, other model family: no cross-family replay.
    upstream(json(envelope([{ text: "ok" }])));
    await run({ body: openaiTurn2([{ id: a, name: "read" }], { model: "claude-sonnet-4-6" }), model: "claude-sonnet-4-6" });
    expect(JSON.stringify(lastSent())).not.toContain(SIG_A);

    // Unknown account writes nothing.
    const u = uid("unknown");
    const before = store.getThoughtSignatureMemorySize();
    upstream(json(envelope([{ thoughtSignature: SIG_B }, call("read", u)])));
    expect((await run({ body: openaiTurn1(), account: null })).success).toBe(true);
    expect(store.getThoughtSignatureMemorySize()).toBe(before);
    expect(store.getGeminiThoughtSignatureSync(u, null, GEMINI)).toBeNull();
    expect(store.storeAccountThoughtSignature(u, SIG_B, "unknown", GEMINI)).toBe(false);
  });

  it("restores the account signature from persistence after the RAM cache is cleared", async () => {
    const a = uid("cold");
    upstream(json(envelope([{ thoughtSignature: SIG_A }, call("read", a)])));
    await run({ body: openaiTurn1() });
    await new Promise((resolve) => setTimeout(resolve, 0));
    store.clearThoughtSignatureMemory();
    upstream(json(envelope([{ text: "ok" }])));
    await run({ body: openaiTurn2([{ id: a, name: "read" }]) });
    expect(sentCalls()[0].thoughtSignature).toBe(SIG_A);
  });

  it("round-trips through the Anthropic Messages endpoint", async () => {
    const a = uid("claude-ep");
    upstream(json(envelope([{ thoughtSignature: SIG_A }, call("read", a, { p: "x" })])));
    const first = await run({
      format: "claude",
      body: { model: GEMINI, max_tokens: 256, stream: false, tools: CLAUDE_TOOLS, messages: [{ role: "user", content: "inspect" }] },
    });
    const message = await first.response.json();
    const toolUse = message.content.find((block) => block.type === "tool_use");
    expect(toolUse.name).toBe("read");
    expect(message.usage).toMatchObject({ input_tokens: 5 });
    expect(store.getAccountThoughtSignatureSync(a, "acct-A", GEMINI)).toBe(SIG_A);

    upstream(json(envelope([{ text: "done" }])));
    await run({
      format: "claude",
      body: {
        model: GEMINI, max_tokens: 256, stream: false, tools: CLAUDE_TOOLS,
        messages: [
          { role: "user", content: "inspect" },
          { role: "assistant", content: [{ type: "tool_use", id: a, name: "read", input: { p: "x" } }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: a, content: "read-ok" }] },
        ],
      },
    });
    expect(sentCalls()[0].thoughtSignature).toBe(SIG_A);
    expect(sentResponses().map((p) => p.functionResponse.name)).toEqual(["read"]);
  });

  const claudeTurn1 = (stream) => ({ model: GEMINI, max_tokens: 256, stream, tools: CLAUDE_TOOLS, messages: [{ role: "user", content: "inspect" }] });
  const claudeTurn2 = (id) => ({
    model: GEMINI, max_tokens: 256, stream: false, tools: CLAUDE_TOOLS,
    messages: [
      { role: "user", content: "inspect" },
      { role: "assistant", content: [{ type: "tool_use", id, name: "read", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "read-ok" }] },
    ],
  });
  const endpoints = [
    ["OpenAI", "openai", openaiTurn1, (id) => openaiTurn2([{ id, name: "read" }])],
    ["Anthropic", "claude", claudeTurn1, claudeTurn2],
  ];

  it.each(endpoints)("forced SSE to JSON (%s) scopes the write to the account, never a bare row", async (_label, format, turn1, turn2) => {
    const [a, b] = [uid("forced-a"), uid("forced-b")];
    upstream(sse(envelope([{ thoughtSignature: SIG_A }, call("read", a), call("list", b)])));
    const result = await run({ body: turn1(false), format, forceStream: true });
    expect(result.success).toBe(true);
    const out = await result.response.json();
    const names = format === "claude" ?
      out.content.filter((block) => block.type === "tool_use").map((block) => block.name) :
      out.choices[0].message.tool_calls.map((tc) => tc.function.name);
    expect(names).toEqual(["read", "list"]);
    expect(store.getAccountThoughtSignatureSync(a, "acct-A", GEMINI)).toBe(SIG_A);
    expect(store.getAccountThoughtSignatureSync(b, "acct-A", GEMINI)).toBeNull();
    expect(store.getGeminiThoughtSignatureSync(a, null, GEMINI)).toBeNull();

    upstream(json(envelope([{ text: "ok" }])));
    await run({ body: turn2(a), format });
    expect(sentCalls()[0].thoughtSignature).toBe(SIG_A);
  });

  it("forced SSE to JSON with an unknown account writes nothing", async () => {
    const a = uid("forced-unknown");
    const before = store.getThoughtSignatureMemorySize();
    upstream(sse(envelope([{ thoughtSignature: SIG_A }, call("read", a)])));
    expect((await run({ body: openaiTurn1(false), account: null, forceStream: true })).success).toBe(true);
    expect(store.getThoughtSignatureMemorySize()).toBe(before);
  });

  it.each(endpoints)("streaming (%s) keeps the existing session-scoped capture and replay", async (_label, format, turn1, turn2) => {
    const a = uid("stream");
    upstream(sse(envelope([{ thoughtSignature: SIG_A }, call("read", a)])));
    const result = await run({ body: turn1(true), format });
    expect(result.success).toBe(true);
    expect(await result.response.text()).toMatch(format === "claude" ? /"tool_use"/ : /"tool_calls"/);
    expect(store.getAccountThoughtSignatureSync(a, "acct-A", GEMINI)).toBeNull();
    upstream(json(envelope([{ text: "ok" }])));
    await run({ body: turn2(a), format });
    expect(sentCalls()[0].thoughtSignature).toBe(SIG_A);
  });

  it("writes nothing and does not dispatch when the client already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const before = store.getThoughtSignatureMemorySize();
    mocks.fetch.mockImplementation(async (_url, init) => {
      if (init?.signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      return json(envelope([{ thoughtSignature: SIG_A }, call("read", uid("abort"))]));
    });
    const result = await run({ body: openaiTurn1(), signal: controller.signal }).catch((error) => ({ error }));
    expect(result.success ?? false).toBe(false);
    expect(store.getThoughtSignatureMemorySize()).toBe(before);
  });
});

describe("signatureless Gemini 4 / 3.8 history keeps the fork's native default (no bypass sentinel)", () => {
  it.each(["gemini-4-argon", "gemini-3.8-flash-high"])("%s replays unsigned parallel calls natively with matching responses", async (model) => {
    process.env.ANTIGRAVITY_ALLOW_SIGNATURE_BYPASS = "1";
    const [a, b] = [uid("plain-a"), uid("plain-b")];
    upstream(json(envelope([{ text: "ok" }])));
    await run({ body: openaiTurn2([{ id: a, name: "read" }, { id: b, name: "list" }], { model }), model });
    const body = lastSent();
    expect(JSON.stringify(body)).not.toContain("skip_thought_signature_validator");
    expect(JSON.stringify(body)).not.toContain("previous_tool_result_context");
    expect(sentCalls(body).map((p) => p.functionCall.id)).toEqual([a, b]);
    expect(sentResponses(body).map((p) => p.functionResponse.id)).toEqual([a, b]);
    expect(body.request.contents.at(-1).role).toBe("user");
  });
});

describe("trailing model turns (21439 helper extended to Antigravity native passthrough)", () => {
  const native = (model, contents) => ({ userAgent: "antigravity", model, project: "synthetic-project", request: { contents } });

  it("matches Gemini 3/4 and pro-agent, with or without a prefix, but not image or older models", () => {
    for (const model of ["gemini-4-argon", "antigravity/gemini-4-carbon-high", "gemini-3.8-flash-high", "gemini-3-flash", "gemini-pro-agent"]) {
      expect(isGeminiTrailingModelTurnRejectingModel(model)).toBe(true);
    }
    for (const model of ["gemini-3.1-flash-image", "gemini-2.5-pro", "claude-sonnet-4-6", null]) {
      expect(isGeminiTrailingModelTurnRejectingModel(model)).toBe(false);
    }
  });

  it("drops a native trailing model turn for gemini-4 instead of fabricating a user turn", async () => {
    upstream(sse(envelope([{ text: "ok" }])));
    const result = await run({
      format: "antigravity", body: native(GEMINI, [
        { role: "user", parts: [{ text: "hi" }] },
        { role: "model", parts: [{ text: "prefill" }] },
      ]),
    });
    await result.response.text();
    expect(lastSent().request.contents).toEqual([{ role: "user", parts: [{ text: "hi" }] }]);
  });

  it("does not duplicate the translated path's terminal user turn", async () => {
    upstream(json(envelope([{ text: "ok" }])));
    await run({ body: { model: GEMINI, max_tokens: 256, messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "prefill" }] } });
    const contents = lastSent().request.contents;
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(contents.filter((c) => c.role === "user").length).toBe(2);
  });

  it("keeps the trailing model turn for an image model", () => {
    const body = mocks.agy.transformRequest("gemini-3.1-flash-image", native("gemini-3.1-flash-image", [
      { role: "user", parts: [{ text: "draw" }] },
      { role: "model", parts: [{ text: "partial" }] },
    ]), false, { accessToken: "synthetic-token", projectId: "synthetic-project" });
    expect(body.request.contents.at(-1).role).toBe("model");
  });
});

describe("9router 3366: only turns emptied by thought filtering are dropped", () => {
  const native = (contents) => ({ userAgent: "antigravity", model: GEMINI, project: "synthetic-project", request: { contents } });

  it("drops thought-only turns, merges the neighbours and keeps user text and tool turns", async () => {
    const a = uid("tool");
    upstream(sse(envelope([{ text: "ok" }])));
    const result = await run({
      format: "antigravity", body: native([
        { role: "user", parts: [{ text: "first" }] },
        { role: "model", parts: [{ thought: true, text: "only thinking" }, { thoughtSignature: SIG_B }] },
        { role: "user", parts: [{ text: "second" }] },
        { role: "model", parts: [{ functionCall: { id: a, name: "read", args: {} }, thoughtSignature: SIG_A }] },
        { role: "user", parts: [{ functionResponse: { id: a, name: "read", response: { result: "ok" } } }] },
      ]),
    });
    await result.response.text();
    const contents = lastSent().request.contents;
    expect(contents.every((c) => c.parts.length > 0)).toBe(true);
    expect(contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(contents[0].parts.map((p) => p.text)).toEqual(["first", "second"]);
    expect(contents[1].parts[0]).toMatchObject({ functionCall: { id: a, name: "read" }, thoughtSignature: SIG_A });
    expect(contents[2].parts[0].functionResponse).toMatchObject({ id: a, name: "read" });
  });

  it("refuses a wholly thought-only history before any network call", async () => {
    const result = await run({
      format: "antigravity", body: native([{ role: "model", parts: [{ thought: true, text: "x" }] }]),
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(generation()).toHaveLength(0);
  });
});
