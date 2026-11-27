import "../translator/registerAll.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const outbound = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init) => ({ status: init?.status || 200, body }) } }));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ createProviderConnection: store.create, getProviderConnectionById: vi.fn(), updateProviderConnection: vi.fn(), getProxyPoolById: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/oauth/utils/server", () => ({ clearCodexSession: vi.fn(), clearXaiSession: vi.fn(), getCodexSessionStatus: vi.fn(), getXaiSessionStatus: vi.fn(), registerCodexSession: vi.fn(), registerXaiSession: vi.fn(), startCodexProxy: vi.fn(), startXaiProxy: vi.fn(), stopCodexProxy: vi.fn(), stopXaiProxy: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: outbound, default: outbound }));

import { clearOAuthFlowsForTests } from "../../src/lib/oauth/flowStore.js";
import { requestDeviceCode, pollForToken } from "../../src/lib/oauth/providers.js";
import { refreshMuseCodeToken } from "../../open-sse/services/museCodeAuth.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest, translateResponse, initState } from "../../open-sse/translator/index.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { normalizeMuseDeviceResponse, normalizeMusePollResponse, assertMuseOAuthAction, postMuseDeviceForm } from "../../src/lib/oauth/providerParity/muse-code/device.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); outbound.mockReset(); store.create.mockReset(); clearOAuthFlowsForTests(); });

describe("Muse Code production device and credential lifecycle", () => {
  it("keeps concurrent device grants, mint credentials and proxies isolated", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const transport = vi.fn(async (url, options) => {
      const params = options.body;
      if (url.includes("authorization")) return json({ device_code: `device-${options.proxyOptions.id}`, user_code: "CODE", expires_in: 600 });
      return json({ access_token: `dca:${params.get("device_code")}`, expires_in: 3600 });
    });
    vi.stubGlobal("fetch", transport);
    outbound.mockImplementation(async (_url, init, proxy) => json({ api_key: `key-${proxy.id}` }));
    const proxies = [{ id: "a" }, { id: "b" }];
    const devices = await Promise.all(proxies.map(p => requestDeviceCode("muse-code", null, {}, p)));
    const results = await Promise.all(devices.map((d, i) => pollForToken("muse-code", d.device_code, null, null, proxies[i])));
    expect(results.map(r => r.tokens.accessToken)).toEqual(["key-a", "key-b"]);
    expect(results.map(r => r.tokens.refreshToken)).toEqual(["dca:device-a", "dca:device-b"]);
    expect(outbound.mock.calls.map(([, init, p]) => [init.headers.Authorization, p.id])).toEqual([["Bearer dca:device-a", "a"], ["Bearer dca:device-b", "b"]]);
    const executor = getExecutor("muse-code");
    expect(results.map(r => executor.buildHeaders(r.tokens).Authorization)).toEqual(["Bearer key-a", "Bearer key-b"]);
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it("remints only a stored device credential and preserves its proxy", async () => {
    const proxy = { id: "account-a" };
    outbound.mockResolvedValueOnce(json({ api_key: "new-key" }));
    const result = await refreshMuseCodeToken("dca:a", {}, null, proxy);
    expect(result).toMatchObject({ accessToken: "new-key", refreshToken: "dca:a" });
    expect(outbound.mock.calls[0][2]).toBe(proxy);
    expect(await refreshMuseCodeToken("model-key", {}, null, proxy)).toBeNull();
    expect(outbound).toHaveBeenCalledTimes(1);
  });

  it("fails a rejected mint without exposing the upstream body", async () => {
    outbound.mockResolvedValueOnce(new Response("secret upstream body", { status: 401 }));
    const log = { warn: vi.fn() };
    expect(await refreshMuseCodeToken("dca:synthetic", {}, log)).toBeNull();
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("secret upstream body");
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("dca:synthetic");
    expect(outbound).toHaveBeenCalledTimes(1);
  });
});


describe("Muse Code discovery and Responses requests", () => {
  it("uses each Model API key for its own model discovery", async () => {
    const { fetchConnectionModels } = await import("../../src/app/api/providers/[id]/models/fetchConnectionModels.js");
    outbound.mockImplementation(async () => json({ data: [{ id: "muse-spark-1.3" }] }));
    const results = await Promise.all(["a", "b"].map(id => fetchConnectionModels({ id, provider: "muse-code", apiKey: `key-${id}` })));
    expect(results.map(result => result.models[0].id)).toEqual(["muse-spark-1.3", "muse-spark-1.3"]);
    expect(outbound.mock.calls.map(([url, init]) => [url, init.headers.Authorization])).toEqual([
      ["https://api.meta.ai/v1/models", "Bearer key-a"], ["https://api.meta.ai/v1/models", "Bearer key-b"]
    ]);
  });

  it("translates a chat request, forwards a stream once, and maps usage", async () => {
    const model = "muse-spark-1.3";
    const body = translateRequest(FORMATS.OPENAI, FORMATS.OPENAI_RESPONSES, model, {
      model, messages: [{ role: "user", content: "hello" }]
    }, true, null, "muse-code");
    outbound.mockResolvedValue(new Response('data: {"type":"response.output_text.delta","delta":"hello"}\n\n', { headers: { "Content-Type": "text/event-stream" } }));
    const result = await getExecutor("muse-code").execute({ model, body, stream: true, credentials: { apiKey: "key-a" }, proxyOptions: { disableEnvProxy: true } });
    expect(outbound).toHaveBeenCalledTimes(1);
    expect(outbound.mock.calls[0][0]).toBe("https://api.meta.ai/v1/responses");
    expect(outbound.mock.calls[0][1].headers.Authorization).toBe("Bearer key-a");
    expect(JSON.parse(outbound.mock.calls[0][1].body).input).toBeTruthy();
    expect(await result.response.text()).toContain("response.output_text.delta");
    const chunks = translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, {
      type: "response.completed", response: { id: "response", object: "response", status: "completed", model, output: [], usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 } }
    }, initState(FORMATS.OPENAI_RESPONSES, {}));
    expect(chunks.find(chunk => chunk?.usage)?.usage).toMatchObject({ prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 });
  });
});

