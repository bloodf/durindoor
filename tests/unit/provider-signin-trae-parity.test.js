import { afterEach, describe, expect, it, vi } from "vitest";

// Closed transport: the production executor performs both request steps.
vi.mock("open-sse/utils/proxyFetch.js", () => ({}));
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init) => Response.json(body, init) } }));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ createProviderConnection: mocks.create, getProviderConnectionById: vi.fn(), updateProviderConnection: vi.fn(), getProxyPoolById: vi.fn() }));
vi.mock("open", () => ({ default: vi.fn() }));


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
