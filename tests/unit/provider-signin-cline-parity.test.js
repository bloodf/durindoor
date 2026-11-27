import { afterEach, describe, expect, it, vi } from "vitest";
import { exchangeTokens, generateAuthData, requestDeviceCode } from "../../src/lib/oauth/providers.js";
import { refreshTokenByProvider } from "../../open-sse/services/tokenRefresh.js";
import { applyClineTaskIdentity } from "../../src/lib/oauth/providerParity/cline/headers.js";
import { validateClineTokens, clineExchangeFailure } from "../../src/lib/oauth/providerParity/cline/exchange.js";

const routeMocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("open", () => ({ default: vi.fn() }));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ createProviderConnection: routeMocks.create, getProviderConnectionById: vi.fn(), updateProviderConnection: vi.fn(), getProxyPoolById: vi.fn() }));

const callback = "http://localhost:20128/callback";
const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe.each(["cline", "clinepass"])("%s production contracts", (provider) => {
  it("creates a state-bound callback and decodes embedded credentials without transport", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
    const auth = await generateAuthData(provider, callback);
    const url = new URL(auth.authUrl);
    expect(url.searchParams.get("state")).toBe(auth.state);
    expect(url.searchParams.get("callback_url")).toBe(callback);
    expect(url.searchParams.has("code_challenge")).toBe(false);
    const code = Buffer.from(JSON.stringify({ accessToken: jwt, refreshToken: "refresh-test", expiresAt: "2030-01-01T01:00:00Z" })).toString("base64");
    await expect(exchangeTokens(provider, code, callback, auth.codeVerifier, auth.state)).resolves.toMatchObject({ accessToken: jwt, refreshToken: "refresh-test", expiresIn: 3600 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exchanges an opaque code once and keeps the redirect bound to the flow", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: { accessToken: jwt, refreshToken: "new-refresh" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await exchangeTokens(provider, "opaque-code", callback, null, "state");
    expect(result).toMatchObject({ accessToken: jwt, refreshToken: "new-refresh" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.cline.bot/api/v1/auth/token");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ code: "opaque-code", redirect_uri: callback, client_type: "extension" });
  });

  it("rejects unsupported device sign-in before transport", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestDeviceCode(provider)).rejects.toThrow("does not support device code flow");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Cline refresh identity", () => {
  it("keeps concurrent accounts distinct and does not repeat accepted requests", async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      const { refreshToken } = JSON.parse(init.body);
      return Response.json({ accessToken: jwt, refreshToken: `${refreshToken}-rotated` });
    });
    vi.stubGlobal("fetch", fetchMock);
    const [a, b] = await Promise.all([
      refreshTokenByProvider("cline", { refreshToken: "account-a" }, null),
      refreshTokenByProvider("clinepass", { refreshToken: "account-b" }, null)
    ]);
    expect([a.refreshToken, b.refreshToken]).toEqual(["account-a-rotated", "account-b-rotated"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns no credential on rejected refresh without exposing its body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("secret-upstream-body", { status: 401 })));
    const log = { error: vi.fn() };
    expect(await refreshTokenByProvider("cline", { refreshToken: "rejected" }, log)).toBeNull();
    expect(JSON.stringify(log.error.mock.calls)).not.toContain("secret-upstream-body");
  });
});

describe("staged web integration", () => {
  it("keeps only safe caller task identity after header layering", () => {
    expect(applyClineTaskIdentity({ "x-task-id": "stored" }, { "X-Task-ID": "task-a" })).toEqual({ "X-Task-ID": "task-a" });
    expect(applyClineTaskIdentity({ "X-Task-ID": "stored" }, { "x-task-id": "bad\r\nvalue" })).toEqual({});
  });

  it("rejects tokenless exchanges and provides a body-free error", () => {
    expect(() => validateClineTokens({})).toThrow("Cline token exchange failed");
    expect(validateClineTokens({ access_token: jwt }).access_token).toBe(jwt);
    expect(clineExchangeFailure().message).toBe("Cline token exchange failed");
  });
});

