/**
 * GitHub Enterprise Copilot public-route parity (#2034, register-auth-02).
 *
 * Two enterprise hosts, one per source-supported shape:
 * - GitHub Enterprise Server (`ghe-a.example.test`), whose session exchange
 *   names an API on its own subdomain.
 * - GHE.com data residency (`tenant-b.ghe.com`), whose session exchange names
 *   `copilot-api.tenant-b.ghe.com`.
 * Each account signs in through its own strict proxy pool.
 *
 * Everything is closed: a disposable DATA_DIR with real SQLite, synthetic
 * tokens, and a fake network behind the shared proxy fetch. Proxy routing is
 * observed through the per-proxy dispatcher the shared transport selects.
 *
 * Sources (MIT): OmniRoute b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523
 * src/lib/oauth/providers/ghe-copilot.ts (enterprise device grant, guarded
 * requests, refused redirects); CLIProxyAPI dbe641f286a489ecb39e3c041c554371e6add864
 * internal/auth/copilot/client.go (scoped session exchange, expired session
 * refusal, trusted API hosts).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-ghe-parity-machine-id" }));

const HOSTS = [
  { issuer: "https://ghe-a.example.test", api: "https://copilot-api.ghe-a.example.test", proxyUrl: "http://proxy-a.invalid:8080" },
  { issuer: "https://tenant-b.ghe.com", api: "https://copilot-api.tenant-b.ghe.com", proxyUrl: "http://proxy-b.invalid:8080" }
];
const FUTURE = () => Math.floor(Date.now() / 1000) + 1800;

const originalEnv = { DATA_DIR: process.env.DATA_DIR, HOME: process.env.HOME, DURINDOOR_DATABASE_ENGINE: process.env.DURINDOOR_DATABASE_ENGINE };
let tempDir;
let api;
let pools;
/** Per-host upstream state; index matches HOSTS. */
let hosts;
const calls = [];
/** The generic connection test checks the proxy itself before the provider probe. */
const proxyChecks = [];

