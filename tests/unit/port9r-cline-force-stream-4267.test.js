import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

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

// proxyFetch captures globalThis.fetch when it loads, so stub before importing.
const upstream = vi.fn();
vi.stubGlobal("fetch", upstream);
const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");

const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
  id: "chatcmpl-cline", object: "chat.completion.chunk", created: 1, model: "m",
  choices: [{ index: 0, delta, finish_reason }],
})}\n\n`;

const CHAT_URL = "https://api.cline.bot/api/v1/chat/completions";

/** Cline's wire behaviour: SSE when streaming, a success-less envelope otherwise. */
function clineUpstream(url, init) {
  // Anything but the chat endpoint (background lookups) stays offline.
  if (String(url) !== CHAT_URL) return Promise.reject(new Error(`unexpected fetch: ${url}`));
  if (JSON.parse(init.body).stream !== true) {
    return Promise.resolve(Response.json({ data: { choices: [{ message: { role: "assistant", content: "OK" } }] } }));
  }
  const sse = `${chunk({ role: "assistant", content: "OK" })}${chunk({}, "stop")}data: [DONE]\n\n`;
  return Promise.resolve(new Response(sse, { headers: { "content-type": "text/event-stream" } }));
}

afterAll(() => vi.unstubAllGlobals());

describe("9router#4267: Cline is streaming-only upstream", () => {
  beforeEach(() => {
    upstream.mockReset().mockImplementation(clineUpstream);
  });

  it.each([
    ["cline", "anthropic/claude-sonnet-4.6"],
    ["clinepass", "glm-5.3"],
  ])("returns a bare completion to a stream:false %s client", async (provider, model) => {
    const body = { model, messages: [{ role: "user", content: "hi" }], stream: false };

    const result = await handleChatCore({
      body,
      modelInfo: { provider, model },
      credentials: { apiKey: "clp_test" },
      clientRawRequest: { endpoint: "/v1/chat/completions", body: structuredClone(body), headers: { accept: "application/json" } },
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });

    expect(result.response.status, await result.response.clone().text()).toBe(200);
    expect(result.response.headers.get("content-type")).toContain("application/json");
    const json = await result.response.json();
    expect(json.data).toBeUndefined();
    expect(json.choices[0].message.content).toBe("OK");
    const chatCalls = upstream.mock.calls.filter(([url]) => String(url) === CHAT_URL);
    expect(chatCalls).toHaveLength(1);
    expect(JSON.parse(chatCalls[0][1].body).stream).toBe(true);
  });
});
