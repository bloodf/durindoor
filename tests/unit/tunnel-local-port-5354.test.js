import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Upstream 9router #5354: the managed tunnel/funnel target port followed a
// hardcoded 20128 instead of the port the app server actually listens on, so
// a dev server on 20127 published a dead endpoint. The fork now defaults both
// managers to getAppPort().
//
// Everything below is stubbed: no cloudflared/tailscale process is started, no
// listener is opened, no DNS or health probe leaves the machine.

const PRODUCTION_PORT = 20128;
const DEV_PORT = 20127;

const ORIGINAL_PORT = process.env.PORT;

// Executable magic bytes the real isValidBinary() accepts on this host:
// PE on Windows, Mach-O 64 on macOS, ELF elsewhere.
const HOST_BINARY_MAGIC = process.platform === "win32"
  ? "4d5a0000"
  : process.platform === "darwin" ? "cffaedfe" : "7f454c46";

function setPort(value) {
  if (value === undefined) delete process.env.PORT;
  else process.env.PORT = value;
}

afterEach(() => {
  setPort(ORIGINAL_PORT);
  vi.resetModules();
  vi.restoreAllMocks();
});

// ── 1. getAppPort() resolver contract ────────────────────────────────────────

describe("getAppPort", () => {
  it("returns the production port when PORT is unset", async () => {
    setPort(undefined);
    const { getAppPort } = await import("@/shared/constants/config.js");
    expect(getAppPort()).toBe(PRODUCTION_PORT);
  });

  it("returns the development port when PORT points at the dev server", async () => {
    setPort(String(DEV_PORT));
    const { getAppPort } = await import("@/shared/constants/config.js");
    expect(getAppPort()).toBe(DEV_PORT);
  });

  it("returns an operator-chosen PORT verbatim", async () => {
    setPort("3100");
    const { getAppPort } = await import("@/shared/constants/config.js");
    expect(getAppPort()).toBe(3100);
  });

  it.each(["", "not-a-port", "0", "-1"])("falls back to the production port for PORT=%j", async (value) => {
    setPort(value);
    const { getAppPort } = await import("@/shared/constants/config.js");
    expect(getAppPort()).toBe(PRODUCTION_PORT);
  });
});

// ── 2. Cloudflare quick tunnel target port ───────────────────────────────────

async function loadCloudflareManager() {
  vi.resetModules();

  const spawnQuickTunnel = vi.fn(async () => ({ tunnelUrl: "https://direct.trycloudflare.com" }));
  const killCloudflared = vi.fn();
  const isCloudflaredRunning = vi.fn(() => false);
  const setUnexpectedExitHandler = vi.fn();

  vi.doMock("@/lib/tunnel/shared/state.js", () => ({
    loadState: vi.fn(() => ({ shortId: "abc123" })),
    saveState: vi.fn(),
    generateShortId: vi.fn(() => "abc123"),
  }));
  vi.doMock("@/lib/tunnel/cloudflare/cloudflared.js", () => ({
    spawnQuickTunnel,
    killCloudflared,
    isCloudflaredRunning,
    setUnexpectedExitHandler,
  }));
  vi.doMock("@/lib/tunnel/cloudflare/pid.js", () => ({ clearPid: vi.fn() }));
  vi.doMock("@/lib/tunnel/cloudflare/healthCheck.js", () => ({
    waitForHealth: vi.fn(async () => "https://direct.trycloudflare.com"),
    probeUrlAlive: vi.fn(async () => false),
  }));
  vi.doMock("@/lib/tunnel/cloudflare/config.js", () => ({ WORKER_URL: "https://relay.example" }));
  vi.doMock("@/lib/localDb", () => ({
    getSettings: vi.fn(async () => ({})),
    updateSettings: vi.fn(async () => {}),
  }));

  globalThis.fetch = vi.fn(async () => ({ ok: true }));

  const { enableTunnel } = await import("@/lib/tunnel/cloudflare/manager.js");
  return { enableTunnel, spawnQuickTunnel };
}