function hostIndex(url) {
  const origin = new URL(url).origin;
  return HOSTS.findIndex((host) => host.issuer === origin || host.api === origin);
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function sse(events) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", {
    status: 200, headers: { "Content-Type": "text/event-stream" }
  });
}
function chatCompletion(i) {
  return { id: `chat-${i}`, object: "chat.completion", created: 1, model: "gpt-4.1",
    choices: [{ index: 0, message: { role: "assistant", content: `answer-${i}` }, finish_reason: "stop" }],
    usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } };
}
function chatChunks(i) {
  return [
    { id: `chat-${i}`, object: "chat.completion.chunk", created: 1, model: "gpt-4.1", choices: [{ index: 0, delta: { role: "assistant", content: `answer-${i}` }, finish_reason: null }] },
    { id: `chat-${i}`, object: "chat.completion.chunk", created: 1, model: "gpt-4.1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }
  ];
}

/** Fake enterprise network. Every request is recorded with its proxy route. */
async function fakeFetch(url, init = {}) {
  const target = String(url);
  const headers = new Headers(init.headers);
  const i = hostIndex(target);
  const body = init.body == null ? "" : String(init.body);
  calls.push({ url: target, host: i, proxy: init.dispatcher?.proxyTag ?? null, redirect: init.redirect,
    authorization: headers.get("authorization"), body });
  if (i < 0) throw new Error(`unexpected outbound request ${target}`);
  const state = hosts[i];
  const { pathname } = new URL(target);
  if (pathname === "/login/device/code") return json({ device_code: `device-${i}-${state.deviceCount += 1}`, user_code: `USER-${i}`, verification_uri: `${HOSTS[i].issuer}/login/device`, expires_in: 900, interval: 5, unexpected: "synthetic-secret" });
  if (pathname === "/login/oauth/access_token") {
    const form = new URLSearchParams(body);
    if (form.get("grant_type") === "refresh_token") {
      state.oauthRefreshes.push(form.get("refresh_token"));
      if (state.refreshResponse) return state.refreshResponse(form);
      return json({ access_token: `oauth-${i}-r${state.oauthRefreshes.length}`, refresh_token: `refresh-${i}-r${state.oauthRefreshes.length}`, expires_in: 28800 });
    }
    const next = state.poll.shift() || { error: "authorization_pending" };
    return json(typeof next === "function" ? next(form) : next);
  }
  if (pathname === "/api/v3/user") return json({ id: 100 + i, login: `user-${i}`, name: `User ${i}`, email: `user-${i}@fixture.invalid`, site_admin: true });
  if (pathname === "/api/v3/copilot_internal/v2/token") {
    state.mints += 1;
    if (state.mintResponse) return state.mintResponse(headers);
    return json({ token: `session-${i}-${state.mints}`, expires_at: FUTURE(), endpoints: { api: HOSTS[i].api, telemetry: "https://collector.invalid" } });
  }
  if (pathname === "/models") return json({ data: [{ id: `model-${i}`, name: `Model ${i}`, capabilities: { type: "chat" } }] });
  if (pathname === "/chat/completions") {
    const request = JSON.parse(body);
    return request.stream ? sse(chatChunks(i)) : json(chatCompletion(i));
  }
  throw new Error(`unexpected path ${target}`);
}

function resetHosts() {
  hosts = HOSTS.map((_, i) => ({
    deviceCount: 0, mints: 0, oauthRefreshes: [], refreshResponse: null, mintResponse: null,
    poll: [{ error: "authorization_pending" }, { access_token: `oauth-${i}`, refresh_token: `refresh-${i}`, expires_in: 28800, token_type: "bearer", scope: "read:user", error_description: "synthetic-secret" }]
  }));
}

const request = (url, method, body) => new Request(`http://localhost${url}`, {
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body)
});
const oauth = async (action, body) => {
  const response = await api.oauth.POST(request(`/api/oauth/ghe-copilot/${action}`, "POST", body), {
    params: Promise.resolve({ provider: "ghe-copilot", action })
  });
  return { status: response.status, body: await response.json() };
};
const SECRET_PATTERN = /oauth-\d|refresh-\d|session-\d|synthetic-secret/;

async function signIn(i) {
  const started = await oauth("device-code", { gheUrl: `${HOSTS[i].issuer}/enterprise/path`, proxyMode: "strict-pool", proxyPoolId: pools[i].id });
  expect(started.status).toBe(200);
  expect(JSON.stringify(started.body)).not.toMatch(/_gheUrl|synthetic-secret|device-\d/);
  const pending = await oauth("poll", { flowId: started.body.flowId });
  expect(pending.body).toMatchObject({ success: false, error: "authorization_pending", pending: true });
  const done = await oauth("poll", { flowId: started.body.flowId });
  expect(done.body.success).toBe(true);
  expect(JSON.stringify(done.body)).not.toMatch(SECRET_PATTERN);
  return { flowId: started.body.flowId, connection: await api.getProviderConnectionById(done.body.connection.id) };
}

/** Leave only account `i` routable so a public request reaches it deterministically. */
async function only(rows, i) {
  for (const [n, row] of rows.entries()) await api.updateProviderConnection(row.id, { isActive: n === i });
}

const chat = (body) => api.handleChat(request("/v1/chat/completions", "POST", { model: "ghe/gpt-4.1", messages: [{ role: "user", content: "hello" }], ...body }));
const messages = (body) => api.handleChat(request("/v1/messages", "POST", { model: "ghe/gpt-4.1", max_tokens: 64, messages: [{ role: "user", content: "hello" }], ...body }));

