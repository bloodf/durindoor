import "../translator/registerAll.js";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exchangeTokens, generateAuthData, getProvider, requestDeviceCode, pollForToken } from "../../src/lib/oauth/providers.js";
import { resolveClinepassModels } from "../../open-sse/services/clinepassModels.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { refreshTokenByProvider } from "../../open-sse/services/tokenRefresh.js";
import { getClinepassUsage } from "../../open-sse/services/usage/clinepass.js";
import { exchangeClinepassCode } from "../../src/lib/oauth/providerParity/clinepass/exchange.js";

vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: async () => ({ logClientRawRequest: vi.fn(), logRawRequest: vi.fn(), logTargetRequest: vi.fn(), logProviderResponse: vi.fn(), logConvertedResponse: vi.fn(), logError: vi.fn() })
}));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(), finishActiveSession: vi.fn(), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}), saveUsageStats: vi.fn(async () => {}) }));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => Response.json(body, init) } }));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: async () => {} }));

const previousDataDir = process.env.DATA_DIR;
const testDataDir = mkdtempSync(join(tmpdir(), "clinepass-parity-"));
process.env.DATA_DIR = testDataDir;
afterAll(() => {
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  rmSync(testDataDir, { recursive: true, force: true });
});

const callback = "http://localhost:20128/callback";
const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.sig";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("ClinePass production contracts", () => {
  it("creates distinct state and decodes embedded account callbacks without submitting a request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const [a, b] = await Promise.all([generateAuthData("clinepass", callback), generateAuthData("clinepass", callback)]);
    expect(a.state).not.toBe(b.state);
    expect(new URL(a.authUrl).searchParams.get("state")).toBe(a.state);
    expect(a.flowType).toBe("authorization_code");
    const code = Buffer.from(JSON.stringify({ accessToken: jwt, refreshToken: "refresh-a", expiresAt: "2026-01-01T01:00:00Z" })).toString("base64");
    expect(await exchangeTokens("clinepass", code, callback, a.codeVerifier, a.state)).toMatchObject({ accessToken: jwt, refreshToken: "refresh-a", expiresIn: 3600 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exchanges opaque codes once with the bound redirect and proxy selection", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: { accessToken: jwt, refreshToken: "rotated" } }));
    vi.stubGlobal("fetch", fetchMock);
    const proxy = { disableEnvProxy: true, strictProxy: false };
    const result = await exchangeTokens("clinepass", "opaque-code", callback, null, "state", {}, proxy);
    expect(result).toMatchObject({ accessToken: jwt, refreshToken: "rotated" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.cline.bot/api/v1/auth/token");
    expect(init.proxyOptions).toEqual(proxy);
    expect(JSON.parse(init.body)).toEqual({ grant_type: "authorization_code", code: "opaque-code", client_type: "extension", redirect_uri: callback });
  });

  it("refreshes and rejects expired account credentials without leaking rejection bodies", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ data: { accessToken: jwt, refreshToken: "new-refresh", expiresAt: "2026-01-01T00:01:00Z" } })).mockResolvedValueOnce(new Response("synthetic-secret", { status: 401 })).mockResolvedValueOnce(new Response("synthetic-secret", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const refreshed = await refreshTokenByProvider("clinepass", { refreshToken: "old-refresh" }, null);
    expect(refreshed).toMatchObject({ accessToken: `workos:${jwt}`, refreshToken: "new-refresh", expiresIn: 60 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ refreshToken: "old-refresh", grantType: "refresh_token", clientType: "extension" });
    expect(await refreshTokenByProvider("clinepass", { refreshToken: "rejected-refresh" }, null)).toBeNull();
    const usage = await getClinepassUsage(null, "clp_usage");
    expect(JSON.stringify(usage)).not.toContain("synthetic-secret");
  });

  it("binds concurrent sign-ins to their owner and consumes accepted work once", async () => {
    const { POST } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
    const { getProviderConnectionById } = await import("../../src/lib/localDb.js");
    const fetchMock = vi.fn(async (_url, init) => {
      const code = JSON.parse(init.body).code;
      return Response.json({ data: { accessToken: `access-${code}`, refreshToken: `refresh-${code}`, userInfo: { email: `${code}@example.test` } } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const post = (action, body) => POST(new Request(`http://localhost/api/oauth/clinepass/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ provider: "clinepass", action }) });
    const [responseA, responseB] = await Promise.all(["owner-a", "owner-b"].map((ownerId) => post("authorize", { redirectUri: callback, proxyMode: "direct", ownerId })));
    expect(responseA.status).toBe(200);
    expect(responseB.status).toBe(200);
    const [a, b] = await Promise.all([responseA.json(), responseB.json()]);
    const unsupported = await post("import-token", { accessToken: "synthetic" });
    expect(unsupported.status).not.toBe(200);
    const wrong = await post("exchange", { flowId: a.flowId, state: b.state, code: "attacker" });
    expect(wrong.status).not.toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    const [doneA, doneB] = await Promise.all([a, b].map((flow, i) => post("exchange", { flowId: flow.flowId, state: flow.state, code: `code-${i}` })));
    expect(doneA.status).toBe(200);
    expect(doneB.status).toBe(200);
    const [resultA, resultB] = await Promise.all([doneA.json(), doneB.json()]);
    expect(JSON.stringify([resultA, resultB])).not.toContain("refresh-code");
    const [rowA, rowB] = await Promise.all([getProviderConnectionById(resultA.connection.id), getProviderConnectionById(resultB.connection.id)]);
    expect(rowA).toMatchObject({ provider: "clinepass", accessToken: "access-code-0", refreshToken: "refresh-code-0" });
    expect(rowB).toMatchObject({ provider: "clinepass", accessToken: "access-code-1", refreshToken: "refresh-code-1" });
    const replay = await post("exchange", { flowId: a.flowId, state: a.state, code: "code-0" });
    expect(replay.status).not.toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => init.proxyOptions?.disableEnvProxy)).toBe(true);
  });

  it("rejects unsupported device operations before network", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(requestDeviceCode("clinepass")).rejects.toThrow(/does not support device/);
    await expect(pollForToken("clinepass", "fake")).rejects.toThrow(/does not support device/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps concurrent account request credentials and model identities separate", async () => {
    const fetchMock = vi.fn(async () => new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    const executor = new DefaultExecutor("clinepass");
    await Promise.all(["clp_account_a", "clp_account_b"].map((apiKey, i) => executor.execute({ model: `cline-pass/model-${i}`, body: { model: `cline-pass/model-${i}`, messages: [{ role: "user", content: "hello" }] }, stream: true, credentials: { apiKey } })));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, init]) => init.headers.Authorization)).toEqual(["Bearer clp_account_a", "Bearer clp_account_b"]);
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).model)).toEqual(["cline-pass/model-0", "cline-pass/model-1"]);
  });

  it.each([false, true])("translates upstream SSE for stream=%s without resubmission", async (stream) => {
    const chunk = (delta, finish_reason = null) => `data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", created: 1, model: "cline-pass/model-a", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    const fetchMock = vi.fn(async () => new Response(`${chunk({ role: "assistant", content: "hello" })}${chunk({}, "stop")}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
    const body = { model: "model-a", messages: [{ role: "user", content: "hi" }], stream };
    const result = await handleChatCore({ body, modelInfo: { provider: "clinepass", model: "model-a" }, credentials: { apiKey: "clp_stream" }, clientRawRequest: { endpoint: "/v1/chat/completions", body: structuredClone(body), headers: { accept: stream ? "text/event-stream" : "application/json" } }, log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } });
    expect(result.response.status).toBe(200);
    const output = await result.response.text();
    expect(output).toContain("hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBe(true);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer clp_stream");
  });

  it("aborts timed out catalog attempts and fails closed", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = resolveClinepassModels({ apiKey: "clp_timeout" });
    await vi.advanceTimersByTimeAsync(10000);
    expect(await result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => init.signal.aborted)).toBe(true);
  });

  it("uses the public catalog then the account-specific fallback without sharing credentials", async () => {
    const fetchMock = vi.fn(async (url, init) => String(url).includes("recommended-models") ? Response.json({ clinePass: [] }) : Response.json({ data: [{ id: "cline-pass/model-a" }, { id: "other" }] }));
    vi.stubGlobal("fetch", fetchMock);
    const [a, b] = await Promise.all([resolveClinepassModels({ apiKey: "clp_catalog_a" }), resolveClinepassModels({ apiKey: "clp_catalog_b" })]);
    expect(a).toEqual({ models: [{ id: "model-a", name: "model-a", upstreamModelId: "cline-pass/model-a" }] });
    expect(b).toEqual(a);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/models")).map(([, init]) => init.headers.Authorization)).toEqual(["Bearer clp_catalog_a", "Bearer clp_catalog_b"]);
  });
});

describe("staged registration", () => {
  it("sanitizes an actual provider exchange failure without exposing the response", async () => {
    const fetchMock = vi.fn(async () => new Response("synthetic upstream secret", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = getProvider("clinepass");
    await expect(exchangeClinepassCode(provider.exchangeToken, [provider.config, "opaque-code", callback])).rejects.toThrow(/^ClinePass token exchange failed$/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported modes and sanitizes failures and tokenless responses", async () => {
    const exchange = vi.fn().mockRejectedValue(new Error("synthetic upstream secret"));
    await expect(exchangeClinepassCode(exchange, [], "device")).rejects.toThrow("Unsupported");
    expect(exchange).not.toHaveBeenCalled();
    await expect(exchangeClinepassCode(exchange, [])).rejects.toThrow("ClinePass token exchange failed");
    exchange.mockResolvedValueOnce({});
    await expect(exchangeClinepassCode(exchange, [])).rejects.toThrow("no access token");
    exchange.mockResolvedValueOnce({ access_token: "synthetic" });
    expect(await exchangeClinepassCode(exchange, [])).toEqual({ access_token: "synthetic" });
  });
});
