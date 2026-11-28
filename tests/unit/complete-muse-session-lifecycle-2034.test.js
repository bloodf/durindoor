/**
 * #2034: Muse Spark Web session lifecycle after the browser-route fix.
 *
 * Defects reproduced on the base commit, and fixed here:
 * 1. A local route refusal (relay, strict route without a proxy, engine without proxy support)
 *    came back from the token refresh as `{ status: 503, refused: true }`, and the executor turned
 *    it into its bootstrap 502 under `meta_ai_auth_error`. It now answers 503 with
 *    `type: "unsupported"` and `code: "meta_ai_refresh_unsupported"`.
 * 2. A bootstrap `Set-Cookie` rotation was used for one turn and then lost. It is now handed to the
 *    dispatcher's existing `onCredentialsRefreshed`, whose compare-and-set write refuses a stale
 *    rotation.
 * 3. A bare opaque value with trailing "=" padding was read as a cookie header with no
 *    `ecto_1_sess`, so the turn answered 401. It is now named `ecto_1_sess`. CR/LF and foreign
 *    header lines are refused before any traffic.
 *
 * Real: the provider registry, provider routes, an isolated SQLite database, credential selection,
 * handleChat and the /v1/messages route, chatCore, the dispatcher's guarded cookie write-back, the
 * executor, the token refresh and the proxy routing code. Mocked: the management guard, the physical
 * transport behind the proxy router, the browser pool and the WebSocket. Every credential and proxy
 * is synthetic. No browser, provider, proxy or relay is contacted, so nothing here shows that Meta
 * rotates `ecto_1_sess`, accepts these requests, or that a live browser applies the proxy.
 *
 * The executor is ported from OmniRoute 4265bb2ad5477450a07d3a43ea33a62c6c874878 (MIT).
 * Report: internal/docs/port-reports/complete-muse-session-lifecycle-2034.md.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

const guard = vi.hoisted(() => ({
  canAccessManagementApi: vi.fn(), canManageAccessConfig: vi.fn(), isOperatorRequest: vi.fn(), hasExactRequestOrigin: vi.fn(),
}));
vi.mock("@/dashboardGuard", () => guard);
vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-muse-lifecycle-machine-id" }));

const PROVIDER = "muse-spark-web";
const ORIGIN = "https://www.meta.ai";
const GRAPHQL = `${ORIGIN}/api/graphql`;
const DASHBOARD = "https://dashboard.example";
const PROXY_A = "http://proxy-a.invalid:8101";
const PROXY_B = "http://proxy-b.invalid:8102";
const PROXY_SECRET = "synthetic-proxy-password";
const PROXY_AUTH = `http://muse-user:${PROXY_SECRET}@proxy-auth.invalid:8103`;
// Synthetic only.
const COOKIE_A = "synthetic-lifecycle-session-a";
const COOKIE_B = "synthetic-lifecycle-session-b";
const ROTATED_A = "synthetic-lifecycle-rotated-a";
const ROTATED_A2 = "synthetic-lifecycle-rotated-a2";
const NEWER_A = "synthetic-lifecycle-reimported-a";
const PADDED = "c3ludGhldGljLWxpZmVjeWNsZS1wYWRkZWQ==";
const RELAY_SECRET = "synthetic-relay-secret";
const SECRETS = [COOKIE_A, COOKIE_B, ROTATED_A, ROTATED_A2, NEWER_A, PADDED, PROXY_SECRET, RELAY_SECRET];

let root;
let db;
let routes;
let handleChat;
let muse;
let direct;
let proxied;
let upstream;
let browser;
let sockets;
let socketMode;
let logs;
let restores;
let usageWrites;

/** The fake page answers a token derived from the placed cookie, so "=" in a value survives. */
const tokenFor = (value) => `access-${Buffer.from(value).toString("hex")}`;

class FakeSocket {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.frames = 0;
    sockets.push(this);
    queueMicrotask(() => this.onopen());
  }
  send() {
    this.frames += 1;
    if (this.frames !== 2) return;
    queueMicrotask(() => {
      if (socketMode === "abnormal") {
        this.onclose({ code: 1006 });
        return;
      }
      this.onmessage({ data: JSON.stringify({ type: "full", response: { sections: [{ view_model: { primitive: { text: "synthetic reply" } } }] } }) });
      this.onclose({ code: 1000 });
    });
  }
  on() {}
  close() {}
}

