import fs from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createBetterSqliteAdapter } from "../../../src/lib/db/adapters/betterSqliteAdapter.js";
import initialMigration from "../../../src/lib/db/migrations/001-initial.js";

const state = await vi.hoisted(async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const originalDataDir = process.env.DATA_DIR;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "web-login-persistence-"));
  // dataDir is read during module collection, not just during writes.
  process.env.DATA_DIR = dataDir;
  return {
    getAdapter: vi.fn(),
    getAdapterSync: vi.fn(() => { throw new Error("Persistence fixture adapter is not initialized"); }),
    isOperatorRequest: vi.fn(), dataDir, originalDataDir,
  };
});
vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: state.getAdapter,
  getAdapterSync: state.getAdapterSync,
}));
vi.mock("@/dashboardGuard", () => ({
  canAccessManagementApi: async () => true,
  isOperatorRequest: state.isOperatorRequest,
  hasExactRequestOrigin: () => true,
}));
// Only adapter lookup is deferred: creation, transaction and encryption are real.
vi.mock("@/models", async () => ({
  ...(await import("../../../src/lib/db/repos/connectionsRepo.js")),
  getProviderNodeById: vi.fn(), getProviderNodes: vi.fn(), getProxyPoolById: vi.fn(),
}));
vi.mock("open-sse/providers/registry/index.js", () => ({ default: [
  { id: "cookie-web", alias: "cookie-web", category: "webCookie", authType: "cookie", display: { name: "Cookie Web" }, webLogin: { origin: "https://provider.example", cookieNames: ["session"], cookiePrefixes: ["session."] } },
  { id: "probe-web", alias: "probe-web", category: "webCookie", authType: "cookie", display: { name: "Probe Web" }, webLogin: { origin: "https://provider.example", cookieNames: "*", readyProbe: { url: "https://provider.example/session" } } },
] }));

import { POST as start } from "../../../src/app/api/providers/web-login/start/route.js";
import { POST as finish } from "../../../src/app/api/providers/web-login/finish/route.js";
import { POST as cancel } from "../../../src/app/api/providers/web-login/cancel/route.js";
import { POST as createHttpProvider } from "../../../src/app/api/providers/route.js";
import { sessionFromRequest, absorbSetCookies, destroySession, beginSession, SESSION_TTL_MS } from "../../../src/lib/webLoginSession.js";
import { getProviderConnectionById } from "../../../src/lib/db/repos/connectionsRepo.js";

const DASHBOARD = "https://dashboard.example";
let db;
let sessions;
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function request(action, body = {}, cookie = "") {
  return new NextRequest(`${DASHBOARD}/api/providers/web-login/${action}`, {
    method: "POST", headers: { "content-type": "application/json", "x-9r-cli-token": "operator-fixture", origin: DASHBOARD, cookie },
    body: JSON.stringify(body),
  });
}
async function begin(provider = "cookie-web", previousCookie = "") {
  const response = await start(request("start", { provider }, previousCookie));
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const sess = sessionFromRequest(request("finish", {}, cookie));
  sessions.push(sess);
  absorbSetCookies(sess, new Response(null, { headers: { "set-cookie": "session=fixture-cookie; Path=/" } }), "https://provider.example/login");
  return { cookie, sess, provider };
}
function save(login, name = "Account") {
  return finish(request("finish", { provider: login.provider, name }, login.cookie));
}
function rows() { return db.all("SELECT * FROM providerConnections"); }
function holdAdapter() {
  const entered = deferred();
  const release = deferred();
  state.getAdapter.mockImplementationOnce(async () => {
    entered.resolve();
    await release.promise;
    return db;
  });
  return { entered: entered.promise, release: release.resolve };
}

