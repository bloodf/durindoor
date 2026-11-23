// #2288 — MCP stdio/headroom child lifecycle + plugin bridge session routing.
import Module from "node:module";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// ---------------------------------------------------------------------------
// stdioClient (ESM, mocks node:child_process)
// ---------------------------------------------------------------------------
const fakeProcs = [];

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const proc = new EventEmitter();
    proc.killed = false;
    proc.exitCode = null;
    proc.pid = 2000 + fakeProcs.length;
    proc.kill = vi.fn(function kill(signal) {
      this.killed = true;
      this._killSignal = signal;
    });
    const stdin = new EventEmitter();
    stdin.destroyed = false;
    stdin.writable = true;
    stdin.write = vi.fn((data) => {
      (proc._writes ||= []).push(data);
      return true;
    });
    proc.stdin = stdin;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    fakeProcs.push(proc);
    return proc;
  }),
}));

const stdio = await import("../../src/lib/mcp/gateway/stdioClient");
const { closeInstance, killAllStdioEntries } = stdio;
const { StdioEntry, getStore, getEntry, instanceFingerprint } = stdio.__test__;

function makeInstance(overrides = {}) {
  return {
    id: "inst-2288",
    slug: "test-mcp",
    command: "fake-mcp",
    args: [],
    env: {},
    ...overrides,
  };
}

function respondError(proc, id, error) {
  proc.stdout.emit("data", Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id, error })}\n`, "utf8"));
}

const tick = () => new Promise((r) => setImmediate(r));
const lastProc = () => fakeProcs[fakeProcs.length - 1];

async function waitForWrites(proc, n) {
  while ((proc._writes || []).length < n) await tick();
}

beforeEach(() => {
  fakeProcs.length = 0;
  getStore().clear();
});

describe("#2288 stdioClient — replace/kill lifecycle", () => {
  it("getEntry replaces the cached child when command/args/env change", async () => {
    const a = makeInstance({ command: "cmd-a", args: ["--one"], env: { A: "1" } });
    const entryA = getEntry(a);
    await entryA.ensure();
    await tick();
    const procA = lastProc();
    expect(entryA.isAlive()).toBe(true);

    const b = makeInstance({ command: "cmd-b", args: ["--two"], env: { A: "2" } });
    expect(instanceFingerprint(a)).not.toBe(instanceFingerprint(b));
    const entryB = getEntry(b);
    expect(entryB).not.toBe(entryA);
    expect(procA.kill).toHaveBeenCalled();
    expect(getStore().get(a.id)).toBe(entryB);
  });

  it("close() kills the child and rejects pending requests", async () => {
    const instance = makeInstance();
    const entry = getEntry(instance);
    await entry.ensure();
    await tick();
    const proc = lastProc();

    const pending = entry.request("tools/list", {}, { skipRetry: true });
    await waitForWrites(proc, 1);
    entry.close();

    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    expect(entry.proc).toBeNull();
    await expect(pending).rejects.toThrow(/closed/);
  });

  it("failed initialize kills the child before store eviction", async () => {
    const instance = makeInstance({ id: "inst-fail" });
    const entry = getEntry(instance);
    await entry.ensure();
    await tick();
    const proc = lastProc();

    const p = entry.ensureInitialized();
    await waitForWrites(proc, 1);
    respondError(proc, 1, { code: -32602, message: "unsupported protocol" });
    await expect(p).rejects.toThrow(/initialize failed/);

    expect(proc.kill).toHaveBeenCalled();
    expect(getStore().has(instance.id)).toBe(false);
  });

  it("closeInstance and killAllStdioEntries kill children", async () => {
    const one = makeInstance({ id: "one", slug: "one" });
    const two = makeInstance({ id: "two", slug: "two" });
    const e1 = getEntry(one);
    const e2 = getEntry(two);
    await e1.ensure();
    await e2.ensure();
    await tick();
    const [p1, p2] = fakeProcs.slice(-2);

    expect(closeInstance("one")).toBe(true);
    expect(p1.kill).toHaveBeenCalled();
    expect(getStore().has("one")).toBe(false);

    killAllStdioEntries();
    expect(p2.kill).toHaveBeenCalled();
    expect(getStore().size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// stdioSseBridge — per-session JSON-RPC routing (CJS module)
// ---------------------------------------------------------------------------
describe("#2288 stdioSseBridge — session-scoped response routing", () => {
  const G_KEY = "__9routerMcpBridges";
  let bridge;
  let bridgeProc;

  beforeEach(() => {
    bridgeProc = null;
    const req = createRequire(import.meta.url);
    const origResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, parent, isMain, options) {
      if (typeof request === "string" && request.startsWith("@/")) {
        request = path.resolve(REPO_ROOT, "src", request.slice(2));
      }
      return origResolve.call(this, request, parent, isMain, options);
    };

    // Bridge requires("child_process") — intercept spawn for this load only.
    const childPath = req.resolve("child_process");
    const fakeChild = {
      spawn: vi.fn(() => {
        const proc = new EventEmitter();
        proc.killed = false;
        proc.exitCode = null;
        proc.pid = 4242;
        proc.kill = vi.fn(function kill() { this.killed = true; });
        proc.stdin = { writable: true, write: vi.fn(() => true) };
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        bridgeProc = proc;
        return proc;
      }),
    };
    req.cache[childPath] = {
      id: childPath,
      filename: childPath,
      loaded: true,
      exports: fakeChild,
    };

    const bridgePath = path.resolve(REPO_ROOT, "src/lib/mcp/stdioSseBridge.js");
    delete req.cache[bridgePath];
    delete globalThis[G_KEY];
    try {
      bridge = req(bridgePath);
    } finally {
      Module._resolveFilename = origResolve;
      delete req.cache[childPath];
    }
  });

  afterEach(() => {
    delete globalThis[G_KEY];
  });

  it("routes remapped responses to the requesting session; notifications to all", () => {
    const name = "browsermcp";
    expect(bridge.findPlugin(name)).toBeTruthy();

    const sentA = [];
    const sentB = [];
    const sidA = bridge.registerSession(name, (chunk) => sentA.push(chunk));
    const sidB = bridge.registerSession(name, (chunk) => sentB.push(chunk));
    expect(bridgeProc).toBeTruthy();

    bridge.sendToChild(name, { jsonrpc: "2.0", id: 7, method: "tools/call", params: {} }, sidA);
    bridge.sendToChild(name, { jsonrpc: "2.0", id: 7, method: "tools/call", params: {} }, sidB);

    const writes = bridgeProc.stdin.write.mock.calls.map((c) => JSON.parse(String(c[0]).replace(/\n$/, "")));
    expect(writes).toHaveLength(2);
    expect(writes[0].id).not.toBe(7);
    expect(writes[1].id).not.toBe(7);
    expect(writes[0].id).not.toBe(writes[1].id);

    bridgeProc.stdout.emit("data", Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id: writes[0].id, result: { ok: "a" } })}\n`));
    bridgeProc.stdout.emit("data", Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id: writes[1].id, result: { ok: "b" } })}\n`));
    bridgeProc.stdout.emit("data", Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress", params: { p: 1 } })}\n`));

    expect(sentA).toHaveLength(2);
    expect(sentB).toHaveLength(2);
    const parseData = (chunk) => JSON.parse(chunk.split("data: ")[1].trim());
    expect(parseData(sentA[0])).toEqual({ jsonrpc: "2.0", id: 7, result: { ok: "a" } });
    expect(parseData(sentB[0])).toEqual({ jsonrpc: "2.0", id: 7, result: { ok: "b" } });
    expect(parseData(sentA[1]).method).toBe("notifications/progress");
    expect(parseData(sentB[1]).method).toBe("notifications/progress");
  });
});

