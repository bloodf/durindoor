import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: { tunnelEnabled: false },
  startQuotaAutoPing: vi.fn(), startBackgroundTokenRefresh: vi.fn(),
  enableTunnel: vi.fn(async () => {}), checkInternet: vi.fn(async () => true),
}));
vi.mock("@/lib/localDb", () => ({
  cleanupProviderConnections: async () => {}, getSettings: async () => mocks.settings,
  updateSettings: async () => {}, getApiKeys: async () => [],
}));
vi.mock("@/lib/tunnel", () => ({
  enableTunnel: mocks.enableTunnel, enableTailscale: async () => {},
  isTunnelManuallyDisabled: () => false, isTunnelReconnecting: () => false,
  isTailscaleReconnecting: () => false,
  getTunnelService: () => ({ cancelToken: { cancelled: false }, spawnInProgress: false, lastRestartAt: 0 }),
  getTailscaleService: () => ({}), setTunnelUnexpectedExitCallback: () => {},
  killCloudflared: () => {}, isCloudflaredRunning: () => false,
  ensureCloudflared: async () => {}, isTailscaleRunning: () => false,
  isTailscaleRunningStrict: () => false, isDaemonAlive: () => false,
  startFunnel: async () => {}, checkInternet: mocks.checkInternet,
  RESTART_COOLDOWN_MS: 0, NETWORK_SETTLE_MS: 0,
  WATCHDOG_INTERVAL_MS: 2000, NETWORK_CHECK_INTERVAL_MS: 1000,
  VIRTUAL_IFACE_REGEX: /.^/,
}));
vi.mock("@/mitm/manager", () => ({
  getMitmStatus: () => ({}), startMitm: async () => {}, stopMitm: async () => {},
  loadEncryptedPassword: async () => null, initDbHooks: () => {},
  restoreToolDNS: async () => {}, isSudoPasswordRequired: () => false,
}));
vi.mock("@/shared/services/quotaAutoPing", () => ({ startQuotaAutoPing: mocks.startQuotaAutoPing }));
vi.mock("@/sse/services/backgroundTokenRefresh.js", () => ({ startBackgroundTokenRefresh: mocks.startBackgroundTokenRefresh }));
vi.mock("@/lib/mitmAliasCache", () => ({ syncToJson: async () => {} }));
vi.mock("@/lib/mcp/stdioSseBridge", () => ({ killAllBridges: () => {} }));

const interfaces = (address) => ({ eth0: [{ address, family: "IPv4", internal: false }] });
const denied = () => { throw Object.assign(new Error("interface enumeration denied"), { code: "ERR_SYSTEM_ERROR" }); };
let observe, tick, clock, listeners, maxListeners;

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); delete global.__appSingleton;
  tick = undefined;
  mocks.settings = { tunnelEnabled: false };
  mocks.checkInternet.mockResolvedValue(true);
  mocks.enableTunnel.mockResolvedValue(undefined);
  listeners = Object.fromEntries(["SIGINT", "SIGTERM"].map((signal) => [signal, new Set(process.listeners(signal))]));
  maxListeners = process.getMaxListeners();
  clock = 10_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  observe = vi.spyOn(os, "networkInterfaces").mockReturnValue(interfaces("192.0.2.1"));
  vi.spyOn(globalThis, "setInterval").mockImplementation((callback, interval) => {
    if (interval === 1000) tick = callback;
    return { unref() {} };
  });
});
afterEach(async () => {
  await vi.dynamicImportSettled();
  for (const signal of ["SIGINT", "SIGTERM"]) {
    for (const listener of process.listeners(signal)) if (!listeners[signal].has(listener)) process.removeListener(signal, listener);
  }
  delete global.__appSingleton; vi.restoreAllMocks(); process.setMaxListeners(maxListeners);
});
async function start() {
  const { initializeApp } = await import("@/shared/services/initializeApp.js");
  await initializeApp(); await vi.dynamicImportSettled();
  mocks.settings.tunnelEnabled = true;
}
async function advance() {
  clock += 1000;
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("unknown network observations do not abort startup (#1396)", () => {
  it("starts unrelated schedulers and monitoring when interface access throws", async () => {
    observe.mockImplementation(denied);
    await start();
    expect(global.__appSingleton.lastNetworkFingerprint).toBeNull();
    expect(tick).toBeTypeOf("function");
    expect(mocks.startQuotaAutoPing).toHaveBeenCalledOnce();
    expect(mocks.startBackgroundTokenRefresh).toHaveBeenCalledOnce();
    await advance();
    expect(mocks.checkInternet).toHaveBeenCalled();
    expect(mocks.enableTunnel).not.toHaveBeenCalled();
  });
  it("seeds the first successful observation without inventing a reconnect", async () => {
    observe.mockImplementation(denied); await start();
    observe.mockReturnValue(interfaces("192.0.2.1")); await advance();
    expect(global.__appSingleton.lastNetworkFingerprint).toBe("eth0:192.0.2.1");
    expect(mocks.enableTunnel).not.toHaveBeenCalled();
  });
  it("retains a valid fingerprint through unavailable and unchanged observations", async () => {
    await start(); observe.mockImplementation(denied); await advance();
    expect(global.__appSingleton.lastNetworkFingerprint).toBe("eth0:192.0.2.1");
    observe.mockReturnValue(interfaces("192.0.2.1")); await advance();
    expect(mocks.enableTunnel).not.toHaveBeenCalled();
  });
  it("detects a real change after an unavailable observation", async () => {
    await start(); observe.mockImplementation(denied); await advance();
    observe.mockReturnValue(interfaces("192.0.2.2")); await advance();
    expect(mocks.enableTunnel).toHaveBeenCalledOnce();
    expect(global.__appSingleton.lastNetworkFingerprint).toBe("eth0:192.0.2.2");
  });
  it("distinguishes an empty successful enumeration from an unavailable observation", async () => {
    await start(); observe.mockReturnValue({}); await advance();
    expect(global.__appSingleton.lastNetworkFingerprint).toBe("");
    expect(mocks.enableTunnel).toHaveBeenCalledOnce();
  });
  it("still recovers an offline-to-online edge without interface access", async () => {
    observe.mockImplementation(denied); await start();
    mocks.checkInternet.mockResolvedValueOnce(false); await advance();
    await advance(); expect(mocks.enableTunnel).toHaveBeenCalledOnce();
  });
  it("still recovers a sleep interval without interface access", async () => {
    observe.mockImplementation(denied); await start();
    clock += 7000; await advance();
    expect(mocks.enableTunnel).toHaveBeenCalledOnce();
  });
});
