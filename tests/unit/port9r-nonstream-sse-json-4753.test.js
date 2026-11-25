import { beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => ({ noAuth: true, execute: mocks.execute }) }));
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

const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const completed = {
  id: "resp_1", object: "response", status: "completed", model: "gpt-x",
  output: [{ type: "message", id: "m1", role: "assistant", content: [{ type: "output_text", text: "OK" }] }],
  usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
};
const responsesSSE = sse([
  { type: "response.created", response: { ...completed, status: "in_progress", output: [] } },
  { type: "response.output_item.added", output_index: 0, item: { type: "message", id: "m1", role: "assistant", content: [] } },
  { type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: "m1", delta: "OK" },
  { type: "response.output_item.done", output_index: 0, item: completed.output[0] },
  { type: "response.completed", response: completed },
]);

async function run(endpoint, request) {
  const body = { model: "gpt-x", ...request };
  const result = await handleChatCore({
    body,
    modelInfo: { provider: "openai-compatible-responses-x", model: "gpt-x" },
    credentials: { apiKey: "test-key", providerSpecificData: { baseUrl: "https://upstream.invalid/v1", apiType: "responses" } },
    clientRawRequest: { endpoint, body: structuredClone(body), headers: {} },
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
  return result.response;
}

describe("upstream PR #4753: non-streaming clients get JSON", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockImplementation(async ({ body }) => ({
      response: new Response(responsesSSE, { headers: { "content-type": "text/event-stream" } }),
      transformedBody: body, url: "https://upstream.invalid/v1/responses", headers: {},
    }));
  });

  it.each([["omitted", {}], ["false", { stream: false }]])(
    "converts Responses SSE to a chat completion when stream is %s", async (_label, flag) => {
      const response = await run("/v1/chat/completions", { messages: [{ role: "user", content: "hi" }], ...flag });

      expect(response.status, await response.clone().text()).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      const json = await response.json();
      expect(json.object).toBe("chat.completion");
      expect(json.choices[0].message.content).toBe("OK");
      expect(json.usage.prompt_tokens).toBe(3);
    });

  it("keeps the Responses document for a Responses client", async () => {
    const response = await run("/v1/responses", { input: "hi" });

    expect(response.status, await response.clone().text()).toBe(200);
    const json = await response.json();
    expect(json.object).toBe("response");
    expect(json.output[0].content[0].text).toBe("OK");
  });
});