describe("Muse Code route with real device service", () => {
  const post = async (action, body, provider = "muse-code") => {
    const { POST } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
    return POST({ json: async () => body }, { params: Promise.resolve({ provider, action }) });
  };

  it("binds a device flow, saves once, and rejects replay before network", async () => {
    const transport = vi.fn(async (url) => url.includes("authorization")
      ? json({ device_code: "private-device", user_code: "CODE", verification_uri: "https://auth.meta.com/device", expires_in: 600 })
      : json({ access_token: "dca:private" }));
    vi.stubGlobal("fetch", transport);
    outbound.mockResolvedValue(json({ api_key: "private-key" }));
    store.create.mockImplementation(async data => ({ id: "connection", ...data }));
    const started = await post("device-code", { proxyMode: "direct", ownerId: "owner-a" });
    expect(started.status).toBe(200);
    expect(JSON.stringify(started.body)).not.toContain("private-device");
    expect(transport.mock.calls[0][1].body.has("code_challenge")).toBe(false);
    const accepted = await post("poll", { flowId: started.body.flowId });
    expect(accepted.body.success).toBe(true);
    expect(JSON.stringify(accepted.body)).not.toMatch(/private-device|dca:private|private-key/);
    expect(store.create).toHaveBeenCalledTimes(1);
    expect((await post("poll", { flowId: started.body.flowId })).status).toBe(410);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(outbound).toHaveBeenCalledTimes(1);
  });

  it("releases a pending poll and prevents simultaneous submissions", async () => {
    let release;
    const transport = vi.fn(async url => {
      if (url.includes("authorization")) return json({ device_code: "device", user_code: "CODE", expires_in: 600 });
      return new Promise(resolve => { release = resolve; });
    });
    vi.stubGlobal("fetch", transport);
    const started = await post("device-code", { proxyMode: "direct" });
    const first = post("poll", { flowId: started.body.flowId });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    expect((await post("poll", { flowId: started.body.flowId })).status).toBe(409);
    release(json({ error: "authorization_pending" }, 400));
    expect((await first).body).toMatchObject({ pending: true, error: "authorization_pending" });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("consumes an expired-token response without minting", async () => {
    const transport = vi.fn(async url => url.includes("authorization")
      ? json({ device_code: "device", user_code: "CODE", expires_in: 600 })
      : json({ error: "expired_token" }, 400));
    vi.stubGlobal("fetch", transport);
    const started = await post("device-code", { proxyMode: "direct" });
    expect((await post("poll", { flowId: started.body.flowId })).body).toMatchObject({ error: "expired_token", pending: false });
    expect((await post("poll", { flowId: started.body.flowId })).status).toBe(410);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(outbound).not.toHaveBeenCalled();
  });

  it("expires a device flow without another submission", async () => {
    vi.useFakeTimers();
    const transport = vi.fn(async () => json({ device_code: "device", user_code: "CODE", expires_in: 1 }));
    vi.stubGlobal("fetch", transport);
    const started = await post("device-code", { proxyMode: "direct" });
    vi.advanceTimersByTime(1001);
    expect((await post("poll", { flowId: started.body.flowId })).status).toBe(410);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("rejects a different provider before network", async () => {
    const transport = vi.fn(async () => json({ device_code: "device", user_code: "CODE", expires_in: 600 }));
    vi.stubGlobal("fetch", transport);
    const started = await post("device-code", { proxyMode: "direct" });
    expect((await post("poll", { flowId: started.body.flowId }, "github")).status).toBe(400);
    expect(transport).toHaveBeenCalledTimes(1);
  });
});

describe("staged device-response validation (not registered)", () => {
  it("accepts Meta links and rejects hostile links and unbounded expiry", () => {
    const data = { device_code: "d", user_code: "u", verification_uri: "https://auth.meta.com/device", expires_in: 600 };
    expect(normalizeMuseDeviceResponse(data)).toMatchObject({ interval: 5, device_code: "d" });
    expect(() => normalizeMuseDeviceResponse({ ...data, verification_uri: "https://evil.example/" })).toThrow("invalid authorization URL");
    expect(() => normalizeMuseDeviceResponse({ ...data, expires_in: 86401 })).toThrow("invalid device code expiry");
  });
  it("rejects unsupported OAuth actions before dispatch", () => {
    expect(() => assertMuseOAuthAction("device-code")).not.toThrow();
    for (const mode of ["authorize", "exchange", "import-token", "manual-code"]) expect(() => assertMuseOAuthAction(mode)).toThrow("device authorization only");
  });
  it("bounds the staged transport and sanitizes abort and network failures", async () => {
    const controller = new AbortController();
    const transport = vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("secret")))));
    vi.stubGlobal("fetch", transport);
    const pending = postMuseDeviceForm("https://auth.meta.com/token", { client_id: "client" }, { id: "proxy" }, controller.signal);
    controller.abort();
    expect(await pending).toEqual({ ok: false, data: { error: "network_error" } });
    expect(transport.mock.calls[0][1]).toMatchObject({ redirect: "error", proxyOptions: { id: "proxy" } });
  });
  it("whitelists poll results and never returns upstream diagnostics", () => {
    expect(normalizeMusePollResponse({ error: "expired_token", error_description: "secret" }, false)).toEqual({ error: "expired_token", error_description: "Device code expired." });
    expect(normalizeMusePollResponse({ error: "secret" }, false)).toEqual({ error: "invalid_response" });
    expect(normalizeMusePollResponse({ access_token: " dca:a ", extra: "secret" }, true)).toEqual({ access_token: "dca:a" });
  });
});