// ---------------------------------------------------------------------------
// headroom process — no detach/unref; stop prefers ChildProcess handle
// ---------------------------------------------------------------------------
describe("#2288 headroom process — attached child + handle stop", () => {
  it("spawn options omit detached/unref and stop kills via ChildProcess handle", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile(
      path.resolve(REPO_ROOT, "src/lib/headroom/process.js"),
      "utf8",
    );
    expect(src).not.toMatch(/detached:\s*true/);
    expect(src).not.toMatch(/child\.unref\s*\(/);

    const os = await import("node:os");
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "headroom-test-"));
    vi.doMock("@/lib/dataDir.js", () => ({ DATA_DIR: dataDir }));
    vi.useFakeTimers();
    try {
      const { stopHeadroomProxy, __test__ } = await import("../../src/lib/headroom/process.js");
      const child = new EventEmitter();
      child.pid = 3210;
      child.killed = false;
      child.kill = vi.fn(() => { child.killed = true; });
      __test__.setManagedChild(child);

      const killSpy = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
        if (signal === 0) {
          if (child.killed) throw new Error("dead");
          return true;
        }
        return true;
      });

      const stopped = stopHeadroomProxy();
      await vi.advanceTimersByTimeAsync(200);
      await expect(stopped).resolves.toEqual({ stopped: true, pid: 3210 });
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      // Must not fall back to process.kill(pid, SIGTERM) for the managed handle path.
      expect(killSpy.mock.calls.some((c) => c[0] === 3210 && c[1] === "SIGTERM")).toBe(false);
      killSpy.mockRestore();
      __test__.setManagedChild(null);
    } finally {
      vi.useRealTimers();
      vi.doUnmock("@/lib/dataDir.js");
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// initializeApp shutdown includes stdio + headroom cleanup
// ---------------------------------------------------------------------------
describe("#2288 initializeApp shutdown cleans stdio + headroom", () => {
  const flush = () => new Promise((r) => setTimeout(r, 0));
  let exitSpy;
  let preSig;

  beforeEach(() => {
    vi.useRealTimers();
    vi.resetModules();
    if (global.__appSingleton) {
      try { clearInterval(global.__appSingleton.watchdogInterval); } catch { /* */ }
      try { clearInterval(global.__appSingleton.networkMonitorInterval); } catch { /* */ }
    }
    delete global.__appSingleton;
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});
    preSig = {
      SIGTERM: new Set(process.listeners("SIGTERM")),
      SIGINT: new Set(process.listeners("SIGINT")),
    };
  });

  afterEach(() => {
    for (const sig of ["SIGTERM", "SIGINT"]) {
      for (const l of process.listeners(sig)) {
        if (!preSig[sig].has(l)) process.removeListener(sig, l);
      }
    }
    exitSpy.mockRestore();
    if (global.__appSingleton) {
      try { clearInterval(global.__appSingleton.watchdogInterval); } catch { /* */ }
      try { clearInterval(global.__appSingleton.networkMonitorInterval); } catch { /* */ }
    }
    delete global.__appSingleton;
  });

  it("SIGTERM calls killAllStdioEntries and stopHeadroomProxy", async () => {
    const killAllBridges = vi.fn();
    const killAllStdioEntriesFn = vi.fn();
    const stopHeadroomProxy = vi.fn(async () => ({ stopped: false, reason: "not_running" }));

    vi.doMock("@/lib/localDb", () => ({
      cleanupProviderConnections: async () => {},
      getSettings: async () => ({}),
      updateSettings: async () => {},
      getApiKeys: async () => [],
    }));
    vi.doMock("@/lib/tunnel", () => ({
      enableTunnel: () => {}, enableTailscale: () => {},
      isTunnelManuallyDisabled: () => false, isTunnelReconnecting: () => false,
      isTailscaleReconnecting: () => false,
      getTunnelService: () => ({}), getTailscaleService: () => ({}),
      setTunnelUnexpectedExitCallback: () => {},
      killCloudflared: () => {}, isCloudflaredRunning: () => false,
      ensureCloudflared: async () => {}, isTailscaleRunning: () => false,
      isTailscaleRunningStrict: () => false, isDaemonAlive: () => false,
      startFunnel: () => {}, checkInternet: async () => true,
      RESTART_COOLDOWN_MS: 0, NETWORK_SETTLE_MS: 0,
      WATCHDOG_INTERVAL_MS: 60000, NETWORK_CHECK_INTERVAL_MS: 60000,
      VIRTUAL_IFACE_REGEX: /.^/,
    }));
    vi.doMock("@/mitm/manager", () => ({
      getMitmStatus: () => ({}), startMitm: async () => {}, stopMitm: async () => {},
      loadEncryptedPassword: () => null, initDbHooks: () => {},
      restoreToolDNS: () => {}, isSudoPasswordRequired: () => false,
    }));
    vi.doMock("@/shared/services/quotaAutoPing", () => ({ startQuotaAutoPing: () => {} }));
    vi.doMock("@/shared/services/quotaAutoPing", () => ({ startQuotaAutoPing: () => {}, stopQuotaAutoPing: () => {} }));
    vi.doMock("@/lib/mitmAliasCache", () => ({ syncToJson: async () => {} }));
    vi.doMock("@/lib/mcp/stdioSseBridge", () => ({ killAllBridges }));
    vi.doMock("@/lib/mcp/gateway/stdioClient", () => ({ killAllStdioEntries: killAllStdioEntriesFn }));
    vi.doMock("@/lib/headroom/process", () => ({ stopHeadroomProxy }));

    const { initializeApp } = await import("@/shared/services/initializeApp.js");
    await initializeApp();

    process.emit("SIGTERM");
    await flush();
    await flush();

    expect(killAllBridges).toHaveBeenCalledTimes(1);
    expect(killAllStdioEntriesFn).toHaveBeenCalledTimes(1);
    expect(stopHeadroomProxy).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  }, 15000);
});