beforeEach(() => {
  sessions = [];
  vi.stubEnv("BASE_URL", DASHBOARD);
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
  vi.stubEnv("DURINDOOR_WEB_LOGIN_ORIGIN", "https://login.example");
  db = createBetterSqliteAdapter(":memory:");
  initialMigration.up(db);
  state.getAdapter.mockReset().mockResolvedValue(db);
  state.getAdapterSync.mockReset().mockReturnValue(db);
  state.isOperatorRequest.mockReset().mockResolvedValue(true);
});
afterEach(() => {
  for (const sess of sessions) destroySession(sess.id);
  db.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
afterAll(() => {
  if (state.originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = state.originalDataDir;
  fs.rmSync(state.dataDir, { recursive: true, force: true });
});

describe("web-login real persistence commit fence", () => {
  it("commits a valid finish encrypted at rest and returns a sanitized connection", async () => {
    const login = await begin();
    const headers = new Headers();
    for (const value of ["session=stale; Path=/", "session.1=second; Path=/", "cf_clearance=clear; Path=/", "session.0=first; Path=/"]) headers.append("Set-Cookie", value);
    absorbSetCookies(login.sess, new Response(null, { headers }), "https://provider.example/login");
    const response = await save(login, " Account ");
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.connection).toMatchObject({ provider: "cookie-web", authType: "cookie", name: "Account" });
    expect(body.connection).not.toHaveProperty("apiKey");
    expect(body.connection).not.toHaveProperty("sessionToken");
    expect(JSON.stringify(body)).not.toContain("session.0=first");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(sessionFromRequest(request("finish", {}, login.cookie))).toBeNull();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].data).not.toContain("session.0=first; session.1=second; cf_clearance=clear");
    expect(JSON.parse(rows()[0].data).apiKey).toMatchObject({ v: 1 });
    expect(await getProviderConnectionById(body.connection.id)).toMatchObject({
      name: "Account", authType: "cookie", apiKey: "session.0=first; session.1=second; cf_clearance=clear",
    });
  });

  it("retains a live login after adapter failure and retries through the real repository", async () => {
    const login = await begin();
    const entered = deferred();
    const release = deferred();
    state.getAdapter.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      throw new Error("Fixture adapter lookup failed");
    });
    const pending = save(login);
    await entered.promise;
    expect(rows()).toHaveLength(0);
    release.resolve();
    expect((await pending).status).toBe(500);
    expect(rows()).toHaveLength(0);
    expect(login.sess.finishing).toBe(false);
    expect(sessionFromRequest(request("finish", {}, login.cookie))).toBe(login.sess);
    const response = await save(login);
    expect(response.status).toBe(201);
    expect(rows()).toHaveLength(1);
    const { connection } = await response.json();
    expect((await getProviderConnectionById(connection.id)).apiKey).toBe("session=fixture-cookie");
  });

  it.each(["cancel", "expire", "replace", "identity", "provider", "owner", "origin"])("rejects %s while real repository adapter lookup is held", async (transition) => {
    const login = await begin();
    const boundary = holdAdapter();
    const pending = save(login);
    await boundary.entered;
    let replacement;
    if (transition === "cancel") expect((await cancel(request("cancel", { provider: login.provider }, login.cookie))).status).toBe(200);
    if (transition === "expire") login.sess.createdAt = Date.now() - SESSION_TTL_MS;
    if (transition === "replace") replacement = await begin("cookie-web", login.cookie);
    if (transition === "identity") {
      const impostor = beginSession("cookie-web", { id: login.sess.id, owner: login.sess.owner, dashboardOrigin: login.sess.dashboardOrigin, loginOrigin: login.sess.loginOrigin });
      sessions.push(impostor);
    }
    if (transition === "provider") login.sess.provider = "probe-web";
    if (transition === "owner") login.sess.owner = "different-operator";
    if (transition === "origin") login.sess.dashboardOrigin = "https://other.example";
    boundary.release();
    expect((await pending).status).toBe(409);
    expect(rows()).toHaveLength(0);
    expect(login.sess.finishing).toBe(false);
    if (replacement) {
      expect(sessionFromRequest(request("finish", {}, replacement.cookie))).toBe(replacement.sess);
      expect((await save(replacement, "Replacement")).status).toBe(201);
      expect(rows()).toHaveLength(1);
      expect(rows()[0].name).toBe("Replacement");
    }
  });

  it("cancels during asynchronous readiness without reaching persistence and allows a later replacement", async () => {
    const login = await begin("probe-web");
    const entered = deferred();
    const release = deferred();
    vi.stubGlobal("fetch", vi.fn(async () => {
      entered.resolve();
      await release.promise;
      return new Response("{}", { status: 200 });
    }));
    const pending = save(login);
    await entered.promise;
    expect((await cancel(request("cancel", { provider: login.provider }, login.cookie))).status).toBe(200);
    release.resolve();
    expect((await pending).status).toBe(409);
    expect(state.getAdapter).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(0);
    const replacement = await begin();
    expect((await save(replacement)).status).toBe(201);
    expect(rows()).toHaveLength(1);
  });

  it("does not clear a replacement login cookie when an older finish returns after its commit", async () => {
    const login = await begin();
    const boundary = holdAdapter();
    const pending = save(login);
    await boundary.entered;
    const operatorEntered = deferred();
    const operatorRelease = deferred();
    state.isOperatorRequest.mockImplementationOnce(async () => {
      operatorEntered.resolve();
      await operatorRelease.promise;
      return true;
    });
    boundary.release();
    await operatorEntered.promise;
    expect(rows()).toHaveLength(1);
    const replacement = await begin("cookie-web", login.cookie);
    operatorRelease.resolve();
    const response = await pending;
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(sessionFromRequest(request("finish", {}, replacement.cookie))).toBe(replacement.sess);
    expect((await save(replacement, "Replacement")).status).toBe(201);
    expect(rows()).toHaveLength(2);
  });

  it("does not accept commit options from HTTP body, headers or Next route context", async () => {
    const req = new NextRequest(`${DASHBOARD}/api/providers`, {
      method: "POST", headers: { "content-type": "application/json", "x-should-commit": "false" },
      body: JSON.stringify({ provider: "cookie-web", name: "HTTP Account", apiKey: "session=fixture-cookie", shouldCommit: false }),
    });
    const response = await createHttpProvider(req, { params: Promise.resolve({}), shouldCommit: () => false });
    expect(response.status).toBe(201);
    expect(rows()).toHaveLength(1);
  });
});