describe("enableTunnel default target port", () => {
  it("forwards the development port when the app listens on 20127", async () => {
    setPort(String(DEV_PORT));
    const { enableTunnel, spawnQuickTunnel } = await loadCloudflareManager();

    await enableTunnel();

    expect(spawnQuickTunnel).toHaveBeenCalledTimes(1);
    expect(spawnQuickTunnel.mock.calls[0][0]).toBe(DEV_PORT);
  });

  it("forwards the production port when PORT is unset", async () => {
    setPort(undefined);
    const { enableTunnel, spawnQuickTunnel } = await loadCloudflareManager();

    await enableTunnel();

    expect(spawnQuickTunnel).toHaveBeenCalledTimes(1);
    expect(spawnQuickTunnel.mock.calls[0][0]).toBe(PRODUCTION_PORT);
  });

  it("keeps an explicit port argument ahead of the resolved port", async () => {
    setPort(String(DEV_PORT));
    const { enableTunnel, spawnQuickTunnel } = await loadCloudflareManager();

    await enableTunnel(9090);

    expect(spawnQuickTunnel).toHaveBeenCalledTimes(1);
    expect(spawnQuickTunnel.mock.calls[0][0]).toBe(9090);
  });
});

// ── 3. Tailscale funnel target port ──────────────────────────────────────────

async function loadTailscaleManager() {
  vi.resetModules();

  const startFunnel = vi.fn(async () => ({ tunnelUrl: "https://node.tailnet.ts.net" }));
  const stopFunnel = vi.fn();

  vi.doMock("@/lib/tunnel/shared/state.js", () => ({
    loadState: vi.fn(() => ({ shortId: "abc123" })),
    saveState: vi.fn(),
    generateShortId: vi.fn(() => "abc123"),
  }));
  vi.doMock("@/lib/tunnel/tailscale/tailscale.js", () => ({
    startFunnel,
    stopFunnel,
    isTailscaleRunning: vi.fn(() => true),
    isTailscaleRunningStrict: vi.fn(async () => true),
    isTailscaleLoggedIn: vi.fn(() => true),
    isTailscaleLoggedInStrict: vi.fn(async () => true),
    isSystemDaemonRunning: vi.fn(() => false),
    getActualFunnelUrl: vi.fn(() => "https://node.tailnet.ts.net"),
    getTailscaleFunnelUrl: vi.fn(() => "https://node.tailnet.ts.net"),
    startLogin: vi.fn(async () => ({})),
    startDaemonWithPassword: vi.fn(async () => {}),
    provisionCert: vi.fn(async () => {}),
  }));
  vi.doMock("@/lib/tunnel/tailscale/healthCheck.js", () => ({
    waitForHealth: vi.fn(async () => true),
  }));
  vi.doMock("@/lib/tunnel/tailscale/config.js", () => ({
    HEALTH_CHECK: { intervalMs: 1, timeoutMs: 10, fetchTimeoutMs: 10, dnsTimeoutMs: 10 },
  }));
  vi.doMock("@/lib/localDb", () => ({
    getSettings: vi.fn(async () => ({})),
    updateSettings: vi.fn(async () => {}),
  }));
  vi.doMock("@/mitm/manager", () => ({
    getCachedPassword: vi.fn(() => ""),
    loadEncryptedPassword: vi.fn(async () => {}),
    initDbHooks: vi.fn(),
  }));

  const { enableTailscale } = await import("@/lib/tunnel/tailscale/manager.js");
  return { enableTailscale, startFunnel };
}

describe("enableTailscale default target port", () => {
  it("forwards the development port when the app listens on 20127", async () => {
    setPort(String(DEV_PORT));
    const { enableTailscale, startFunnel } = await loadTailscaleManager();

    await enableTailscale();

    expect(startFunnel).toHaveBeenCalledTimes(1);
    expect(startFunnel.mock.calls[0][0]).toBe(DEV_PORT);
  });

  it("forwards the production port when PORT is unset", async () => {
    setPort(undefined);
    const { enableTailscale, startFunnel } = await loadTailscaleManager();

    await enableTailscale();

    expect(startFunnel).toHaveBeenCalledTimes(1);
    expect(startFunnel.mock.calls[0][0]).toBe(PRODUCTION_PORT);
  });

  it("keeps an explicit port argument ahead of the resolved port", async () => {
    setPort(String(DEV_PORT));
    const { enableTailscale, startFunnel } = await loadTailscaleManager();

    await enableTailscale(9090);

    expect(startFunnel).toHaveBeenCalledTimes(1);
    expect(startFunnel.mock.calls[0][0]).toBe(9090);
  });

  it("keeps the funnel target a bare port, with no host argument added", async () => {
    setPort(String(DEV_PORT));
    const { enableTailscale, startFunnel } = await loadTailscaleManager();

    await enableTailscale();

    expect(startFunnel.mock.calls[0]).toHaveLength(1);
  });
});