/** Every outbound call carried only the credential of the host it reached, through that host's proxy. */
function expectIsolated(list = calls) {
  for (const call of list) {
    expect(call.host).toBeGreaterThanOrEqual(0);
    expect(call.proxy).toBe(`proxy-${call.host}`);
    expect(call.redirect === "manual" || call.redirect === "error").toBe(true);
    const foreign = new RegExp(`(oauth|refresh|session|device)-${1 - call.host}`);
    expect(call.authorization || "").not.toMatch(foreign);
    expect(call.body).not.toMatch(foreign);
  }
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "durindoor-ghe-parity-"));
  process.env.DATA_DIR = path.join(tempDir, "data");
  process.env.HOME = path.join(tempDir, "home");
  process.env.DURINDOOR_DATABASE_ENGINE = "sqlite";
  fs.mkdirSync(process.env.HOME, { recursive: true });
  // The adapter lives on a global that outlives modules; never reuse another file's store.
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.resetModules();
  vi.doMock("next/server", () => ({
    NextResponse: {
      json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200, headers: { "Content-Type": "application/json", ...(init.headers || {}) } })
    }
  }));
  vi.doMock("@/lib/network/proxyTest", () => ({
    testProxyUrl: async ({ proxyUrl }) => { proxyChecks.push(proxyUrl); return { ok: true, status: 200 }; }
  }));
  const localDb = await import("@/lib/localDb");
  await (await import("@/lib/db/index.js")).initDb();
  const proxyFetch = await import("../../open-sse/utils/proxyFetch.js");
  api = {
    ...localDb,
    flows: await import("@/lib/oauth/flowStore.js"),
    oauth: await import("../../src/app/api/oauth/[provider]/[action]/route.js"),
    models: await import("../../src/app/api/providers/[id]/models/route.js"),
    validate: await import("../../src/app/api/providers/[id]/test/route.js"),
    handleChat: (await import("../../src/sse/handlers/chat.js")).handleChat,
    background: await import("../../src/sse/services/backgroundTokenRefresh.js"),
    proxyFetch,
    restore: proxyFetch.__setOriginalFetchForTesting(vi.fn(fakeFetch))
  };
  const { createProxyPool } = await import("@/lib/db/repos/proxyPoolsRepo.js");
  pools = await Promise.all(HOSTS.map((host, i) => createProxyPool({ name: `pool-${i}`, proxyUrl: host.proxyUrl, strictProxy: true, testStatus: "active" })));
}, 120_000);