function fakePool({ engine } = {}) {
  return {
    acquire: async (key, options) => {
      const pooled = { value: "", key, options };
      browser.acquired.push({ key, proxyUrl: options?.proxyUrl ?? null });
      pooled.context = { addCookies: async (cookies) => { browser.cookies.push(...cookies); pooled.value = cookies[0].value; } };
      return pooled;
    },
    openPage: async (pooled) => ({
      route: async () => {}, routeWebSocket: async () => {}, goto: async () => {}, close: async () => {},
      url: () => `${ORIGIN}/`, content: async () => `"accessToken":"ecto1:${tokenFor(pooled.value)}"`,
    }),
    release: async () => {},
    ...(engine ? { engine: () => engine } : {}),
  };
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "muse-lifecycle-"));
  vi.stubEnv("DATA_DIR", path.join(root, "data"));
  vi.stubEnv("HOME", path.join(root, "home"));
  vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
  vi.stubEnv("BASE_URL", DASHBOARD);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON", "DURINDOOR_WEB_LOGIN_ORIGIN",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]) vi.stubEnv(key, undefined);
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete global._dbAdapter;
  vi.resetModules();
  logs = ["log", "info", "warn", "error", "debug"].map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
  for (const fn of Object.values(guard)) fn.mockReset().mockReturnValue(true);

  // Closed by default: anything that skips the connection proxy is recorded and fails.
  direct = vi.fn(async () => { throw new Error("closed mock: unproxied request"); });
  vi.stubGlobal("fetch", direct);

  db = await import("@/lib/db/index.js");
  routes = {
    providers: await import("../../src/app/api/providers/route.js"),
    provider: await import("../../src/app/api/providers/[id]/route.js"),
    messages: await import("../../src/app/api/v1/messages/route.js"),
  };
  ({ handleChat } = await import("../../src/sse/handlers/chat.js"));
  usageWrites = vi.spyOn(await import("@/lib/usageDb.js"), "saveRequestUsage");

  proxied = [];
  upstream = () => Response.json({});
  const transport = await import("../../open-sse/utils/proxyFetch.js");
  const dispatchers = new Map([[PROXY_A, { proxy: PROXY_A }], [PROXY_B, { proxy: PROXY_B }]]);
  for (const [url, dispatcher] of dispatchers) transport.__setProxyDispatcherForTesting(url, dispatcher);
  const restoreTransport = transport.__setOriginalFetchForTesting(async (url, init) => {
    const route = [...dispatchers].find(([, dispatcher]) => dispatcher === init.dispatcher)?.[0] ?? null;
    proxied.push({ url: String(url), route, cookie: init.headers?.Cookie });
    return upstream(String(url), init, proxied.length);
  });

  browser = { acquired: [], cookies: [] };
  sockets = [];
  socketMode = "reply";
  muse = await import("../../open-sse/executors/muse-spark-web.js");
  muse.__setMuseSparkBrowserPoolForTesting(fakePool());
  const restoreSocket = muse.__setMuseSparkWebSocketForTesting(FakeSocket);
  restores = [
    restoreSocket, restoreTransport, () => transport.__clearProxyDispatchersForTesting(),
    () => muse.__setMuseSparkBrowserPoolForTesting(undefined), () => muse.__resetMuseSparkTokenCacheForTesting(),
    () => muse.__resetMuseSparkConversationCacheForTesting(),
  ];
}, 60_000);

afterEach(async () => {
  await Promise.allSettled(usageWrites.mock.results.map((result) => result.value));
  for (const restore of restores) restore();
  await global._dbAdapter?.instance?.close?.();
  delete global._dbAdapter;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await disposeLoadedRequestDetailsRepo();
  fs.rmSync(root, { recursive: true, force: true });
});

