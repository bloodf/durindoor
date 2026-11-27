import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeTokens, generateAuthData } from "../../src/lib/oauth/providers.js";
import iflow from "../../open-sse/providers/registry/iflow.js";
import { IFlowExecutor } from "../../open-sse/executors/iflow.js";
import { refreshIflowToken } from "../../open-sse/services/tokenRefresh/providers.js";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";

afterEach(() => vi.unstubAllGlobals());

describe("iFlow production OAuth contracts", () => {
  it("keeps concurrent account tokens and profile identities paired", async () => {
    const fetch = vi.fn(async (url, options) => {
      if (url === iflow.oauth.tokenUrl) {
        const code = options.body.get("code");
        return Response.json({ access_token: `access-${code}`, refresh_token: `refresh-${code}` });
      }
      const access = new URL(url).searchParams.get("accessToken");
      return Response.json({ success: true, data: { apiKey: `key-${access}`, email: `${access}@example.invalid` } });
    });
    vi.stubGlobal("fetch", fetch);
    const redirect = "http://localhost:1234/callback";
    const [a, b] = await Promise.all([exchangeTokens("iflow", "A", redirect), exchangeTokens("iflow", "B", redirect)]);
    expect(a).toMatchObject({ accessToken: "access-A", refreshToken: "refresh-A", apiKey: "key-access-A", email: "access-A@example.invalid" });
    expect(b).toMatchObject({ accessToken: "access-B", refreshToken: "refresh-B", apiKey: "key-access-B", email: "access-B@example.invalid" });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("rejects a profile without an API key after one token exchange", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "synthetic" })).mockResolvedValueOnce(Response.json({ success: true, data: { email: "x@example.invalid" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(exchangeTokens("iflow", "synthetic-code", "http://localhost/callback")).rejects.toThrow("Empty API key");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes separate accounts and preserves request credentials on streams", async () => {
    const calls = [];
    const restore = __setOriginalFetchForTesting(async (url, options) => {
      calls.push({ url, options });
      if (url === iflow.oauth.tokenUrl) {
        return Response.json({ access_token: `new-${options.body.get("refresh_token")}`, expires_in: 60 });
      }
      return new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
    });
    try {
      const [a, b] = await Promise.all([refreshIflowToken("refresh-A"), refreshIflowToken("refresh-B")]);
      expect(a).toMatchObject({ accessToken: "new-refresh-A", refreshToken: "refresh-A" });
      expect(b).toMatchObject({ accessToken: "new-refresh-B", refreshToken: "refresh-B" });
      const executor = new IFlowExecutor();
      const result = await executor.execute({ model: "qwen3-max", body: { messages: [], stream: true }, stream: true, credentials: { apiKey: "key-A" }, requestPolicy: { maxTransportAttempts: 1 } });
      expect(await result.response.text()).toContain("[DONE]");
      const chat = calls.find((call) => call.url === iflow.transport.baseUrl);
      expect(chat.options.headers.Authorization).toBe("Bearer key-A");
      expect(JSON.parse(chat.options.body).stream_options).toEqual({ include_usage: true });
      expect(iflow.models.length).toBeGreaterThan(0);
    } finally { restore(); }
  });

  it("generates independent browser states", async () => {
    const [a, b] = await Promise.all([generateAuthData("iflow", "http://localhost/callback"), generateAuthData("iflow", "http://localhost/callback")]);
    expect(a.state).toBeTruthy();
    expect(a.state).not.toBe(b.state);
    expect(new URL(a.authUrl).searchParams.get("state")).toBe(a.state);
  });
});

describe("staged iFlow cookie import", () => {
  it("keeps concurrent sessions separate and posts once per accepted lookup", async () => {
    const { importIflowCookie } = await import("../../src/lib/oauth/providerParity/iflow/cookie.js");
    const calls = [];
    const transport = vi.fn(async (url, options) => {
      calls.push({ url, ...options });
      const account = options.headers.Cookie.includes("session-A") ? "A" : "B";
      return Response.json({ success: true, data: options.method === "GET" ? { name: `account-${account}` } : { apiKey: `key-${account}` } });
    });
    const [a, b] = await Promise.all([
      importIflowCookie("BXAuth=session-A; ignored=private", { fetch: transport }),
      importIflowCookie("BXAuth=session-B;", { fetch: transport }),
    ]);
    expect(a).toMatchObject({ apiKey: "key-A", providerSpecificData: { cookie: "BXAuth=session-A;" } });
    expect(b).toMatchObject({ apiKey: "key-B", providerSpecificData: { cookie: "BXAuth=session-B;" } });
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(2);
    for (const call of calls.filter((entry) => entry.method === "POST")) {
      expect(JSON.parse(call.body).name).toBe(call.headers.Cookie.includes("session-A") ? "account-A" : "account-B");
    }
  });

  it("rejects malformed cookies before network and hides rejected-session bodies", async () => {
    const { importIflowCookie } = await import("../../src/lib/oauth/providerParity/iflow/cookie.js");
    const transport = vi.fn(async () => new Response("synthetic-secret", { status: 401 }));
    await expect(importIflowCookie("notBXAuth=x", { fetch: transport })).rejects.toThrow("BXAuth");
    await expect(importIflowCookie("BXAuth=a; BXAuth=b", { fetch: transport })).rejects.toThrow("BXAuth");
    expect(transport).not.toHaveBeenCalled();
    await expect(importIflowCookie("BXAuth=expired", { fetch: transport })).rejects.toThrow(/^iFlow cookie verification failed$/);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("does not retry a failed rotation and forwards cancellation", async () => {
    const { importIflowCookie } = await import("../../src/lib/oauth/providerParity/iflow/cookie.js");
    const controller = new AbortController();
    const transport = vi.fn().mockResolvedValueOnce(Response.json({ success: true, data: { name: "account" } })).mockImplementationOnce(async (_url, options) => {
      expect(options.signal).toBe(controller.signal);
      controller.abort();
      throw new Error("synthetic secret");
    });
    await expect(importIflowCookie("BXAuth=session", { fetch: transport, signal: controller.signal })).rejects.toThrow("aborted");
    expect(transport).toHaveBeenCalledTimes(2);
  });
});
