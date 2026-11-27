// CLIProxyAPI auth lifecycle parity (#2034). Source: router-for-me/CLIProxyAPI
// (MIT) 42b13fff, 6021aba9, 32c0c459, 37caab7d, ee8b3f0c, e1e87409 at dbe641f.
// Synthetic rows only: disposable HOME/DATA_DIR, real SQLite, mocked executors,
// no provider network and no live account.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disposeLoadedRequestDetailsRepo } from "../utils/requestDetailsCleanup.js";

vi.mock("node-machine-id", () => ({ machineIdSync: () => "synthetic-lifecycle-machine-id" }));

const HOUR = 60 * 60 * 1000;

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function iso(ms) {
  return new Date(ms).toISOString();
}

describe("CPA auth lifecycle parity on the connection store", () => {
  let root;
  let database;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cpa-auth-lifecycle-"));
    vi.stubEnv("DATA_DIR", path.join(root, "data"));
    vi.stubEnv("HOME", path.join(root, "home"));
    vi.stubEnv("DURINDOOR_DATABASE_ENGINE", "sqlite");
    vi.stubEnv("CODEX_REFRESH_SPACING_MS", "0");
    for (const key of ["DURINDOOR_PG_URL", "DURINDOOR_PG_SSLMODE", "DURINDOOR_DATABASE_ENV_SOURCE_JSON"]) {
      vi.stubEnv(key, undefined);
    }
    fs.mkdirSync(process.env.HOME, { recursive: true });
    delete global._dbAdapter;
    vi.resetModules();
    database = await import("@/lib/db/index.js");
  });

  afterEach(async () => {
    await global._dbAdapter?.instance?.close?.();
    delete global._dbAdapter;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await disposeLoadedRequestDetailsRepo();
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function seedOAuth(overrides = {}) {
    return database.createProviderConnection({
      provider: "claude",
      authType: "oauth",
      name: `synthetic-${Math.random().toString(36).slice(2, 8)}`,
      email: `${Math.random().toString(36).slice(2, 8)}@fixture.invalid`,
      accessToken: "synthetic-access-old",
      refreshToken: "synthetic-refresh-old",
      expiresAt: iso(Date.now() - 1000),
      testStatus: "active",
      isActive: true,
      ...overrides,
    });
  }

  async function seedApiKey(id, data) {
    const { getAdapter } = await import("@/lib/db/driver.js");
    const db = await getAdapter();
    const createdAt = iso(Date.now() - 60_000);
    db.run(
      `INSERT INTO providerConnections(id, provider, authType, name, priority, isActive, data, createdAt, updatedAt)
       VALUES(?, 'perplexity', 'apikey', ?, ?, 1, ?, ?, ?)`,
      [id, id, data.priority ?? 1, JSON.stringify({ apiKey: `key-${id}`, ...data }), createdAt, createdAt],
    );
  }

  describe("re-enable reconciliation (42b13fff reconcileReenabledAuthState)", () => {
    it("clears only the disabled-era automatic-disable failure", async () => {
      const at = iso(Date.now() - HOUR);
      const row = await seedOAuth({ provider: "qoder" });
      await database.updateProviderConnection(row.id, {
        isActive: false, testStatus: "unavailable", lastError: "Qoder quota exhausted (code 112)",
        errorCode: 403, lastErrorAt: at, autoDisabledReason: "Qoder quota exhausted (code 112)", autoDisabledAt: at,
      });

      const enabled = await database.updateProviderConnection(row.id, { isActive: true });
      expect(enabled).toMatchObject({
        isActive: true, testStatus: null, lastError: null, errorCode: null, lastErrorAt: null,
        autoDisabledReason: null, autoDisabledAt: null,
      });
    });

    it("keeps a sign-in failure pinned while automatically disabled", async () => {
      const disabledAt = iso(Date.now() - 2 * HOUR);
      const pinnedAt = iso(Date.now() - HOUR);
      const row = await seedOAuth({ provider: "qoder" });
      await database.updateProviderConnection(row.id, {
        isActive: false, testStatus: "unavailable", lastError: "quota", errorCode: 403, lastErrorAt: disabledAt,
        autoDisabledReason: "quota", autoDisabledAt: disabledAt,
      });
      await database.updateProviderConnection(row.id, {
        testStatus: "reauth_required", lastError: "OAuth session expired. Reconnect this account.",
        errorCode: "REAUTH", lastErrorAt: pinnedAt,
      });

      const enabled = await database.updateProviderConnection(row.id, { isActive: true });
      expect(enabled).toMatchObject({
        isActive: true, testStatus: "reauth_required", errorCode: "REAUTH",
        lastError: "OAuth session expired. Reconnect this account.", lastErrorAt: pinnedAt,
        autoDisabledReason: null, autoDisabledAt: null,
      });
    });

    it("keeps a credential rejection recorded after the automatic disable", async () => {
      const disabledAt = iso(Date.now() - 2 * HOUR);
      const rejectedAt = iso(Date.now() - HOUR);
      const row = await seedOAuth({ provider: "qoder" });
      await database.updateProviderConnection(row.id, {
        isActive: false, testStatus: "unavailable", lastError: "quota", errorCode: 403, lastErrorAt: disabledAt,
        autoDisabledReason: "quota", autoDisabledAt: disabledAt,
      });
      await database.updateProviderConnection(row.id, {
        testStatus: "error", lastError: "Invalid credentials", errorCode: 401, lastErrorAt: rejectedAt,
      });

      const enabled = await database.updateProviderConnection(row.id, { isActive: true });
      expect(enabled).toMatchObject({ testStatus: "error", errorCode: 401, lastError: "Invalid credentials", lastErrorAt: rejectedAt });
    });

    it("keeps a manual quarantine for reauthorization", async () => {
      const row = await seedOAuth();
      await database.updateProviderConnection(row.id, {
        isActive: false, testStatus: "reauth_required", errorCode: 401,
        lastError: "token invalidated", lastErrorAt: iso(Date.now() - HOUR),
      });
      const enabled = await database.updateProviderConnection(row.id, { isActive: true });
      expect(enabled).toMatchObject({ isActive: true, testStatus: "reauth_required", errorCode: 401 });
    });

    it("reconciles orphaned unavailability but never a live cooldown", async () => {
      const now = Date.now();
      const orphan = await seedOAuth();
      await database.updateProviderConnection(orphan.id, {
        isActive: false, testStatus: "unavailable", lastError: "Rate limited", errorCode: 429,
        lastErrorAt: iso(now - 2 * HOUR), "modelLock_claude-sonnet": iso(now - HOUR),
      });
      const cooling = await seedOAuth();
      const lockUntil = iso(now + HOUR);
      const lockout = { status: "quota_exhausted", source: "auto", message: "Provider quota exhausted", detectedAt: iso(now - HOUR), reactivateAt: iso(now + 2 * HOUR) };
      await database.updateProviderConnection(cooling.id, {
        isActive: false, testStatus: "unavailable", lastError: "Rate limited", errorCode: 429,
        lastErrorAt: iso(now - HOUR), "modelLock_claude-sonnet": lockUntil, quotaLockout: lockout,
      });

      const reconciled = await database.updateProviderConnection(orphan.id, { isActive: true });
      // Status is reconciled; error history stays visible (port9r #1448 display contract).
      expect(reconciled).toMatchObject({ isActive: true, testStatus: null, lastError: "Rate limited", errorCode: 429 });

      const kept = await database.updateProviderConnection(cooling.id, { isActive: true });
      expect(kept).toMatchObject({ isActive: true, testStatus: "unavailable", "modelLock_claude-sonnet": lockUntil, quotaLockout: lockout });
    });

    it("leaves explicit status patches and replacement credentials to the caller", async () => {
      const row = await seedOAuth();
      await database.updateProviderConnection(row.id, {
        isActive: false, testStatus: "reauth_required", errorCode: "REAUTH", lastError: "expired", lastErrorAt: iso(Date.now() - HOUR),
      });
      const { saveOAuthConnection } = await import("@/lib/oauth/flowCompletion.js");
      const replaced = await saveOAuthConnection(
        "claude",
        { accessToken: "synthetic-access-new", refreshToken: "synthetic-refresh-new", expiresIn: 3600 },
        { mode: "legacy" },
        { connectionId: row.id },
      );
      expect(replaced).toMatchObject({ testStatus: "active", errorCode: null, lastError: null, refreshToken: "synthetic-refresh-new" });
    });

    it("routing ignores an orphaned status label and honors live deadlines", async () => {
      const now = Date.now();
      await seedApiKey("orphan", { testStatus: "unavailable", lastError: "Rate limited", "modelLock_sonar": iso(now - HOUR), priority: 1 });
      await seedApiKey("cooling", { testStatus: "active", "modelLock_sonar": iso(now + HOUR), priority: 2 });
      const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
      const selected = await getProviderCredentials("perplexity", null, "sonar", { now, quotaSnapshotsLoader: async () => [] });
      expect(selected?.connectionId).toBe("orphan");
      const withoutOrphan = await getProviderCredentials("perplexity", new Set(["orphan"]), "sonar", { now, quotaSnapshotsLoader: async () => [] });
      expect(withoutOrphan).toMatchObject({ allRateLimited: true });
    });
  });

  describe("concurrent refresh never resurrects deleted or superseded credentials", () => {
    function executorReturning(promise) {
      const refreshCredentials = vi.fn(() => promise);
      return { refreshCredentials, getExecutorImpl: () => ({ needsRefresh: () => true, refreshCredentials }) };
    }

    it("refuses a refresh result for a connection deleted mid-flight", async () => {
      const { refreshAndUpdateCredentials } = await import("@/shared/services/providerCredentials.js");
      const row = await seedOAuth();
      const pending = deferred();
      const { getExecutorImpl, refreshCredentials } = executorReturning(pending.promise);
      const refresh = refreshAndUpdateCredentials(row, true, null, { getExecutorImpl, callerTimeoutMs: 5000 });
      await vi.waitFor(() => expect(refreshCredentials).toHaveBeenCalledTimes(1));

      expect(await database.deleteProviderConnection(row.id)).toBe(true);
      pending.resolve({ accessToken: "synthetic-access-late", refreshToken: "synthetic-refresh-late", expiresIn: 3600 });

      await expect(refresh).rejects.toMatchObject({ code: "PROVIDER_CONNECTION_NOT_FOUND" });
      expect(await database.getProviderConnectionById(row.id)).toBeNull();
      expect(await database.getProviderConnections({ provider: "claude" })).toHaveLength(0);
    });

    it("refuses an unrecoverable refresh for a deleted connection without writing reauth", async () => {
      const { refreshAndUpdateCredentials } = await import("@/shared/services/providerCredentials.js");
      const row = await seedOAuth();
      const pending = deferred();
      const { getExecutorImpl, refreshCredentials } = executorReturning(pending.promise);
      const refresh = refreshAndUpdateCredentials(row, true, null, {
        getExecutorImpl, callerTimeoutMs: 5000, reconcileDelays: [0], wait: async () => {},
      });
      await vi.waitFor(() => expect(refreshCredentials).toHaveBeenCalledTimes(1));
      await database.deleteProviderConnection(row.id);
      pending.resolve({ error: "invalid_grant" });

      await expect(refresh).rejects.toMatchObject({ code: "PROVIDER_CONNECTION_NOT_FOUND" });
      expect(await database.getProviderConnectionById(row.id)).toBeNull();
    });

    it("keeps a reconnect that superseded the in-flight refresh", async () => {
      const { refreshAndUpdateCredentials } = await import("@/shared/services/providerCredentials.js");
      const row = await seedOAuth();
      const pending = deferred();
      const { getExecutorImpl, refreshCredentials } = executorReturning(pending.promise);
      const refresh = refreshAndUpdateCredentials(row, true, null, { getExecutorImpl, callerTimeoutMs: 5000 });
      await vi.waitFor(() => expect(refreshCredentials).toHaveBeenCalledTimes(1));

      await database.updateProviderConnection(row.id, {
        accessToken: "synthetic-access-reconnect", refreshToken: "synthetic-refresh-reconnect", testStatus: "active",
      }, { replacesCredential: true });
      pending.resolve({ accessToken: "synthetic-access-late", refreshToken: "synthetic-refresh-late", expiresIn: 3600 });

      await expect(refresh).resolves.toMatchObject({ refreshed: false });
      expect(await database.getProviderConnectionById(row.id)).toMatchObject({
        accessToken: "synthetic-access-reconnect", refreshToken: "synthetic-refresh-reconnect",
      });
    });

    it("does not pin reauth over a reconnect that won the rotation race", async () => {
      const { refreshAndUpdateCredentials } = await import("@/shared/services/providerCredentials.js");
      const row = await seedOAuth();
      const pending = deferred();
      const { getExecutorImpl, refreshCredentials } = executorReturning(pending.promise);
      const refresh = refreshAndUpdateCredentials(row, true, null, {
        getExecutorImpl, callerTimeoutMs: 5000, reconcileDelays: [0], wait: async () => {},
      });
      await vi.waitFor(() => expect(refreshCredentials).toHaveBeenCalledTimes(1));
      await database.updateProviderConnection(row.id, {
        accessToken: "synthetic-access-reconnect", refreshToken: "synthetic-refresh-reconnect", testStatus: "active",
      }, { replacesCredential: true });
      pending.resolve({ error: "refresh_token_reused" });

      await expect(refresh).resolves.toMatchObject({ refreshed: false });
      expect(await database.getProviderConnectionById(row.id)).toMatchObject({ testStatus: "active", refreshToken: "synthetic-refresh-reconnect" });
    });

    it("surfaces a persistence failure and lets the next refresh start cleanly", async () => {
      const { refreshAndUpdateCredentials } = await import("@/shared/services/providerCredentials.js");
      const { drainRefreshPersistence } = await import("open-sse/services/refreshSerializer.js");
      const row = await seedOAuth();
      const { getExecutorImpl, refreshCredentials } = executorReturning(
        Promise.resolve({ accessToken: "synthetic-access-new", refreshToken: "synthetic-refresh-new", expiresIn: 3600 }),
      );
      const failingWrite = vi.fn(async () => {
        throw new Error("synthetic disk full");
      });
      await expect(refreshAndUpdateCredentials(row, true, null, {
        getExecutorImpl, updateProviderConnectionImpl: failingWrite, callerTimeoutMs: 5000,
      })).rejects.toThrow("synthetic disk full");
      expect(await drainRefreshPersistence({ timeoutMs: 50 })).toEqual({ drained: true, pending: 0 });
      expect(await database.getProviderConnectionById(row.id)).toMatchObject({ refreshToken: "synthetic-refresh-old" });

      await expect(refreshAndUpdateCredentials(row, true, null, { getExecutorImpl, callerTimeoutMs: 5000 }))
        .resolves.toMatchObject({ refreshed: true });
      expect(refreshCredentials).toHaveBeenCalledTimes(2);
      expect(await database.getProviderConnectionById(row.id)).toMatchObject({ refreshToken: "synthetic-refresh-new" });
    });
  });

  describe("persistence atomicity (6021aba9 equivalence)", () => {
    it("rolls back a failed credential write as one transaction", async () => {
      const row = await seedOAuth();
      // A provider change throws inside the same transaction after the merge is built.
      await expect(database.updateProviderConnection(row.id, {
        accessToken: "synthetic-access-partial", refreshToken: "synthetic-refresh-partial", provider: "codex",
      })).rejects.toMatchObject({ code: "PROVIDER_IDENTITY_IMMUTABLE" });
      expect(await database.getProviderConnectionById(row.id)).toMatchObject({
        provider: "claude", accessToken: "synthetic-access-old", refreshToken: "synthetic-refresh-old",
      });
    });
  });

  describe("credential-wide quota cooldown retention (37caab7d)", () => {
    it("keeps live quota and model cooldowns through ordinary and operator success", async () => {
      const now = Date.now();
      const row = await seedOAuth();
      const lockUntil = iso(now + HOUR);
      const lockout = { status: "quota_exhausted", source: "auto", message: "Provider quota exhausted", detectedAt: iso(now - 1000), reactivateAt: iso(now + 2 * HOUR) };
      await database.updateProviderConnection(row.id, { "modelLock_claude-sonnet": lockUntil, quotaLockout: lockout, testStatus: "unavailable" });

      const cleared = await database.clearProviderConnectionFallbackState(row.id, { model: "claude-opus", observedAt: now }, { now });
      expect(cleared.connection).toMatchObject({ quotaLockout: lockout, "modelLock_claude-sonnet": lockUntil, testStatus: "unavailable" });

      // A skipped/unverified operator test writes "unknown"; a passing key check writes "active".
      for (const testStatus of ["unknown", "active"]) {
        const tested = await database.updateProviderConnection(row.id, { testStatus, lastError: null, lastErrorAt: null });
        expect(tested).toMatchObject({ quotaLockout: lockout, "modelLock_claude-sonnet": lockUntil });
      }
    });

    it("lets ordinary success clear only an expired quota lockout", async () => {
      const now = Date.now();
      const row = await seedOAuth();
      await database.updateProviderConnection(row.id, {
        quotaLockout: { status: "quota_exhausted", source: "auto", message: "x", detectedAt: iso(now - 2 * HOUR), reactivateAt: iso(now - HOUR) },
      });
      const cleared = await database.clearProviderConnectionFallbackState(row.id, { model: "claude-opus", observedAt: now }, { now });
      expect(cleared.connection.quotaLockout).toBeNull();
    });
  });
});