afterAll(async () => {
  api?.restore?.();
  api?.proxyFetch?.__clearProxyDispatchersForTesting();
  vi.doUnmock("next/server");
  vi.doUnmock("@/lib/network/proxyTest");
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  await disposeLoadedRequestDetailsRepo();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(async () => {
  for (const connection of await api.getProviderConnections()) await api.deleteProviderConnection(connection.id);
  api.flows.clearOAuthFlowsForTests();
  api.proxyFetch.__clearProxyDispatchersForTesting();
  HOSTS.forEach((host, i) => api.proxyFetch.__setProxyDispatcherForTesting(host.proxyUrl, { proxyTag: `proxy-${i}` }));
  resetHosts();
  calls.length = 0;
  proxyChecks.length = 0;
});

describe("GHE device sign-in through the public OAuth route", () => {
  it("binds two hosts to their own issuer, client, proxy pool and scoped session", async () => {
    const [a, b] = [await signIn(0), await signIn(1)];
    for (const [i, { connection }] of [a, b].entries()) {
      const data = connection.providerSpecificData;
      expect(connection.provider).toBe("ghe-copilot");
      expect(connection.accessToken).toBe(`oauth-${i}`);
      expect(connection.refreshToken).toBe(`refresh-${i}`);
      expect(data.gheUrl).toBe(HOSTS[i].issuer);
      expect(data.gheBinding).toMatchObject({ issuer: HOSTS[i].issuer, clientId: expect.any(String) });
      expect(data.gheBinding.proxyOptions.connectionProxyUrl).toBe(HOSTS[i].proxyUrl);
      expect(data.copilotToken).toBe(`session-${i}-1`);
      expect(data.copilotApiUrl).toBe(HOSTS[i].api);
      expect(data.gheSession).toMatchObject({ issuer: HOSTS[i].issuer, apiOrigin: HOSTS[i].api, kind: "session" });
      expect(data.proxyPoolId).toBe(pools[i].id);
      expect(JSON.stringify(data)).not.toContain("collector.invalid");
    }
    expectIsolated();
  });

  it("refuses denial and expiry without saving a connection, and never replays an accepted flow", async () => {
    hosts[0].poll = [{ error: "access_denied", error_description: "synthetic-secret" }];
    hosts[1].poll = [{ error: "expired_token" }];
    for (const i of [0, 1]) {
      const started = await oauth("device-code", { gheUrl: HOSTS[i].issuer, proxyMode: "strict-pool", proxyPoolId: pools[i].id });
      const refused = await oauth("poll", { flowId: started.body.flowId });
      expect(refused.body.success).toBe(false);
      expect(refused.body.pending).toBe(false);
      expect(JSON.stringify(refused.body)).not.toContain("synthetic-secret");
      const again = await oauth("poll", { flowId: started.body.flowId });
      expect(again.status).toBeGreaterThanOrEqual(400);
    }
    expect(await api.getProviderConnections({ provider: "ghe-copilot" })).toHaveLength(0);

    resetHosts();
    const { flowId } = await signIn(0);
    const before = calls.length;
    const replay = await oauth("poll", { flowId });
    expect(replay.status).toBeGreaterThanOrEqual(400);
    expect(calls).toHaveLength(before);
    expect(await api.getProviderConnections({ provider: "ghe-copilot" })).toHaveLength(1);
  });

  it("cancels a pending flow so a later poll reaches no enterprise host", async () => {
    const started = await oauth("device-code", { gheUrl: HOSTS[1].issuer, proxyMode: "strict-pool", proxyPoolId: pools[1].id });
    const cancelled = await oauth("cancel", { flowId: started.body.flowId });
    expect(cancelled.status).toBe(200);
    const before = calls.length;
    const poll = await oauth("poll", { flowId: started.body.flowId });
    expect(poll.status).toBeGreaterThanOrEqual(400);
    expect(calls).toHaveLength(before);
    expect(await api.getProviderConnections({ provider: "ghe-copilot" })).toHaveLength(0);
  });
});

describe("GHE discovery and validation through public provider routes", () => {
  it("discovers each account's models with its own session credential and proxy", async () => {
    const rows = [(await signIn(0)).connection, (await signIn(1)).connection];
    calls.length = 0;
    for (const [i, row] of rows.entries()) {
      const response = await api.models.GET(request(`/api/providers/${row.id}/models`, "GET"), { params: Promise.resolve({ id: row.id }) });
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.models.map((model) => model.id)).toContain(`model-${i}`);
      expect(JSON.stringify(body)).not.toMatch(SECRET_PATTERN);
    }
    expect(calls.map(({ url, authorization }) => [url, authorization])).toEqual([
      [`${HOSTS[0].api}/models`, "Bearer session-0-1"],
      [`${HOSTS[1].api}/models`, "Bearer session-1-1"]
    ]);
    expectIsolated();
  });

  it("validates each account against its own issuer and proxy only", async () => {
    const rows = [(await signIn(0)).connection, (await signIn(1)).connection];
    calls.length = 0;
    for (const row of rows) {
      const response = await api.validate.POST(request(`/api/providers/${row.id}/test`, "POST", {}), { params: Promise.resolve({ id: row.id }) });
      const body = await response.json();
      expect(body).toMatchObject({ valid: true });
      expect(JSON.stringify(body)).not.toMatch(SECRET_PATTERN);
    }
    expect(proxyChecks).toEqual(HOSTS.map((host) => host.proxyUrl));
    expect(calls.map(({ url, authorization }) => [url, authorization])).toEqual([
      [`${HOSTS[0].issuer}/api/v3/user`, "Bearer oauth-0"],
      [`${HOSTS[1].issuer}/api/v3/user`, "Bearer oauth-1"]
    ]);
    expectIsolated();
  });
});

describe("GHE dispatch through the public OpenAI and Anthropic routes", () => {
  it.each([
    ["OpenAI buffered", () => chat({ stream: false })],
    ["OpenAI streamed", () => chat({ stream: true })],
    ["Anthropic buffered", () => messages({ stream: false })],
    ["Anthropic streamed", () => messages({ stream: true })]
  ])("%s requests reach only the selected account's session API", async (_label, send) => {
    const rows = [(await signIn(0)).connection, (await signIn(1)).connection];
    calls.length = 0;
    for (const i of [0, 1, 0]) {
      await only(rows, i);
      const response = await send();
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain(`answer-${i}`);
      expect(text).not.toMatch(SECRET_PATTERN);
      expect(calls.at(-1)).toMatchObject({ url: `${HOSTS[i].api}/chat/completions`, authorization: `Bearer session-${i}-1`, proxy: `proxy-${i}` });
    }
    expect(calls.filter((call) => call.url.endsWith("/chat/completions")).map((call) => call.host)).toEqual([0, 1, 0]);
    expect(rows.every((row) => row.accessToken !== row.providerSpecificData.copilotToken)).toBe(true);
    expectIsolated();
  });
});

describe("GHE refresh through public dispatch and the background scheduler", () => {
  async function expireSession(row, seconds = 60) {
    await api.updateProviderConnection(row.id, {
      providerSpecificData: { ...row.providerSpecificData, copilotTokenExpiresAt: Math.floor(Date.now() / 1000) + seconds }
    });
  }

  it("re-mints an expiring session on the request path, persists its provenance, and reuses it without another mint", async () => {
    const rows = [(await signIn(0)).connection, (await signIn(1)).connection];
    for (const row of rows) await expireSession(row);
    calls.length = 0;
    for (const i of [0, 0, 1, 1]) {
      await only(rows, i);
      expect((await chat({ stream: false })).status).toBe(200);
    }
    for (const [i, row] of rows.entries()) {
      const stored = await api.getProviderConnectionById(row.id);
      expect(hosts[i].mints).toBe(2);
      expect(stored.accessToken).toBe(`oauth-${i}`);
      expect(stored.providerSpecificData.copilotToken).toBe(`session-${i}-2`);
      expect(stored.providerSpecificData.gheBinding).toEqual(row.providerSpecificData.gheBinding);
      expect(stored.providerSpecificData.proxyPoolId).toBe(pools[i].id);
    }
    const mints = calls.filter((call) => call.url.endsWith("/copilot_internal/v2/token"));
    expect(mints.map((call) => [call.url, call.authorization])).toEqual(expect.arrayContaining([
      [`${HOSTS[0].issuer}/api/v3/copilot_internal/v2/token`, "token oauth-0"],
      [`${HOSTS[1].issuer}/api/v3/copilot_internal/v2/token`, "token oauth-1"]
    ]));
    expect(mints).toHaveLength(2);
    for (const call of calls.filter((entry) => entry.url.endsWith("/chat/completions"))) {
      expect(call.authorization).toBe(`Bearer session-${call.host}-2`);
    }
    expectIsolated();
  });

  it("refreshes the OAuth grant with the bound client only when the stored grant can no longer mint", async () => {
    const { connection } = await signIn(1);
    await api.updateProviderConnection(connection.id, { expiresAt: new Date(Date.now() + 60_000).toISOString() });
    hosts[1].mintResponse = (headers) => headers.get("authorization") === "token oauth-1"
      ? json({ message: "synthetic-secret" }, 401)
      : json({ token: "session-1-rotated", expires_at: FUTURE(), endpoints: { api: HOSTS[1].api } });
    calls.length = 0;
    await api.background.runBackgroundTokenRefreshTick({ sleep: async () => {} });
    const stored = await api.getProviderConnectionById(connection.id);
    expect(hosts[1].oauthRefreshes).toEqual(["refresh-1"]);
    const grant = calls.find((call) => call.url.endsWith("/login/oauth/access_token"));
    expect(new URLSearchParams(grant.body).get("client_id")).toBe(connection.providerSpecificData.gheBinding.clientId);
    expect(stored).toMatchObject({ accessToken: "oauth-1-r1", refreshToken: "refresh-1-r1" });
    expect(stored.providerSpecificData.copilotToken).toBe("session-1-rotated");
    expect(stored.providerSpecificData.gheSession).toMatchObject({ issuer: HOSTS[1].issuer, apiOrigin: HOSTS[1].api, kind: "session" });
    expect(JSON.stringify(stored)).not.toContain("synthetic-secret");
    calls.length = 0;
    expect((await messages({ stream: true })).status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ url: `${HOSTS[1].api}/chat/completions`, authorization: "Bearer session-1-rotated", proxy: "proxy-1" });
    expectIsolated();
  });

  it("does not let a background refresh overwrite a reconnect that lands during its exchange", async () => {
    const { connection } = await signIn(0);
    await api.updateProviderConnection(connection.id, { expiresAt: new Date(Date.now() + 60_000).toISOString() });
    hosts[0].mintResponse = () => {
      // Another writer: the operator reconnects the same account mid-exchange.
      return api.updateProviderConnection(connection.id, {
        accessToken: "oauth-0-reconnected", refreshToken: "refresh-0-reconnected",
        providerSpecificData: { ...connection.providerSpecificData, copilotToken: "session-0-reconnected", proxyPoolId: pools[0].id }
      }).then(() => json({ token: "session-0-stale", expires_at: FUTURE(), endpoints: { api: HOSTS[0].api } }));
    };
    await api.background.runBackgroundTokenRefreshTick({ sleep: async () => {} });
    const stored = await api.getProviderConnectionById(connection.id);
    expect(stored.accessToken).toBe("oauth-0-reconnected");
    expect(stored.providerSpecificData.copilotToken).toBe("session-0-reconnected");
    expect(JSON.stringify(stored)).not.toContain("session-0-stale");
  });
});

