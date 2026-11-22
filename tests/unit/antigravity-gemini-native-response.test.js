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
const { collectAntigravityGeminiSSE } = await import("../../open-sse/handlers/chatCore/antigravityGeminiNative.js");

const requestBody = { contents: [{ role: "user", parts: [{ text: "hello" }] }], tools: [{ functionDeclarations: [{ name: "ns.search", parameters: { type: "object", properties: {} } }] }] };
const chunk = (name) => ({ response: { candidates: [
  { index: 0, content: { role: "model", parts: [{ functionCall: { name, args: {} } }] } },
  { index: 1, content: { role: "model", parts: [{ functionCall: { name, args: {} } }] }, finishReason: "MAX_TOKENS" },
], cpaUsageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4, totalTokenCount: 7 } } });
const post = (action) => POST(new Request(`https://router.test/api/v1beta/models/antigravity/test:${action}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(requestBody),
}), { params: Promise.resolve({ path: ["antigravity", `test:${action}`] }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.openaiFixture = false;
  mocks.forced = false;
  mocks.execute.mockImplementation(async ({ body, stream }) => {
    const name = body.request.tools[0].functionDeclarations[0].name;
    const data = chunk(name);
    if (mocks.openaiFixture) data.response.candidates[0].finishReason = "STOP";
    return { response: new Response(stream ? `data: ${JSON.stringify(data)}\n\n` : JSON.stringify(data), {
      headers: { "content-type": stream ? "text/event-stream" : "application/json" },
    }), transformedBody: body, url: "https://upstream.test", headers: {} };
  });
  mocks.handleChat.mockImplementation(async (request, raw) => {
    const body = await request.json();
    const result = await handleChatCore({ body, modelInfo: { provider: "antigravity", model: "test" }, credentials: { accessToken: "fixture", projectId: "fixture" }, ...(mocks.forced ? { executorOverride: { noAuth: true, forceStream: true, execute: mocks.execute } } : {}), clientRawRequest: raw, log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    return result.response;
  });
});

describe("Antigravity Gemini native response", () => {
  function expectNative(data) {
    expect(data.candidates).toHaveLength(2);
    expect(data.candidates.map(c => c.content.parts[0].functionCall.name)).toEqual(["ns.search", "ns.search"]);
    expect(data.candidates.map(c => c.finishReason)).toEqual(["STOP", "MAX_TOKENS"]);
    expect(data.usageMetadata.totalTokenCount).toBe(7);
    expect(data.cpaUsageMetadata).toBeUndefined();
  }
  it("preserves every candidate in JSON", async () => {
    const response = await post("generateContent");
    expect(response.status, await response.clone().text()).toBe(200);
    expectNative(await response.json());
  });
  it("preserves every candidate in SSE", async () => {
    const response = await post("streamGenerateContent");
    expect(response.status).toBe(200);
    const events = (await response.text()).split("\n").filter(line => line.startsWith("data: "));
    expect(events).toHaveLength(1);
    expectNative(JSON.parse(events[0].slice(6)));
  });
  it("preserves candidates when SSE is collected for a JSON client", async () => {
    mocks.forced = true;
    const response = await post("generateContent");
    expect(response.status, await response.clone().text()).toBe(200);
    expectNative(await response.json());
  });
  it("collects separate fragments and usage by candidate index", () => {
    const frames = [
      { response: { candidates: [{ index: 0, content: { parts: [{ text: "one" }] } }, { index: 1, content: { parts: [{ function_response: { name: "ns_search", response: {} } }] } }] } },
      { response: { candidates: [{ index: 0, content: { parts: [{ text: "two" }] }, finishReason: "MAX_TOKENS" }], cpaUsageMetadata: { totalTokenCount: 7 } } },
    ];
    const result = collectAntigravityGeminiSSE(frames.map(frame => `data: ${JSON.stringify(frame)}\n\n`).join(""), new Map([["ns_search", "ns.search"]]));
    expect(result.candidates[0].content.parts.map(part => part.text)).toEqual(["one", "two"]);
    expect(result.candidates[0].finishReason).toBe("MAX_TOKENS");
    expect(result.candidates[1].finishReason).toBe("STOP");
    expect(result.candidates[1].content.parts[0].function_response.name).toBe("ns.search");
    expect(result.usageMetadata.totalTokenCount).toBe(7);
  });
  it("keeps the OpenAI response format for chat requests", async () => {
    mocks.openaiFixture = true;
    const body = { model: "antigravity/test", messages: [{ role: "user", content: "hello" }], tools: [{ type: "function", function: { name: "ns.search", parameters: { type: "object", properties: {} } } }], stream: false };
    const result = await handleChatCore({ body, modelInfo: { provider: "antigravity", model: "test" }, credentials: { accessToken: "fixture", projectId: "fixture" }, clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} }, log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    const data = await result.response.json();
    expect(result.response.status, JSON.stringify(data)).toBe(200);
    expect(data.choices).toHaveLength(1);
    expect(data.candidates).toBeUndefined();
  });
});
