import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

// #2034: CLIProxyAPI dbe641f Gemini/Antigravity replay parity: 13e0642 reply grouping,
// 54ed2ba enum cleaning, 249ea68 Google RPC stream errors. 66f3ad1 is not ported (see report).
// Real translators, real public /v1beta route and real handleChatCore; only the upstream
// executor is faked. No live account is used.
const mocks = vi.hoisted(() => ({ execute: vi.fn(), handleChat: vi.fn() }));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: () => ({ noAuth: true, execute: mocks.execute }),
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
vi.mock("@/sse/handlers/chat.js", () => ({ handleChat: mocks.handleChat }));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { POST } = await import("../../src/app/api/v1beta/models/[...path]/route.js");
const { groupGeminiFunctionResponses, buildGeminiToolParameters } = await import("../../open-sse/translator/formats/gemini.js");
const { googleRpcErrorBody } = await import("../../open-sse/handlers/chatCore/antigravityGeminiNative.js");
const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");
const { translateRequest } = await import("../../open-sse/translator/index.js");
const { FORMATS } = await import("../../open-sse/translator/formats.js");

const SECRET = "ya29.private-fixture-token-2034";
let target;

const withId = (body, id) => (id ? Object.assign(body, { id }) : body);
const call = (name, id) => ({ functionCall: withId({ name, args: { q: name } }, id) });
const reply = (name, id) => ({ functionResponse: withId({ name, response: { result: `${name}-ok` } }, id) });
const responseNames = (content) => content.parts.map((part) => (part.functionResponse ?? part.function_response).name);