describe("GHE rows without sign-in provenance", () => {
  async function seedLegacy(providerSpecificData, extra = {}) {
    return api.createProviderConnection({
      provider: "ghe-copilot", authType: "oauth", name: `legacy-${Math.random().toString(36).slice(2, 8)}`,
      accessToken: "oauth-0", refreshToken: "refresh-0", expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      testStatus: "active", isActive: true, providerSpecificData, ...extra
    });
  }

  it("refuses an API-only row before any network on dispatch, discovery, validation and refresh", async () => {
    const row = await seedLegacy({ copilotApiUrl: "https://operator.example.test", copilotToken: "session-0-legacy", copilotTokenExpiresAt: FUTURE() });
    calls.length = 0;
    const dispatched = await chat({ stream: false });
    expect(dispatched.status).toBeGreaterThanOrEqual(400);
    expect(await dispatched.text()).not.toMatch(/oauth-0|session-0|operator\.example/);
    const discovered = await api.models.GET(request(`/api/providers/${row.id}/models`, "GET"), { params: Promise.resolve({ id: row.id }) });
    expect(discovered.status).toBe(401);
    const validated = await (await api.validate.POST(request(`/api/providers/${row.id}/test`, "POST", {}), { params: Promise.resolve({ id: row.id }) })).json();
    expect(validated.valid).toBe(false);
    await api.updateProviderConnection(row.id, { expiresAt: new Date(Date.now() + 60_000).toISOString() });
    await api.background.runBackgroundTokenRefreshTick({ sleep: async () => {} });
    expect(calls).toEqual([]);
    const stored = await api.getProviderConnectionById(row.id);
    expect(stored.accessToken).toBe("oauth-0");
    expect(stored.providerSpecificData.copilotToken).toBe("session-0-legacy");
  });

  it("keeps an operator-entered issuer for a historical row but never trusts its stored API host", async () => {
    await seedLegacy({ gheUrl: HOSTS[0].issuer, copilotApiUrl: "https://collector.invalid", copilotToken: "session-0-legacy", copilotTokenExpiresAt: FUTURE() });
    calls.length = 0;
    expect((await chat({ stream: false })).status).toBe(200);
    expect(calls.map(({ url, authorization }) => [url, authorization])).toEqual([[`${HOSTS[0].issuer}/chat/completions`, "Bearer session-0-legacy"]]);
  });

  it("re-mints a historical session that states no expiry before dispatch instead of trusting it indefinitely", async () => {
    const row = await seedLegacy({ gheUrl: HOSTS[0].issuer, copilotToken: "session-0-legacy" });
    calls.length = 0;
    expect((await chat({ stream: false })).status).toBe(200);
    expect(calls.map(({ url, authorization }) => [url, authorization])).toEqual([
      [`${HOSTS[0].issuer}/api/v3/copilot_internal/v2/token`, "token oauth-0"],
      [`${HOSTS[0].api}/chat/completions`, "Bearer session-0-1"]
    ]);
    const stored = await api.getProviderConnectionById(row.id);
    expect(stored.providerSpecificData.copilotToken).toBe("session-0-1");
    expect(stored.providerSpecificData.copilotTokenExpiresAt).toBeTruthy();
  });

  it("refuses a historical row whose OAuth credential is the dispatch credential", async () => {
    await seedLegacy({ gheUrl: HOSTS[0].issuer, copilotApiUrl: HOSTS[0].api, copilotToken: "oauth-0", copilotTokenExpiresAt: FUTURE() });
    calls.length = 0;
    const response = await chat({ stream: false });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(calls.filter((call) => call.url.endsWith("/chat/completions"))).toEqual([]);
  });
});

