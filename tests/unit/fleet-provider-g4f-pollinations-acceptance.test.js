/**
 * Issue #1189 scope: offline comparison of installed native Pollinations with
 * the distinct, uninstalled g4f.space Pollinations gateway (g4fpol). Raw upstream
 * metadata is not runtime proof; g4f/web/app-server is not the native vendor.
 * Mocked tool/stream responses prove wire preservation only, not upstream
 * capabilities. Account-backed endpoint/auth/models/tool/stream verification is
 * unavailable; candidate capabilities must remain unadvertised.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Registry imports otherwise start an unrelated release-check timer.
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "kimchi/offline" }));
vi.mock("@/models", () => ({ getProviderNodeById: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => null),
}));
vi.mock("@/sse/services/tokenRefresh", () => ({
  refreshGoogleToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
}));
const transport = vi.hoisted(() => vi.fn());
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: transport }));

import { POST } from "../../src/app/api/providers/validate/route.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { PROVIDERS } from "../../open-sse/config/providers.js";

const nativeUrl = "https://gen.pollinations.ai/v1/chat/completions";
const candidateUrl = "https://g4f.space/api/pollinations/v1/chat/completions";
const apiKey = "offline-fixture-not-a-credential";
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
const validate = (provider) => POST(new Request("http://localhost/api/providers/validate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ provider, apiKey }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected offline fetch"); }));
  transport.mockImplementation(async () => { throw new Error("Unexpected offline transport"); });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("#1189 native Pollinations is not g4f-pollinations", () => {
  it("validates a native key at the native models endpoint, never the g4f gateway", async () => {
    globalThis.fetch.mockResolvedValue(json({ data: [{ id: "openai" }] }));
    const response = await validate("pollinations");
    expect(await response.json()).toEqual({ valid: true, error: null });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = globalThis.fetch.mock.calls[0];
    expect(url).toBe("https://gen.pollinations.ai/v1/models");
    expect(options.headers.Authorization).toBe(`Bearer ${apiKey}`);
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(["g4f-pollinations", "g4fpol"])("rejects uninstalled identity %s before validation or discovery I/O", async (provider) => {
    const response = await validate(provider);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Provider validation not supported" });
    expect(await fetchConnectionModels({ id: "offline", provider, apiKey })).toEqual({
      error: `Provider ${provider} does not support models listing`, status: 400,
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    expect(getModelsByProviderId(provider)).toEqual([]);
    expect(PROVIDERS[provider]).toBeUndefined();
  });

  it.each(["g4f-pollinations", "g4fpol", "fleet-unregistered-provider-1189"])("rejects %s URL construction with status 400 before reading credentials", (provider) => {
    const executor = getExecutor(provider);
    const buildHeaders = vi.spyOn(executor, "buildHeaders");
    const readApiKey = vi.fn(() => apiKey);
    const credentials = { get apiKey() { return readApiKey(); } };
    let error;
    try {
      executor.buildUrl("openai", false, 0, credentials);
    } catch (caught) {
      error = caught;
    }
    expect(readApiKey).not.toHaveBeenCalled();
    expect(buildHeaders).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(error).toMatchObject({ status: 400 });
  });

  it.each(["g4f-pollinations", "g4fpol", "fleet-unregistered-provider-1189"])("rejects %s execution with status 400 and zero credential dispatch", async (provider) => {
    const executor = getExecutor(provider);
    const buildHeaders = vi.spyOn(executor, "buildHeaders");
    const readApiKey = vi.fn(() => apiKey);
    const credentials = { get apiKey() { return readApiKey(); } };
    // A successful offline response exposes unsafe dispatch without retry delays.
    transport.mockResolvedValue(json({ choices: [{ message: { content: "must not dispatch" } }] }));
    let error;
    try {
      await executor.execute({
        model: "openai", body: { messages: [{ role: "user", content: "ping" }] },
        stream: false, credentials,
      });
    } catch (caught) {
      error = caught;
    }
    expect.soft(error).toMatchObject({ status: 400 });
    expect.soft(buildHeaders).not.toHaveBeenCalled();
    expect.soft(readApiKey).not.toHaveBeenCalled();
    expect.soft(transport).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("keeps the native static catalog without pretending it supports dynamic model discovery", async () => {
    expect(getModelsByProviderId("pollinations").some((model) => model.id === "openai")).toBe(true);
    expect(getExecutor("pol").getProvider()).toBe("pollinations");
    expect(await fetchConnectionModels({ id: "offline-native", provider: "pollinations", apiKey })).toEqual({
      error: "Provider pollinations does not support models listing", status: 400,
    });
    expect(transport).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("executes a native tool round trip without replacing transport from connection metadata", async () => {
    const toolCall = { id: "call_lookup", type: "function", function: { name: "lookup", arguments: '{"q":"gate"}' } };
    const body = {
      messages: [
        { role: "user", content: "Look up gate" },
        { role: "assistant", content: null, tool_calls: [toolCall] },
        { role: "tool", tool_call_id: "call_lookup", content: "stone" },
      ],
      tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: { q: { type: "string" } } } } }],
      tool_choice: "auto",
    };
    const original = structuredClone(body);
    const fixture = { choices: [{ message: { role: "assistant", content: "stone" }, finish_reason: "stop" }] };
    transport.mockResolvedValue(json(fixture));
    const { response } = await getExecutor("pollinations").execute({
      model: "openai", body, stream: false,
      credentials: { apiKey, providerSpecificData: { baseUrl: candidateUrl } },
    });
    expect(await response.json()).toEqual(fixture);
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, options] = transport.mock.calls[0];
    expect(url).toBe(nativeUrl);
    expect(options.headers.Authorization).toBe(`Bearer ${apiKey}`);
    expect(JSON.parse(options.body)).toEqual({ ...body, model: "openai", stream: false });
    expect(body).toEqual(original);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("preserves a mocked SSE tool-call stream and omits synthetic public auth", async () => {
    const sse = 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_lookup","type":"function","function":{"name":"lookup","arguments":"{}"}}]}}]}\n\ndata: [DONE]\n\n';
    transport.mockResolvedValue(new Response(sse, { headers: { "Content-Type": "text/event-stream" } }));
    const { response } = await getExecutor("pol").execute({
      model: "openai-fast", body: { messages: [{ role: "user", content: "lookup" }] }, stream: true,
      credentials: { id: "noauth", accessToken: "public" },
    });
    expect(await response.text()).toBe(sse);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, options] = transport.mock.calls[0];
    expect(url).toBe(nativeUrl);
    expect(options.headers.Authorization).toBeUndefined();
    expect(options.headers.Accept).toBe("text/event-stream");
    expect(JSON.parse(options.body)).toMatchObject({ model: "openai-fast", stream: true });
  });

  it("retains native upstream auth errors without rerouting to g4f", async () => {
    const fixture = { error: { message: "fixture key rejected", type: "authentication_error" } };
    transport.mockResolvedValue(json(fixture, 401));
    const { response } = await getExecutor("pollinations").execute({
      model: "openai", body: { messages: [{ role: "user", content: "ping" }] }, stream: false,
      credentials: { apiKey },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(fixture);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toBe(nativeUrl);
  });
});
