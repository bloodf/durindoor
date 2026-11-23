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
    db.run(`UPDATE antigravityRefreshLeases SET leaseExpiresAt = 1 WHERE connectionId = ?`, ["restart-1"]);
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

  it("enrolls only with a subject and keeps the password out of status", async () => {
    const db = await openDb();
    insertConnection(db, "acct-1", SAME_TOKEN, "");
    const { POST, GET } = await route();
    const missingSubject = await POST(request("POST", { body: { action: "enroll", connectionId: "acct-1", recoveryPassword: SECRET } }));
    expect(missingSubject.status).toBe(409);
    expect(db.get(`SELECT connectionId FROM antigravityRecoveryCredentials WHERE connectionId = ?`, ["acct-1"])).toBeFalsy();
    db.run(`UPDATE providerConnections SET data = ? WHERE id = ?`, [JSON.stringify({
      refreshToken: SAME_TOKEN,
      providerSpecificData: { antigravitySubject: "subject-1", projectId: "project-1" },
    }), "acct-1"]);
    const enrolled = await POST(request("POST", { body: { action: "enroll", connectionId: "acct-1", recoveryPassword: SECRET } }));
    expect(enrolled.status).toBe(200);
    const payload = await enrolled.json();
    expect(JSON.stringify(payload)).not.toContain(SECRET);
    expect(payload.subjectPresent).toBe(true);
    expect(payload.recoveryEnabled).toBe(false);
    const stored = db.get(`SELECT ciphertext FROM antigravityRecoveryCredentials WHERE connectionId = ?`, ["acct-1"]).ciphertext;
    expect(stored).not.toContain(SECRET);
    const blank = await POST(request("POST", { body: { action: "replace", connectionId: "acct-1", recoveryPassword: "" } }));
    expect(blank.status).toBe(400);
    expect(db.get(`SELECT ciphertext FROM antigravityRecoveryCredentials WHERE connectionId = ?`, ["acct-1"]).ciphertext).toBe(stored);
    const enabled = await POST(request("POST", { body: { action: "enable", connectionId: "acct-1" } }));
    expect(enabled.status).toBe(200);
    expect((await enabled.json()).recoveryEnabled).toBe(true);
    const status = await GET(request("GET", { connectionId: "acct-1" }));
    const body = await status.json();
    expect(body.schedulerEnabled).toBe(false);
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(body.email).toBeUndefined();
    expect(body.subject).toBeUndefined();
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
