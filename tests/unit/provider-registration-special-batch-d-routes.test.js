// Registration batch D (#2034), route level: the OAuth route, the connection test and the key
// probe reach the registered providers. The production provider table and sign-in services are
// real; only the database writes and the outbound network are closed fakes.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProviderConnection: vi.fn(),
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

// The proxy-aware transport is the closed global fetch below.
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (url, init) => globalThis.fetch(url, init) }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (url, init) => globalThis.fetch(url, init) }));
vi.mock("next/server", () => ({
  NextResponse: { json: (body, init) => ({ status: init?.status || 200, body, json: async () => body }) },
}));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: vi.fn(async () => {}) }));
vi.mock("@/models", () => ({
  createProviderConnection: mocks.createProviderConnection,
  getProxyPoolById: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({ connectionProxyEnabled: false, connectionProxyUrl: "", vercelRelayUrl: "" })),
}));
vi.mock("@/lib/network/proxyTest", () => ({ testProxyUrl: vi.fn() }));

import { claimOAuthFlow, clearOAuthFlowsForTests } from "@/lib/oauth/flowStore.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { testSingleConnection } from "../../src/app/api/providers/[id]/test/testUtils.js";
import { normalizeDevinSessionToken } from "../../src/lib/oauth/services/devin-desktop.js";

