// MIT: getkimchi/kimchi b4e3105dc84daa6eb7e8e3834efc0fdb90d96770,
// src/cli-auth/index.ts and src/cli-auth/oauth.ts (distinct login methods).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

const listener = vi.hoisted(() => ({ callbacks: [], close: vi.fn(), save: vi.fn() }));
vi.mock("open", () => ({ default: vi.fn() }));
vi.mock("@/lib/localDb", () => ({
  createProviderConnection: listener.save,
  getProviderConnectionById: vi.fn(), updateProviderConnection: vi.fn(), getProxyPoolById: vi.fn(),
}));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: vi.fn() }));
vi.mock("../../src/lib/oauth/utils/server.js", async (original) => ({
  ...(await original()),
  startLocalServer: vi.fn(async (callback) => {
    listener.callbacks.push(callback);
    return { port: 4321 + listener.callbacks.length, close: listener.close };
  }),
}));
vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "kimchi/offline", updateKimchiUserAgent: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", async (original) => ({ ...(await original()), proxyAwareFetch: vi.fn() }));

import { exchangeTokens, generateAuthData, getProvider, pollForToken, requestDeviceCode } from "../../src/lib/oauth/providers.js";
import { KimchiService } from "../../src/lib/oauth/services/kimchi.js";
import { clearKimchiCatalog, resolveKimchiModels } from "../../open-sse/services/kimchiModels.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import kimchi from "../../open-sse/providers/registry/kimchi.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { beginOAuthFlowIntent, claimOAuthFlow, clearOAuthFlowsForTests, consumeOAuthFlow, createOAuthFlow } from "../../src/lib/oauth/flowStore.js";