describe("Cline catalog and requests", () => {
  it("uses the ClinePass public tier and preserves its wire namespace", async () => {
    const { resolveClinepassModels } = await import("../../open-sse/services/clinepassModels.js");
    const fetchMock = vi.fn(async () => Response.json({ clinePass: [{ id: "cline-pass/example", name: "Example" }], free: [{ id: "cline-free/other" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const catalog = await resolveClinepassModels({ accessToken: jwt });
    expect(catalog.models).toEqual([{ id: "example", name: "Example", upstreamModelId: "cline-pass/example" }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it.each(["cline", "clinepass"])("keeps concurrent %s request credentials separate", async (provider) => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      calls.push({ url, init });
      return new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
    }));
    const executor = new DefaultExecutor(provider);
    const model = provider === "clinepass" ? "cline-pass/example" : "example/model";
    await Promise.all(["clp_account_a", "clp_account_b"].map((apiKey) => executor.execute({ model, body: { model, messages: [{ role: "user", content: "hello" }] }, stream: true, credentials: { apiKey } })));
    expect(calls).toHaveLength(2);
    expect(calls.map(({ init }) => init.headers.Authorization).sort()).toEqual(["Bearer clp_account_a", "Bearer clp_account_b"]);
    expect(calls.every(({ init }) => JSON.parse(init.body).model === model)).toBe(true);
  });
});

describe.each(["cline", "clinepass"])("%s OAuth route ownership", (provider) => {
  it("rejects mismatched state and consumes a completed flow exactly once", async () => {
    const { clearOAuthFlowsForTests } = await import("../../src/lib/oauth/flowStore.js");
    const { GET, POST } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
    clearOAuthFlowsForTests();
    routeMocks.create.mockReset().mockImplementation(async (data, options) => {
      expect(options.shouldCommit()).toBe(true);
      return { id: "connection-test", ...data };
    });
    const params = (action) => ({ params: Promise.resolve({ provider, action }) });
    const start = await GET(new Request(`http://localhost/api/oauth/${provider}/authorize?redirect_uri=${encodeURIComponent(callback)}`), params("authorize"));
    const flow = await start.json();
    const code = Buffer.from(JSON.stringify({ accessToken: jwt, refreshToken: "refresh-route" })).toString("base64");
    const exchange = (state) => POST(new Request(`http://localhost/api/oauth/${provider}/exchange`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, state, flowId: flow.flowId }) }), params("exchange"));
    const fetchMock = vi.fn(() => { throw new Error("unexpected transport"); });
    vi.stubGlobal("fetch", fetchMock);
    expect((await exchange("wrong-state")).status).toBe(400);
    expect(routeMocks.create).not.toHaveBeenCalled();
    const result = await exchange(flow.state);
    expect(result.status).toBe(200);
    expect(JSON.stringify(await result.json())).not.toContain(jwt);
    expect((await exchange(flow.state)).status).toBe(410);
    expect(routeMocks.create).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    clearOAuthFlowsForTests();
  });
});

// --- Retry additions: selected-proxy identity, deadlines/cancellation, request and stream translation. ---
// These use production modules only; transports are replaced through proxyFetch's test seams or a stubbed fetch.

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({
    logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(),
    logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn()
  })
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(),
  appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}), saveUsageStats: vi.fn(async () => {})
}));