describe("controlled shutdown drains refresh persistence (32c0c459)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("waits for an in-flight write and reports drained", async () => {
    const { drainRefreshPersistence, trackRefreshPersistence } = await import("open-sse/services/refreshSerializer.js");
    const write = deferred();
    let persisted = false;
    trackRefreshPersistence(write.promise.then(() => {
      persisted = true;
    }));
    const drain = drainRefreshPersistence({ timeoutMs: 5000 });
    await Promise.resolve();
    expect(persisted).toBe(false);
    write.resolve();
    await expect(drain).resolves.toEqual({ drained: true, pending: 0 });
    expect(persisted).toBe(true);
  });

  it("is bounded for a write that never settles", async () => {
    vi.useFakeTimers();
    try {
      const { drainRefreshPersistence, trackRefreshPersistence } = await import("open-sse/services/refreshSerializer.js");
      trackRefreshPersistence(new Promise(() => {}));
      const drain = drainRefreshPersistence({ timeoutMs: 250 });
      await vi.advanceTimersByTimeAsync(250);
      await expect(drain).resolves.toEqual({ drained: false, pending: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not deadlock when drained from inside a tracked operation", async () => {
    const { drainRefreshPersistence, trackRefreshPersistence } = await import("open-sse/services/refreshSerializer.js");
    let inner;
    const outer = trackRefreshPersistence((async () => {
      await Promise.resolve();
      inner = await drainRefreshPersistence({ timeoutMs: 20 });
    })());
    await outer;
    expect(inner).toEqual({ drained: false, pending: 1 });
    expect(await drainRefreshPersistence({ timeoutMs: 20 })).toEqual({ drained: true, pending: 0 });
  });

  it("finishes the running background refresh and starts no other after stop", async () => {
    const { runBackgroundTokenRefreshTick, stopBackgroundTokenRefresh } = await import("../../src/sse/services/backgroundTokenRefresh.js");
    const { drainRefreshPersistence } = await import("open-sse/services/refreshSerializer.js");
    const due = (id) => ({ id, provider: "claude", authType: "oauth", isActive: true, refreshToken: `r-${id}`, expiresAt: iso(Date.now() + 60_000) });
    const write = deferred();
    const persisted = [];
    const refreshConnection = vi.fn(async (conn) => {
      await write.promise;
      persisted.push(conn.id);
    });
    const sleep = vi.fn(async () => {});
    const tick = runBackgroundTokenRefreshTick({ loadConnections: async () => [due("a"), due("b")], refreshConnection, sleep });
    await vi.waitFor(() => expect(refreshConnection).toHaveBeenCalledTimes(1));

    stopBackgroundTokenRefresh();
    const drain = drainRefreshPersistence({ timeoutMs: 5000 });
    write.resolve();
    await expect(drain).resolves.toEqual({ drained: true, pending: 0 });
    await tick;
    expect(persisted).toEqual(["a"]);
    expect(refreshConnection).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  describe("SIGTERM handler", () => {
    let exitSpy;
    let before;
    const mocked = [
      "@/lib/localDb", "@/lib/tunnel", "@/mitm/manager", "@/shared/services/quotaAutoPing",
      "@/sse/services/backgroundTokenRefresh.js", "@/lib/mitmAliasCache", "@/lib/mcp/stdioSseBridge",
      "@/lib/mcp/gateway/stdioClient", "@/lib/headroom/process",
    ];

    beforeEach(() => {
      delete global.__appSingleton;
      exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});
      before = new Set(process.listeners("SIGTERM"));
      vi.doMock("@/lib/localDb", () => ({
        cleanupProviderConnections: async () => {}, getSettings: async () => ({}), updateSettings: async () => {}, getApiKeys: async () => [],
      }));
      vi.doMock("@/lib/tunnel", () => ({
        enableTunnel: () => {}, enableTailscale: () => {}, isTunnelManuallyDisabled: () => false, isTunnelReconnecting: () => false,
        isTailscaleReconnecting: () => false, getTunnelService: () => ({}), getTailscaleService: () => ({}),
        setTunnelUnexpectedExitCallback: () => {}, killCloudflared: () => {}, isCloudflaredRunning: () => false,
        ensureCloudflared: async () => {}, isTailscaleRunning: () => false, isTailscaleRunningStrict: () => false,
        isDaemonAlive: () => false, startFunnel: () => {}, checkInternet: async () => true,
        RESTART_COOLDOWN_MS: 0, NETWORK_SETTLE_MS: 0, WATCHDOG_INTERVAL_MS: 60000, NETWORK_CHECK_INTERVAL_MS: 60000, VIRTUAL_IFACE_REGEX: /.^/,
      }));
      vi.doMock("@/mitm/manager", () => ({
        getMitmStatus: () => ({}), startMitm: async () => {}, stopMitm: async () => {}, loadEncryptedPassword: () => null,
        initDbHooks: () => {}, restoreToolDNS: () => {}, isSudoPasswordRequired: () => false,
      }));
      vi.doMock("@/shared/services/quotaAutoPing", () => ({ startQuotaAutoPing: () => {}, stopQuotaAutoPing: () => {} }));
      vi.doMock("@/sse/services/backgroundTokenRefresh.js", () => ({ startBackgroundTokenRefresh: () => {}, stopBackgroundTokenRefresh: () => {} }));
      vi.doMock("@/lib/mitmAliasCache", () => ({ syncToJson: async () => {} }));
      vi.doMock("@/lib/mcp/stdioSseBridge", () => ({ killAllBridges: () => {} }));
      vi.doMock("@/lib/mcp/gateway/stdioClient", () => ({ killAllStdioEntries: () => {} }));
      vi.doMock("@/lib/headroom/process", () => ({ stopHeadroomProxy: async () => ({ stopped: false }) }));
    });

    afterEach(() => {
      for (const listener of process.listeners("SIGTERM")) {
        if (!before.has(listener)) process.removeListener("SIGTERM", listener);
      }
      exitSpy.mockRestore();
      if (global.__appSingleton) {
        clearInterval(global.__appSingleton.watchdogInterval);
        clearInterval(global.__appSingleton.networkMonitorInterval);
      }
      delete global.__appSingleton;
      for (const id of mocked) vi.doUnmock(id);
    });

    it("exits only after the tracked refresh write lands", async () => {
      const { trackRefreshPersistence } = await import("open-sse/services/refreshSerializer.js");
      const { initializeApp } = await import("@/shared/services/initializeApp.js");
      await initializeApp();
      const write = deferred();
      trackRefreshPersistence(write.promise);

      process.emit("SIGTERM");
      process.emit("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(exitSpy).not.toHaveBeenCalled();

      write.resolve();
      await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0), { timeout: 5000 });
      expect(exitSpy).toHaveBeenCalledTimes(1);
    });
  });
});

describe("session affinity TTL on deterministic time (e1e87409)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes a binding on access and expires it after an idle TTL", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-11-27T00:00:00.000Z"));
    vi.resetModules();
    const { MEMORY_CONFIG } = await import("open-sse/config/runtimeConfig.js");
    const affinity = await import("../../src/sse/services/auth/sessionAffinity.js");
    const ttl = MEMORY_CONFIG.sessionTtlMs;
    const sweep = MEMORY_CONFIG.sessionCleanupIntervalMs;

    affinity.rememberSessionAffinity("claude", "session-1", "conn-a");
    await vi.advanceTimersByTimeAsync(ttl - sweep);
    expect(affinity.getSessionAffinity("claude", "session-1")).toBe("conn-a");

    // Past the original deadline, inside the refreshed one, across several sweeps.
    await vi.advanceTimersByTimeAsync(2 * sweep);
    expect(affinity.getSessionAffinity("claude", "session-1")).toBe("conn-a");

    await vi.advanceTimersByTimeAsync(ttl + sweep);
    expect(affinity.getSessionAffinity("claude", "session-1")).toBeNull();
    affinity.resetProviderSessionAffinity();
  });
});