const json = (url, body, method = "POST") => new NextRequest(new URL(url, DASHBOARD), {
  method, headers: { "content-type": "application/json", origin: DASHBOARD },
  body: JSON.stringify(body),
});
const logged = () => logs.flatMap((spy) => spy.mock.calls).map((call) => call.map((arg) => String(arg?.stack ?? JSON.stringify(arg) ?? arg)).join(" ")).join("\n");
const expectNoSecrets = (text) => { for (const secret of SECRETS) expect(text).not.toContain(secret); };
const metaDirect = () => direct.mock.calls.filter(([url]) => /meta\.ai|meta\.com/.test(String(url)));
const nothingSent = () => {
  expect(proxied).toEqual([]);
  expect(browser.cookies).toEqual([]);
  expect(sockets).toEqual([]);
  expect(metaDirect()).toEqual([]);
};

async function addAccount(name, apiKey, route) {
  const res = await routes.providers.POST(json("/api/providers", { provider: PROVIDER, name, apiKey }));
  expect(res.status).toBe(201);
  expectNoSecrets(await res.clone().text());
  const { connection } = await res.json();
  await configure(connection.id, { ...route, providerSpecificData: { enableSessionDispatch: true } });
  return connection.id;
}
const viaProxy = (proxy) => ({ connectionProxyEnabled: true, connectionProxyUrl: proxy });
async function configure(id, body) {
  const res = await routes.provider.PUT(json(`/api/providers/${id}`, body, "PUT"), { params: Promise.resolve({ id }) });
  expect(res.status).toBe(200);
  expectNoSecrets(await res.text());
}
/** Make `first` the selected account, `second` the fallback, and prove it. */
async function order(first, second) {
  await configure(second, { priority: 2 });
  await configure(first, { priority: 1 });
  expect((await db.getProviderConnectionById(first)).priority).toBe(1);
  expect((await db.getProviderConnectionById(second)).priority).toBe(2);
}
const stored = async (id) => (await db.getProviderConnectionById(id)).apiKey;

async function chat(extra = {}) {
  const res = await handleChat(json("/v1/chat/completions", { model: "ms-web/muse-spark", stream: false, messages: [{ role: "user", content: "hello" }], ...extra }));
  const text = await res.text();
  expectNoSecrets(text);
  return { status: res.status, text };
}
async function messages(extra = {}) {
  const res = await routes.messages.POST(json("/v1/messages", { model: "ms-web/muse-spark", max_tokens: 16, messages: [{ role: "user", content: "hello" }], ...extra }));
  const text = await res.text();
  expectNoSecrets(text);
  return { status: res.status, text };
}
/** One turn: three GraphQL sends through `proxy`, one placed cookie, one WebSocket on the same proxy. */
function expectTurn(value, proxy, turn = 0) {
  expect(proxied.slice(turn * 3, turn * 3 + 3).map(({ url, route, cookie }) => ({ url, route, cookie })))
    .toEqual(Array(3).fill({ url: GRAPHQL, route: proxy, cookie: `ecto_1_sess=${value}` }));
  expect(browser.cookies[turn]).toEqual({ name: "ecto_1_sess", value, domain: "www.meta.ai", path: "/", secure: true });
  expect(new URL(sockets[turn].url).searchParams.get("Authorization")).toBe(`ecto1:${tokenFor(value)}`);
  expect(sockets[turn].options.agent.proxy.href).toBe(`${proxy}/`);
}
/** Record each executor answer (status and error body) before the gateway consumes it. */
function captureExecutorAnswers() {
  const answers = [];
  const original = muse.MuseSparkWebExecutor.prototype.runChat;
  vi.spyOn(muse.MuseSparkWebExecutor.prototype, "runChat").mockImplementation(async function (...args) {
    const result = await original.apply(this, args);
    const body = await result.response.clone().json().catch(() => null);
    answers.push({ status: result.response.status, error: body?.error ?? null, scoped: result.claudeRequestScoped === true });
    return result;
  });
  return answers;
}
const rotateOnBootstrap = (value, attributes = "Path=/; Secure; HttpOnly") => (url, init, count) => count === 1
  ? new Response("{}", { headers: { "set-cookie": `ecto_1_sess=${value}; ${attributes}` } })
  : Response.json({});