const CHAT_URL = "https://api.cline.bot/api/v1/chat/completions";
const PROXY_A = "http://proxy-a.invalid:8080";
const PROXY_B = "http://proxy-b.invalid:8080";
const sseChunk = (delta, finish_reason = null) => `data: ${JSON.stringify({
  id: "chatcmpl-parity", object: "chat.completion.chunk", created: 1, model: "m",
  choices: [{ index: 0, delta, finish_reason }]
})}\n\n`;
const clineSse = () => new Response(`${sseChunk({ role: "assistant", content: "OK" })}${sseChunk({}, "stop")}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
const quietLog = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const proxyFor = (url) => ({ connectionProxyEnabled: true, connectionProxyUrl: url, strictProxy: true });

/** Route proxied sends through a recording transport keyed by the selected dispatcher identity. */
async function installProxyTransport(respond) {
  const seam = await import("../../open-sse/utils/proxyFetch.js");
  const dispatchers = new Map([[PROXY_A, { route: "a" }], [PROXY_B, { route: "b" }]]);
  for (const [url, dispatcher] of dispatchers) seam.__setProxyDispatcherForTesting(url, dispatcher);
  const seen = [];
  const restore = seam.__setOriginalFetchForTesting(async (url, init) => {
    const route = [...dispatchers.values()].find((d) => d === init.dispatcher)?.route ?? "direct";
    seen.push({ url: String(url), route, init });
    return respond(url, init, route);
  });
  // Any send that bypasses the connection route would reach this stub instead.
  const direct = vi.fn(() => { throw new Error("direct egress"); });
  vi.stubGlobal("fetch", direct);
  return { seen, direct, cleanup: () => { restore(); seam.__clearProxyDispatchersForTesting(); } };
}

describe("selected-proxy identity", () => {
  it.each(["cline", "clinepass"])("binds each concurrent %s request to its own connection proxy and token", async (provider) => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const transport = await installProxyTransport(async (_url, init, route) => {
      // Finish account B first so ordering cannot hide a cross-wired request.
      if (route === "a") await new Promise((resolve) => setTimeout(resolve, 5));
      return clineSse();
    });
    try {
      const executor = new DefaultExecutor(provider);
      const model = provider === "clinepass" ? "cline-pass/example" : "example/model";
      const run = (apiKey, proxy) => executor.execute({ model, body: { model, messages: [{ role: "user", content: "hi" }] }, stream: true, credentials: { apiKey }, proxyOptions: proxyFor(proxy) });
      await Promise.all([run("clp_account_a", PROXY_A), run("clp_account_b", PROXY_B)]);
      expect(transport.direct).not.toHaveBeenCalled();
      const byRoute = Object.fromEntries(transport.seen.map(({ route, init }) => [route, init.headers.Authorization]));
      expect(byRoute).toEqual({ a: "Bearer clp_account_a", b: "Bearer clp_account_b" });
      expect(transport.seen.every(({ init }) => init.redirect === "error")).toBe(true);
    } finally {
      transport.cleanup();
    }
  });

  it("refreshes concurrent accounts through their own proxies and coalesces a duplicate refresh", async () => {
    const transport = await installProxyTransport(async (_url, init, route) => {
      const { refreshToken } = JSON.parse(init.body);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json({ data: { accessToken: `access-${route}`, refreshToken: `${refreshToken}-rotated` } });
    });
    try {
      const [a, aAgain, b] = await Promise.all([
        refreshTokenByProvider("cline", { refreshToken: "proxy-account-a" }, null, proxyFor(PROXY_A)),
        refreshTokenByProvider("cline", { refreshToken: "proxy-account-a" }, null, proxyFor(PROXY_A)),
        refreshTokenByProvider("clinepass", { refreshToken: "proxy-account-b" }, null, proxyFor(PROXY_B))
      ]);
      expect(a).toEqual(aAgain);
      // Opaque (non-JWT) access tokens are stored as issued; only JWT-shaped tokens gain the workos: prefix.
      expect(a).toMatchObject({ accessToken: "access-a", refreshToken: "proxy-account-a-rotated" });
      expect(b).toMatchObject({ accessToken: "access-b", refreshToken: "proxy-account-b-rotated" });
      expect(transport.seen.map(({ route, init }) => [route, JSON.parse(init.body).refreshToken]).sort()).toEqual([["a", "proxy-account-a"], ["b", "proxy-account-b"]]);
      expect(transport.direct).not.toHaveBeenCalled();
    } finally {
      transport.cleanup();
    }
  });

  it("fails a strict connection without a usable proxy before any network send", async () => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const transport = await installProxyTransport(() => { throw new Error("unexpected send"); });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const model = "cline-pass/example";
      const outcome = new DefaultExecutor("clinepass").execute({ model, body: { model, messages: [] }, stream: true, credentials: { apiKey: "clp_strict" }, proxyOptions: { strictProxy: true } })
        .then(() => null, (error) => error);
      // The executor's network-error retry delays run on the fake clock; none of them reaches a transport.
      await vi.advanceTimersByTimeAsync(60_000);
      expect((await outcome)?.message).toContain("strictProxy=true");
      expect(transport.seen).toHaveLength(0);
      expect(transport.direct).not.toHaveBeenCalled();
    } finally {
      transport.cleanup();
    }
  });

  it("forwards each opaque-code exchange's own proxy options to the patched fetch boundary", async () => {
    const fetchMock = vi.fn(async (_url, init) => Response.json({ data: { accessToken: jwt, refreshToken: `refresh-${init.proxyOptions.connectionProxyUrl}` } }));
    vi.stubGlobal("fetch", fetchMock);
    await Promise.all([
      exchangeTokens("cline", "opaque-a", callback, null, "state-a", null, proxyFor(PROXY_A)),
      exchangeTokens("clinepass", "opaque-b", callback, null, "state-b", null, proxyFor(PROXY_B))
    ]);
    const sent = fetchMock.mock.calls.map(([, init]) => [JSON.parse(init.body).code, init.proxyOptions.connectionProxyUrl]).sort();
    expect(sent).toEqual([["opaque-a", PROXY_A], ["opaque-b", PROXY_B]]);
  });
});

describe("deadlines and cancellation", () => {
  it("rejects a cancelled sign-in exchange before transport", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(exchangeTokens("cline", "opaque-code", callback, null, "state", null, null, controller.signal)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["cline", "clinepass"])("does not dispatch an already-cancelled %s request", async (provider) => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(new DefaultExecutor(provider).execute({ model: "m", body: { model: "m", messages: [] }, stream: true, credentials: { apiKey: "clp_cancelled" }, signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates a caller abort during an in-flight request without retrying", async () => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const controller = new AbortController();
    const fetchMock = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      queueMicrotask(() => controller.abort());
    }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new DefaultExecutor("clinepass").execute({ model: "m", body: { model: "m", messages: [] }, stream: true, credentials: { apiKey: "clp_inflight" }, signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError", errorKind: "aborted" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ends a stalled upstream at the header deadline with a single dispatch", async () => {
    const { DefaultExecutor } = await import("../../open-sse/executors/default.js");
    const { FETCH_CONNECT_TIMEOUT_MS } = await import("../../open-sse/config/runtimeConfig.js");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fetchMock = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = new DefaultExecutor("cline").execute({ model: "m", body: { model: "m", messages: [] }, stream: true, credentials: { apiKey: "clp_stalled" } });
    const outcome = pending.then(() => null, (error) => error);
    await vi.advanceTimersByTimeAsync(FETCH_CONNECT_TIMEOUT_MS + 1);
    const error = await outcome;
    expect(error).toMatchObject({ errorKind: "connect_timeout" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("request and stream translation through chatCore", () => {
  const chatCore = async () => (await import("../../open-sse/handlers/chatCore.js")).handleChatCore;
  const claudeBody = (stream) => ({ model: "glm-5.3", max_tokens: 64, stream, system: "be brief", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }] });

  it("translates an Anthropic Messages client to the forced-stream OpenAI wire and back to a JSON message", async () => {
    await import("../translator/registerAll.js");
    const upstream = vi.fn(async (url) => String(url) === CHAT_URL ? clineSse() : Promise.reject(new Error(`unexpected fetch: ${url}`)));
    vi.stubGlobal("fetch", upstream);
    const body = claudeBody(false);
    const result = await (await chatCore())({
      body, modelInfo: { provider: "clinepass", model: "glm-5.3" }, credentials: { apiKey: "clp_translate" },
      clientRawRequest: { endpoint: "/v1/messages", body: structuredClone(body), headers: { accept: "application/json" } },
      log: quietLog()
    });
    expect(result.response.status, await result.response.clone().text()).toBe(200);
    const message = await result.response.json();
    expect(message.type).toBe("message");
    expect(message.content.find((block) => block.type === "text")?.text).toBe("OK");
    const chatCalls = upstream.mock.calls.filter(([url]) => String(url) === CHAT_URL);
    expect(chatCalls).toHaveLength(1);
    const wire = JSON.parse(chatCalls[0][1].body);
    expect(wire.stream).toBe(true);
    expect(wire.model).toBe("cline-pass/glm-5.3");
    expect(wire.messages[0]).toMatchObject({ role: "system" });
    expect(wire.messages.at(-1)).toMatchObject({ role: "user" });
    expect(wire.system).toBeUndefined();
  });

  it("streams Anthropic events to a streaming Messages client from Cline SSE", async () => {
    await import("../translator/registerAll.js");
    const upstream = vi.fn(async (url) => String(url) === CHAT_URL ? clineSse() : Promise.reject(new Error(`unexpected fetch: ${url}`)));
    vi.stubGlobal("fetch", upstream);
    const body = claudeBody(true);
    const result = await (await chatCore())({
      body, modelInfo: { provider: "cline", model: "anthropic/claude-sonnet-4.6" }, credentials: { apiKey: "clp_stream" },
      clientRawRequest: { endpoint: "/v1/messages", body: structuredClone(body), headers: { accept: "text/event-stream" } },
      log: quietLog()
    });
    expect(result.response.status).toBe(200);
    const text = await result.response.text();
    expect(text).toContain("event: message_start");
    expect(text).toContain('"text":"OK"');
    expect(text).toContain("event: message_stop");
    expect(text).not.toContain("[DONE]");
    expect(upstream.mock.calls.filter(([url]) => String(url) === CHAT_URL)).toHaveLength(1);
  });

  it("does not resubmit after Cline accepted a stream that later fails", async () => {
    await import("../translator/registerAll.js");
    const upstream = vi.fn(async (url) => {
      if (String(url) !== CHAT_URL) throw new Error(`unexpected fetch: ${url}`);
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(sseChunk({ role: "assistant", content: "partial" })));
          controller.error(new Error("upstream reset secret-upstream-body"));
        }
      }), { headers: { "content-type": "text/event-stream" } });
    });
    vi.stubGlobal("fetch", upstream);
    const body = { model: "glm-5.3", messages: [{ role: "user", content: "hi" }], stream: true };
    const result = await (await chatCore())({
      body, modelInfo: { provider: "clinepass", model: "glm-5.3" }, credentials: { apiKey: "clp_reset" },
      clientRawRequest: { endpoint: "/v1/chat/completions", body: structuredClone(body), headers: { accept: "text/event-stream" } },
      log: quietLog()
    });
    const text = await result.response.text().catch(() => "");
    expect(text).not.toContain("secret-upstream-body");
    expect(text).not.toContain("clp_reset");
    expect(upstream.mock.calls.filter(([url]) => String(url) === CHAT_URL)).toHaveLength(1);
  });
});