const post = (path, payload, query = "") =>
  POST(new Request(`https://router.test/v1beta/models/${path.join("/")}${query}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }), { params: Promise.resolve({ path }) });

const sse = (...frames) => new Response(frames.map((f) => (typeof f === "string" ? f : `data: ${JSON.stringify(f)}\n\n`)).join(""), {
  headers: { "content-type": "text/event-stream" },
});
const reply200 = (response, body) => ({ response, transformedBody: body, url: "https://upstream.test", headers: {} });
const outbound = () => mocks.execute.mock.calls.at(-1)[0].body;

beforeEach(() => {
  vi.clearAllMocks();
  target = { provider: "gemini", model: "gemini-2.5-pro", credentials: { apiKey: "k" } };
  mocks.handleChat.mockImplementation(async (request, raw) => {
    const body = await request.json();
    const result = await handleChatCore({
      body,
      modelInfo: { provider: target.provider, model: target.model },
      credentials: target.credentials,
      clientRawRequest: raw,
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    return result.response;
  });
});

describe("groupGeminiFunctionResponses (CPA 13e0642)", () => {
  const model = (...parts) => ({ role: "model", parts });

  it("groups split replies, including a function-role turn, in functionCall order", () => {
    const contents = [
      { role: "user", parts: [{ text: "go" }] },
      model(call("a", "id-a"), call("b", "id-b")),
      { role: "user", parts: [reply("b", "id-b")] },
      { role: "function", parts: [reply("a", "id-a")] },
    ];
    const out = groupGeminiFunctionResponses(contents);
    expect(out).toHaveLength(3);
    expect(out[2].role).toBe("user");
    expect(responseNames(out[2])).toEqual(["a", "b"]);
  });

  it("handles snake_case function_call/function_response parts", () => {
    const contents = [
      { role: "model", parts: [{ function_call: { name: "a", args: {} } }, { function_call: { name: "b", args: {} } }] },
      { role: "user", parts: [{ function_response: { name: "b", response: {} } }] },
      { role: "user", parts: [{ function_response: { name: "a", response: {} } }] },
    ];
    const out = groupGeminiFunctionResponses(contents);
    expect(out).toHaveLength(2);
    expect(out[1].parts.every((part) => part.function_response)).toBe(true);
    expect(responseNames(out[1])).toEqual(["a", "b"]);
  });

  it("prefers exact id+name when parallel calls share a placeholder id", () => {
    const contents = [model(call("a", "x"), call("b", "x")), { role: "user", parts: [reply("b", "x"), reply("a", "x")] }];
    expect(responseNames(groupGeminiFunctionResponses(contents)[1])).toEqual(["a", "b"]);
  });

  it("moves interleaved non-response turns after the grouped replies", () => {
    const contents = [
      model(call("a"), call("b")),
      { role: "user", parts: [reply("a")] },
      { role: "user", parts: [{ text: "note" }] },
      { role: "user", parts: [{ text: "mixed" }, reply("b")] },
    ];
    const out = groupGeminiFunctionResponses(contents);
    expect(out[0]).toBe(contents[0]);
    expect(out.slice(1).map((c) => [c.role, c.parts.map((p) => p.text ?? p.functionResponse.name)])).toEqual([
      ["user", ["a", "b"]],
      ["user", ["note"]],
      ["user", ["mixed"]],
    ]);
  });

  it("keeps incomplete histories, invalid boundaries and an unanswered earlier call untouched", () => {
    const incomplete = [model(call("a"), call("b")), { role: "user", parts: [reply("a")] }];
    const boundary = [
      model(call("a"), call("b")),
      { role: "user", parts: [reply("b")] },
      { role: "user", parts: [call("c")] },
      { role: "user", parts: [reply("a")] },
    ];
    const empty = [model(call("a"), call("b")), { role: "user", parts: [] }, { role: "user", parts: [reply("b")] }, { role: "user", parts: [reply("a")] }];
    const unanswered = [
      { role: "user", parts: [{ text: "one" }] },
      model(call("w")),
      { role: "user", parts: [{ text: "again" }] },
      model(call("w")),
      { role: "user", parts: [reply("w")] },
    ];
    for (const contents of [incomplete, boundary, empty, unanswered]) {
      expect(groupGeminiFunctionResponses(contents)).toBe(contents);
    }
  });

  it("keeps excess and unmatched replies after the matched ones", () => {
    const contents = [model(call("a", "1")), { role: "user", parts: [reply("z", "9")] }, { role: "user", parts: [reply("a", "1")] }];
    expect(responseNames(groupGeminiFunctionResponses(contents)[1])).toEqual(["a", "z"]);
  });

  it("runs in the Antigravity executor before tool names are sanitized", () => {
    const executor = new AntigravityExecutor();
    const transformed = executor.transformRequest("gemini-3-flash", {
      request: {
        contents: [
          { role: "user", parts: [{ text: "go" }] },
          model(call("ns.a", "id-a"), call("ns.b", "id-b")),
          { role: "user", parts: [reply("ns.b", "id-b")] },
          { role: "user", parts: [reply("ns.a", "id-a")] },
        ],
        tools: [{ functionDeclarations: [{ name: "ns.a", parameters: { type: "object" } }, { name: "ns.b", parameters: { type: "object" } }] }],
      },
    }, false, { projectId: "p" });
    const contents = transformed.request.contents;
    const calls = contents[1].parts.filter((p) => p.functionCall).map((p) => [p.functionCall.id, p.functionCall.name]);
    const replies = contents[2].parts.map((p) => [p.functionResponse.id, p.functionResponse.name]);
    expect(contents).toHaveLength(3);
    expect(replies).toEqual(calls);
    expect(contents[1].parts.find((p) => p.functionCall).thoughtSignature).toBeTruthy();
  });
});

describe("/v1beta split replies through the real translator", () => {
  const history = [
    { role: "user", parts: [{ text: "go" }] },
    { role: "model", parts: [call("a", "id-a"), call("b", "id-b")] },
    { role: "user", parts: [reply("b", "id-b")] },
    { role: "user", parts: [{ text: "side note" }] },
    { role: "user", parts: [{ function_response: { id: "id-a", name: "a", response: { result: "a-ok" } } }] },
  ];
  const declarations = [{ functionDeclarations: [{ name: "a", parameters: { type: "object" } }, { name: "b", parameters: { type: "object" } }] }];
  const geminiReply = () => new Response(JSON.stringify({
    candidates: [{ content: { role: "model", parts: [{ text: "done" }] }, finishReason: "STOP", index: 0 }],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
  }), { headers: { "content-type": "application/json" } });

  it("sends a Gemini upstream one reply turn in call order with ids kept", async () => {
    mocks.execute.mockImplementation(async ({ body }) => reply200(geminiReply(), body));
    const res = await post(["gemini-2.5-pro:generateContent"], { contents: history, tools: declarations });
    expect(res.status, await res.clone().text()).toBe(200);
    const contents = outbound().contents;
    const modelIndex = contents.findIndex((c) => c.role === "model");
    const callIds = contents[modelIndex].parts.filter((p) => p.functionCall).map((p) => p.functionCall.id);
    const replyTurn = contents[modelIndex + 1];
    expect(replyTurn.parts.map((p) => p.functionResponse?.id)).toEqual(callIds);
    expect(replyTurn.parts.map((p) => p.functionResponse.name)).toEqual(["a", "b"]);
    expect(contents.slice(modelIndex + 2).some((c) => c.parts.some((p) => p.text === "side note"))).toBe(true);
  });

  it("sends an OpenAI upstream adjacent tool results in call order", async () => {
    target = { provider: "openai", model: "gpt-test", credentials: { apiKey: "k" } };
    mocks.execute.mockImplementation(async ({ body }) => reply200(new Response(JSON.stringify({
      id: "c", object: "chat.completion", model: "gpt-test",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "done" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { headers: { "content-type": "application/json" } }), body));
    const res = await post(["gpt-test:generateContent"], { contents: history, tools: declarations });
    expect(res.status).toBe(200);
    const messages = outbound().messages;
    const assistant = messages.findIndex((m) => m.tool_calls);
    expect(messages.slice(assistant + 1, assistant + 3).map((m) => [m.role, m.tool_call_id])).toEqual([["tool", "id-a"], ["tool", "id-b"]]);
    expect(messages[assistant + 3]).toMatchObject({ role: "user", content: "side note" });
  });

  it("pairs nameless idless replies with the pending calls by position", async () => {
    target = { provider: "openai", model: "gpt-test", credentials: { apiKey: "k" } };
    mocks.execute.mockImplementation(async ({ body }) => reply200(new Response(JSON.stringify({
      id: "c", object: "chat.completion", model: "gpt-test",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "done" } }],
    }), { headers: { "content-type": "application/json" } }), body));
    await post(["gpt-test:generateContent"], {
      contents: [
        { role: "user", parts: [{ text: "go" }] },
        { role: "model", parts: [call("a"), call("b")] },
        { role: "user", parts: [{ functionResponse: { response: { result: 1 } } }, { function_response: { name: "", response: { result: 2 } } }] },
      ],
      tools: declarations,
    });
    const messages = outbound().messages;
    const callIds = messages.find((m) => m.tool_calls).tool_calls.map((c) => c.id);
    expect(new Set(callIds).size).toBe(2);
    expect(messages.filter((m) => m.role === "tool").map((m) => m.tool_call_id)).toEqual(callIds);
  });
});

describe("Gemini-only enum cleaning (CPA 54ed2ba)", () => {
  it("drops empty, whitespace-only and null enum members and keeps valid ones verbatim", () => {
    const params = buildGeminiToolParameters({
      type: "object",
      properties: {
        mode: { type: "string", enum: ["", "  ", null, "fast", " slow "] },
        blank: { type: "string", enum: ["", " \t"] },
        level: { type: "integer", enum: [1, 2], minimum: 1 },
        enum: { type: "string", description: "a property literally named enum" },
      },
    }, "t");
    expect(params.properties.mode.enum).toEqual(["fast", " slow "]);
    expect(params.properties.blank.enum).toBeUndefined();
    expect(params.properties.blank.type).toBe("string");
    expect(params.properties.level.enum).toBeUndefined();
    expect(params.properties.level.description).toContain("Allowed values: 1, 2.");
    expect(params.properties.enum).toMatchObject({ type: "string", description: "a property literally named enum" });
  });

  it("applies the same cleaning on the direct Claude -> Gemini translator", () => {
    const out = translateRequest(FORMATS.CLAUDE, FORMATS.GEMINI, "gemini-2.5-pro", {
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      tools: [{ name: "pick", input_schema: { type: "object", properties: { c: { type: "string", enum: [" ", "red", null] }, d: { type: "string", format: "date" } } } }],
    }, false, { apiKey: "k" }, "gemini");
    const props = out.tools[0].functionDeclarations[0].parameters.properties;
    expect(props.c.enum).toEqual(["red"]);
    expect(props.d).toEqual({ type: "string", format: "date" });
  });
});

describe("Google RPC post-commit errors (CPA 249ea68)", () => {
  const thought = { response: { candidates: [{ content: { role: "model", parts: [{ thought: true, text: "planning tool call..." }] } }], modelVersion: "g" } };
  const malformed = { response: {
    candidates: [{ content: { role: "model", parts: [{ thoughtSignature: "sig-only", text: "" }] }, finishReason: "MALFORMED_FUNCTION_CALL" }],
    usageMetadata: { promptTokenCount: 50, thoughtsTokenCount: 10, totalTokenCount: 60 }, modelVersion: "g",
  } };
  const nativeBody = { contents: [{ role: "user", parts: [{ text: "run tool" }] }] };
  const streamNative = () => post(["antigravity", "test:streamGenerateContent"], nativeBody, "?alt=sse");

  // A genai-style reader: `data:` frames are payloads, a bare JSON object is an APIError.
  function parseGenAiStream(text) {
    const payloads = [];
    const errors = [];
    for (const block of text.split(/\r?\n\r?\n/).map((b) => b.trim()).filter(Boolean)) {
      if (block.startsWith("data:")) payloads.push(JSON.parse(block.slice(5)));
      else errors.push(JSON.parse(block).error);
    }
    return { payloads, errors };
  }

  beforeEach(() => {
    target = { provider: "antigravity", model: "test", credentials: { accessToken: SECRET, projectId: "fixture" } };
  });

  it("ends a post-thought MALFORMED_FUNCTION_CALL with one 502 UNAVAILABLE RPC error and no replay", async () => {
    mocks.execute.mockImplementation(async ({ body }) => reply200(sse(thought, malformed), body));
    const res = await streamNative();
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("event: error");
    expect(text).not.toContain("[DONE]");
    const { payloads, errors } = parseGenAiStream(text);
    expect(payloads).toHaveLength(1);
    expect(payloads[0].candidates[0].content.parts[0]).toMatchObject({ thought: true });
    expect(errors).toEqual([{ code: 502, status: "UNAVAILABLE", message: "upstream returned zero output with finishReason MALFORMED_FUNCTION_CALL" }]);
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("preserves an upstream RPC error with details after a thought, redacting the credential", async () => {
    const upstreamError = { error: {
      code: 429, message: `Quota exceeded for model (token ${SECRET})`, status: "RESOURCE_EXHAUSTED",
      details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "RATE_LIMIT_EXCEEDED" }],
    } };
    mocks.execute.mockImplementation(async ({ body }) => reply200(sse(thought, upstreamError), body));
    const res = await streamNative();
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    const { payloads, errors } = parseGenAiStream(text);
    expect(payloads).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 429, status: "RESOURCE_EXHAUSTED", details: [{ reason: "RATE_LIMIT_EXCEEDED" }] });
    expect(errors[0].message).toContain("Quota exceeded for model");
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("still retries an empty MALFORMED attempt that never reached the client", async () => {
    const text = { response: { candidates: [{ content: { role: "model", parts: [{ text: "answer" }] }, finishReason: "STOP" }], modelVersion: "g" } };
    mocks.execute
      .mockImplementationOnce(async ({ body }) => reply200(sse(malformed), body))
      .mockImplementation(async ({ body }) => reply200(sse(text), body));
    const res = await streamNative();
    const { payloads, errors } = parseGenAiStream(await res.text());
    expect(errors).toEqual([]);
    expect(payloads.at(-1).candidates[0].content.parts[0].text).toBe("answer");
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it("turns a translated OpenAI mid-stream error into a Google RPC frame on /v1beta", async () => {
    target = { provider: "openai", model: "gpt-test", credentials: { apiKey: SECRET } };
    mocks.execute.mockImplementation(async ({ body }) => reply200(sse(
      { id: "c", created: 1, model: "gpt-test", choices: [{ index: 0, delta: { role: "assistant", content: "par" }, finish_reason: null }] },
      { error: { message: `backend failure for ${SECRET}`, type: "server_error", code: "internal_server_error" } },
    ), body));
    const res = await post(["gpt-test:streamGenerateContent"], nativeBody, "?alt=sse");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(SECRET);
    const { payloads, errors } = parseGenAiStream(text);
    expect(payloads[0].candidates[0].content.parts[0].text).toBe("par");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 500, status: "INTERNAL" });
    expect(errors[0].message).toContain("backend failure");
    expect(Number.isInteger(errors[0].code)).toBe(true);
  });

  it("normalizes error bodies to integer code, message and canonical status", () => {
    expect(googleRpcErrorBody({ message: "x", type: "server_error", code: "stream_error" })).toEqual({ error: { code: 500, message: "x", status: "INTERNAL" } });
    expect(googleRpcErrorBody({ code: 502, status: "EMPTY_RESPONSE", message: "empty" })).toEqual({ error: { code: 502, message: "empty", status: "UNAVAILABLE" } });
    expect(googleRpcErrorBody({ status: "PERMISSION_DENIED", message: "no" })).toEqual({ error: { code: 403, message: "no", status: "PERMISSION_DENIED" } });
    expect(googleRpcErrorBody('[{"error":{"code":"429","message":"slow","details":["bad",{"reason":"R"}]}}]'))
      .toEqual({ error: { code: 429, message: "slow", status: "RESOURCE_EXHAUSTED", details: [{ reason: "R" }] } });
    expect(googleRpcErrorBody("plain text", 504)).toEqual({ error: { code: 504, message: "plain text", status: "DEADLINE_EXCEEDED" } });
  });
});
