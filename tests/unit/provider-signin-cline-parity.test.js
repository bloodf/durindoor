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
