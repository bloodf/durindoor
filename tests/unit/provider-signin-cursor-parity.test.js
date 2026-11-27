// Cursor sign-in/request parity (#2034). Closed network: every provider call goes
// through a stubbed fetch or the mocked proxy transport. Synthetic tokens only.
// Source comparison: OmniRoute b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523 (MIT);
// see internal/docs/port-reports/provider-signin-cursor-parity.md.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";

const env = vi.hoisted(async () => {
  const { mkdtempSync: mk } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join: j } = await import("node:path");
  const root = mk(j(tmpdir(), "cursor-signin-parity-"));
  process.env.HOME = root;
  process.env.DATA_DIR = j(root, "data");
  process.env.XDG_CACHE_HOME = j(root, "cache");
  return { root };
});

const store = vi.hoisted(() => ({ rows: [], nextId: 1, create: null, update: null, list: null, nonAdmin: false }));
const transport = vi.hoisted(() => ({ calls: [], handler: null }));

vi.mock("@/lib/localDb", () => ({
  createProviderConnection: vi.fn(async (values, options) => store.create(values, options)),
  updateProviderConnection: vi.fn(async (id, values, options) => store.update(id, values, options)),
  getProviderConnections: vi.fn(async (filter) => store.list(filter)),
}));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: vi.fn(async () => "f".repeat(32)) }));
vi.mock("@/dashboardGuard", () => ({ isNonAdminApiKeyCaller: vi.fn(async () => store.nonAdmin) }));
vi.mock("open-sse/utils/proxyFetch.js", async (importOriginal) => ({
  ...(await importOriginal()),
  proxyAwareFetch: vi.fn(async (url, init, proxyOptions) => {
    transport.calls.push({ url, init, proxyOptions });
    return transport.handler(url, init, proxyOptions);
  }),
}));

import { POST as loginStart } from "../../src/app/api/oauth/cursor/login/start/route.js";
import { POST as loginPoll } from "../../src/app/api/oauth/cursor/login/poll/route.js";
import { POST as loginCancel } from "../../src/app/api/oauth/cursor/login/cancel/route.js";
import { POST as importToken } from "../../src/app/api/oauth/cursor/import/route.js";
import { createCursorLoginSession, pollCursorLoginSession, cursorTokenDetails } from "../../src/lib/oauth/services/cursorLogin.js";
import { CursorService, resolveCursorTokenTtlSeconds } from "../../src/lib/oauth/services/cursor.js";
import { readCursorLocalAuthSync } from "../../src/lib/oauth/services/cursorLocalStore.js";
import { refreshCursorToken } from "open-sse/services/tokenRefresh/cursor.js";
import { resolveCursorModels } from "open-sse/services/cursorModels.js";

