// MCP child cleanup on shutdown: the SIGTERM/SIGINT handler registered by
// initializeApp() must invoke killAllBridges so child processes do not outlive
// the parent as orphans. Drives the REAL signal handler with the bridge module
// mocked (its CJS `@/...` requires don't resolve under vitest's alias), and
// separately verifies the bridge module's own cleanup contract.
import Module from "node:module";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const flush = () => new Promise((r) => setTimeout(r, 0));
let exitSpy;
let preSig;

beforeEach(() => {
  vi.resetModules();
  if (global.__appSingleton) {
    try { clearInterval(global.__appSingleton.watchdogInterval); } catch {}
    try { clearInterval(global.__appSingleton.networkMonitorInterval); } catch {}
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
    try { clearInterval(global.__appSingleton.watchdogInterval); } catch {}
    try { clearInterval(global.__appSingleton.networkMonitorInterval); } catch {}
  }
  delete global.__appSingleton;
});

function wireAppMocks({ killAllBridges, getSettings, startQuotaAutoPing }) {
  vi.doMock("@/lib/localDb", () => ({
    cleanupProviderConnections: async () => {},
    getSettings: getSettings || (async () => ({})),
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
  vi.doMock("@/shared/services/quotaAutoPing", () => ({ startQuotaAutoPing: startQuotaAutoPing || (() => {}) }));
  vi.doMock("@/lib/mitmAliasCache", () => ({ syncToJson: async () => {} }));
  vi.doMock("@/lib/mcp/stdioSseBridge", () => ({ killAllBridges }));
}

describe("initializeApp SIGTERM cleanup", () => {
  it("registered handler calls killAllBridges before process.exit", async () => {
    const killAllBridges = vi.fn();
    wireAppMocks({ killAllBridges });

    const { initializeApp } = await import("@/shared/services/initializeApp.js");
    await initializeApp();

    process.emit("SIGTERM");
    await flush();
    await flush();

    expect(killAllBridges).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);
  }, 15000);
});

describe("initializeApp quota auto-ping scheduler reuse", () => {
  it("starts the scheduler with the settings already loaded", async () => {
    const settingsSnapshot = { claudeAutoPing: { connections: { c: true } } };
    const getSettings = vi.fn().mockResolvedValue(settingsSnapshot);
    const startQuotaAutoPing = vi.fn();
    wireAppMocks({ killAllBridges: vi.fn(), getSettings, startQuotaAutoPing });

    const { initializeApp } = await import("@/shared/services/initializeApp.js");
    await initializeApp();

    expect(startQuotaAutoPing).toHaveBeenCalledWith(settingsSnapshot);
  });
});

describe("MCP bridge cleanup contract (real module)", () => {
  const G_KEY = "__9routerMcpBridges";
  let bridge;

  beforeEach(() => {
    // The bridge is CommonJS and `require`s "@/shared/constants/coworkPlugins".
    // Vitest's alias only rewrites ESM imports, so hook CJS resolution for the
    // literal alias just for the single require that loads the module, then
    // restore immediately so parallel test files are not contaminated.
    const origResolve = Module._resolveFilename;
    Module._resolveFilename = function (request, parent, isMain, options) {
      if (typeof request === "string" && request.startsWith("@/")) {
        request = path.resolve(REPO_ROOT, "src", request.slice(2));
      }
      return origResolve.call(this, request, parent, isMain, options);
    };
    const req = createRequire(import.meta.url);
    const bridgePath = path.resolve(REPO_ROOT, "src/lib/mcp/stdioSseBridge.js");
    delete req.cache[bridgePath];
    delete globalThis[G_KEY];
    try {
      bridge = req(bridgePath);
    } finally {
      Module._resolveFilename = origResolve;
    }
  });

  afterEach(() => {
    delete globalThis[G_KEY];
  });

  it("unregisterSession kills the child when the last session leaves", () => {
    const proc = { killed: false, kill: vi.fn(function () { this.killed = true; }) };
    const store = (globalThis[G_KEY] ??= new Map());
    store.set("fake", { proc, sessions: new Map([["sid-1", () => {}]]), buffer: "" });

    bridge.unregisterSession("fake", "sid-1");
    expect(proc.kill).toHaveBeenCalledTimes(1);
    expect(store.has("fake")).toBe(false);
  });

  it("keeps the child alive while sessions remain", () => {
    const proc = { killed: false, kill: vi.fn(function () { this.killed = true; }) };
    const store = (globalThis[G_KEY] ??= new Map());
    store.set("fake", { proc, sessions: new Map([["a", () => {}], ["b", () => {}]]), buffer: "" });

    bridge.unregisterSession("fake", "a");
    expect(proc.kill).not.toHaveBeenCalled();
    expect(store.has("fake")).toBe(true);
  });

  it("killAllBridges kills every child and clears the store", () => {
    const p1 = { killed: false, kill: vi.fn(function () { this.killed = true; }) };
    const p2 = { killed: false, kill: vi.fn(function () { this.killed = true; }) };
    const store = (globalThis[G_KEY] ??= new Map());
    store.set("x", { proc: p1, sessions: new Map(), buffer: "" });
    store.set("y", { proc: p2, sessions: new Map(), buffer: "" });

    bridge.killAllBridges();
    expect(p1.kill).toHaveBeenCalledTimes(1);
    expect(p2.kill).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(0);
  });
});
