import { afterEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";

// Closed transport: the production executor performs both request steps.
vi.mock("open-sse/utils/proxyFetch.js", () => ({}));
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init) => Response.json(body, init) } }));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ createProviderConnection: mocks.create, getProviderConnectionById: vi.fn(), updateProviderConnection: vi.fn(), getProxyPoolById: vi.fn() }));
vi.mock("open", () => ({ default: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("../../open-sse/handlers/chatCore/proxyTimeline.js", () => ({ startTrace: vi.fn(), record: vi.fn(), finishTrace: vi.fn() }));


afterEach(() => vi.unstubAllGlobals());

describe("Trae concurrent imported sessions", () => {
  it("keeps account identity and route on both calls without repeating accepted sessions", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, options) => {
      calls.push({ url: String(url), ...options });
      const token = options.headers.Authorization.split(" ")[1];
      if (String(url).endsWith("/chat_sessions")) {
        return Response.json({ code: 0, data: { chat_session_id: token, message_id: token } });
      }
      return new Response('event: done\ndata: {}\n\n', { headers: { "Content-Type": "text/event-stream" } });
    }));
    const { TraeExecutor } = await import("../../open-sse/executors/trae.js");
    const executor = new TraeExecutor();
    await Promise.all(["one", "two"].map((id) => executor.execute({
      model: "auto", body: { messages: [{ role: "user", content: id }] }, stream: false,
      credentials: { accessToken: `synthetic-${id}`, providerSpecificData: { webId: id, userRegion: id } },
      proxyOptions: { connectionProxyEnabled: true, proxyPoolId: `proxy-${id}` }
    })));
    expect(calls).toHaveLength(4);
    for (const id of ["one", "two"]) {
      const own = calls.filter((call) => call.headers.Authorization === `Cloud-IDE-JWT synthetic-${id}`);
      expect(own).toHaveLength(2);
      expect(own.every((call) => call.proxyOptions.proxyPoolId === `proxy-${id}`)).toBe(true);
      const create = own.find((call) => call.url.endsWith("/chat_sessions"));
      expect(JSON.parse(JSON.parse(create.body).initial_message.common_params).web_id).toBe(id);
      expect(own.find((call) => call.url.includes("/events")).url).toContain(`synthetic-${id}`);
    }
  });
});

