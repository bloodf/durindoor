import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeTokens, generateAuthData } from "../../src/lib/oauth/providers.js";
import iflow from "../../open-sse/providers/registry/iflow.js";
import { IFlowExecutor } from "../../open-sse/executors/iflow.js";
import { refreshIflowToken } from "../../open-sse/services/tokenRefresh/providers.js";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";

// Transport seams only. `routeTransport` is set by the public-handler block; other blocks
// keep the real proxyAwareFetch so their __setOriginalFetchForTesting hooks still apply.
let routeTransport = null;
vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => Response.json(body, init) } }));
vi.mock("@/lib/network/initOutboundProxy", () => ({ ensureOutboundProxyInitialized: async () => {} }));
vi.mock("@/lib/network/proxyTest", async (original) => ({ ...(await original()), testProxyUrl: async () => ({ ok: true }) }));
vi.mock("open-sse/utils/proxyFetch.js", async (original) => {
  const actual = await original();
  return { ...actual, proxyAwareFetch: (...args) => (routeTransport ? routeTransport(...args) : actual.proxyAwareFetch(...args)) };
});

afterEach(() => vi.unstubAllGlobals());

describe("iFlow production OAuth contracts", () => {
  it("keeps concurrent account tokens and profile identities paired", async () => {
    const fetch = vi.fn(async (url, options) => {
      if (url === iflow.oauth.tokenUrl) {
        const code = options.body.get("code");
        return Response.json({ access_token: `access-${code}`, refresh_token: `refresh-${code}` });
      }
      const access = new URL(url).searchParams.get("accessToken");
      return Response.json({ success: true, data: { apiKey: `key-${access}`, email: `${access}@example.invalid` } });
    });
    vi.stubGlobal("fetch", fetch);
    const redirect = "http://localhost:1234/callback";
    const [a, b] = await Promise.all([exchangeTokens("iflow", "A", redirect), exchangeTokens("iflow", "B", redirect)]);
    expect(a).toMatchObject({ accessToken: "access-A", refreshToken: "refresh-A", apiKey: "key-access-A", email: "access-A@example.invalid" });
    expect(b).toMatchObject({ accessToken: "access-B", refreshToken: "refresh-B", apiKey: "key-access-B", email: "access-B@example.invalid" });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("rejects a profile without an API key after one token exchange", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ access_token: "synthetic" })).mockResolvedValueOnce(Response.json({ success: true, data: { email: "x@example.invalid" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(exchangeTokens("iflow", "synthetic-code", "http://localhost/callback")).rejects.toThrow("Empty API key");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("refreshes separate accounts and preserves request credentials on streams", async () => {
    const calls = [];
    const restore = __setOriginalFetchForTesting(async (url, options) => {
      calls.push({ url, options });
      if (url === iflow.oauth.tokenUrl) {
        return Response.json({ access_token: `new-${options.body.get("refresh_token")}`, expires_in: 60 });
      }
      return new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } });
    });
    try {
      const [a, b] = await Promise.all([refreshIflowToken("refresh-A"), refreshIflowToken("refresh-B")]);
      expect(a).toMatchObject({ accessToken: "new-refresh-A", refreshToken: "refresh-A" });
      expect(b).toMatchObject({ accessToken: "new-refresh-B", refreshToken: "refresh-B" });
      const executor = new IFlowExecutor();
      const result = await executor.execute({ model: "qwen3-max", body: { messages: [], stream: true }, stream: true, credentials: { apiKey: "key-A" }, requestPolicy: { maxTransportAttempts: 1 } });
      expect(await result.response.text()).toContain("[DONE]");
      const chat = calls.find((call) => call.url === iflow.transport.baseUrl);
      expect(chat.options.headers.Authorization).toBe("Bearer key-A");
      expect(JSON.parse(chat.options.body).stream_options).toEqual({ include_usage: true });
      expect(iflow.models.length).toBeGreaterThan(0);
    } finally { restore(); }
  });

  it("generates independent browser states", async () => {
    const [a, b] = await Promise.all([generateAuthData("iflow", "http://localhost/callback"), generateAuthData("iflow", "http://localhost/callback")]);
    expect(a.state).toBeTruthy();
    expect(a.state).not.toBe(b.state);
    expect(new URL(a.authUrl).searchParams.get("state")).toBe(a.state);
  });
});

describe("staged iFlow cookie import", () => {
  // The manifest stays immutable; assert that its staged helper is now wired.
  it("is declared staged with its exact export", async () => {
    const registration = JSON.parse(fs.readFileSync(new URL("../../src/lib/oauth/providerParity/iflow/registration.json", import.meta.url), "utf8"));
    const helper = await import("../../src/lib/oauth/providerParity/iflow/cookie.js");
    expect(registration.status).toBe("staged");
    expect(Object.keys(helper).sort()).toEqual([...registration.exports].sort());
    const route = fs.readFileSync(new URL("../../src/app/api/oauth/iflow/cookie/route.js", import.meta.url), "utf8");
    expect(route).toContain("providerParity/iflow/cookie.js");
    expect(route).toContain("await importIflowCookie(cookie, { signal: request.signal })");
  });

  it("keeps concurrent sessions separate and posts once per accepted lookup", async () => {
    const { importIflowCookie } = await import("../../src/lib/oauth/providerParity/iflow/cookie.js");
    const calls = [];
    const transport = vi.fn(async (url, options) => {
      calls.push({ url, ...options });
      const account = options.headers.Cookie.includes("session-A") ? "A" : "B";
      return Response.json({ success: true, data: options.method === "GET" ? { name: `account-${account}` } : { apiKey: `key-${account}` } });
    });
    const [a, b] = await Promise.all([
      importIflowCookie("BXAuth=session-A; ignored=private", { fetch: transport }),
      importIflowCookie("BXAuth=session-B;", { fetch: transport }),
    ]);
    expect(a).toMatchObject({ apiKey: "key-A", providerSpecificData: { cookie: "BXAuth=session-A;" } });
    expect(b).toMatchObject({ apiKey: "key-B", providerSpecificData: { cookie: "BXAuth=session-B;" } });
    expect(calls.filter((call) => call.method === "POST")).toHaveLength(2);
    for (const call of calls.filter((entry) => entry.method === "POST")) {
      expect(JSON.parse(call.body).name).toBe(call.headers.Cookie.includes("session-A") ? "account-A" : "account-B");
    }
  });

  it("rejects malformed cookies before network and hides rejected-session bodies", async () => {
    const { importIflowCookie } = await import("../../src/lib/oauth/providerParity/iflow/cookie.js");
    const transport = vi.fn(async () => new Response("synthetic-secret", { status: 401 }));
    await expect(importIflowCookie("notBXAuth=x", { fetch: transport })).rejects.toThrow("BXAuth");
    await expect(importIflowCookie("BXAuth=a; BXAuth=b", { fetch: transport })).rejects.toThrow("BXAuth");
    expect(transport).not.toHaveBeenCalled();
    await expect(importIflowCookie("BXAuth=expired", { fetch: transport })).rejects.toThrow(/^iFlow cookie verification failed$/);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("does not retry a failed rotation and forwards cancellation", async () => {
    const { importIflowCookie } = await import("../../src/lib/oauth/providerParity/iflow/cookie.js");
    const controller = new AbortController();
    const transport = vi.fn().mockResolvedValueOnce(Response.json({ success: true, data: { name: "account" } })).mockImplementationOnce(async (_url, options) => {
      expect(options.signal).toBe(controller.signal);
      controller.abort();
      throw new Error("synthetic secret");
    });
    await expect(importIflowCookie("BXAuth=session", { fetch: transport, signal: controller.signal })).rejects.toThrow("aborted");
    expect(transport).toHaveBeenCalledTimes(2);
  });
});

describe("iFlow public handler contracts", () => {
  const TOKEN = "https://iflow.cn/oauth/token";
  const PROFILE = "https://iflow.cn/api/oauth/getUserInfo";
  const CHAT = "https://apis.iflow.cn/v1/chat/completions";
  const SECRET = "synthetic-upstream-secret-body";
  let dir, previousDataDir, db, oauth, models, test, chat, v1models, calls, behaviour;

  // One synthetic upstream. Every call is recorded with the egress options it was given.
  const transport = async (input, init = {}, proxyOptions) => {
    const url = String(input);
    const call = { url, method: init.method || "GET", proxy: init.proxyOptions || proxyOptions || null, headers: new Headers(init.headers), body: init.body };
    calls.push(call);
    if (url === TOKEN) {
      if (behaviour.token) return behaviour.token(call);
      const code = init.body.get("code");
      return Response.json({ access_token: `access-${code}`, refresh_token: `refresh-${code}`, expires_in: 3600 });
    }
    if (url.startsWith(`${PROFILE}?`)) {
      if (behaviour.profile) return behaviour.profile(call);
      const access = new URL(url).searchParams.get("accessToken");
      return Response.json({ success: true, data: { apiKey: `key-${access}`, email: `${access}@example.invalid` } });
    }
    if (url === CHAT) {
      if (behaviour.chat) return behaviour.chat(call);
      const chunk = { id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "synthetic reply" } }] };
      return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
    }
    throw new Error(`Unexpected outbound request: ${url}`);
  };
  const post = (action, body) => oauth.POST(
    new Request(`http://localhost/api/oauth/iflow/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ provider: "iflow", action }) },
  );
  const begin = async (body) => {
    const response = await post("authorize", { redirectUri: "http://localhost:20128/callback", ...body });
    expect(response.status).toBe(200);
    return response.json();
  };
  const chatRequest = (extra = {}) => chat.POST(new Request("http://localhost/v1/chat/completions", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "if/qwen3-max", stream: true, messages: [{ role: "user", content: "Hi" }], ...extra }),
  }));
  const rows = () => db.getProviderConnections({ provider: "iflow" });

  beforeAll(async () => {
    previousDataDir = process.env.DATA_DIR;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "iflow-route-parity-"));
    process.env.DATA_DIR = dir;
    delete global._dbAdapter;
    db = await import("@/lib/localDb");
    oauth = await import("@/app/api/oauth/[provider]/[action]/route.js");
    models = await import("@/app/api/providers/[id]/models/route.js");
    test = await import("@/app/api/providers/[id]/test/route.js");
    chat = await import("@/app/api/v1/chat/completions/route.js");
    v1models = await import("@/app/api/v1/models/route.js");
    await db.createProxyPool({ id: "pool-a", name: "pool-a", proxyUrl: "http://pool-a.invalid:8080" });
    await db.createProxyPool({ id: "pool-b", name: "pool-b", proxyUrl: "http://pool-b.invalid:8080" });
  });
  beforeEach(() => {
    calls = [];
    behaviour = {};
    routeTransport = transport;
    vi.stubGlobal("fetch", transport);
  });
  afterEach(() => { routeTransport = null; });
  afterAll(async () => {
    await global._dbAdapter?.instance?.close?.();
    delete global._dbAdapter;
    if (previousDataDir === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previousDataDir;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("signs in two accounts concurrently and keeps token, key and proxy identity paired", async () => {
    const [a, b] = await Promise.all([begin({ proxyPoolId: "pool-a" }), begin({ proxyPoolId: "pool-b" })]);
    expect(a.state).not.toBe(b.state);
    const url = new URL(a.authUrl);
    expect(url.origin + url.pathname).toBe("https://iflow.cn/oauth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ state: a.state, redirect: "http://localhost:20128/callback", loginMethod: "phone", type: "phone" });

    const [ra, rb] = await Promise.all([
      post("exchange", { code: "A", state: a.state, flowId: a.flowId }),
      post("exchange", { code: "B", state: b.state, flowId: b.flowId }),
    ]);
    expect([ra.status, rb.status]).toEqual([200, 200]);
    const bodies = [await ra.text(), await rb.text()];
    for (const text of bodies) expect(text).not.toMatch(/refresh-|key-access-|"access-[AB]"|accessToken|apiKey/);
    const ids = bodies.map((text) => JSON.parse(text).connection.id);

    for (const [id, account, pool] of [[ids[0], "A", "pool-a"], [ids[1], "B", "pool-b"]]) {
      expect(await db.getProviderConnectionById(id)).toMatchObject({
        provider: "iflow", authType: "oauth", accessToken: `access-${account}`, refreshToken: `refresh-${account}`,
        apiKey: `key-access-${account}`, email: `access-${account}@example.invalid`,
        providerSpecificData: { proxyPoolId: pool, oauthProxy: { mode: "strict-pool", poolId: pool } },
      });
      const sent = calls.filter((call) => call.url === TOKEN ? call.body.get("code") === account : call.url.includes(`accessToken=access-${account}`));
      expect(sent).toHaveLength(2);
      for (const call of sent) expect(call.proxy).toMatchObject({ proxyPoolId: pool, connectionProxyUrl: `http://${pool}.invalid:8080`, strictProxy: true });
      const exchange = sent.find((call) => call.url === TOKEN);
      expect(exchange.headers.get("authorization")).toMatch(/^Basic /);
      expect(Object.fromEntries(exchange.body)).toMatchObject({ grant_type: "authorization_code", redirect_uri: "http://localhost:20128/callback" });
    }

    // The flow is consumed: a replay is refused without another token submission.
    const replay = await post("exchange", { code: "A", state: a.state, flowId: a.flowId });
    expect(replay.status).toBe(410);
    expect(calls).toHaveLength(4);
  });

  it("accepts one of two simultaneous submissions of the same callback", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    behaviour.token = async (call) => { await gate; return Response.json({ access_token: `access-${call.body.get("code")}`, refresh_token: "refresh-dup", expires_in: 3600 }); };
    const flow = await begin({ proxyMode: "direct" });
    const first = post("exchange", { code: "dup", state: flow.state, flowId: flow.flowId });
    await vi.waitFor(() => expect(calls.some((call) => call.url === TOKEN)).toBe(true));
    const second = await post("exchange", { code: "dup", state: flow.state, flowId: flow.flowId });
    expect([409, 410]).toContain(second.status);
    release();
    expect((await first).status).toBe(200);
    expect(calls.filter((call) => call.url === TOKEN)).toHaveLength(1);
  });

  it("fails unsupported and malformed sign-in requests before any upstream request", async () => {
    const flow = await begin({ proxyMode: "direct" });
    const mismatch = await post("exchange", { code: "x", state: "wrong-state", flowId: flow.flowId });
    expect(mismatch.status).toBe(400);
    // The shipped CLI (cli/src/cli/menus/providers.js) posts this shape, which lacks the bound flowId.
    const cliShape = await post("exchange", { code: "x", redirectUri: "http://localhost:20128/callback", codeVerifier: "v", state: flow.state });
    expect(cliShape.status).toBe(400);
    expect(await cliShape.json()).toEqual({ error: "Missing required fields" });
    const device = await post("device-code", { proxyMode: "direct" });
    expect(device.status).toBe(400);
    const metaInQuery = await oauth.GET(new Request("http://localhost/api/oauth/iflow/authorize?redirect_uri=http://localhost:20128/callback&token=x"), { params: Promise.resolve({ provider: "iflow", action: "authorize" }) });
    expect(metaInQuery.status).toBe(400);
    expect(calls).toHaveLength(0);
    // The mismatched state did not consume the flow.
    expect((await post("exchange", { code: "late", state: flow.state, flowId: flow.flowId })).status).toBe(200);
  });

  it("serves the CLI GET authorize surface with a bound flow", async () => {
    const response = await oauth.GET(new Request("http://localhost/api/oauth/iflow/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A20128%2Fcallback"), { params: Promise.resolve({ provider: "iflow", action: "authorize" }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.flowId).toBeTruthy();
    expect(new URL(body.authUrl).searchParams.get("state")).toBe(body.state);
    expect(body).not.toHaveProperty("codeVerifier");
    expect(calls).toHaveLength(0);
  });

  it("stores nothing when the code, profile or API key is rejected", async () => {
    const before = (await rows()).length;
    behaviour.profile = () => Response.json({ success: true, data: { email: "nokey@example.invalid" } });
    const missing = await begin({ proxyMode: "direct" });
    const rejectedKey = await post("exchange", { code: "nokey", state: missing.state, flowId: missing.flowId });
    expect(rejectedKey.status).toBe(502);
    behaviour.profile = () => Response.json({ success: false, message: "denied" });
    const denied = await begin({ proxyMode: "direct" });
    expect((await post("exchange", { code: "denied", state: denied.state, flowId: denied.flowId })).status).toBe(502);
    behaviour.token = () => new Response(SECRET, { status: 400 });
    const rejectedCode = await begin({ proxyMode: "direct" });
    expect((await post("exchange", { code: "rejected", state: rejectedCode.state, flowId: rejectedCode.flowId })).status).toBe(502);
    expect((await rows()).length).toBe(before);
    expect(calls.filter((call) => call.url === TOKEN)).toHaveLength(3);
    expect(calls.filter((call) => call.url.startsWith(PROFILE))).toHaveLength(2);
  });

  it("verifies a stored account through its own token and route, without a refresh grant", async () => {
    const flow = await begin({ proxyMode: "direct" });
    const { connection } = await (await post("exchange", { code: "probe", state: flow.state, flowId: flow.flowId })).json();
    calls = [];
    const ok = await test.POST(new Request("http://localhost/api/providers/x/test", { method: "POST" }), { params: Promise.resolve({ id: connection.id }) });
    expect(await ok.json()).toMatchObject({ valid: true, refreshed: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${PROFILE}?accessToken=access-probe`);
    expect(calls[0].proxy).toMatchObject({ connectionProxyEnabled: false, disableEnvProxy: true });

    await db.updateProviderConnection(connection.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    behaviour.profile = () => new Response(SECRET, { status: 401 });
    calls = [];
    const rejected = await test.POST(new Request("http://localhost/api/providers/x/test", { method: "POST" }), { params: Promise.resolve({ id: connection.id }) });
    const result = await rejected.json();
    expect(result).toMatchObject({ valid: false, refreshed: false });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(calls.map((call) => call.url)).toEqual([`${PROFILE}?accessToken=access-probe`]);
    await db.deleteProviderConnection(connection.id);
  });

  it("lists the static registry models and refuses per-connection discovery without a request", async () => {
    const [row] = await rows();
    const perConnection = await models.GET(new Request(`http://localhost/api/providers/${row.id}/models`), { params: Promise.resolve({ id: row.id }) });
    expect(perConnection.status).toBe(400);
    expect(calls).toHaveLength(0);
    const listing = await (await v1models.GET(new Request("http://localhost/v1/models"))).json();
    const listed = listing.data.map((model) => model.id).filter((id) => id.startsWith("if/"));
    expect(listed).toEqual(expect.arrayContaining(iflow.models.map((model) => `if/${model.id}`)));
    // The aggregate listing also probes unrelated public catalogs; none of its requests reach iFlow.
    expect(calls.filter((call) => /iflow\.cn/.test(call.url))).toHaveLength(0);
  });

  it("streams chat through the selected account's key, signature and proxy", async () => {
    const all = await rows();
    const byPool = Object.fromEntries(all.filter((row) => row.providerSpecificData?.proxyPoolId).map((row) => [row.providerSpecificData.proxyPoolId, row]));
    for (const [pool, other] of [["pool-a", "pool-b"], ["pool-b", "pool-a"]]) {
      for (const row of all) await db.updateProviderConnection(row.id, { isActive: row.id === byPool[pool].id });
      calls = [];
      const response = await chatRequest();
      const text = await response.text();
      expect(response.status, text).toBe(200);
      expect(text).toContain("synthetic reply");
      expect(calls).toHaveLength(1);
      const [sent] = calls;
      expect(sent.url).toBe(CHAT);
      expect(sent.headers.get("authorization")).toBe(`Bearer ${byPool[pool].apiKey}`);
      expect(sent.headers.get("x-iflow-signature")).toMatch(/^[0-9a-f]{64}$/);
      expect(sent.proxy).toMatchObject({ proxyPoolId: pool, connectionProxyUrl: `http://${pool}.invalid:8080` });
      expect(sent.proxy.connectionProxyUrl).not.toContain(other);
      expect(JSON.parse(sent.body)).toMatchObject({ model: "qwen3-max", stream: true, stream_options: { include_usage: true } });
    }
  });

  it("does not spend the refresh token when the key is expired or rejected", async () => {
    const [row] = (await rows()).filter((entry) => entry.isActive);
    await db.updateProviderConnection(row.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    behaviour.chat = () => new Response(SECRET, { status: 401 });
    const response = await chatRequest();
    await response.text();
    expect(response.status).toBe(401);
    expect(calls.some((call) => call.url === TOKEN)).toBe(false);
    expect(calls.every((call) => call.url === CHAT && call.headers.get("authorization") === `Bearer ${row.apiKey}`)).toBe(true);
    expect(await db.getProviderConnectionById(row.id)).toMatchObject({ refreshToken: row.refreshToken, accessToken: row.accessToken });
  });

  it("returns null from the refresh grant on rejection without a second request", async () => {
    behaviour.token = () => new Response(SECRET, { status: 400 });
    expect(await refreshIflowToken("refresh-rejected")).toBeNull();
    expect(calls).toHaveLength(1);
    expect(Object.fromEntries(calls[0].body)).toMatchObject({ grant_type: "refresh_token", refresh_token: "refresh-rejected" });
  });
});

describe("legacy iFlow CLI service reachability", () => {
  it("cannot load because its server-credential module is absent", async () => {
    expect(fs.existsSync(new URL("../../src/lib/oauth/config/index.js", import.meta.url))).toBe(false);
    await expect(import("../../src/lib/oauth/services/iflow.js")).rejects.toThrow();
  });
});
