import { describe, it, expect, vi } from "vitest";
import "../translator/registerAll.js";
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));
import { handleChatCore } from "../../open-sse/handlers/chatCore.js";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { getProviderModels } from "../../open-sse/config/providerModels.js";
import { buildRegistryProviderProbe } from "../../src/app/api/providers/providerProbe.js";
import registry from "../../open-sse/providers/registry/codebuddy-intl.js";

const sse = 'data: {"choices":[{"index":0,"delta":{"content":"hello","function_call":{"name":"","arguments":""}},"finish_reason":""}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1}}\n\ndata: [DONE]\n\n';

describe("CodeBuddy International", () => {
  it("registers a distinct API-key connection without China OAuth or quota", () => {
    expect(registry.category).toBe("apikey");
    expect(registry.oauth).toBeUndefined();
    expect(buildRegistryProviderProbe("codebuddy-intl", "synthetic-key")).toBeNull();
    expect(registry.transport.usage).toBeUndefined();
    expect(PROVIDERS["codebuddy-cn"].baseUrl).toContain("copilot.tencent.com");
    expect(PROVIDERS["codebuddy-intl"].baseUrl).toBe("https://www.codebuddy.ai/v2/chat/completions");
    expect(getExecutor("cbai")).toBe(getExecutor("codebuddy-intl"));
  });

  it("exposes the curated gateway catalog without an account model fetcher", () => {
    expect(getProviderModels("cbai").map(({ id }) => id)).toEqual(registry.models.map(({ id }) => id));
    expect(registry.modelsFetcher).toBeUndefined();
  });

  it.each([false, true])("sends forced streaming for stream=%s and normalizes SSE", async (stream) => {
    let captured;
    const result = await getExecutor("codebuddy-intl").execute({
      model: "hy3", body: { model: "hy3", messages: [{ role: "user", content: "hi" }] }, stream,
      credentials: { apiKey: "synthetic-key" },
      directFetch: async (url, init) => {
        captured = { url, ...init };
        return new Response(sse, { headers: { "content-type": "text/event-stream", "content-length": "99" } });
      },
    });
    expect(captured.url).toBe("https://www.codebuddy.ai/v2/chat/completions");
    // Tencent IAM specifies the key header. The other transport headers are
    // compatibility assumptions taken from the pinned OmniRoute gateway code.
    expect(captured.headers["X-Api-Key"]).toBe("synthetic-key");
    expect(captured.headers.Authorization).toBeUndefined();
    expect(captured.headers["X-Product"]).toBe("SaaS");
    expect(captured.headers["x-requested-with"]).toBe("XMLHttpRequest");
    expect(captured.headers["x-codebuddy-request"]).toBe("1");
    expect(captured.headers["X-Conversation-ID"]).toBeTruthy();
    expect(captured.headers["X-Conversation-Request-ID"]).toBeTruthy();
    expect(captured.headers["X-Conversation-Message-ID"]).toBeTruthy();
    const sent = JSON.parse(captured.body);
    expect(sent.stream).toBe(true);
    expect(sent.messages[0].role).toBe("system");
    expect(result.response.headers.has("content-length")).toBe(false);
    const output = await result.response.text();
    expect(output).toContain('"finish_reason":null');
    expect(output).not.toContain('function_call');
    expect(output).toContain('"prompt_tokens":2');
    expect(output).toContain('[DONE]');
  });

  it("preserves upstream authentication and quota failures", async () => {
    for (const status of [401, 429]) {
      const result = await getExecutor("codebuddy-intl").execute({
        model: "hy3", body: { messages: [] }, stream: true, credentials: { apiKey: "invalid" },
        directFetch: async () => new Response('{"error":"denied"}', { status }),
        requestPolicy: { maxTransportAttempts: 1 },
      });
      expect(result.response.status).toBe(status);
      expect(await result.response.text()).toContain("denied");
    }
  });
  it.each([false, true])("normal gateway route handles stream=%s", async (stream) => {
    const restore = __setOriginalFetchForTesting(async (url) => {
      expect(url).toBe("https://www.codebuddy.ai/v2/chat/completions");
      return new Response(sse, { headers: { "content-type": "text/event-stream" } });
    });
    try {
      const body = { model: "cbai/hy3", stream, messages: [{ role: "user", content: "hi" }] };
      const result = await handleChatCore({
        body, modelInfo: { provider: "codebuddy-intl", model: "hy3" },
        credentials: { apiKey: "synthetic-key", providerSpecificData: {} },
        connectionId: "test-connection", log: { debug() {}, info() {}, warn() {}, error() {} },
        rtkEnabled: false, headroomEnabled: false, cavemanEnabled: false, ponytailEnabled: false,
        clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: { accept: stream ? "text/event-stream" : "application/json" } },
      });
      expect(result.response.status).toBe(200);
      const output = await result.response.text();
      expect(output).toContain("hello");
      expect(output).toContain(stream ? "[DONE]" : "chat.completion");
    } finally { restore(); }
  });

});
