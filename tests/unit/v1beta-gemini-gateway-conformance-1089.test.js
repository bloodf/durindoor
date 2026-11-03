import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

// #1089: Gemini-source cases through the real public route (POST /v1beta/models/*) and the
// real handleChatCore. Only the upstream executor is faked; it echoes the outbound tool name.
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

const NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const schema = { type: "object", properties: { type: { type: "string" } }, required: ["type"] };
const decl = (name) => ({ name, description: "S", parameters: schema });

const body = (toolConfig, names = ["ns.search"]) => ({
  contents: [{ role: "user", parts: [{ text: "hi" }] }],
  tools: [{ functionDeclarations: names.map(decl) }],
  ...(toolConfig && { toolConfig }),
});

const post = (suffix, payload) =>
  POST(new Request(`https://router.test/v1beta/models/gpt-test:${suffix}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }), { params: Promise.resolve({ path: [`gpt-test:${suffix}`] }) });

const upstreamJson = (toolName) => new Response(JSON.stringify({
  id: "c", object: "chat.completion", model: "gpt-test",
  choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: toolName, arguments: '{"type":"a"}' } }] } }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
}), { headers: { "content-type": "application/json" } });

const upstreamSse = (toolName) => new Response([
  { id: "c", created: 1, model: "gpt-test", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: toolName, arguments: '{"type":"a"}' } }] }, finish_reason: null }] },
  { id: "c", created: 1, model: "gpt-test", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
].map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });

// The provider speaks JSON or SSE depending on the outbound `stream` flag chatCore chose.
const upstream = async ({ body: sent }) => ({
  response: sent.stream ? upstreamSse(sent.tools[0].function.name) : upstreamJson(sent.tools[0].function.name),
  url: "http://upstream.test", headers: {}, transformedBody: sent,
});

const outbound = () => mocks.execute.mock.calls.at(-1)[0].body;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.handleChat.mockImplementation(async (request) => {
    const chatBody = await request.json();
    const result = await handleChatCore({
      body: chatBody,
      modelInfo: { provider: "openai", model: "gpt-test" },
      credentials: { apiKey: "k" },
      clientRawRequest: { endpoint: "/v1/chat/completions", body: chatBody, headers: { accept: "application/json" } },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    return result.response;
  });
});

describe("#1089 Gemini public route through handleChatCore", () => {
  it("aliases a namespaced tool upstream and restores ns.search in the JSON reply", async () => {
    mocks.execute.mockImplementation(upstream);
    const res = await post("generateContent", body({ functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["ns.search"] } }));
    expect(res.status).toBe(200);
    expect(outbound().tools[0].function.name).toMatch(NAME);
    expect(outbound().tools[0].function.name).not.toBe("ns.search");
    expect(outbound().tool_choice).toMatchObject({ type: "function", function: { name: outbound().tools[0].function.name } });
    const json = await res.json();
    expect(json.candidates[0].content.parts[0].functionCall).toMatchObject({ name: "ns.search", args: { type: "a" } });
  });

  it("restores ns.search in the streamed reply", async () => {
    mocks.execute.mockImplementation(upstream);
    const res = await post("streamGenerateContent?alt=sse", body());
    const text = await res.text();
    expect(text).toContain('"name":"ns.search"');
    expect(text).not.toMatch(/ns_search/);
  });

  it("does not send required with an empty tool list when allowedFunctionNames match nothing", async () => {
    mocks.execute.mockImplementation(upstream);
    await post("generateContent", body({ functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["missing"] } }, ["a", "b"]));
    expect(outbound().tools.map((t) => t.function.name)).toEqual(["a", "b"]);
    expect(outbound().tool_choice).toBe("required");
  });

  it("gives two idless same-turn calls to one function distinct paired ids", async () => {
    mocks.execute.mockImplementation(upstream);
    await post("generateContent", {
      contents: [
        { role: "user", parts: [{ text: "hi" }] },
        { role: "model", parts: [{ functionCall: { name: "w", args: { c: 1 } } }, { functionCall: { name: "w", args: { c: 2 } } }] },
        { role: "user", parts: [{ functionResponse: { name: "w", response: { result: 1 } } }, { functionResponse: { name: "w", response: { result: 2 } } }] },
      ],
      tools: [{ functionDeclarations: [decl("w")] }],
    });
    const msgs = outbound().messages;
    const callIds = msgs.find((m) => m.tool_calls).tool_calls.map((c) => c.id);
    const resultIds = msgs.filter((m) => m.role === "tool").map((m) => m.tool_call_id);
    expect(new Set(callIds).size).toBe(2);
    expect(resultIds).toEqual(callIds);
  });
});