describe("GHE source-inapplicable and refused modes", () => {
  it("refuses a GET device request (the CLI shape) that cannot carry the enterprise URL", async () => {
    const response = await api.oauth.GET(new Request("http://localhost/api/oauth/ghe-copilot/device-code?proxyMode=direct"), {
      params: Promise.resolve({ provider: "ghe-copilot", action: "device-code" })
    });
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("refuses an enterprise redirect during discovery without following it", async () => {
    const { connection } = await signIn(0);
    calls.length = 0;
    const restore = api.proxyFetch.__setOriginalFetchForTesting(async (url, init = {}) => {
      if (String(url).endsWith("/models")) {
        calls.push({ url: String(url), host: 0, proxy: init.dispatcher?.proxyTag ?? null, redirect: init.redirect, authorization: new Headers(init.headers).get("authorization"), body: "" });
        return new Response(null, { status: 302, headers: { location: "https://collector.invalid/models" } });
      }
      return fakeFetch(url, init);
    });
    try {
      const response = await api.models.GET(request(`/api/providers/${connection.id}/models`, "GET"), { params: Promise.resolve({ id: connection.id }) });
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(await response.json())).not.toMatch(SECRET_PATTERN);
    } finally {
      restore();
    }
    expect(calls.map((call) => call.url)).toEqual([`${HOSTS[0].api}/models`]);
    expect(calls[0].redirect).toBe("manual");
  });

  it("supports the GHE.com issuer OAuth fallback only on the issuer and dispatches there", async () => {
    hosts[1].mintResponse = () => new Response(null, { status: 404 });
    const restore = api.proxyFetch.__setOriginalFetchForTesting(async (url, init = {}) => {
      if (String(url) === `${HOSTS[1].issuer}/api/v3/copilot_internal/user`) {
        calls.push({ url: String(url), host: 1, proxy: init.dispatcher?.proxyTag ?? null, redirect: init.redirect, authorization: new Headers(init.headers).get("authorization"), body: "" });
        return json({ endpoints: { api: HOSTS[1].issuer } });
      }
      return fakeFetch(url, init);
    });
    try {
      const { connection } = await signIn(1);
      expect(connection.providerSpecificData.gheSession).toMatchObject({ kind: "issuer-oauth", apiOrigin: HOSTS[1].issuer });
      calls.length = 0;
      expect((await chat({ stream: false })).status).toBe(200);
      expect(calls.at(-1)).toMatchObject({ url: `${HOSTS[1].issuer}/chat/completions`, authorization: "Bearer oauth-1", proxy: "proxy-1" });
    } finally {
      restore();
    }
  });
});