describe("#2034 real gateway clients", () => {
  it("serves buffered and streamed OpenAI Chat Completions and Anthropic Messages through the account proxy", async () => {
    await addAccount("A", `ecto_1_sess=${COOKIE_A}`, viaProxy(PROXY_A));

    const buffered = await chat();
    expect(buffered.status).toBe(200);
    expect(JSON.parse(buffered.text).choices[0].message.content).toBe("synthetic reply");
    const streamed = await chat({ stream: true });
    expect(streamed.status).toBe(200);
    expect(streamed.text).toContain("synthetic reply");
    expect(streamed.text).toContain("data: [DONE]");

    const message = await messages();
    expect(message.status).toBe(200);
    expect(JSON.parse(message.text).content.some((block) => block.text === "synthetic reply")).toBe(true);
    const messageStream = await messages({ stream: true });
    expect(messageStream.status).toBe(200);
    expect(messageStream.text).toContain("event: message_start");
    expect(messageStream.text).toContain("synthetic reply");
    expect(messageStream.text).toContain("event: message_stop");

    expect(sockets).toHaveLength(4);
    expect(proxied.every(({ route, cookie }) => route === PROXY_A && cookie === `ecto_1_sess=${COOKIE_A}`)).toBe(true);
    expect(sockets.every((socket) => socket.options.agent.proxy.href === `${PROXY_A}/` && !("Cookie" in socket.options.headers))).toBe(true);
    expect(metaDirect()).toEqual([]);
    expectNoSecrets(logged());
  });

  it("keeps a guarded connection on 501 with no traffic, unchanged by the lifecycle fix", async () => {
    const id = await addAccount("Guarded", `ecto_1_sess=${COOKIE_A}`, viaProxy(PROXY_A));
    await configure(id, { providerSpecificData: { enableSessionDispatch: false } });
    for (const run of [() => chat(), () => chat({ stream: true }), () => messages(), () => messages({ stream: true })]) {
      expect((await run()).status).toBe(501);
    }
    nothingSent();
    expect(await stored(id)).toBe(`ecto_1_sess=${COOKIE_A}`);
    expectNoSecrets(logged());
  });
});

describe("#2034 route refusal is unsupported, not auth and not success", () => {
  // Relay and strict settings reach the executor only through proxy pools, as an operator sets them.
  const cases = [
    ["HTTP relay pool", { proxyUrl: "https://relay.invalid/", type: "vercel", relaySecret: RELAY_SECRET, strictProxy: true }],
    ["strict pool bypassed by noProxy", { proxyUrl: PROXY_A, noProxy: "www.meta.ai", strictProxy: true }],
    ["strict pool with a scheme the browser cannot apply", { proxyUrl: "ftp://proxy.invalid:21", strictProxy: true }],
  ];
  it.each(cases)("%s: 503 before any send; the account is not marked invalid, expired or healthy", async (_label, pool) => {
    const id = await addAccount("Refused", `ecto_1_sess=${COOKIE_A}`, {});
    const created = await db.createProxyPool({ name: "Pool", isActive: true, ...pool });
    await configure(id, { proxyPoolId: created.id, providerSpecificData: { enableSessionDispatch: true } });
    const answers = captureExecutorAnswers();
    const before = await db.getProviderConnectionById(id);
    const first = await chat();
    expect(first.status).toBe(503);
    // The executor's own answer: a local refusal with the "unsupported" category.
    expect(answers[0]).toMatchObject({ status: 503, error: { type: "unsupported", code: "meta_ai_refresh_unsupported" } });
    expect(first.text).not.toMatch(/re-import|expired|token bootstrap failed/i);
    // Later attempts inside the gateway's transient 503 cooldown stay 503 and send nothing either.
    for (const run of [() => chat({ stream: true }), () => messages()]) expect((await run()).status).toBe(503);
    nothingSent();
    const after = await db.getProviderConnectionById(id);
    expect(after.apiKey).toBe(before.apiKey);
    expect(after.isActive).not.toBe(false);
    // The gateway's own handling of a 503: a short transient cooldown, recorded with the refusal code.
    expect(after.testStatus).toBe("unavailable");
    expect(after.errorCode).toBe(503);
    expect(after.lastError).toContain("meta_ai_refresh_unsupported");
    expectNoSecrets(logged());
  });

  it("refuses a proxied refresh on an engine without verified proxy support before the cookie is placed", async () => {
    muse.__setMuseSparkBrowserPoolForTesting(fakePool({ engine: "obscura" }));
    const id = await addAccount("Obscura", `ecto_1_sess=${COOKIE_A}`, viaProxy(PROXY_A));
    const answers = captureExecutorAnswers();
    const result = await chat();
    expect(result.status).toBe(503);
    expect(answers[0]).toMatchObject({ status: 503, error: { type: "unsupported", code: "meta_ai_refresh_unsupported" } });
    // The bootstrap already went through the account proxy; the browser never received the cookie.
    expect(proxied.map(({ route }) => route)).toEqual([PROXY_A]);
    expect(browser.acquired.map(({ proxyUrl }) => proxyUrl)).toEqual([PROXY_A]);
    expect(browser.cookies).toEqual([]);
    expect(sockets).toEqual([]);
    expect((await db.getProviderConnectionById(id)).testStatus).not.toBe("active");
    expectNoSecrets(logged());
  });

  it("carries the refusal category at the executor and keeps proxy credentials out of the error", async () => {
    const result = await new muse.MuseSparkWebExecutor().execute({
      model: "muse-spark", stream: false, body: { messages: [{ role: "user", content: "hi" }] },
      proxyOptions: { vercelRelayUrl: PROXY_AUTH, strictProxy: true },
      credentials: { connectionId: "relay", apiKey: `ecto_1_sess=${COOKIE_A}`, providerSpecificData: { enableSessionDispatch: true } },
    });
    expect(result.response.status).toBe(503);
    const text = await result.response.text();
    expect(JSON.parse(text).error).toMatchObject({ type: "unsupported", code: "meta_ai_refresh_unsupported" });
    expectNoSecrets(text);
    nothingSent();
  });
});