const NOW = Date.UTC(2026, 10, 27, 12, 0, 0);
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const jwt = (payload) => `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.${"s".repeat(43)}`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const post = (path, body) => new Request(`http://localhost${path}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const deferred = () => { let resolveFn; const promise = new Promise((r) => { resolveFn = r; }); return { promise, resolve: resolveFn }; };

function resetStore() {
  store.rows = []; store.nextId = 1; store.nonAdmin = false;
  store.create = async (values, options) => {
    const row = { id: `conn-${store.nextId++}`, ...values, createOptions: options };
    store.rows.push(row);
    return row;
  };
  store.update = async (id, values, options) => {
    const row = store.rows.find((r) => r.id === id);
    Object.assign(row, values, { updateOptions: options });
    return row;
  };
  store.list = async (filter) => store.rows.filter((r) => !filter?.provider || r.provider === filter.provider);
}

let fetchMock;
beforeEach(() => {
  resetStore();
  transport.calls = [];
  transport.handler = () => { throw new Error("unexpected transport call"); };
  fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("outbound disabled"));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
afterAll(async () => { rmSync((await env).root, { recursive: true, force: true }); });

describe("deep-control browser sign-in (production service)", () => {
  it("publishes only the S256 challenge and polls with the server-held verifier", async () => {
    const { sessionId, loginUrl, expiresInSeconds } = createCursorLoginSession();
    const url = new URL(loginUrl);
    expect(`${url.origin}${url.pathname}`).toBe("https://cursor.com/loginDeepControl");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      challenge: expect.any(String), uuid: expect.any(String), mode: "login", redirectTarget: "cli",
    });
    expect(expiresInSeconds).toBe(900);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await pollCursorLoginSession(sessionId)).toEqual({ status: "pending" });
    const [pollUrl, init] = fetchMock.mock.calls[0];
    const poll = new URL(pollUrl);
    expect(`${poll.origin}${poll.pathname}`).toBe("https://api2.cursor.sh/auth/poll");
    expect(poll.searchParams.get("uuid")).toBe(url.searchParams.get("uuid"));
    const verifier = poll.searchParams.get("verifier");
    expect(loginUrl).not.toContain(verifier);
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(url.searchParams.get("challenge"));
    expect(init.redirect).toBe("error");
  });

  it("consumes a session once even when polls overlap", async () => {
    const { sessionId } = createCursorLoginSession();
    const gate = deferred();
    fetchMock.mockImplementationOnce(() => gate.promise);
    const first = pollCursorLoginSession(sessionId);
    expect(await pollCursorLoginSession(sessionId)).toEqual({ status: "pending" });
    gate.resolve(json({ accessToken: "a".repeat(60), refreshToken: "r".repeat(60) }));
    expect(await first).toEqual({ status: "ok", accessToken: "a".repeat(60), refreshToken: "r".repeat(60) });
    expect(await pollCursorLoginSession(sessionId)).toEqual({ status: "expired" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("expires sessions on the fake clock and honors caller aborts before network", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const expiring = createCursorLoginSession();
    const aborted = createCursorLoginSession();
    const controller = new AbortController();
    controller.abort();
    expect(await pollCursorLoginSession(aborted.sessionId, { signal: controller.signal })).toEqual({ status: "error" });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await pollCursorLoginSession(aborted.sessionId)).toEqual({ status: "pending" });
    vi.setSystemTime(NOW + 15 * 60 * 1000);
    expect(await pollCursorLoginSession(expiring.sessionId)).toEqual({ status: "expired" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("aborts an in-flight poll and keeps the session usable", async () => {
    const { sessionId } = createCursorLoginSession();
    const controller = new AbortController();
    fetchMock.mockImplementationOnce((_url, init) => new Promise((_, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    }));
    const pending = pollCursorLoginSession(sessionId, { signal: controller.signal });
    controller.abort();
    expect(await pending).toEqual({ status: "error" });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await pollCursorLoginSession(sessionId)).toEqual({ status: "pending" });
  });

  it("rejects incomplete or malformed token responses without consuming the session", async () => {
    const { sessionId } = createCursorLoginSession();
    fetchMock.mockResolvedValueOnce(json({ accessToken: "a".repeat(60) }));
    expect(await pollCursorLoginSession(sessionId)).toEqual({ status: "error" });
    fetchMock.mockResolvedValueOnce(new Response("not json", { status: 200 }));
    expect(await pollCursorLoginSession(sessionId)).toEqual({ status: "error" });
    fetchMock.mockResolvedValueOnce(new Response("denied", { status: 403 }));
    expect(await pollCursorLoginSession(sessionId)).toEqual({ status: "error", httpStatus: 403 });
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await pollCursorLoginSession(sessionId)).toEqual({ status: "pending" });
  });

  it("reads identity and the real expiry from the access token", () => {
    expect(cursorTokenDetails(jwt({ sub: "auth0|user_A", email: "A@Example.Invalid", exp: NOW / 1000 + 600 })))
      .toEqual({ accountId: "auth0|user_A", email: "a@example.invalid", expiresAt: new Date(NOW + 600000).toJSON() });
  });
});

describe("login routes with two concurrent accounts", () => {
  const tokens = {
    a: { accessToken: jwt({ sub: "auth0|user_a", email: "a@example.invalid", exp: NOW / 1000 + 3600 }), refreshToken: `refresh-a-${"x".repeat(40)}` },
    b: { accessToken: jwt({ sub: "auth0|user_b", email: "b@example.invalid", exp: NOW / 1000 + 7200 }), refreshToken: `refresh-b-${"y".repeat(40)}` },
  };

  async function start() {
    const response = await loginStart(post("/api/oauth/cursor/login/start", {}));
    const body = await response.json();
    return { ...body, uuid: new URL(body.loginUrl).searchParams.get("uuid") };
  }

  it("stores each account with its own tokens and never submits accepted work twice", async () => {
    const [a, b] = [await start(), await start()];
    const owners = { [a.uuid]: tokens.a, [b.uuid]: tokens.b };
    const gates = { [a.uuid]: deferred(), [b.uuid]: deferred() };
    fetchMock.mockImplementation((url) => gates[new URL(url).searchParams.get("uuid")].promise);
    const polls = [loginPoll(post("/x", { sessionId: a.sessionId })), loginPoll(post("/x", { sessionId: b.sessionId }))];
    const duplicate = await loginPoll(post("/x", { sessionId: a.sessionId }));
    expect(await duplicate.json()).toEqual({ status: "pending" });
    gates[b.uuid].resolve(json(owners[b.uuid]));
    gates[a.uuid].resolve(json(owners[a.uuid]));
    const bodies = await Promise.all(polls.map(async (p) => (await p).json()));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodies.map((x) => x.connection.email)).toEqual(["a@example.invalid", "b@example.invalid"]);
    for (const body of bodies) expect(JSON.stringify(body)).not.toMatch(/refresh-|eyJ/);
    expect(store.rows).toHaveLength(2);
    for (const [key, row] of [["a", store.rows.find((r) => r.email === "a@example.invalid")], ["b", store.rows.find((r) => r.email === "b@example.invalid")]]) {
      expect(row).toMatchObject({
        provider: "cursor", authType: "oauth", accessToken: tokens[key].accessToken, refreshToken: tokens[key].refreshToken,
        providerSpecificData: { accountId: `auth0|user_${key}`, authMethod: "deep_control", machineId: "f".repeat(32) },
        createOptions: { createOnly: true },
      });
    }
    expect(store.rows.find((r) => r.email === "b@example.invalid").expiresAt).toBe(new Date(NOW + 7200000).toJSON());
    expect((await loginPoll(post("/x", { sessionId: a.sessionId }))).status).toBe(410);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("re-signing an account replaces its credential instead of duplicating it", async () => {
    store.rows.push({ id: "existing", provider: "cursor", authType: "oauth", accessToken: "old", providerSpecificData: { userId: "auth0|user_a", proxyPoolId: "pool-a" } });
    const session = await start();
    fetchMock.mockResolvedValueOnce(json(tokens.a));
    const response = await loginPoll(post("/x", { sessionId: session.sessionId }));
    expect(response.status).toBe(200);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      accessToken: tokens.a.accessToken, updateOptions: { replacesCredential: true },
      providerSpecificData: { proxyPoolId: "pool-a", accountId: "auth0|user_a" },
    });
  });

  it("does not leak the upstream body on a rejected poll", async () => {
    const session = await start();
    fetchMock.mockResolvedValueOnce(new Response("upstream-secret-detail", { status: 401 }));
    const response = await loginPoll(post("/x", { sessionId: session.sessionId }));
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("upstream-secret-detail");
    expect(store.rows).toHaveLength(0);
  });

  it("refuses non-admin API keys and malformed input before network", async () => {
    store.nonAdmin = true;
    for (const route of [loginStart, loginPoll, loginCancel]) expect((await route(post("/x", { sessionId: "s" }))).status).toBe(403);
    store.nonAdmin = false;
    expect((await loginPoll(post("/x", {}))).status).toBe(400);
    expect((await loginPoll(post("/x", { sessionId: "unknown" }))).status).toBe(410);
    const session = await start();
    expect(await (await loginCancel(post("/x", { sessionId: session.sessionId }))).json()).toEqual({ success: true, cancelled: true });
    expect((await loginPoll(post("/x", { sessionId: session.sessionId }))).status).toBe(410);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("refresh and rejected tokens (production open-sse refresher)", () => {
  const REFRESH_URL = "https://api2.cursor.sh/auth/exchange_user_api_key";

  it("rotates per account through each account's own proxy route", async () => {
    const issued = { [`Bearer rt-a-${"1".repeat(30)}`]: "a", [`Bearer rt-b-${"2".repeat(30)}`]: "b" };
    transport.handler = (_url, init) => {
      const who = issued[init.headers.Authorization];
      return json(who === "a"
        ? { accessToken: jwt({ sub: "a", exp: NOW / 1000 + 3600 }), refreshToken: `rt-a2-${"3".repeat(30)}` }
        : { accessToken: jwt({ sub: "b", exp: NOW / 1000 + 1800 }) });
    };
    const proxyA = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy-a.invalid:1" };
    const proxyB = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy-b.invalid:2" };
    const [a, b] = await Promise.all([
      refreshCursorToken(`rt-a-${"1".repeat(30)}`, null, proxyA),
      refreshCursorToken(`rt-b-${"2".repeat(30)}`, null, proxyB),
    ]);
    expect(a).toEqual({ accessToken: jwt({ sub: "a", exp: NOW / 1000 + 3600 }), refreshToken: `rt-a2-${"3".repeat(30)}`, expiresAt: new Date(NOW + 3600000).toJSON() });
    expect(b.refreshToken).toBe(`rt-b-${"2".repeat(30)}`);
    expect(transport.calls).toHaveLength(2);
    for (const call of transport.calls) {
      expect(call.url).toBe(REFRESH_URL);
      expect(call.init).toMatchObject({ method: "POST", body: "{}", redirect: "error" });
      const owner = issued[call.init.headers.Authorization];
      expect(call.proxyOptions).toBe(owner === "a" ? proxyA : proxyB);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks 401/403 unrecoverable without retrying", async () => {
    for (const status of [401, 403]) {
      transport.calls = [];
      transport.handler = () => new Response("upstream-secret-detail", { status });
      expect(await refreshCursorToken(`rt-rejected-${status}-${"z".repeat(30)}`, null, null))
        .toEqual({ error: "unrecoverable_refresh_error", code: "unauthorized" });
      expect(transport.calls).toHaveLength(1);
    }
  });

  it("retries transient failures on the fake clock, then succeeds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const log = { error: vi.fn() };
    const responses = [new Response("busy", { status: 503 }), json({ accessToken: "opaque-access" })];
    transport.handler = () => responses.shift();
    const pending = refreshCursorToken(`rt-retry-${"q".repeat(30)}`, log, null);
    await vi.advanceTimersByTimeAsync(1000);
    const result = await pending;
    expect(result).toMatchObject({ accessToken: "opaque-access", refreshToken: `rt-retry-${"q".repeat(30)}` });
    expect(transport.calls).toHaveLength(2);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("gives up after three transient failures and logs no secret", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const log = { error: vi.fn() };
    transport.handler = () => new Response("upstream-secret-detail", { status: 502 });
    const pending = refreshCursorToken(`rt-down-${"d".repeat(30)}`, log, null);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toBeNull();
    expect(transport.calls).toHaveLength(3);
    expect(JSON.stringify(log.error.mock.calls)).not.toMatch(/rt-down|upstream-secret/);
  });

  it("does nothing without a refresh token (imported connections)", async () => {
    expect(await refreshCursorToken(null, null, null)).toBeNull();
    expect(transport.calls).toHaveLength(0);
  });
});

describe("local token import and encrypted-store fixtures (production)", () => {
  const machineId = "c".repeat(32);

  it("records a JWT's real expiry and keeps the 24-hour estimate for opaque tokens", () => {
    expect(resolveCursorTokenTtlSeconds(jwt({ exp: NOW / 1000 + 90 }), NOW)).toBe(90);
    expect(resolveCursorTokenTtlSeconds(`opaque-${"o".repeat(60)}`, NOW)).toBe(86400);
    expect(resolveCursorTokenTtlSeconds(`${b64({})}.${b64({ exp: "soon" })}.${"s".repeat(43)}`, NOW)).toBe(86400);
  });

  it("imports two accounts independently without contacting Cursor", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const accounts = ["a", "b"].map((name, i) => ({
      accessToken: jwt({ sub: `auth0|user_${name}`, exp: NOW / 1000 + 3600 * (i + 1), pad: "p".repeat(40) }),
      machineId: String(i + 1).repeat(32), cachedEmail: `${name}@example.invalid`,
    }));
    const responses = await Promise.all(accounts.map((account) => importToken(post("/api/oauth/cursor/import", account))));
    for (const response of responses) expect(response.status).toBe(200);
    for (const [i, account] of accounts.entries()) {
      expect(store.rows.find((r) => r.email === account.cachedEmail)).toMatchObject({
        accessToken: account.accessToken, refreshToken: null, expiresAt: new Date(NOW + 3600000 * (i + 1)).toISOString(),
        providerSpecificData: { machineId: account.machineId, authMethod: "imported", userId: `auth0|user_${["a", "b"][i]}` },
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an already-expired token before storage and does not log it", async () => {
    const logs = vi.spyOn(console, "log").mockImplementation(() => {});
    const expired = jwt({ sub: "auth0|user_old", exp: Date.now() / 1000 - 1, pad: "p".repeat(40) });
    const response = await importToken(post("/api/oauth/cursor/import", { accessToken: expired, machineId, cachedEmail: "old@example.invalid" }));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/expired/);
    expect(store.rows).toHaveLength(0);
    expect(JSON.stringify(logs.mock.calls)).not.toContain(expired);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects malformed values before storage", async () => {
    const service = new CursorService();
    await expect(service.validateImportToken("short", machineId)).rejects.toThrow(/too short/);
    await expect(service.validateImportToken("x".repeat(60), "not-a-machine-id")).rejects.toThrow(/machine ID/);
  });

  it("fails closed on encrypted, keychain-held or non-SQLite stores without echoing contents", async () => {
    const dir = mkdtempSync(join((await env).root, "store-"));
    const encrypted = join(dir, "encrypted.vscdb");
    writeFileSync(encrypted, Buffer.concat([Buffer.from("v10"), Buffer.alloc(4096, 0xa5)]));
    expect(readCursorLocalAuthSync(encrypted)).toEqual({ accessToken: null, machineId: null, cachedEmail: null });
    const keychain = join(dir, "keychain.vscdb");
    const db = new Database(keychain);
    db.exec("CREATE TABLE itemTable (key TEXT PRIMARY KEY, value TEXT)");
    db.prepare("INSERT INTO itemTable VALUES (?, ?)").run("storage.serviceMachineId", machineId);
    db.prepare("INSERT INTO itemTable VALUES (?, ?)").run("cursorAuth/refreshToken", "refresh-must-not-be-imported");
    db.close();
    expect(readCursorLocalAuthSync(keychain)).toEqual({ accessToken: null, machineId, cachedEmail: null });
    expect(readCursorLocalAuthSync(join(dir, "missing.vscdb"))).toBeNull();
  });
});

describe("headers and model discovery", () => {
  it("derives the request checksum from the fake clock and the account's machine ID", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const service = new CursorService();
    const timestamp = String(Math.floor(NOW / 1000));
    let key = 165;
    const bytes = [...timestamp].map((ch) => { const out = ch.charCodeAt(0) ^ key; key = (key + ch.charCodeAt(0)) & 0xff; return out; });
    expect(service.generateChecksum("m-a")).toBe(`${Buffer.from(bytes).toString("base64")},m-a`);
    expect(service.buildHeaders("tok-b", "m-b")).toMatchObject({ Authorization: "Bearer tok-b", "x-cursor-checksum": expect.stringMatching(/,m-b$/), "x-ghost-mode": "false" });
  });

  it("skips catalog discovery before network when the account lacks a machine ID", async () => {
    expect(await resolveCursorModels({ accessToken: "a".repeat(60), providerSpecificData: {} })).toBeNull();
    expect(await resolveCursorModels({ providerSpecificData: { machineId: "m" } })).toBeNull();
    expect(transport.calls).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// Staging-only: the helper is not wired into routes yet. When the auth batch
// registers it, move these into positive route tests and delete this block.
describe("staged web wiring (src/lib/oauth/providerParity/cursor)", () => {
  const dir = resolve(__dirname, "../../src/lib/oauth/providerParity/cursor");

  it("registration lists exactly the module's exports and stays unregistered", async () => {
    const helper = await import("../../src/lib/oauth/providerParity/cursor/index.js");
    const registration = JSON.parse(readFileSync(join(dir, "registration.json"), "utf8"));
    expect(registration).toMatchObject({ issue: "#2034", status: "staged-unregistered", webSafe: true });
    expect(registration.source.commit).toBe("b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523");
    expect(Object.keys(registration.exports).sort()).toEqual(Object.keys(helper).sort());
    expect(readFileSync(join(dir, "index.js"), "utf8")).not.toMatch(/from "(node:|fs|path|os|child_process|better-sqlite3)/);
  });

  it("reads only the exact refresh key and matches accounts by subject", async () => {
    const helper = await import("../../src/lib/oauth/providerParity/cursor/index.js");
    const root = mkdtempSync(join((await env).root, "staged-"));
    const path = join(root, "state.vscdb");
    const db = new Database(path);
    db.exec("CREATE TABLE itemTable (key TEXT PRIMARY KEY, value TEXT)");
    db.prepare("INSERT INTO itemTable VALUES (?, ?)").run("cursorAuth/otherRefreshToken", "decoy");
    expect(helper.readCursorRefreshTokenFromDb(db)).toBeNull();
    db.prepare("INSERT INTO itemTable VALUES (?, ?)").run("cursorAuth/refreshToken", JSON.stringify(" rt-synthetic "));
    expect(helper.readCursorRefreshTokenFromDb(db)).toBe("rt-synthetic");
    db.close();
    expect(helper.readCursorRefreshTokenFromDb({ prepare() { throw new Error("file is encrypted"); } })).toBeNull();
    expect(helper.normalizeCursorImportRefreshToken("has space")).toBeNull();
    const rows = [
      { id: "1", provider: "cursor", authType: "oauth", providerSpecificData: { userId: "u-a" } },
      { id: "2", provider: "cursor", authType: "apikey", providerSpecificData: { accountId: "u-b" } },
    ];
    expect(helper.findCursorAccountConnection(rows, "u-a")?.id).toBe("1");
    expect(helper.findCursorAccountConnection(rows, "u-b")).toBeNull();
    expect(helper.findCursorAccountConnection(rows, null)).toBeNull();
    expect(helper.cursorImportConnectionValues({
      tokenData: { accessToken: "at", machineId: "m", expiresIn: 60 },
      identity: { userId: "u-a", email: "a@example.invalid", name: "a@example.invalid" },
      refreshToken: " rt ", now: NOW,
    })).toMatchObject({ refreshToken: "rt", expiresAt: new Date(NOW + 60000).toISOString(), providerSpecificData: { accountId: "u-a", authMethod: "imported" } });
  });
});