// ── 4. Cloudflare quick-tunnel target keeps the configured host ──────────────

async function loadRealCloudflared() {
  // The manager stubs above registered module mocks; drop them so the real
  // cloudflared module is loaded for the target-URL assertions.
  for (const path of [
    "@/lib/tunnel/cloudflare/cloudflared.js",
    "@/lib/tunnel/cloudflare/healthCheck.js",
    "@/lib/tunnel/cloudflare/config.js",
    "@/lib/tunnel/shared/state.js",
    "@/lib/tunnel/tailscale/tailscale.js",
    "@/lib/tunnel/tailscale/healthCheck.js",
    "@/lib/tunnel/tailscale/config.js",
    "@/lib/localDb",
    "@/mitm/manager",
  ]) {
    vi.doUnmock(path);
  }
  vi.resetModules();

  const spawnArgs = [];
  const child = {
    pid: 4242,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    on: vi.fn(),
    kill: vi.fn(),
  };

  const spawn = vi.fn((_bin, args) => {
    spawnArgs.push(args);
    // Deliver the quick-tunnel URL the way cloudflared logs it. The timer runs
    // after the pending microtasks, so the log handlers are already attached.
    setTimeout(() => {
      child.stdout.emit("data", Buffer.from("INF | https://abc123.trycloudflare.com\n"));
    }, 0);
    return child;
  });

  const fsStub = {
    existsSync: vi.fn(() => true),
    statSync: vi.fn(() => ({ size: 50 * 1024 * 1024 })),
    openSync: vi.fn(() => 7),
    // Report a valid executable header for the host platform so the real
    // binary check passes and no download is ever attempted.
    readSync: vi.fn((_fd, buf) => {
      Buffer.from(HOST_BINARY_MAGIC, "hex").copy(buf, 0);
      return 4;
    }),
    closeSync: vi.fn(),
    chmodSync: vi.fn(),
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdtempSync: vi.fn(() => "/tmp/durindoor-5354-cloudflared-quick"),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
    createWriteStream: vi.fn(() => {
      throw new Error("cloudflared download attempted in test");
    }),
  };

  vi.doMock("fs", () => ({ default: fsStub, ...fsStub }));
  vi.doMock("child_process", () => ({ execSync: vi.fn(() => ""), spawn }));
  const httpsStub = {
    get: vi.fn(() => {
      throw new Error("network access attempted in test");
    }),
  };
  vi.doMock("https", () => ({ default: httpsStub, ...httpsStub }));
  vi.doMock("@/lib/dataDir.js", () => ({ DATA_DIR: "/tmp/durindoor-5354-data" }));
  vi.doMock("@/lib/tunnel/cloudflare/pid.js", () => ({
    savePid: vi.fn(),
    loadPid: vi.fn(() => null),
    clearPid: vi.fn(),
  }));

  const { spawnQuickTunnel } = await import("@/lib/tunnel/cloudflare/cloudflared.js");
  return { spawnQuickTunnel, spawnArgs };
}

describe("cloudflared quick-tunnel target", () => {
  it("keeps the 127.0.0.1 host and uses the port the app listens on", async () => {
    setPort(String(DEV_PORT));
    const { spawnQuickTunnel, spawnArgs } = await loadRealCloudflared();

    const result = await spawnQuickTunnel(DEV_PORT, vi.fn());

    expect(result.tunnelUrl).toBe("https://abc123.trycloudflare.com");
    expect(spawnArgs).toHaveLength(1);
    expect(spawnArgs[0]).toContain("http://127.0.0.1:20127");
    expect(spawnArgs[0]).not.toContain("http://127.0.0.1:20128");
  });
});
