import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const previousDataDir = process.env.DATA_DIR;
const oldClientId = process.env.GEMINI_OAUTH_CLIENT_ID;
const oldClientSecret = process.env.GEMINI_OAUTH_CLIENT_SECRET;
process.env.GEMINI_OAUTH_CLIENT_ID = "test-client";
process.env.GEMINI_OAUTH_CLIENT_SECRET = "test-client-secret";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-cli-parity-"));
process.env.DATA_DIR = dataDir;

vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => Response.json(body, init) } }));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: async () => {} }));
vi.mock("open-sse/utils/proxyFetch.js", async (original) => ({ ...(await original()), proxyAwareFetch: (...args) => outbound(...args) }));
const calls = [];
const outbound = vi.fn(async (input, init = {}, proxyOptions = null) => {
  const url = String(input);
  calls.push({ url, init, proxyOptions });
  if (url.includes("oauth2.googleapis.com/token")) {
    if (init.body.get("grant_type") === "refresh_token") {
      if (init.body.get("refresh_token") === "rejected") return Response.json({ error: "invalid_grant" }, { status: 400 });
      return Response.json({ access_token: `renewed-${init.body.get("refresh_token")}`, expires_in: 3600 });
    }
    const code = init.body.get("code");
    if (code === "reject") return new Response("private upstream body", { status: 400 });
    return Response.json({ access_token: `access-${code}`, refresh_token: `refresh-${code}`, expires_in: 3600 });
  }
  if (url.includes("userinfo")) return Response.json({ email: `${new Headers(init.headers).get("authorization").slice(7)}@example.test` });
  if (url.includes(":loadCodeAssist")) return Response.json({ cloudaicompanionProject: { id: `project-${new Headers(init.headers).get("authorization").slice(7)}` } });
  if (url.includes(":fetchAvailableModels")) {
    const token = new Headers(init.headers).get("authorization");
    if (token === "Bearer expired") return new Response("expired", { status: 401 });
    return Response.json({ models: { "gemini-test": { displayName: "Test" }, hidden: { isInternal: true } } });
  }
  if (url.includes(":generateContent")) return Response.json({ response: { candidates: [{ content: { role: "model", parts: [{ text: "Hello" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 } } });
  if (url.includes(":streamGenerateContent")) return new Response(`data: ${JSON.stringify({ response: { candidates: [{ content: { role: "model", parts: [{ text: "Hello" }] }, finishReason: "STOP" }] } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
  throw new Error("Unexpected outbound request");
});
let oauth, db, catalog, refresh;
beforeAll(async () => {
  vi.stubGlobal("fetch", outbound);
  db = await import("@/lib/localDb");
  oauth = await import("@/app/api/oauth/[provider]/[action]/route.js");
  catalog = (await import("@/app/api/providers/[id]/models/modelsConfig.js")).PROVIDER_MODELS_CONFIG;
  refresh = (await import("../../open-sse/services/tokenRefresh/providers.js")).refreshGoogleTokenDetailed;
  vi.stubGlobal("fetch", outbound);
});
afterAll(() => {
  vi.unstubAllGlobals();
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
  if (oldClientId === undefined) delete process.env.GEMINI_OAUTH_CLIENT_ID; else process.env.GEMINI_OAUTH_CLIENT_ID = oldClientId;
  if (oldClientSecret === undefined) delete process.env.GEMINI_OAUTH_CLIENT_SECRET; else process.env.GEMINI_OAUTH_CLIENT_SECRET = oldClientSecret;
  fs.rmSync(dataDir, { recursive: true, force: true });
});
async function post(action, body) {
  return oauth.POST(new Request(`http://localhost/api/oauth/gemini-cli/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ provider: "gemini-cli", action }) });
}
describe("Gemini CLI dashboard OAuth", () => {
  it("binds simultaneous flows to their own state and saves distinct accounts once", async () => {
    const [a, b] = await Promise.all(["a", "b"].map(async () => (await post("authorize", { redirectUri: "http://localhost/callback", proxyMode: "direct" })).json()));
    expect(a.state).not.toBe(b.state);
    const auth = new URL(a.authUrl);
    expect(auth.searchParams.get("state")).toBe(a.state);
    expect(auth.searchParams.get("response_type")).toBe("code");
    expect(auth.searchParams.get("client_id")).toBe("test-client");
    expect(auth.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/cloud-platform");
    expect(auth.searchParams.get("code_challenge")).toBeNull();
    const wrong = await post("exchange", { code: "wrong", state: b.state, flowId: a.flowId });
    expect(wrong.status).not.toBe(200);
    expect(calls).toHaveLength(0);
    const [ra, rb] = await Promise.all([a, b].map((flow, i) => post("exchange", { code: `code${i}`, state: flow.state, flowId: flow.flowId })));
    expect(ra.status).toBe(200);
    expect(rb.status).toBe(200);
    const [ca, cb] = await Promise.all([ra, rb].map(async (r) => db.getProviderConnectionById((await r.json()).connection.id)));
    expect(ca).toMatchObject({ accessToken: "access-code0", refreshToken: "refresh-code0", projectId: "project-access-code0" });
    expect(cb).toMatchObject({ accessToken: "access-code1", refreshToken: "refresh-code1", projectId: "project-access-code1" });
    const count = calls.length;
    const replay = await post("exchange", { code: "code0", state: a.state, flowId: a.flowId });
    expect(replay.status).not.toBe(200);
    expect(calls).toHaveLength(count);
  });
});


describe("Gemini CLI runtime contracts", () => {
  it("expires the authorization flow and rejects unsupported device initiation before transport", async () => {
    vi.useFakeTimers();
    try {
      const start = await (await post("authorize", { redirectUri: "http://localhost/callback", proxyMode: "direct" })).json();
      const count = calls.length;
      vi.advanceTimersByTime(300001);
      expect((await post("exchange", { code: "late", state: start.state, flowId: start.flowId })).status).not.toBe(200);
      expect((await post("device-code", {})).status).not.toBe(200);
      expect(calls).toHaveLength(count);
    } finally { vi.useRealTimers(); }
  });

  it("redacts rejected exchanges through the public handler without saving or replay", async () => {
    const flow = await (await post("authorize", { redirectUri: "http://localhost/callback", proxyMode: "direct" })).json();
    const rows = await db.getProviderConnections({ provider: "gemini-cli" });
    const before = calls.length;
    const response = await post("exchange", { code: "reject", state: flow.state, flowId: flow.flowId });
    const text = await response.text();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(text).not.toContain("private upstream body");
    expect((await db.getProviderConnections({ provider: "gemini-cli" })).length).toBe(rows.length);
    expect(calls.slice(before).filter(({ url }) => url.includes("oauth2.googleapis.com/token"))).toHaveLength(1);
  });

  it("sends isolated streaming requests through the provider executor", async () => {
    const { GeminiCLIExecutor } = await import("../../open-sse/executors/gemini-cli.js");
    const executor = new GeminiCLIExecutor();
    const before = calls.length;
    const results = await Promise.all(["one", "two"].map((id) => executor.execute({ model: "gemini-2.5-flash", stream: true, credentials: { accessToken: `access-${id}`, projectId: `project-${id}` }, body: { contents: [{ role: "user", parts: [{ text: id }] }] } })));
    const sends = calls.slice(before).filter(({ url }) => url.includes(":streamGenerateContent"));
    expect(results).toHaveLength(2);
    expect(await results[0].response.text()).toContain("Hello");
    for (const [i, id] of ["one", "two"].entries()) {
      expect(sends[i].url).toContain(":streamGenerateContent?alt=sse");
      expect(new Headers(sends[i].init.headers).get("authorization")).toBe(`Bearer access-${id}`);
      expect(JSON.parse(sends[i].init.body)).toMatchObject({ project: `project-${id}`, model: "gemini-2.5-flash" });
    }
    const controller = new AbortController();
    controller.abort();
    await expect(executor.execute({ model: "gemini-2.5-flash", body: {}, credentials: {}, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(sends).toHaveLength(2);
  });
  it("refuses a fresh exhausted model quota", async () => {
    const { evaluateProviderQuotaPreflight } = await import("../../src/shared/services/providerQuotaPreflight.js");
    const now = Date.parse("2026-01-01T00:00:00Z");
    const snapshot = {
      identity: { connectionId: "account", provider: "gemini-cli", accountKey: "scope:connection", resourceKey: "model:gemini-2.5-flash", dimensionKey: "requests:session" },
      state: "exhausted",
      amounts: { limitKind: "bounded", limit: 100, used: 100, remaining: 0, remainingRatio: 0, unit: "requests" },
      timing: { observedAt: new Date(now - 1000).toISOString(), staleAt: new Date(now + 60000).toISOString(), resetAt: new Date(now + 30000).toISOString(), cooldownUntil: null },
      provenance: { sourceType: "provider_api", sourceId: "gemini-cli:retrieve-user-quota:v1", reasonCode: null, metadata: {} }
    };
    expect(evaluateProviderQuotaPreflight([snapshot], { connectionId: "account", provider: "gemini-cli", resourceKeys: ["model:gemini-2.5-flash"], now, refreshSupported: true })).toMatchObject({ skip: true, reason: "exhausted" });
  });

  it("discovers models with the selected account and project", async () => {
    const connection = { id: "catalog-account", accessToken: "catalog-token", refreshToken: "catalog-refresh", projectId: "catalog-project" };
    const result = await catalog["gemini-cli"].customResolver(connection, { proxyUrl: "http://proxy.test" });
    expect(result.models).toEqual([{ id: "gemini-test", name: "Test" }]);
    const sent = calls.findLast(({ url }) => url.includes(":fetchAvailableModels"));
    expect(new Headers(sent.init.headers).get("authorization")).toBe("Bearer catalog-token");
    expect(JSON.parse(sent.init.body)).toEqual({ project: "catalog-project" });
    expect(sent.proxyOptions).toEqual({ proxyUrl: "http://proxy.test" });
  });

  it("refreshes discovery through the public route with the sign-in client and selected proxy", async () => {
    const pool = await db.createProxyPool({ name: "gemini-discovery", proxyUrl: "http://gemini-discovery.invalid:8080", isActive: true });
    const connection = await db.createProviderConnection({ provider: "gemini-cli", authType: "oauth", accessToken: "expired", refreshToken: "discovery-refresh", projectId: "discovery-project", isActive: true, providerSpecificData: { proxyMode: "strict-pool", proxyPoolId: pool.id } });
    const route = await import("@/app/api/providers/[id]/models/route.js");
    const before = calls.length;
    const response = await route.GET(new Request(`http://localhost/api/providers/${connection.id}/models`), { params: Promise.resolve({ id: connection.id }) });
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(text).toContain("gemini-test");
    const sent = calls.slice(before);
    const refreshCall = sent.find(({ url }) => url.includes("oauth2.googleapis.com/token"));
    expect(Object.fromEntries(refreshCall.init.body)).toMatchObject({ client_id: "test-client", client_secret: "test-client-secret", refresh_token: "discovery-refresh" });
    expect(refreshCall.proxyOptions).toMatchObject({ proxyPoolId: pool.id });
    expect(sent.filter(({ url }) => url.includes(":fetchAvailableModels"))).toHaveLength(2);
    expect(text).not.toContain("discovery-refresh");
    expect(text).not.toContain("test-client-secret");
  });

  it("refreshes and refuses rejected credentials without disclosing the response", async () => {
    const proxy = { proxyUrl: "http://proxy.test" };
    const good = await refresh("refresh-one", "test-client", "test-client-secret", null, proxy);
    expect(good).toMatchObject({ ok: true, tokens: { accessToken: "renewed-refresh-one", refreshToken: "refresh-one" } });
    expect(calls.findLast(({ url }) => url.includes("oauth2.googleapis.com/token")).proxyOptions).toEqual(proxy);
    const bad = await refresh("rejected", "test-client", "test-client-secret", null, proxy);
    expect(bad).toEqual({ ok: false, category: "invalid_grant" });
  });
});

describe("staged Gemini CLI web registration", () => {
  it("fails closed on missing client and hides token endpoint bodies", async () => {
    const { exchangeGeminiCode, refreshGeminiDiscoveryToken } = await import("../../src/lib/oauth/providerParity/gemini-cli/index.js");
    const count = calls.length;
    await expect(exchangeGeminiCode({}, "code", "http://localhost/callback")).rejects.toThrow("not configured");
    expect(calls).toHaveLength(count);
    const error = await exchangeGeminiCode({ clientId: "client", clientSecret: "secret", tokenUrl: "https://oauth2.googleapis.com/token" }, "reject", "http://localhost/callback").catch((e) => e);
    expect(error.message).toContain("HTTP 400");
    expect(error.message).not.toContain("private upstream body");
    const fn = vi.fn();
    const route = { proxyUrl: "http://proxy.test" };
    refreshGeminiDiscoveryToken(fn, { clientId: "client", clientSecret: "secret" }, { refreshToken: "refresh" }, route);
    expect(fn).toHaveBeenCalledWith("refresh", "client", "secret", null, route);
  });
});


describe("Gemini CLI public inference", () => {
  beforeAll(async () => {
    for (const row of await db.getProviderConnections({ provider: "gemini-cli" })) {
      await db.updateProviderConnection(row.id, { isActive: row.accessToken === "access-code0" });
    }
  });
  it.each([["chat/completions", false], ["chat/completions", true], ["messages", false], ["messages", true]])("serves %s stream=%s on the signed-in account", async (endpoint, stream) => {
    const handler = endpoint === "messages" ? await import("@/app/api/v1/messages/route.js") : await import("@/app/api/v1/chat/completions/route.js");
    const before = calls.length;
    const response = await handler.POST(new Request(`http://localhost/v1/${endpoint}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "gc/gemini-2.5-flash", max_tokens: 32, stream, messages: [{ role: "user", content: "Hi" }] }) }));
    const text = await response.text();
    expect(response.status, text).toBe(200);
    expect(text).toContain("Hello");
    expect(text).not.toContain("access-code0");
    expect(text).not.toContain("refresh-code0");
    const sends = calls.slice(before).filter(({ url }) => url.includes("GenerateContent") || url.includes("generateContent"));
    expect(sends).toHaveLength(1);
    expect(new Headers(sends[0].init.headers).get("authorization")).toBe("Bearer access-code0");
    expect(JSON.parse(sends[0].init.body).project).toBe("project-access-code0");
  });
});