const post = async (provider, action, body) => {
  const { POST } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
  return POST({ json: async () => body }, { params: Promise.resolve({ provider, action }) });
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  clearOAuthFlowsForTests();
  vi.clearAllMocks();
  mocks.createProviderConnection.mockImplementation(async (data) => ({ id: "connection-1", ...data }));
  mocks.updateProviderConnection.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe("registration batch D: OAuth route", () => {
  it("binds the Devin Desktop loopback redirect to the flow, then imports a pasted token as a guarded connection", async () => {
    const started = await post("devin-desktop", "authorize", { redirectUri: "https://dashboard.invalid/callback", proxyMode: "direct" });
    expect(started.status).toBe(200);
    expect(new URL(started.body.authUrl).searchParams.get("redirect_uri")).toBe("http://127.0.0.1:59653/callback");
    const flow = claimOAuthFlow({ flowId: started.body.flowId, provider: "devin-desktop" });
    expect(flow.payload.redirectUri).toBe("http://127.0.0.1:59653/callback");

    // devin-cli keeps its import-only behavior.
    const cli = await post("devin-cli", "authorize", { redirectUri: "https://dashboard.invalid/callback", proxyMode: "direct" });
    expect(cli.status).toBe(400);
    expect(cli.body.error).toMatch(/import-token/);

    const token = "devin-session-token$synthetic-import-0001";
    const imported = await post("devin-desktop", "import-token", { accessToken: token });
    expect(imported.status).toBe(200);
    expect(mocks.createProviderConnection).toHaveBeenCalledWith(expect.objectContaining({
      provider: "devin-desktop", authType: "oauth", accessToken: token, expiresAt: null,
    }));
    // The import never turns dispatch on.
    expect(mocks.createProviderConnection.mock.calls[0][0].providerSpecificData?.enableSessionDispatch).toBeUndefined();
    // A bare key stays verbatim (no prefix added); too-short pastes are refused.
    await post("devin-desktop", "import-token", { accessToken: "synthetic-api-key-0000002" });
    expect(mocks.createProviderConnection.mock.calls[1][0].accessToken).toBe("synthetic-api-key-0000002");
    expect(normalizeDevinSessionToken("abc")).toBe("devin-session-token$abc");
    expect((await post("devin-desktop", "import-token", { accessToken: "short" })).status).toBe(400);
  });

  it("exchanges the Devin Desktop browser code using the flow's PKCE verifier", async () => {
    const fetchMock = vi.fn(async (url) => {
      if (url !== "https://api.devin.ai/auth/cli/token") throw new Error("Unexpected outbound request");
      return json({ token: "synthetic-browser-session" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const started = await post("devin-desktop", "authorize", { proxyMode: "direct" });
    expect(started.status).toBe(200);
    const completed = await post("devin-desktop", "exchange", {
      flowId: started.body.flowId,
      state: started.body.state,
      code: "eyJsynthetic.browser.code",
    });
    expect(completed.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      code: "eyJsynthetic.browser.code",
      code_verifier: expect.stringMatching(/^[A-Za-z0-9_-]{128}$/),
    });
    expect(mocks.createProviderConnection).toHaveBeenCalledTimes(1);
    const [connection] = mocks.createProviderConnection.mock.calls[0];
    expect(connection).toMatchObject({
      provider: "devin-desktop",
      authType: "oauth",
      accessToken: "devin-session-token$synthetic-browser-session",
      providerSpecificData: { authMethod: "browser" },
    });
    expect(connection.providerSpecificData.enableSessionDispatch).toBeUndefined();
  });

  it("carries the Zed system id and private key through the flow, never to the browser", async () => {
    const started = await post("zed-hosted", "authorize", { redirectUri: "http://127.0.0.1:20128/callback", proxyMode: "direct" });
    expect(started.status).toBe(200);
    const flow = claimOAuthFlow({ flowId: started.body.flowId, provider: "zed-hosted" });
    expect(flow.payload.codeVerifier).toMatch(/^zed-rsa-pkcs1:/);
    expect(flow.payload.redirectUri).toBe("http://127.0.0.1:20128/");
    expect(flow.payload.meta).toEqual({ systemId: expect.any(String) });
    expect(JSON.stringify(started.body)).not.toContain(flow.payload.codeVerifier);
  });

  it("starts WorkBuddy, Freebuff and MiniMax Code through the shared device-code route, on closed mocks", async () => {
    const fetchMock = vi.fn(async (url) => {
      const target = String(url);
      if (target.startsWith("https://www.workbuddy.ai/v2/plugin/auth/state")) return json({ code: 0, data: { state: "wb-state", authUrl: "https://www.workbuddy.ai/login" } });
      if (target === "https://freebuff.com/api/auth/cli/code") return json({ loginUrl: "https://freebuff.com/login", fingerprintHash: "hash", expiresAt: String(Date.now() + 300_000) });
      if (target === "https://account.minimax.cn/oauth2/device/code") return json({ device_code: "mm-code", user_code: "ABCD", verification_uri: "https://account.minimax.cn/device", expires_in: 300, interval: 5 });
      throw new Error(`Unexpected request ${target}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const workbuddy = await post("workbuddy", "device-code", { proxyMode: "direct" });
    expect(workbuddy.body).toMatchObject({ verification_uri: "https://www.workbuddy.ai/login" });
    const freebuff = await post("freebuff", "device-code", { proxyMode: "direct" });
    expect(freebuff.body).toMatchObject({ verification_uri: "https://freebuff.com/login" });
    // The region chosen in the dashboard reaches the account host that issues the device code.
    const minimax = await post("minimax-code", "device-code", { proxyMode: "direct", region: "cn" });
    expect(minimax.body).toMatchObject({ user_code: "ABCD" });

    // Polling WorkBuddy needs no PKCE verifier, and a pending answer is not a failure.
    fetchMock.mockImplementationOnce(async () => json({ code: 11217 }));
    const pending = await post("workbuddy", "poll", { flowId: workbuddy.body.flowId });
    expect(pending.body).toMatchObject({ success: false, pending: true, error: "authorization_pending" });
    expect(mocks.createProviderConnection).not.toHaveBeenCalled();
  });
});

describe("registration batch D: connection test and key probe", () => {
  it.each(["devin-desktop", "freebuff", "zed-hosted"])("tests a stored %s credential locally, without a request", async (provider) => {
    const fetchMock = vi.fn(() => { throw new Error("Unexpected outbound request"); });
    vi.stubGlobal("fetch", fetchMock);
    mocks.getProviderConnectionById.mockResolvedValue({ id: "c1", provider, authType: "oauth", accessToken: "synthetic-token" });
    expect(await testSingleConnection("c1")).toMatchObject({ valid: true, error: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["minimax-code", "workbuddy"])("checks a stored %s token's expiry locally", async (provider) => {
    const fetchMock = vi.fn(() => { throw new Error("Unexpected outbound request"); });
    vi.stubGlobal("fetch", fetchMock);
    mocks.getProviderConnectionById.mockResolvedValue({ id: "c1", provider, authType: "oauth", accessToken: "synthetic-token", expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect(await testSingleConnection("c1")).toMatchObject({ valid: true });
    mocks.getProviderConnectionById.mockResolvedValue({ id: "c1", provider, authType: "oauth", accessToken: "synthetic-token", refreshToken: "synthetic-refresh", expiresAt: new Date(Date.now() - 3_600_000).toISOString() });
    // An expired token is reported, not silently refreshed by a test.
    expect(await testSingleConnection("c1")).toMatchObject({ valid: false, error: "Token expired" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates a Cursor API key with the key exchange, and refuses another prefix before any request", async () => {
    const fetcher = vi.fn(async () => json({ accessToken: "a.b.c", refreshToken: "d.e.f" }));
    expect(await probeRegistryProvider("cursor-api", "crsr_synthetic", fetcher)).toMatchObject({ valid: true });
    expect(fetcher.mock.calls[0][0]).toBe("https://api2.cursor.sh/auth/exchange_user_api_key");
    expect(fetcher.mock.calls[0][1].headers.authorization).toBe("Bearer crsr_synthetic");

    fetcher.mockClear();
    expect(await probeRegistryProvider("cursor-api", "sk-not-a-cursor-key", fetcher)).toMatchObject({ valid: false });
    expect(fetcher).not.toHaveBeenCalled();

    fetcher.mockResolvedValueOnce(new Response("nope", { status: 401 }));
    expect(await probeRegistryProvider("cursor-api", "crsr_revoked", fetcher)).toMatchObject({ valid: false, error: "Invalid API key" });
    fetcher.mockResolvedValueOnce(new Response("down", { status: 503 }));
    expect(await probeRegistryProvider("cursor-api", "crsr_synthetic", fetcher)).toMatchObject({ valid: false, unavailable: true });
  });

  it("validates a Freebuff token with the session probe, never a chat body", async () => {
    const fetcher = vi.fn(async () => json({}, 409));
    expect(await probeRegistryProvider("freebuff", "synthetic-freebuff-token", fetcher)).toMatchObject({ valid: true });
    expect(fetcher.mock.calls[0][0]).toBe("https://www.codebuff.com/api/v1/freebuff/session");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({});
    fetcher.mockResolvedValueOnce(json({}, 401));
    expect(await probeRegistryProvider("freebuff", "synthetic-freebuff-token", fetcher)).toMatchObject({ valid: false, error: "Invalid or expired Freebuff Auth Token" });
    fetcher.mockRejectedValueOnce(new Error("offline"));
    expect(await probeRegistryProvider("freebuff", "synthetic-freebuff-token", fetcher)).toMatchObject({ valid: false, unavailable: true });
  });
});
