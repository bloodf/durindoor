import { describe, expect, it, vi } from "vitest";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { __clearProxyDispatchersForTesting, __setOriginalFetchForTesting, __setProxyDispatcherForTesting, evictResponseDispatcher, proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { createEmptyRetryStream } from "../../open-sse/handlers/chatCore/emptyStreamGuard.js";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(), saveRequestDetail: vi.fn(), saveRequestUsage: vi.fn(),
}));

describe("Antigravity in-band errors", () => {
  it.each([[401, 401], [403, 403], [429, 429], [0, 502]])("reports RPC code %i as %i", async (code, status) => {
    const onRequestSuccess = vi.fn();
    const result = await handleNonStreamingResponse({
      providerResponse: Response.json({ error: { code, message: "synthetic failure" } }),
      provider: "antigravity", model: "gemini-test", sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.ANTIGRAVITY, body: { messages: [] }, stream: false,
      requestStartTime: Date.now(), onRequestSuccess, trackDone: vi.fn(), appendLog: vi.fn(),
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(status);
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });
});

describe("Antigravity session isolation", () => {
  it("scopes the same body session to its connection and subagent", () => {
    const executor = new AntigravityExecutor();
    const session = (connectionId, agent) => executor.transformRequest("gemini-3-flash", {
      request: { sessionId: "shared-session", contents: [{ role: "user", parts: [{ text: "hello" }] }] },
      metadata: { subagent_id: agent },
    }, false, { connectionId, projectId: "synthetic-project" }).request.sessionId;
    expect(session("one", "alpha")).toBe(session("one", "alpha"));
    expect(new Set([session("one", "alpha"), session("one", "beta"), session("two", "alpha")]).size).toBe(3);
  });
});

describe("Antigravity transport retirement", () => {
  it("retires only the actual pooled dispatcher and leaves a replacement intact", async () => {
    const proxy = "http://proxy.example.test:8080";
    const old = { close: vi.fn() };
    const replacement = { close: vi.fn() };
    const restore = __setOriginalFetchForTesting(async () => Response.json({ error: { code: 401 } }));
    try {
      __setProxyDispatcherForTesting(proxy, old);
      const response = await proxyAwareFetch("https://service.example.test/test", {}, { connectionProxyEnabled: true, connectionProxyUrl: proxy, disableEnvProxy: true });
      expect(evictResponseDispatcher(response.body)).toBe(true);
      expect(old.close).toHaveBeenCalledOnce();
      __setProxyDispatcherForTesting(proxy, replacement);
      expect(evictResponseDispatcher(response)).toBe(false);
      expect(replacement.close).not.toHaveBeenCalled();
    } finally {
      restore();
      __clearProxyDispatchersForTesting();
    }
  });

  it("observes an in-band authentication error after output without consuming the error", async () => {
    const body = new Response('data: {"response":{"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}}\n\ndata: {"error":{"code":403,"message":"denied"}}\n\n').body;
    const observed = vi.fn();
    const stream = createEmptyRetryStream({ body, reexecute: vi.fn(), onInBandError: observed });
    const text = await new Response(stream).text();
    expect(observed).toHaveBeenCalledWith({ code: 403, message: "denied" }, body);
    expect(text).toContain('"code":403');
  });

  it.each([401, 403])( "retires the serving pool on an HTTP %i", async (status) => {
    const proxy = "http://proxy.example.test:8080";
    const pool = { close: vi.fn() };
    const restore = __setOriginalFetchForTesting(async () => new Response("denied", { status }));
    try {
      __setProxyDispatcherForTesting(proxy, pool);
      const result = await new AntigravityExecutor().execute({
        model: "gemini-3-flash", stream: false,
        credentials: { accessToken: "synthetic", projectId: "project-test", connectionId: "one" },
        body: { request: { contents: [{ role: "user", parts: [{ text: "hello" }] }] } },
        proxyOptions: { connectionProxyEnabled: true, connectionProxyUrl: proxy, disableEnvProxy: true },
      });
      expect(result.response.status).toBe(status);
      expect(pool.close).toHaveBeenCalledOnce();
    } finally {
      restore();
      __clearProxyDispatchersForTesting();
    }
  });

  it("retires the serving pool when a JSON body reports a 401", async () => {
    const proxy = "http://proxy.example.test:8080";
    const pool = { close: vi.fn() };
    const restore = __setOriginalFetchForTesting(async () => Response.json({ error: { code: 401, message: "denied" } }));
    try {
      __setProxyDispatcherForTesting(proxy, pool);
      const response = await proxyAwareFetch("https://service.example.test/test", {}, { connectionProxyEnabled: true, connectionProxyUrl: proxy, disableEnvProxy: true });
      const result = await handleNonStreamingResponse({
        providerResponse: response, provider: "antigravity", model: "gemini-test", sourceFormat: FORMATS.OPENAI,
        targetFormat: FORMATS.ANTIGRAVITY, body: { messages: [] }, stream: false, requestStartTime: Date.now(),
        trackDone: vi.fn(), appendLog: vi.fn(), reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      });
      expect(result.status).toBe(401);
      expect(pool.close).toHaveBeenCalledOnce();
    } finally {
      restore();
      __clearProxyDispatchersForTesting();
    }
  });
});