describe("#2034 rotated cookie write-back", () => {
  it("persists a rotated header cookie for the selected account only, and the next turn sends it", async () => {
    const a = await addAccount("A", `ecto_1_sess=${COOKIE_A}`, viaProxy(PROXY_A));
    const b = await addAccount("B", `ecto_1_sess=${COOKIE_B}`, viaProxy(PROXY_B));
    await order(a, b);
    upstream = rotateOnBootstrap(ROTATED_A);
    expect((await chat()).status).toBe(200);
    // The bootstrap sends the stored cookie; warmup, mode switch, browser and socket use the rotated one.
    expect(proxied.map(({ route, cookie }) => ({ route, cookie }))).toEqual([COOKIE_A, ROTATED_A, ROTATED_A].map((v) => ({ route: PROXY_A, cookie: `ecto_1_sess=${v}` })));
    expect(browser.cookies.map(({ value }) => value)).toEqual([ROTATED_A]);
    expect(new URL(sockets[0].url).searchParams.get("Authorization")).toBe(`ecto1:${tokenFor(ROTATED_A)}`);
    expect(await stored(a)).toBe(`ecto_1_sess=${ROTATED_A}`);
    expect(await stored(b)).toBe(`ecto_1_sess=${COOKIE_B}`);
    upstream = () => Response.json({});
    expect((await chat()).status).toBe(200);
    expectTurn(ROTATED_A, PROXY_A, 1);
    expect(JSON.stringify([proxied, browser, sockets.map((socket) => socket.url)])).not.toContain(COOKIE_B);
    expectNoSecrets(logged());
  });

  it("keeps a bare stored value bare when writing back its rotation", async () => {
    const a = await addAccount("Bare", COOKIE_A, viaProxy(PROXY_A));
    upstream = rotateOnBootstrap(ROTATED_A);
    expect((await chat()).status).toBe(200);
    expect(await stored(a)).toBe(ROTATED_A);
    expectNoSecrets(logged());
  });

  it("does not overwrite a cookie re-imported while the rotating turn was in flight", async () => {
    const a = await addAccount("A", `ecto_1_sess=${COOKIE_A}`, viaProxy(PROXY_A));
    upstream = async (url, init, count) => {
      if (count !== 1) return Response.json({});
      // A newer session lands between dispatch and the rotation write-back.
      await db.updateProviderConnection(a, { apiKey: `ecto_1_sess=${NEWER_A}` });
      return new Response("{}", { headers: { "set-cookie": `ecto_1_sess=${ROTATED_A}; Path=/; Secure` } });
    };
    expect((await chat()).status).toBe(200);
    expect(await stored(a)).toBe(`ecto_1_sess=${NEWER_A}`);
    expectNoSecrets(logged());
  });

  it("lets only the first of two rotations sent with the same session win (stale writer)", async () => {
    const a = await addAccount("A", `ecto_1_sess=${COOKIE_A}`, viaProxy(PROXY_A));
    const b = await addAccount("B", `ecto_1_sess=${COOKIE_B}`, viaProxy(PROXY_B));
    // Two turns that both sent the same stored session; the dispatcher's guarded write runs after each.
    const sent = await db.getProviderConnectionById(a);
    const { providerRefreshContext } = await import("../../src/shared/utils/providerCredentialContext.js");
    const { updateProviderCredentials } = await import("../../src/sse/services/tokenRefresh.js");
    const context = providerRefreshContext(sent);
    const write = (next) => updateProviderCredentials(a, { rotatedApiKey: next.apiKey }, { expectedRefreshContext: context });
    const writes = [];
    const run = (value) => {
      upstream = rotateOnBootstrap(value);
      muse.__resetMuseSparkTokenCacheForTesting();
      return new muse.MuseSparkWebExecutor().execute({
        model: "muse-spark", stream: false, body: { messages: [{ role: "user", content: "hi" }] }, proxyOptions: viaProxy(PROXY_A),
        credentials: { connectionId: a, apiKey: sent.apiKey, providerSpecificData: { enableSessionDispatch: true } },
        onCredentialsRefreshed: async (next) => { writes.push(await write(next)); },
      });
    };
    proxied.length = 0;
    expect((await run(ROTATED_A)).response.status).toBe(200);
    proxied.length = 0;
    expect((await run(ROTATED_A2)).response.status).toBe(200);
    expect(writes).toEqual([true, false]);
    expect(await stored(a)).toBe(`ecto_1_sess=${ROTATED_A}`);
    expect(await stored(b)).toBe(`ecto_1_sess=${COOKIE_B}`);
    expectNoSecrets(logged());
  });

  it.each([
    ["Max-Age=0", "Path=/; Max-Age=0"],
    ["an Expires date in the past", "Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT"],
  ])("never writes back a deleting Set-Cookie (%s)", async (_label, attributes) => {
    const a = await addAccount("A", `ecto_1_sess=${COOKIE_A}`, viaProxy(PROXY_A));
    upstream = rotateOnBootstrap(ROTATED_A, attributes);
    await chat();
    expect(await stored(a)).toBe(`ecto_1_sess=${COOKIE_A}`);
    expectNoSecrets(logged());
  });

  it("logs a failed write-back without the cookie and still answers the turn", async () => {
    upstream = rotateOnBootstrap(ROTATED_A);
    const warn = vi.fn();
    const result = await new muse.MuseSparkWebExecutor().execute({
      model: "muse-spark", stream: false, body: { messages: [{ role: "user", content: "hi" }] }, proxyOptions: viaProxy(PROXY_A),
      credentials: { connectionId: "x", apiKey: `ecto_1_sess=${COOKIE_A}`, providerSpecificData: { enableSessionDispatch: true } },
      log: { warn, error: vi.fn() },
      onCredentialsRefreshed: async () => { throw new Error(`database refused ecto_1_sess=${ROTATED_A} for ${COOKIE_A}`); },
    });
    expect(result.response.status).toBe(200);
    expect(warn).toHaveBeenCalledTimes(1);
    expectNoSecrets(JSON.stringify(warn.mock.calls));
  });

  it("does not write back a rotation of a cookie taken from extraApiKeys", async () => {
    upstream = rotateOnBootstrap(ROTATED_A);
    const onCredentialsRefreshed = vi.fn();
    const result = await new muse.MuseSparkWebExecutor().execute({
      model: "muse-spark", stream: false, body: { messages: [{ role: "user", content: "hi" }] }, proxyOptions: viaProxy(PROXY_A),
      credentials: { connectionId: "x", apiKey: "", providerSpecificData: { enableSessionDispatch: true, extraApiKeys: [`ecto_1_sess=${COOKIE_A}`] } },
      onCredentialsRefreshed,
    });
    expect(result.response.status).toBe(200);
    expect(onCredentialsRefreshed).not.toHaveBeenCalled();
  });
});

