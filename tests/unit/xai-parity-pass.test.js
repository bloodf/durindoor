import { afterEach, describe, expect, it, vi } from "vitest";
import { XaiExecutor } from "../../open-sse/executors/xai.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { XaiService } from "../../src/lib/oauth/services/xai.js";
import { fetchXaiOAuthQuota } from "../../src/lib/usage/xaiQuotaAdapter.js";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn() }));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("xAI upstream parity", () => {
  it.each([false, true])("removes stop from native Responses requests, stream=%s", async (stream) => {
    proxyAwareFetch.mockResolvedValue(new Response("{}"));
    await new XaiExecutor().execute({ model: "grok-4.20-multi-agent-0309", stream,
      body: { model: "grok-4.20-multi-agent-0309", input: "hello", stop: ["end"] }, credentials: { apiKey: "fixture" } });
    const [url, options] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe("https://api.x.ai/v1/responses");
    expect(JSON.parse(options.body)).not.toHaveProperty("stop");
  });

  it("rejects a refresh response without an access token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      authorization_endpoint: "https://auth.x.ai/oauth2/authorize", token_endpoint: "https://auth.x.ai/oauth2/token"
    }))).mockResolvedValueOnce(new Response(JSON.stringify({ refresh_token: "fixture" }))));
    await expect(new XaiService().refreshAccessToken("fixture")).rejects.toThrow("missing access_token");
  });

  it("rejects an authorization-code exchange without an access token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
    await expect(new XaiService().exchangeXaiCode({ tokenUrl: "https://auth.x.ai/oauth2/token", code: "fixture", redirectUri: "http://127.0.0.1/callback", codeVerifier: "fixture" })).rejects.toThrow("missing access_token");
  });

  it("normalizes Responses content and web search tools at dispatch", async () => {
    proxyAwareFetch.mockResolvedValue(new Response("{}"));
    await new XaiExecutor().execute({ model: "grok-4.20-multi-agent-0309", stream: false,
      body: { model: "grok-4.20-multi-agent-0309", input: [{ role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: "https://example.test/a" } }] }], tools: [{ type: "web_search", external_web_access: true, filters: { allowed_domains: ["example.test"] } }] }, credentials: { apiKey: "fixture" } });
    const sent = JSON.parse(proxyAwareFetch.mock.calls[0][1].body);
    expect(sent.input[0].content).toEqual([{ type: "input_text", text: "hi" }, { type: "input_image", image_url: "https://example.test/a" }]);
    expect(sent.tools).toEqual([{ type: "web_search", allowed_domains: ["example.test"] }]);
  });

  it("reads the selected OAuth connection's weekly billing and fails open", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ creditUsagePercent: 35, currentPeriod: { end: "2030-01-01T00:00:00Z" } }))).mockResolvedValueOnce(new Response("denied", { status: 401 }));
    const context = { connection: { accessToken: "oauth-fixture" }, fetchImpl };
    const live = await fetchXaiOAuthQuota(context);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://cli-chat-proxy.grok.com/v1/billing?format=credits");
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer oauth-fixture");
    expect(live.quotas.Credits).toMatchObject({ used: 35, total: 100 });
    expect((await fetchXaiOAuthQuota(context)).outcome).toBe("unauthenticated");
  });

  it("flattens Responses namespace and custom tools", async () => {
    proxyAwareFetch.mockResolvedValue(new Response("{}"));
    await new XaiExecutor().execute({ model: "grok-4.20-multi-agent-0309", stream: false,
      body: { model: "grok-4.20-multi-agent-0309", input: [], tools: [{ type: "namespace", name: "server", tools: [{ name: "lookup", parameters: { type: "object" } }] }, { type: "custom", name: "patch" }] }, credentials: { apiKey: "fixture" } });
    const tools = JSON.parse(proxyAwareFetch.mock.calls[0][1].body).tools;
    expect(tools).toEqual([{ type: "function", name: "server__lookup", parameters: { type: "object" } }, { type: "function", name: "patch", parameters: { type: "object", properties: { input: { type: "string" } }, required: ["input"] } }]);
  });
});
