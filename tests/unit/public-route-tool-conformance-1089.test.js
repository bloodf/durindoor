import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

// #1089: Chat, Responses and Claude clients through the real public routes
// (POST /v1/chat/completions, /v1/responses, /v1/messages) into the real handleChatCore.
// Only the upstream executor is faked; it echoes the outbound tool name in a Chat JSON reply.
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
const { detectFormatByEndpoint } = await import("../../open-sse/translator/formats.js");
const chatRoute = await import("../../src/app/api/v1/chat/completions/route.js");
const responsesRoute = await import("../../src/app/api/v1/responses/route.js");
const messagesRoute = await import("../../src/app/api/v1/messages/route.js");

const NAME = /^[a-zA-Z0-9_-]{1,64}$/;
const schema = { type: "object", properties: { type: { type: "string" }, properties: { type: "array", items: { type: "string" } } }, required: ["type"] };

const toolName = (sent) => sent.tools[0].function.name;
const json = (sent) => new Response(JSON.stringify({
  id: "c", object: "chat.completion", model: "m",
  choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: toolName(sent), arguments: '{"type":"a"}' } }] } }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
}), { headers: { "content-type": "application/json" } });
const sse = (sent) => new Response([
  { id: "c", created: 1, model: "m", choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: toolName(sent), arguments: '{"type":"a"}' } }] }, finish_reason: null }] },
  { id: "c", created: 1, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
].map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });

// chatCore picks the upstream transport; answer in whichever it asked for.
const upstream = async ({ body: sent }) => ({
  response: sent.stream ? sse(sent) : json(sent),
  url: "http://upstream.test", headers: {}, transformedBody: sent,
});

const bodies = {
  chat: () => ({
    model: "gpt-test", stream: false,
    messages: [{ role: "user", content: "hi" }],
    tools: [{ type: "function", function: { name: "ns.search", description: "S", parameters: schema, strict: true } }],
    tool_choice: { type: "function", function: { name: "ns.search" } },
    parallel_tool_calls: false,
  }),
  responses: () => ({
    model: "gpt-test", stream: false, input: "hi",
    tools: [{ type: "function", name: "ns.search", description: "S", parameters: schema, strict: true }],
    tool_choice: { type: "function", name: "ns.search" },
    parallel_tool_calls: false,
  }),
  claude: () => ({
    model: "gpt-test", max_tokens: 100, stream: false,
    messages: [{ role: "user", content: "hi" }],
    tools: [{ name: "ns.search", description: "S", input_schema: schema }],
    tool_choice: { type: "tool", name: "ns.search", disable_parallel_tool_use: true },
  }),
};

const call = (route, path, payload) =>
  route.POST(new Request(`https://router.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }));

const outbound = () => mocks.execute.mock.calls.at(-1)[0].body;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.execute.mockImplementation(upstream);
  mocks.handleChat.mockImplementation(async (request) => {
    const chatBody = await request.json();
    const result = await handleChatCore({
      body: chatBody,
      modelInfo: { provider: "openai", model: "gpt-test" },
      credentials: { apiKey: "k" },
      // handleChat derives the client dialect from the route path, not the body.
      sourceFormatOverride: detectFormatByEndpoint(new URL(request.url).pathname, chatBody),
      clientRawRequest: { endpoint: new URL(request.url).pathname, body: chatBody, headers: { accept: "application/json" } },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    return result.response;
  });
});

describe("#1089 public routes keep tool policy and restore aliases", () => {
  it("Chat client: alias upstream, named choice and parallel false kept, name restored", async () => {
    const res = await call(chatRoute, "/v1/chat/completions", bodies.chat());
    expect(res.status).toBe(200);
    const sent = outbound();
    expect(sent.tools[0].function.name).toMatch(NAME);
    expect(sent.tools[0].function.strict).toBe(true);
    expect(sent.tool_choice.function.name).toBe(sent.tools[0].function.name);
    expect(sent.parallel_tool_calls).toBe(false);
    const reply = await res.json();
    expect(reply.choices[0].message.tool_calls[0].function.name).toBe("ns.search");
  });

  it("Responses client: alias upstream, named choice and parallel false kept, name restored", async () => {
    // stream:true: the SSE path is what Codex-style Responses clients use; the JSON projection is
    // covered by v5-conformance-responses-json.test.js.
    const res = await call(responsesRoute, "/v1/responses", { ...bodies.responses(), stream: true });
    expect(res.status).toBe(200);
    const sent = outbound();
    expect(sent.tools[0].function.name).toMatch(NAME);
    expect(sent.tools[0].function.strict).toBe(true);
    expect(sent.tool_choice.function.name).toBe(sent.tools[0].function.name);
    expect(sent.parallel_tool_calls).toBe(false);
    const text = await res.text();
    const done = text.split("\n\n").map((f) => f.split("\n").find((l) => l.startsWith("data: "))).filter(Boolean)
      .map((l) => JSON.parse(l.slice(6))).find((e) => e.type === "response.output_item.done");
    expect(done.item.name).toBe("ns.search");
  });

  it("Claude client: alias upstream, named choice and parallel false kept, name restored", async () => {
    const res = await call(messagesRoute, "/v1/messages", bodies.claude());
    expect(res.status).toBe(200);
    const sent = outbound();
    expect(sent.tools[0].function.name).toMatch(NAME);
    expect(sent.tool_choice.function.name).toBe(sent.tools[0].function.name);
    expect(sent.parallel_tool_calls).toBe(false);
    const reply = await res.json();
    expect(reply.content.find((b) => b.type === "tool_use").name).toBe("ns.search");
  });

  // Chat to Chat is same-format passthrough and does not validate schemas (like Responses to Responses).
  it.each([
    ["responses", responsesRoute, "/v1/responses"],
    ["claude", messagesRoute, "/v1/messages"],
  ])("%s client: a malformed tool schema is rejected with 400 before the upstream", async (kind, route, path) => {
    const payload = bodies[kind]();
    const bad = { type: "object", properties: "bad" };
    if (kind === "responses") payload.tools[0].parameters = bad;
    else payload.tools[0].input_schema = bad;
    const res = await call(route, path, payload);
    expect(res.status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});

// Gemini clients use /v1beta/models/*; see v1beta-gemini-gateway-conformance-1089.test.js for the
// Gemini route against Chat, Claude and Gemini upstreams. A Gemini-shaped body posted to
// /v1/chat/completions is not a supported Gemini route: it is treated as a Chat request.
describe("#1089 Gemini client through its public route", () => {
  it("POST /v1beta/models/*:generateContent restores ns.search from a Chat upstream", async () => {
    const { POST } = await import("../../src/app/api/v1beta/models/[...path]/route.js");
    const res = await POST(new Request("https://router.test/v1beta/models/gpt-test:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: [{ functionDeclarations: [{ name: "ns.search", description: "S", parameters: schema }] }],
      }),
    }), { params: Promise.resolve({ path: ["gpt-test:generateContent"] }) });
    expect(res.status).toBe(200);
    expect(outbound().tools[0].function.name).toMatch(NAME);
    const reply = await res.json();
    expect(reply.candidates[0].content.parts.find((p) => p.functionCall).functionCall.name).toBe("ns.search");
  });
});