describe("#2034 stored cookie shapes", () => {
  it("names a bare value with trailing = padding and sends it through the account proxy", async () => {
    const id = await addAccount("Padded", PADDED, viaProxy(PROXY_B));
    expect((await chat()).status).toBe(200);
    expectTurn(PADDED, PROXY_B);
    expect(await stored(id)).toBe(PADDED);
    expectNoSecrets(logged());
  });

  it("keeps known header shapes as written", () => {
    const normalize = muse.normalizeMetaAiCookieHeader;
    expect(normalize(`ecto_1_sess=${COOKIE_A}`)).toBe(`ecto_1_sess=${COOKIE_A}`);
    expect(normalize(`Cookie: ecto_1_sess=${PADDED}`)).toBe(`ecto_1_sess=${PADDED}`);
    expect(normalize(`datr=x1; ecto_1_sess=${COOKIE_A};`)).toBe(`datr=x1; ecto_1_sess=${COOKIE_A};`);
    expect(normalize(COOKIE_A)).toBe(`ecto_1_sess=${COOKIE_A}`);
    expect(normalize(`  ${PADDED}\n`)).toBe(`ecto_1_sess=${PADDED}`);
  });

  it.each([
    ["CRLF injection", `ecto_1_sess=${COOKIE_A}\r\nX-Other: y`],
    ["bare LF", `${COOKIE_A}\nX-Other: y`],
    ["foreign header pair", `ecto_1_sess=${COOKIE_A}; X-Other: y`],
    ["foreign header line", `Authorization: Bearer ${COOKIE_A}`],
    ["foreign cookie only", `abra_sess=${COOKIE_A}`],
    ["value with inner =", `abc=def${COOKIE_A}`],
    ["whitespace inside a bare value", `${COOKIE_A} more`],
    ["empty session", "ecto_1_sess="],
  ])("refuses %s with 401 before any traffic", async (_label, apiKey) => {
    expect(muse.normalizeMetaAiCookieHeader(apiKey)).toBe("");
    const result = await new muse.MuseSparkWebExecutor().execute({
      model: "muse-spark", stream: false, body: { messages: [{ role: "user", content: "hi" }] }, proxyOptions: viaProxy(PROXY_A),
      credentials: { connectionId: "shape", apiKey, providerSpecificData: { enableSessionDispatch: true } },
    });
    expect(result.response.status).toBe(401);
    expectNoSecrets(await result.response.text());
    // A refused primary does not fall through to a well-formed extra key.
    const withExtra = await new muse.MuseSparkWebExecutor().execute({
      model: "muse-spark", stream: false, body: { messages: [{ role: "user", content: "hi" }] }, proxyOptions: viaProxy(PROXY_A),
      credentials: { connectionId: "shape", apiKey, providerSpecificData: { enableSessionDispatch: true, extraApiKeys: [`ecto_1_sess=${COOKIE_B}`] } },
    });
    expect(withExtra.response.status).toBe(401);
    nothingSent();
  });
});

describe("#2034 unknown work is not replayed", () => {
  it("does not retry a turn whose WebSocket failed after the billable send, even with a second account", async () => {
    const a = await addAccount("A", `ecto_1_sess=${COOKIE_A}`, viaProxy(PROXY_A));
    const b = await addAccount("B", `ecto_1_sess=${COOKIE_B}`, viaProxy(PROXY_B));
    await order(a, b);
    socketMode = "abnormal";
    const answers = captureExecutorAnswers();
    const result = await chat();
    expect(result.status).toBe(502);
    expect(answers).toEqual([{ status: 502, error: expect.objectContaining({ code: "meta_ai_outcome_unknown" }), scoped: true }]);
    expect(JSON.parse(result.text).error.message).toMatch(/not retried/);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].options.agent.proxy.href).toBe(`${PROXY_A}/`);
    expect(proxied.some(({ route }) => route === PROXY_B)).toBe(false);
    expect(await stored(a)).toBe(`ecto_1_sess=${COOKIE_A}`);
    expect(await stored(b)).toBe(`ecto_1_sess=${COOKIE_B}`);
    expectNoSecrets(logged());
  });
});
