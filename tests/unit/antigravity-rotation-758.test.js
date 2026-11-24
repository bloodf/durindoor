import { fork } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QUOTA_WRITE_LOCK_SQL } from "../../src/lib/db/repos/quotaSql.js";

const workerUrl = new URL("./antigravity-lease-worker.js", import.meta.url);
const SECRET = "recovery-secret-should-not-leak";
const SAME_TOKEN = "refresh-same";
const NEW_TOKEN = "refresh-new";

let tempDir;
let originalDataDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-rot-"));
  originalDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  vi.restoreAllMocks();
});

afterEach(async () => {
  try { global._dbAdapter?.close?.(); } catch { /* already closed */ }
  delete global._dbAdapter;
  vi.restoreAllMocks();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function openDb() {
  const { getAdapter } = await import("../../src/lib/db/driver.js");
  return getAdapter();
}

function insertConnection(db, id, refreshToken, subject = "subject-1") {
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
     VALUES(?, 'antigravity', 'oauth', 'agy', 'hidden@example.com', 1, 1, ?, ?, ?)`,
    [id, JSON.stringify({
      refreshToken,
      providerSpecificData: { antigravitySubject: subject, projectId: "project-1" },
    }), now, now]
  );
}

async function revision(token) {
  const { credentialRevision } = await import("../../src/lib/antigravity/leaseSql.js");
  return credentialRevision(token);
}

describe("antigravity rotation lease", () => {
  it.each([false, true])("fences a sent exchange on management action (delete credential: %s)", async (deleteCredential) => {
    const db = await openDb();
    const { acquireAntigravityLease, markAntigravityDispatched, clearAntigravityLease,
      fenceAntigravityRecovery, advanceAntigravityGeneration } = await import("../../src/lib/antigravity/leaseSql.js");
    insertConnection(db, "fenced", SAME_TOKEN);
    const first = acquireAntigravityLease(db, { connectionId: "fenced", refreshToken: SAME_TOKEN, owner: "first" });
    expect(first.ok).toBe(true);
    expect(markAntigravityDispatched(db, first.lease)).toBe(true);
    db.run(`INSERT INTO antigravityRecoveryCredentials(connectionId, ciphertext, fieldName, updatedAt) VALUES(?, ?, 'recoveryPassword', ?)`, ["fenced", "synthetic", Date.now()]);
    db.transaction(() => fenceAntigravityRecovery(db, "fenced", { deleteCredential }));
    expect(clearAntigravityLease(db, first.lease, NEW_TOKEN)).toBe(false);
    expect(acquireAntigravityLease(db, { connectionId: "fenced", refreshToken: SAME_TOKEN, owner: "second", force: true }))
      .toMatchObject({ ok: false, category: "uncertain_dispatch" });
    expect(Boolean(db.get(`SELECT connectionId FROM antigravityRecoveryCredentials WHERE connectionId = ?`, ["fenced"]))).toBe(!deleteCredential);
    advanceAntigravityGeneration(db, "fenced", SAME_TOKEN);
    expect(acquireAntigravityLease(db, { connectionId: "fenced", refreshToken: SAME_TOKEN, owner: "third" }))
      .toMatchObject({ ok: false, category: "uncertain_dispatch" });
    advanceAntigravityGeneration(db, "fenced", NEW_TOKEN);
    expect(acquireAntigravityLease(db, { connectionId: "fenced", refreshToken: SAME_TOKEN, owner: "stale" }))
      .toMatchObject({ ok: false, category: "reauth_required" });
    expect(acquireAntigravityLease(db, { connectionId: "fenced", refreshToken: NEW_TOKEN, owner: "fourth" }).ok).toBe(true);
  });

  it("lets one of two blocked workers claim the refresh", async () => {
    const db = await openDb();
    const { currentDataFile } = await import("../../src/lib/db/paths.js");
    const file = currentDataFile();
    db.exec("BEGIN IMMEDIATE");
    expect(db.run(QUOTA_WRITE_LOCK_SQL).changes).toBe(1);
    const claim = { connectionId: "race-1", refreshToken: SAME_TOKEN, owner: "worker", force: false };
    const workers = [0, 1].map(() => new Worker(workerUrl, { workerData: { file, claim: { ...claim, owner: `worker-${Math.random()}` } } }));
    await Promise.all(workers.map((worker) => new Promise((resolve, reject) => {
      worker.once("message", (message) => (message.phase === "started" ? resolve() : reject(new Error("worker failed before start"))));
      worker.once("error", reject);
    })));
    await new Promise((resolve) => setTimeout(resolve, 150));
    db.exec("COMMIT");
    const done = await Promise.all(workers.map((worker) => new Promise((resolve, reject) => {
      const messages = [];
      worker.on("message", (message) => {
        messages.push(message);
        if (message.phase === "done") resolve(message);
      });
      worker.once("error", reject);
    })));
    await Promise.all(workers.map((worker) => worker.terminate()));
    expect(done.filter((message) => message.ok)).toHaveLength(1);
    expect(done.filter((message) => !message.ok).map((message) => message.category)).toEqual(["busy"]);
    db.close();
  });

  it("keeps an expired dispatch uncertain across a restart and blocks reset", async () => {
    const db = await openDb();
    const { acquireAntigravityLease, markAntigravityDispatched, resetAntigravityRetryBudget } = await import("../../src/lib/antigravity/leaseSql.js");
    insertConnection(db, "restart-1", SAME_TOKEN);
    const first = acquireAntigravityLease(db, { connectionId: "restart-1", refreshToken: SAME_TOKEN, owner: "owner-a" });
    expect(first.ok).toBe(true);
    expect(markAntigravityDispatched(db, first.lease)).toBe(true);
    expect(resetAntigravityRetryBudget(db, "restart-1")).toEqual({ ok: false, category: "busy" });
    db.run(`UPDATE antigravityRefreshLeases SET leaseExpiresAt = 1 WHERE connectionId = ?`, ["restart-1"]);
    expect(resetAntigravityRetryBudget(db, "restart-1")).toEqual({ ok: false, category: "uncertain_dispatch" });
    const restarted = acquireAntigravityLease(db, { connectionId: "restart-1", refreshToken: SAME_TOKEN, owner: "owner-b" });
    expect(restarted.ok).toBe(false);
    expect(restarted.category).toBe("uncertain_dispatch");
    expect(db.get(`SELECT attemptState FROM antigravityRefreshLeases WHERE connectionId = ?`, ["restart-1"]).attemptState).toBe("uncertain");
    expect(resetAntigravityRetryBudget(db, "restart-1").category).toBe("uncertain_dispatch");
    const again = acquireAntigravityLease(db, { connectionId: "restart-1", refreshToken: SAME_TOKEN, owner: "owner-c", force: true });
    expect(again.ok).toBe(false);
    expect(again.category).toBe("uncertain_dispatch");
  });

  it("exhausts the pre-dispatch budget, honors force, and resets only while idle", async () => {
    const db = await openDb();
    const {
      acquireAntigravityLease,
      markAntigravityDispatched,
      releaseAntigravityAttempt,
      resetAntigravityRetryBudget,
    } = await import("../../src/lib/antigravity/leaseSql.js");
    insertConnection(db, "budget-1", SAME_TOKEN);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const claimed = acquireAntigravityLease(db, { connectionId: "budget-1", refreshToken: SAME_TOKEN, owner: `owner-${attempt}`, force: true });
      expect(claimed.ok).toBe(true);
      expect(markAntigravityDispatched(db, claimed.lease)).toBe(true);
      expect(releaseAntigravityAttempt(db, claimed.lease, { category: "rate_limit", retryAfterMs: 0, dispatched: true })).toBe(true);
    }
    const blocked = acquireAntigravityLease(db, { connectionId: "budget-1", refreshToken: SAME_TOKEN, owner: "owner-blocked" });
    expect(blocked).toMatchObject({ ok: false, category: "budget_exhausted" });
    const forced = acquireAntigravityLease(db, { connectionId: "budget-1", refreshToken: SAME_TOKEN, owner: "owner-forced", force: true });
    expect(forced.ok).toBe(true);
    expect(markAntigravityDispatched(db, forced.lease)).toBe(true);
    expect(releaseAntigravityAttempt(db, forced.lease, { category: "rate_limit", retryAfterMs: 0, dispatched: true })).toBe(true);
    expect(resetAntigravityRetryBudget(db, "budget-1").ok).toBe(true);
    const afterReset = acquireAntigravityLease(db, { connectionId: "budget-1", refreshToken: SAME_TOKEN, owner: "owner-after" });
    expect(afterReset.ok).toBe(true);
  });

  it("keeps a killed worker's unexpired dispatch busy, then uncertain after expiry", async () => {
    const db = await openDb();
    const { currentDataFile } = await import("../../src/lib/db/paths.js");
    const file = currentDataFile();
    const child = fork(fileURLToPath(workerUrl), [], {
      env: {
        ...process.env,
        AGY_HOLD: "1",
        AGY_DB_FILE: file,
        AGY_CONNECTION: "kill-1",
        AGY_TOKEN: SAME_TOKEN,
      },
      execArgv: [],
    });
    const held = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("killed worker did not report the lease")), 15000);
      child.once("message", (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    expect(held).toMatchObject({ phase: "held", ok: true });
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
    const { acquireAntigravityLease } = await import("../../src/lib/antigravity/leaseSql.js");
    const live = acquireAntigravityLease(db, { connectionId: "kill-1", refreshToken: SAME_TOKEN, owner: "survivor" });
    expect(live).toMatchObject({ ok: false, category: "busy" });
    expect(db.get(`SELECT attemptState FROM antigravityRefreshLeases WHERE connectionId = ?`, ["kill-1"]).attemptState).toBe("dispatched");
    db.run(`UPDATE antigravityRefreshLeases SET leaseExpiresAt = 1 WHERE connectionId = ?`, ["kill-1"]);
    const expired = acquireAntigravityLease(db, { connectionId: "kill-1", refreshToken: SAME_TOKEN, owner: "survivor-2" });
    expect(expired).toMatchObject({ ok: false, category: "uncertain_dispatch" });
    expect(db.get(`SELECT attemptState FROM antigravityRefreshLeases WHERE connectionId = ?`, ["kill-1"]).attemptState).toBe("uncertain");
  });

  it("retains uncertainty when management fences a dispatched worker that dies", async () => {
    const db = await openDb();
    const { currentDataFile } = await import("../../src/lib/db/paths.js");
    const { acquireAntigravityLease, fenceAntigravityRecovery } = await import("../../src/lib/antigravity/leaseSql.js");
    const child = fork(fileURLToPath(workerUrl), [], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, AGY_HOLD: "1", AGY_DB_FILE: currentDataFile(), AGY_CONNECTION: "fence-crash", AGY_TOKEN: SAME_TOKEN },
      execArgv: [],
    });
    try {
      const held = await new Promise((resolve, reject) => {
        child.once("message", resolve);
        child.once("error", reject);
        child.once("exit", (code) => reject(new Error(`worker exited before dispatch: ${code}`)));
      });
      expect(held).toMatchObject({ phase: "held", ok: true });
      // Let the child reach an idle event loop before fencing its live dispatch.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBeNull();
      db.transaction(() => fenceAntigravityRecovery(db, "fence-crash", { deleteCredential: true }));
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
      expect(acquireAntigravityLease(db, { connectionId: "fence-crash", refreshToken: SAME_TOKEN, owner: "survivor", force: true }))
        .toMatchObject({ ok: false, category: "uncertain_dispatch" });
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }
  }, 20_000);
});

describe("antigravity rotation storage", () => {
  it("omits recovery material from export and preserves or fences it on import", async () => {
    const db = await openDb();
    const { exportDb, importDb } = await import("../../src/lib/db/index.js");
    const { credentialRevision } = await import("../../src/lib/antigravity/leaseSql.js");
    insertConnection(db, "keep-1", SAME_TOKEN);
    insertConnection(db, "drop-1", SAME_TOKEN);
    const rev = credentialRevision(SAME_TOKEN);
    const now = Date.now();
    for (const id of ["keep-1", "drop-1"]) {
      db.run(
        `INSERT INTO antigravityRefreshLeases(connectionId, generation, attemptState, recoveryEnabled, retryCount, credentialRevision, errorCategory, updatedAt)
         VALUES(?, 4, 'uncertain', 0, 0, ?, 'uncertain_dispatch', ?)`,
        [id, rev, now]
      );
      db.run(
        `INSERT INTO antigravityRecoveryCredentials(connectionId, ciphertext, fieldName, updatedAt) VALUES(?, ?, 'recoveryPassword', ?)`,
        [id, JSON.stringify({ secret: SECRET }), now]
      );
    }
    const exported = await exportDb({ includeSecrets: true });
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("antigravityRecoveryCredentials");
    expect(serialized).not.toContain("antigravityRefreshLeases");
    expect(exported.providerConnections.some((row) => row.email === "hidden@example.com")).toBe(true);

    await expect(importDb({ ...exported, antigravityRecoveryCredentials: [{ connectionId: "keep-1" }] })).rejects.toThrow(/cannot carry Antigravity/);
    expect(db.get(`SELECT ciphertext FROM antigravityRecoveryCredentials WHERE connectionId = ?`, ["keep-1"]).ciphertext).toContain(SECRET);

    const base = {
      usageEventReceipts: [],
      providerConnections: [{
        id: "keep-1",
        provider: "antigravity",
        authType: "oauth",
        name: "agy",
        refreshToken: SAME_TOKEN,
        providerSpecificData: { antigravitySubject: "subject-1", projectId: "project-1" },
      }],
    };
    await importDb(base);
    expect(db.get(`SELECT attemptState, generation FROM antigravityRefreshLeases WHERE connectionId = ?`, ["keep-1"])).toMatchObject({ attemptState: "uncertain", generation: 4 });
    expect(db.get(`SELECT connectionId FROM antigravityRecoveryCredentials WHERE connectionId = ?`, ["keep-1"])).toBeTruthy();
    expect(db.get(`SELECT connectionId FROM antigravityRecoveryCredentials WHERE connectionId = ?`, ["drop-1"])).toBeFalsy();

    await importDb({ ...base, providerConnections: [{ ...base.providerConnections[0], refreshToken: NEW_TOKEN }] });
    expect(db.get(`SELECT attemptState, generation FROM antigravityRefreshLeases WHERE connectionId = ?`, ["keep-1"])).toMatchObject({ attemptState: "idle", generation: 5 });
    expect(db.get(`SELECT ciphertext FROM antigravityRecoveryCredentials WHERE connectionId = ?`, ["keep-1"]).ciphertext).toContain(SECRET);

    await importDb({ usageEventReceipts: [], providerConnections: [] });
    expect(db.get(`SELECT connectionId FROM antigravityRecoveryCredentials WHERE connectionId = ?`, ["keep-1"])).toBeFalsy();
    expect(db.get(`SELECT connectionId FROM antigravityRefreshLeases WHERE connectionId = ?`, ["keep-1"])).toBeFalsy();
  });
});

describe("antigravity browser boundary", () => {
  it("redacts a browser failure and removes the temporary profile", async () => {
    const { evaluateBrowserRequest, runBrowserRecovery } = await import("../../src/lib/antigravity/browserRecovery.js");
    const redirect = "http://127.0.0.1:20127/callback";
    expect(evaluateBrowserRequest(`${redirect}?code=one&state=two`, redirect, [])).toMatchObject({ action: "intercept", code: "one", state: "two" });
    expect(evaluateBrowserRequest(`${redirect}?code=one&code=two&state=two`, redirect, [])).toMatchObject({ action: "block", category: "pre_dispatch_failure" });
    expect(evaluateBrowserRequest("https://accounts.google.com/signin/oauth/consent", redirect, [])).toMatchObject({ action: "block", category: "consent" });
    expect(evaluateBrowserRequest("https://169.254.169.254/latest", redirect, ["169.254.169.254"])).toMatchObject({ action: "block", category: "network" });
    expect(evaluateBrowserRequest("https://accounts.google.com/o/oauth2/v2/auth", redirect, [])).toMatchObject({ action: "block", category: "network" });

    let profileDir = "";
    const result = await runBrowserRecovery({
      boundary: "test",
      redirectUri: redirect,
      browser: async ({ profileDir: dir }) => {
        profileDir = dir;
        expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
        return { ok: false, category: "challenge", html: SECRET, url: "https://accounts.google.com/secret" };
      },
    });
    expect(result).toEqual({ ok: false, category: "challenge" });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(profileDir).not.toBe("");
    expect(fs.existsSync(profileDir)).toBe(false);
    delete process.env.DURINDOOR_ANTIGRAVITY_BROWSER_RECOVERY;
    delete process.env.DURINDOOR_ANTIGRAVITY_EGRESS_ENFORCED;
    const unavailable = await runBrowserRecovery({ redirectUri: redirect, authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth" });
    expect(unavailable).toEqual({ ok: false, category: "browser_unavailable" });
  });

  it("enters a synthetic password only on the recognized password screen and captures the callback", async () => {
    const redirect = "http://127.0.0.1:20127/callback";
    const typed = [];
    let handler;
    vi.resetModules();
    vi.doMock("puppeteer-extra", () => ({ default: {
      use() {},
      async launch() { return {
        async newPage() { return {
          async setRequestInterception() {},
          mainFrame: () => null,
          on(_event, fn) { handler = fn; },
          async goto() {},
          url: () => "https://accounts.google.com/signin/v2/challenge/pwd",
          async $(selector) {
            if (selector === 'input[type="password"][name="Passwd"]') return { type: async (value) => typed.push(value) };
            if (selector === "#passwordNext") return { click: async () => {
              await handler({ url: () => `${redirect}?code=synthetic-code&state=expected`, isNavigationRequest: () => true, frame: () => null, abort: async () => {}, continue: async () => {} });
            } };
            return null;
          },
          async waitForNavigation() { throw new Error("aborted navigation"); },
        }; },
        async close() {},
      }; },
    } }));
    vi.doMock("puppeteer-extra-plugin-stealth", () => ({ default: () => ({}) }));
    const { runBrowserRecovery } = await import("../../src/lib/antigravity/browserRecovery.js");
    const result = await runBrowserRecovery({
      env: { DURINDOOR_ANTIGRAVITY_BROWSER_RECOVERY: "1", DURINDOOR_ANTIGRAVITY_EGRESS_ENFORCED: "1" },
      redirectUri: redirect, authorizeUrl: "https://accounts.google.com/", state: "expected", password: "synthetic-password",
    });
    expect(typed).toEqual(["synthetic-password"]);
    expect(result).toEqual({ ok: true, code: "synthetic-code", state: "expected" });
    vi.doUnmock("puppeteer-extra");
    vi.doUnmock("puppeteer-extra-plugin-stealth");
  });

  it.each([
    ["https://accounts.google.com/signin/oauth/consent", "consent"],
    ["https://accounts.google.com/signin/v2/challenge/otp", "challenge"],
    ["http://127.0.0.1:20127/callback?code=synthetic-code&state=wrong", "pre_dispatch_failure"],
  ])("stops without entering credentials on %s", async (target, category) => {
    let handler;
    const type = vi.fn();
    vi.resetModules();
    vi.doMock("puppeteer-extra", () => ({ default: {
      use() {},
      async launch() { return {
        async newPage() {
          const frame = {};
          return {
            async setRequestInterception() {}, on(_event, fn) { handler = fn; },
            mainFrame: () => frame,
            async goto() {
              await handler({ url: () => target, isNavigationRequest: () => true, frame: () => frame, abort: async () => {}, continue: async () => {} });
              throw new Error("aborted");
            },
            url: () => target,
            async $() { return { type }; },
          };
        },
        async close() {},
      }; },
    } }));
    vi.doMock("puppeteer-extra-plugin-stealth", () => ({ default: () => ({}) }));
    const { runBrowserRecovery } = await import("../../src/lib/antigravity/browserRecovery.js");
    const result = await runBrowserRecovery({
      env: { DURINDOOR_ANTIGRAVITY_BROWSER_RECOVERY: "1", DURINDOOR_ANTIGRAVITY_EGRESS_ENFORCED: "1" },
      redirectUri: "http://127.0.0.1:20127/callback", authorizeUrl: target, state: "expected", password: "synthetic-password",
    });
    expect(result).toEqual({ ok: false, category });
    expect(type).not.toHaveBeenCalled();
    vi.doUnmock("puppeteer-extra");
    vi.doUnmock("puppeteer-extra-plugin-stealth");
  });

  it("returns an intercepted callback when the navigation aborts", async () => {
    const redirect = "http://127.0.0.1:20127/callback";
    const target = `${redirect}?code=one&state=two`;
    vi.resetModules();
    vi.doMock("puppeteer-extra", () => ({
      default: {
        use() {},
        async launch() {
          return {
            async newPage() {
              let handler;
              return {
                async setRequestInterception() {},
                mainFrame: () => null,
                on(_event, next) { handler = next; },
                async goto() {
                  await handler({
                    url: () => target,
                    isNavigationRequest: () => true, frame: () => null,
                    abort: async () => {},
                    continue: async () => {},
                  });
                  throw new Error("net::ERR_BLOCKED_BY_CLIENT");
                },
              };
            },
            async close() {},
          };
        },
      },
    }));
    vi.doMock("puppeteer-extra-plugin-stealth", () => ({ default: () => ({}) }));
    const { runBrowserRecovery } = await import("../../src/lib/antigravity/browserRecovery.js");
    const result = await runBrowserRecovery({
      env: {
        DURINDOOR_ANTIGRAVITY_BROWSER_RECOVERY: "1",
        DURINDOOR_ANTIGRAVITY_EGRESS_ENFORCED: "1",
      },
      redirectUri: redirect,
      authorizeUrl: target,
      state: "two",
    });
    expect(result).toEqual({ ok: true, code: "one", state: "two" });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    vi.doUnmock("puppeteer-extra");
    vi.doUnmock("puppeteer-extra-plugin-stealth");
  });
});

describe("antigravity rotation route", () => {
  async function route() {
    const session = await import("../../src/lib/auth/dashboardSession.js");
    const guard = await import("../../src/dashboardGuard.js");
    vi.spyOn(session, "verifyDashboardPassword").mockResolvedValue(true);
    vi.spyOn(session, "isUsingDefaultPassword").mockResolvedValue(false);
    vi.spyOn(guard, "hasValidCliToken").mockResolvedValue(true);
    vi.spyOn(guard, "hasValidToken").mockResolvedValue(false);
    return import("../../src/app/api/oauth/antigravity/rotation/route.js");
  }

  function request(method, { origin, body, connectionId } = {}) {
    const headers = { host: "localhost:20127" };
    if (origin) headers.origin = origin;
    if (method === "POST") headers["x-9r-password"] = "not-the-real-password";
    const url = new URL("http://localhost:20127/api/oauth/antigravity/rotation");
    if (connectionId) url.searchParams.set("connectionId", connectionId);
    return new Request(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  }

  it.each(["disable", "delete"])("keeps a dispatched refresh blocked after %s", async (action) => {
    const db = await openDb();
    const { openAntigravityLease } = await import("../../src/lib/antigravity/refreshProtocol.js");
    const { acquireAntigravityLease } = await import("../../src/lib/antigravity/leaseSql.js");
    insertConnection(db, "route-fence", SAME_TOKEN);
    const session = await openAntigravityLease({ id: "route-fence", refreshToken: SAME_TOKEN });
    expect(session.ok).toBe(true);
    expect(session.markDispatched()).toBe(true);
    const { POST } = await route();
    expect((await POST(request("POST", { body: { action, connectionId: "route-fence" } }))).status).toBe(200);
    expect(session.commit({ accessToken: "synthetic-access" }, null, NEW_TOKEN)).toBe(false);
    expect(acquireAntigravityLease(db, { connectionId: "route-fence", refreshToken: SAME_TOKEN, owner: "after-crash", force: true }))
      .toMatchObject({ ok: false, category: "uncertain_dispatch" });
  });

  it("rejects a missing session, a foreign origin, an oversized body, and the default password", async () => {
    const guard = await import("../../src/dashboardGuard.js");
    const session = await import("../../src/lib/auth/dashboardSession.js");
    vi.spyOn(guard, "hasValidCliToken").mockResolvedValue(false);
    vi.spyOn(guard, "hasValidToken").mockResolvedValue(false);
    const { GET, POST } = await import("../../src/app/api/oauth/antigravity/rotation/route.js");
    expect((await GET(request("GET"))).status).toBe(401);
    vi.spyOn(guard, "hasValidCliToken").mockResolvedValue(true);
    expect((await POST(request("POST", { origin: "https://evil.example", body: { action: "enable", connectionId: "keep-1" } }))).status).toBe(403);
    vi.spyOn(session, "isUsingDefaultPassword").mockResolvedValue(true);
    vi.spyOn(session, "verifyDashboardPassword").mockResolvedValue(true);
    const oversized = request("POST", { body: { action: "enroll" } });
    oversized.headers.set("content-length", "9000");
    expect((await POST(oversized)).status).toBe(413);
    const denied = await POST(request("POST", { body: { action: "enroll", connectionId: "keep-1", recoveryPassword: SECRET } }));
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain(SECRET);
  });

  it("rejects editable subjects and legacy consent without writing credentials", async () => {
    const db = await openDb();
    insertConnection(db, "acct-1", SAME_TOKEN, "subject-1");
    const { POST, GET } = await route();
    for (const action of ["enroll", "replace", "enable"]) {
      const response = await POST(request("POST", { body: { action, connectionId: "acct-1", recoveryPassword: SECRET } }));
      expect(response.status).toBe(409);
      expect(await response.text()).not.toContain(SECRET);
    }
    expect(db.get(`SELECT connectionId FROM antigravityRecoveryCredentials WHERE connectionId = ?`, ["acct-1"])).toBeFalsy();
    const status = await GET(request("GET", { connectionId: "acct-1" }));
    const body = await status.json();
    expect(body.subjectPresent).toBe(false);
    expect(body.recoveryEnabled).toBe(false);
    expect(body.schedulerEnabled).toBe(false);
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });
});

describe("antigravity CLI PKCE", () => {
  it("requires a challenge and verifier and hides provider bodies", async () => {
    const { AntigravityService } = await import("../../src/lib/oauth/services/antigravity.js");
    const service = new AntigravityService();
    expect(() => service.buildAuthUrl("http://127.0.0.1/callback", "state")).toThrow(/PKCE challenge/);
    const url = new URL(service.buildAuthUrl("http://127.0.0.1/callback", "state", "challenge-value"));
    expect(url.searchParams.get("code_challenge")).toBe("challenge-value");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    await expect(service.exchangeCode("code", "http://127.0.0.1/callback")).rejects.toThrow(/PKCE verifier/);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("raw-provider-secret", { status: 400 }));
    await expect(service.exchangeCode("code", "http://127.0.0.1/callback", "verifier")).rejects.toThrow(/400/);
    await expect(service.exchangeCode("code", "http://127.0.0.1/callback", "verifier")).rejects.not.toThrow(/raw-provider-secret/);
    fetchMock.mockRestore();
  });
});