describe("production Trae import and catalog", () => {
  it("imports synthetic credentials without returning them and rejects device initiation before fetch", async () => {
    const fetchMock = vi.fn(() => { throw new Error("unexpected network"); });
    vi.stubGlobal("fetch", fetchMock);
    mocks.create.mockReset().mockResolvedValue({ id: "connection", provider: "trae" });
    const { POST } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
    const call = (action, body) => POST({ json: async () => body }, { params: { provider: "trae", action } });
    const response = await call("import-token", { accessToken: "synthetic-secret", webId: "account", userRegion: "SG" });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain("synthetic-secret");
    expect(mocks.create.mock.calls[0][0]).toMatchObject({ accessToken: "synthetic-secret", refreshToken: null, providerSpecificData: { webId: "account", userRegion: "SG" } });
    const device = await call("device-code", {});
    expect(device.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the static upstream model inventory", async () => {
    const { default: provider } = await import("../../open-sse/providers/registry/trae.js");
    expect(provider.models.map((model) => model.id)).toEqual(["auto", "work", "gemini-3.1-pro", "gemini-3-flash-solo", "minimax-m3", "minimax-m2.7", "kimi-k2.5", "gpt-5.4", "gpt-5.2"]);
  });
});

describe("staged Trae callback integration", () => {
  it("maps callback credentials and requires a claimed one-use, unexpired state", async () => {
    vi.useFakeTimers();
    try {
      const flows = await import("../../src/lib/oauth/flowStore.js");
      const { parseTraeCallback } = await import("../../src/lib/oauth/providerParity/trae/callback.js");
      flows.clearOAuthFlowsForTests();
      const intent = flows.beginOAuthFlowIntent("trae", "owner-one");
      const flow = flows.createOAuthFlow({ provider: "trae", state: "trace-one", intent, ttlMs: 1000 });
      expect(flows.claimOAuthFlow({ state: "wrong", provider: "trae" })).toBeNull();
      const claim = flows.claimOAuthFlow({ state: flow.state, provider: "trae" });
      expect(flows.claimOAuthFlow({ state: flow.state, provider: "trae" })).toBeNull();
      const query = new URLSearchParams({ userJwt: JSON.stringify({ Token: "synthetic-token", RefreshToken: "synthetic-refresh", ClientID: "client-one", TokenExpireAt: 2000000000000 }), userInfo: JSON.stringify({ UserID: "user-one", Region: "SG" }), host: "https://api-sg.trae.ai" });
      const record = parseTraeCallback(query);
      expect(record).toMatchObject({ accessToken: "synthetic-token", refreshToken: "synthetic-refresh", providerSpecificData: { clientId: "client-one", webId: "user-one", region: "SG", host: "https://api-sg.trae.ai", authMethod: "oauth_callback" } });
      expect(flows.isOAuthFlowClaimActive(claim)).toBe(true);
      expect(flows.consumeOAuthFlow(claim)).toBe(true);
      expect(flows.claimOAuthFlow({ state: flow.state, provider: "trae" })).toBeNull();
      const expired = flows.createOAuthFlow({ provider: "trae", state: "expired", ttlMs: 1000 });
      vi.advanceTimersByTime(1000);
      expect(flows.claimOAuthFlow({ state: expired.state, provider: "trae" })).toBeNull();
      flows.clearOAuthFlowsForTests();
    } finally { vi.useRealTimers(); }
  });

  it("refreshes callback accounts independently and keeps failures and invalid hosts private", async () => {
    const { parseTraeCallback, refreshTraeCallbackCredentials, requireTraeImportMode } = await import("../../src/lib/oauth/providerParity/trae/callback.js");
    expect(() => requireTraeImportMode("device-code")).toThrow("Trae requires session import");
    expect(() => requireTraeImportMode("import-token")).not.toThrow();
    expect(() => parseTraeCallback(new URLSearchParams({ userJwt: '{"Token":"synthetic"}', host: "https://trae.ai.evil.example" }))).toThrow("Invalid Trae callback host");
    const calls = [];
    const fetchImpl = vi.fn(async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return Response.json({ Result: { Token: `new-${JSON.parse(options.body).ClientID}`, TokenExpireAt: 2000000000000 } });
    });
    const accounts = ["one", "two"].map((id) => ({ refreshToken: `refresh-${id}`, providerSpecificData: { authMethod: "oauth_callback", clientId: `client-${id}`, host: `https://${id}.trae.ai` } }));
    const refreshed = await Promise.all(accounts.map((account) => refreshTraeCallbackCredentials(account, { fetchImpl })));
    expect(refreshed.map((item) => item.accessToken)).toEqual(["new-client-one", "new-client-two"]);
    expect(calls).toEqual(accounts.map((account, index) => ({ url: `https://${["one", "two"][index]}.trae.ai/cloudide/api/v3/trae/oauth/ExchangeToken`, body: { ClientID: account.providerSpecificData.clientId, RefreshToken: account.refreshToken, ClientSecret: "-", UserID: "" } })));
    expect(await refreshTraeCallbackCredentials({ refreshToken: "synthetic", providerSpecificData: { authMethod: "imported" } }, { fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await expect(refreshTraeCallbackCredentials({ ...accounts[0], providerSpecificData: { ...accounts[0].providerSpecificData, host: "https://evil.example" } }, { fetchImpl })).rejects.toThrow("Invalid Trae refresh host");
    await expect(refreshTraeCallbackCredentials({ ...accounts[0], providerSpecificData: { ...accounts[0].providerSpecificData, refreshExpireAt: 1 } }, { fetchImpl })).rejects.toThrow("Trae refresh credential expired");
    const rejected = vi.fn(async () => new Response("synthetic-secret-upstream-body", { status: 401 }));
    await expect(refreshTraeCallbackCredentials(accounts[0], { fetchImpl: rejected })).rejects.toThrow(/^Trae token refresh failed$/);
    const abort = new AbortController(); abort.abort();
    await expect(refreshTraeCallbackCredentials(accounts[0], { fetchImpl, signal: abort.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

// Request/stream error contract of the production executor and gateway. No
// staging dependency: these exercise open-sse/executors/trae.js directly.
const SECRET = "synthetic-upstream-secret";
const sse = (frames) => new Response(frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
const session = () => Response.json({ code: 0, data: { chat_session_id: "s", message_id: "m" } });
function traeTransport(create, events = () => sse([["done", {}]])) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
    calls.push(String(url));
    if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
    return String(url).endsWith("/chat_sessions") ? create() : events();
  }));
  return calls;
}
const run = async (stream, signal) => {
  const { TraeExecutor } = await import("../../open-sse/executors/trae.js");
  return new TraeExecutor().execute({ model: "auto", stream, signal, body: { messages: [{ role: "user", content: "hi" }] }, credentials: { accessToken: "synthetic-jwt" } });
};

describe("Trae request error exposure", () => {
  it.each([
    [401, 401, /re-import/],
    [403, 403, /re-import/],
    [429, 429, /rate limit or quota/],
    [500, 502, /^Trae request failed$/]
  ])("keeps create-session HTTP %i typed as %i without upstream text", async (upstream, status, message) => {
    const calls = traeTransport(() => new Response(`${SECRET} synthetic-jwt`, { status: upstream, headers: { "Retry-After": "7" } }));
    const { response } = await run(false);
    expect(response.status).toBe(status);
    if (status === 429) expect(response.headers.get("retry-after")).toBe("7");
    const text = await response.text();
    expect(JSON.parse(text).error.message).toMatch(message);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("synthetic-jwt");
    expect(calls).toHaveLength(1);
  });

  it("hides rejected create payloads and provider error events in both response modes", async () => {
    traeTransport(() => Response.json({ code: 1001, message: SECRET }));
    const rejected = await run(false);
    expect(rejected.response.status).toBe(502);
    expect(await rejected.response.text()).not.toContain(SECRET);

    traeTransport(session, () => sse([["error", { code: 4001, message: SECRET }]]));
    const json = await run(false);
    const jsonText = await json.response.text();
    expect(json.response.status).toBe(502);
    expect(JSON.parse(jsonText).error.message).toBe("Trae request failed (code 4001)");
    expect(jsonText).not.toContain(SECRET);

    traeTransport(session, () => sse([["error", { code: `${SECRET} x`, message: SECRET }]]));
    const streamed = await (await run(true)).response.text();
    expect(streamed).toContain('"message":"Trae request failed"');
    expect(streamed).not.toContain(SECRET);
    expect(streamed.trim().endsWith("data: [DONE]")).toBe(true);
  });

  it("types an events-stream rejection and never echoes its body", async () => {
    const calls = traeTransport(session, () => new Response(SECRET, { status: 401 }));
    const json = await run(false);
    expect(json.response.status).toBe(401);
    expect(await json.response.text()).not.toContain(SECRET);
    traeTransport(session, () => new Response(SECRET, { status: 429 }));
    const streamed = await (await run(true)).response.text();
    expect(streamed).toContain('"code":"429"');
    expect(streamed).not.toContain(SECRET);
    expect(calls).toHaveLength(2);
  });

  it("propagates a caller abort before any session is submitted", async () => {
    const calls = traeTransport(session);
    const abort = new AbortController();
    abort.abort();
    await expect(run(false, abort.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(calls.length).toBeLessThanOrEqual(1);
  });

  it("serves success and typed auth failures through the real chat gateway", async () => {
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const call = (stream) => {
      const body = { model: "trae/auto", messages: [{ role: "user", content: "hi" }], stream };
      return handleChatCore({ body, modelInfo: { provider: "trae", model: "auto" }, credentials: { id: "trae-a", accessToken: "synthetic-jwt", authType: "oauth", providerSpecificData: {} }, clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: {} }, connectionId: "trae-a", log, rtkEnabled: false, headroomEnabled: false, compressionEnabled: false });
    };
    traeTransport(session, () => sse([["plan_item", { id: "p", thought: "Hello" }], ["done", {}]]));
    for (const stream of [false, true]) {
      const ok = await call(stream);
      expect(ok.response.status).toBe(200);
      expect(await ok.response.text()).toContain("Hello");
    }
    traeTransport(() => new Response(`${SECRET} synthetic-jwt`, { status: 401 }));
    const denied = await call(false);
    expect(denied.response.status).toBe(401);
    const deniedText = await denied.response.text();
    expect(deniedText).not.toContain(SECRET);
    expect(deniedText).not.toContain("synthetic-jwt");
  });
});
