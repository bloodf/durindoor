import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyBrowserUrl, runBrowserRecovery } from "../../src/lib/antigravity/browserRecovery.js";
import { readAntigravityScheduler, runAntigravitySchedulerTick } from "../../src/lib/antigravity/scheduler.js";

const redirect = "http://127.0.0.1:20127/callback";

describe("Antigravity recovery boundaries", () => {
  it("does not dispatch scheduled work while recovery gates are unproven", async () => {
    const listConnections = vi.fn();
    const refresh = vi.fn();
    expect(await readAntigravityScheduler()).toEqual({ enabled: false });
    expect(await runAntigravitySchedulerTick({ listConnections, refresh })).toEqual({ skipped: "disabled" });
    expect(listConnections).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("matches the exact callback and rejects missing or duplicate state and code", () => {
    expect(classifyBrowserUrl(`${redirect}?code=synthetic&state=expected`, redirect))
      .toEqual({ action: "intercept", code: "synthetic", state: "expected" });
    for (const query of ["code=synthetic", "state=expected", "code=a&code=b&state=expected", "code=a&state=x&state=y"]) {
      expect(classifyBrowserUrl(`${redirect}?${query}`, redirect).action).toBe("block");
    }
    expect(classifyBrowserUrl("http://127.0.0.1:20127/callback/other?code=a&state=b", redirect).action).toBe("block");
  });

  it("rejects mismatched state from a synthetic browser", async () => {
    const browser = vi.fn(async () => ({ ok: true, code: "synthetic-code", state: "other" }));
    expect(await runBrowserRecovery({ boundary: "test", browser, redirectUri: redirect, state: "expected" }))
      .toEqual({ ok: false, category: "pre_dispatch_failure" });
    expect(browser).toHaveBeenCalledOnce();
  });

  it("stops on consent, MFA, and unknown screens without returning browser details", async () => {
    expect(classifyBrowserUrl("https://accounts.google.com/signin/oauth/consent", redirect))
      .toEqual({ action: "block", category: "consent" });
    expect(classifyBrowserUrl("https://accounts.google.com/signin/v2/challenge/totp", redirect))
      .toEqual({ action: "block", category: "challenge" });
    for (const category of ["consent", "challenge", "unrecognized-screen"]) {
      const result = await runBrowserRecovery({ boundary: "test", redirectUri: redirect, state: "expected", browser: async () => ({ ok: false, category, detail: "synthetic-secret" }) });
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("synthetic-secret");
    }
  });
});

describe("management and stored credential", () => {
  let dir;
  let previousDataDir;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "agy-wiring-"));
    previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = dir;
    delete global._dbAdapter;
    vi.resetModules();
  });

  afterEach(() => {
    try { global._dbAdapter?.close?.(); } catch { /* already closed */ }
    delete global._dbAdapter;
    vi.restoreAllMocks();
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("rejects unauthenticated management requests", async () => {
    const guard = await import("../../src/dashboardGuard.js");
    vi.spyOn(guard, "hasValidCliToken").mockResolvedValue(false);
    vi.spyOn(guard, "hasValidToken").mockResolvedValue(false);
    const { GET } = await import("../../src/app/api/oauth/antigravity/rotation/route.js");
    const response = await GET(new Request("http://localhost:20127/api/oauth/antigravity/rotation", {
      headers: { host: "localhost:20127" },
    }));
    expect(response.status).toBe(401);
  });

  it("binds encrypted synthetic passwords to their connection", async () => {
    const { getAdapter } = await import("../../src/lib/db/driver.js");
    const { writeRecoveryPassword, readRecoveryPassword } = await import("../../src/lib/antigravity/recoveryStore.js");
    const db = await getAdapter();
    const now = new Date().toISOString();
    for (const id of ["subject-one", "subject-two"]) {
      db.run(`INSERT INTO providerConnections(id, provider, authType, name, priority, isActive, data, createdAt, updatedAt)
        VALUES (?, 'antigravity', 'oauth', 'fixture', 1, 1, '{}', ?, ?)`, [id, now, now]);
    }
    writeRecoveryPassword(db, "subject-one", "synthetic-password");
    const row = db.get("SELECT ciphertext FROM antigravityRecoveryCredentials WHERE connectionId = ?", ["subject-one"]);
    expect(row.ciphertext).not.toContain("synthetic-password");
    expect(readRecoveryPassword(db, "subject-one")).toBe("synthetic-password");
    expect(readRecoveryPassword(db, "subject-two")).toBeNull();
    db.run("INSERT INTO antigravityRecoveryCredentials(connectionId, ciphertext, fieldName, updatedAt) VALUES (?, ?, ?, ?)",
      ["subject-two", row.ciphertext, "recoveryPassword", Date.now()]);
    expect(() => readRecoveryPassword(db, "subject-two")).toThrow();
  });
});