beforeEach(() => { clearKimchiCatalog(); clearOAuthFlowsForTests(); proxyAwareFetch.mockReset(); listener.callbacks.length = 0; listener.close.mockReset(); listener.save.mockReset(); });
afterEach(() => { clearOAuthFlowsForTests(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Kimchi production contracts", () => {
  it("creates independent state-bound browser-token URLs without sending PKCE", async () => {
    const [a, b] = await Promise.all([generateAuthData("kimchi", "http://localhost:8080/callback"), generateAuthData("kimchi", "http://localhost:8080/callback")]);
    expect(a.state).not.toBe(b.state);
    expect(a.flowType).toBe("browser_token");
    const url = new URL(a.authUrl);
    expect(url.origin + url.pathname).toBe("https://app.kimchi.dev/cli-auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({ callback: "http://localhost:8080/callback", state: a.state });
  });

  it("keeps two token validations and profiles associated with their proxy selections", async () => {
    const fetch = vi.fn(async (url, init) => url.includes("supported-providers") ? new Response(null, { status: 200 }) : Response.json({ id: init.headers.Authorization.slice(7), username: "fixture" }));
    vi.stubGlobal("fetch", fetch);
    const proxies = [{ proxyUrl: "http://a.test" }, { proxyUrl: "http://b.test" }];
    const results = await Promise.all(proxies.map((proxy, i) => exchangeTokens("kimchi", `token-${i}`, "callback", null, `state-${i}`, {}, proxy)));
    results.forEach((result, i) => {
      expect(result).toMatchObject({ accessToken: `token-${i}`, refreshToken: null, providerSpecificData: { userId: `token-${i}`, authMethod: "browser_token" } });
      expect(fetch.mock.calls.filter(([, init]) => init.proxyOptions === proxies[i] && init.headers.Authorization === `Bearer token-${i}`)).toHaveLength(2);
    });
  });

  it("rejects invalid tokens without disclosing upstream bodies and rejects device flow before transport", async () => {
    const fetch = vi.fn(async () => new Response("private upstream detail", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    await expect(exchangeTokens("kimchi", "synthetic-secret", "callback", null, "state")).rejects.toThrow("Kimchi token validation failed: 401");
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockClear();
    await expect(requestDeviceCode("kimchi")).rejects.toThrow("does not support device code");
    await expect(pollForToken("kimchi", "device")).rejects.toThrow("does not support device code");
    expect(fetch).not.toHaveBeenCalled();
    expect(getProvider("kimchi").deviceFlow).toBeUndefined();
  });

  it("checks callback state before validation and classifies rejected CLI tokens", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const service = new KimchiService();
    await expect(service._handleCallback({ state: "wrong", token: "synthetic" }, "expected")).rejects.toThrow("isn't valid");
    expect(fetch).not.toHaveBeenCalled();
    await expect(service._handleCallback({ state: "expected", token: "synthetic" }, "expected")).rejects.toThrow("invalid or expired");
    await expect(service._handleCallback({ state: "wrong", error: "synthetic-secret" }, "expected")).rejects.toThrow("isn't valid");
    await expect(service._handleCallback({ state: "expected", error: "synthetic-secret" }, "expected")).rejects.toThrow("Kimchi sign-in was rejected");
  });

  it("claims one callback before validation and keeps simultaneous logins independent", async () => {
    vi.useFakeTimers();
    let finish;
    const fetch = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetch);
    const service = new KimchiService();
    const [a, b] = await Promise.all([service.startLogin(), service.startLogin()]);
    expect(new URL(a.authUrl).searchParams.get("callback")).toBe("http://127.0.0.1:4322/callback");
    listener.callbacks[0]({ state: a.state, token: "first" });
    listener.callbacks[0]({ state: a.state, token: "duplicate" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer first");
    finish(new Response(null, { status: 200 }));
    expect(await a.result).toEqual({ token: "first" });
    listener.callbacks[1]({ state: b.state, token: "second" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer second");
    finish(new Response(null, { status: 200 }));
    expect(await b.result).toEqual({ token: "second" });
    await vi.advanceTimersByTimeAsync(0);
    expect(listener.close).toHaveBeenCalledTimes(2);
  });

  it("times out a pending login after five minutes and prevents late submission", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const session = await new KimchiService().startLogin();
    await vi.advanceTimersByTimeAsync(299999);
    expect(listener.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await session.result).toEqual({ error: "Browser login timed out — please try again" });
    listener.callbacks[0]({ state: session.state, token: "late" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("aborts a stalled validation at its deadline and uses the configured profile endpoint", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))));
    vi.stubGlobal("fetch", fetch);
    const service = new KimchiService();
    const validation = service.validateToken("synthetic");
    await vi.advanceTimersByTimeAsync(10000);
    expect(await validation).toEqual({ valid: true }); // Existing fail-open behavior.
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    fetch.mockImplementation(async () => Response.json({ name: "Fixture", email: "fixture@example.test", username: "fixture" }));
    expect(await service.fetchProfile("synthetic")).toEqual({ displayName: "Fixture", email: "fixture@example.test", username: "fixture" });
    expect(fetch.mock.calls[1][0]).toBe("https://app.kimchi.dev/api/v1/me");
  });

  it("binds claims to state and owner and consumes accepted work once", () => {
    const intentA = beginOAuthFlowIntent("kimchi", "owner-a");
    const intentB = beginOAuthFlowIntent("kimchi", "owner-b");
    const a = createOAuthFlow({ provider: "kimchi", state: "state-a", kind: "authorization", intent: intentA, payload: { proxySelection: { mode: "direct" } } });
    const b = createOAuthFlow({ provider: "kimchi", state: "state-b", kind: "authorization", intent: intentB, payload: {} });
    expect(claimOAuthFlow({ provider: "kimchi", flowId: a.flowId, state: b.state })).toBeNull();
    const claim = claimOAuthFlow({ provider: "kimchi", flowId: a.flowId, state: a.state });
    expect(claim.payload.proxySelection).toEqual({ mode: "direct" });
    expect(claimOAuthFlow({ provider: "kimchi", flowId: a.flowId, state: a.state })).toBeNull();
    expect(consumeOAuthFlow(claim)).toBe(true);
    expect(claimOAuthFlow({ provider: "kimchi", flowId: a.flowId, state: a.state })).toBeNull();
    expect(claimOAuthFlow({ provider: "kimchi", flowId: b.flowId, state: b.state })).not.toBeNull();
  });

  it("runs the actual web route through exchange and rejects replay without another submission", async () => {
    const fetch = vi.fn(async (url) => url.includes("supported-providers") ? new Response(null, { status: 200 }) : Response.json({ id: "user-a" }));
    vi.stubGlobal("fetch", fetch);
    listener.save.mockImplementation(async (connection, options) => {
      expect(options.shouldCommit()).toBe(true);
      return { ...connection, id: "connection-a" };
    });
    const { POST } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
    const post = (action, body) => POST(new Request(`http://localhost/api/oauth/kimchi/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ provider: "kimchi", action }) });
    const start = await post("authorize", { ownerId: "owner-a", proxyMode: "direct" });
    expect(start.status).toBe(200);
    const flow = await start.json();
    const exchange = { flowId: flow.flowId, state: flow.state, code: "synthetic-token" };
    const wrong = await post("exchange", { ...exchange, state: "wrong" });
    expect(wrong.status).not.toBe(200);
    expect(fetch).not.toHaveBeenCalled();
    const completed = await post("exchange", exchange);
    expect(completed.status).toBe(200);
    const publicResult = await completed.json();
    expect(JSON.stringify(publicResult)).not.toContain("synthetic-token");
    expect(listener.save).toHaveBeenCalledOnce();
    expect(listener.save.mock.calls[0][0]).toMatchObject({ provider: "kimchi", accessToken: "synthetic-token" });
    expect(fetch).toHaveBeenCalledTimes(2);
    const replay = await post("exchange", exchange);
    expect(replay.status).not.toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("preserves bearer identity and OpenAI request and stream payloads", () => {
    const executor = new DefaultExecutor("kimchi");
    expect(executor.buildHeaders({ accessToken: "first" }, true)).toMatchObject({ Authorization: "Bearer first", Accept: "text/event-stream", "User-Agent": "kimchi/offline" });
    expect(executor.buildHeaders({ apiKey: "second" }, false).Authorization).toBe("Bearer second");
    const body = { model: "kimi-k2.5", messages: [{ role: "user", content: "hello" }], stream: true };
    expect(translateRequest(FORMATS.OPENAI, FORMATS.OPENAI, body.model, body, true, null, "kimchi")).toMatchObject(body);
    const chunk = { id: "fixture", choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }] };
    expect(translateResponse(FORMATS.OPENAI, FORMATS.OPENAI, chunk, {})).toEqual([chunk]);
  });

  it("discovers account-specific catalogs using each token and proxy", async () => {
    proxyAwareFetch.mockImplementation(async (_url, init) => Response.json({ models: [{ slug: init.headers.Authorization.slice(7) }] }));
    const proxies = [{ proxyUrl: "http://a.test" }, { proxyUrl: "http://b.test" }];
    const results = await Promise.all(proxies.map((proxyOptions, i) => resolveKimchiModels({ accessToken: `model-${i}` }, { proxyOptions })));
    results.forEach((result, i) => {
      expect(result.models[0].id).toBe(`model-${i}`);
      expect(proxyAwareFetch.mock.calls[i][2]).toBe(proxies[i]);
    });
    expect(kimchi.transport.format).toBe("openai");
    expect(kimchi.transport.auth).toMatchObject({ header: "Authorization", scheme: "bearer" });
    expect(kimchi.transport.baseUrl).toBe("https://llm.kimchi.dev/openai/v1/chat/completions");
  });
});
