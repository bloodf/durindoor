import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The Headroom proxy is a child of the gateway, so it is reaped on every
// systemd restart and dropped on every container restart. instrumentation
// register() revives it at boot for all deployment shapes.
//
// The boot logic lives in src/instrumentation.node.js: src/instrumentation.js
// is bundled for the edge runtime too (src/proxy.js keeps an edge entry
// alive), so Node-only work must stay behind a compile-time NEXT_RUNTIME
// guard. These tests exercise both halves.
const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  startHeadroomProxy: vi.fn(),
  getManagedPid: vi.fn(),
  isLoopbackHeadroomUrl: vi.fn(),
  startOperationalMetricsRuntime: vi.fn(),
}));

vi.mock("../../open-sse/services/operationalMetrics.js", () => ({
  startOperationalMetricsRuntime: mocks.startOperationalMetricsRuntime,
}));

// The Node bootstrap starts four more services next to Headroom. None of
// them belongs to the Headroom path and each owns I/O that outlives the test
// that triggered it: the exposure guard reads the settings database, the
// retention and model auto-sync schedulers import the database driver and
// install timers, and the Kimchi updater fetches a release and installs a
// four-hour timer. Their lifecycle is asserted by their own suites (see
// unit/kimchi-updater-bootstrap.test.js); here they are stubbed, so no boot
// service can write to the console after this file's scope is gone. The real
// instrumentation hook, the real Node bootstrap and the real Headroom boot
// path stay under test.
vi.mock("@/lib/startup/nonLoopbackApiKeyGuard.js", () => ({
  warnIfInferenceServerExposed: vi.fn(),
}));
vi.mock("@/lib/dataRetention/scheduler.js", () => ({
  startDataRetentionScheduler: vi.fn(),
}));
vi.mock("@/lib/modelAutoSync/scheduler.js", () => ({
  startModelAutoSyncScheduler: vi.fn(),
}));
vi.mock("../../open-sse/utils/kimchiUserAgent.js", () => ({
  startKimchiUserAgentUpdater: vi.fn(),
  getKimchiUserAgent: () => "kimchi/0.1.01",
  updateKimchiUserAgent: vi.fn(async () => "kimchi/0.1.01"),
}));

// Transport backstop: no boot service in this file may reach the network,
// whatever the stubs above end up doing.
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(async () => ({
    ok: true, status: 200, statusText: "OK",
    json: async () => ({ tag_name: "v0.1.01" }),
  })),
}));

vi.mock("@/lib/db/repos/settingsRepo.js", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/lib/headroom/process.js", () => ({
  startHeadroomProxy: mocks.startHeadroomProxy,
  getManagedPid: mocks.getManagedPid,
}));
vi.mock("@/lib/headroom/detect.js", () => ({
  DEFAULT_HEADROOM_URL: "http://localhost:8787",
  isLoopbackHeadroomUrl: mocks.isLoopbackHeadroomUrl,
}));

async function loadNodeBoot() {
  return import("../../src/instrumentation.node.js");
}

async function loadHook() {
  return import("../../src/instrumentation.js");
}

describe("headroom proxy autostart at gateway boot", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // Drop any per-test settings implementation, so a deferred fixture from
    // one test cannot outlive the test that created it.
    mocks.getSettings.mockReset();
    mocks.getManagedPid.mockReturnValue(null);
    mocks.isLoopbackHeadroomUrl.mockReturnValue(true);
    mocks.startHeadroomProxy.mockResolvedValue({ pid: 4242, alreadyRunning: false });
  });

  it("starts the proxy on the configured loopback port when Headroom is enabled", async () => {
    mocks.getSettings.mockResolvedValue({ headroomEnabled: true, headroomUrl: "http://localhost:9100" });
    const { ensureHeadroomProxy } = await loadNodeBoot();

    await ensureHeadroomProxy();

    expect(mocks.startHeadroomProxy).toHaveBeenCalledWith({ port: 9100 });
  });

  it("defaults to port 8787 when the URL carries no port", async () => {
    mocks.getSettings.mockResolvedValue({ headroomEnabled: true, headroomUrl: "http://localhost" });
    const { ensureHeadroomProxy } = await loadNodeBoot();

    await ensureHeadroomProxy();

    expect(mocks.startHeadroomProxy).toHaveBeenCalledWith({ port: 8787 });
  });

  it("never starts a proxy the operator has not enabled", async () => {
    mocks.getSettings.mockResolvedValue({ headroomEnabled: false });
    const { ensureHeadroomProxy } = await loadNodeBoot();

    await ensureHeadroomProxy();

    expect(mocks.startHeadroomProxy).not.toHaveBeenCalled();
  });

  it("leaves a remote proxy alone — we only manage our own", async () => {
    mocks.isLoopbackHeadroomUrl.mockReturnValue(false);
    mocks.getSettings.mockResolvedValue({ headroomEnabled: true, headroomUrl: "https://headroom.example.com" });
    const { ensureHeadroomProxy } = await loadNodeBoot();

    await ensureHeadroomProxy();

    expect(mocks.startHeadroomProxy).not.toHaveBeenCalled();
  });

  it("is idempotent when a managed proxy is already alive", async () => {
    mocks.getManagedPid.mockReturnValue(1234);
    mocks.getSettings.mockResolvedValue({ headroomEnabled: true, headroomUrl: "http://localhost:8787" });
    const { ensureHeadroomProxy } = await loadNodeBoot();

    await ensureHeadroomProxy();

    expect(mocks.startHeadroomProxy).not.toHaveBeenCalled();
  });

  it("register() renames the process and never throws or blocks when the proxy fails", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    // The Headroom boot path reads the settings row before it can decide to
    // start a proxy. This test owns that read, so it can settle the failure
    // here: the boot path's fail-open catch then runs while this scope is
    // still alive instead of logging after Vitest tore the environment down.
    let rejectSettings;
    const settingsRequested = new Promise((resolve) => {
      mocks.getSettings.mockImplementation(() => {
        resolve();
        return new Promise((_, reject) => { rejectSettings = reject; });
      });
    });
    const { register } = await loadHook();
    const original = process.title;
    process.title = "next-server (v16)";

    try {
      expect(() => register()).not.toThrow();
      // The node boot module loads through a dynamic import; wait for it.
      await vi.waitFor(() => expect(process.title).toBe("9router (v16)"));
      await vi.waitFor(() => expect(mocks.startOperationalMetricsRuntime).toHaveBeenCalledTimes(1));
      await vi.dynamicImportSettled();
      // register() must not await the 8s startup probe; the rejection is
      // swallowed asynchronously without surfacing an unhandled rejection.
      await settingsRequested;
      rejectSettings(new Error("database unavailable"));
      // The boot path still owns that rejection: let its fail-open catch run
      // before this test restores the process title and the environment.
      await new Promise((resolve) => setImmediate(resolve));
      expect(mocks.startHeadroomProxy).not.toHaveBeenCalled();
    } finally {
      process.title = original;
      vi.unstubAllEnvs();
    }
  });
});

describe("edge-runtime safety of the instrumentation hook", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // The edge scope inherits no settings fixture from the Node scope.
    mocks.getSettings.mockReset();
  });

  it("register() is a no-op outside the nodejs runtime", async () => {
    vi.stubEnv("NEXT_RUNTIME", "edge");
    const { register } = await loadHook();
    const original = process.title;
    process.title = "next-server (v16)";

    try {
      expect(() => register()).not.toThrow();
      // Give any (buggy) dynamic import a chance to fire.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(mocks.getSettings).not.toHaveBeenCalled();
      expect(mocks.startHeadroomProxy).not.toHaveBeenCalled();
      expect(mocks.startOperationalMetricsRuntime).not.toHaveBeenCalled();
      expect(process.title).toBe("next-server (v16)");
    } finally {
      process.title = original;
      vi.unstubAllEnvs();
    }
  });

  it("keeps instrumentation.js free of unguarded module loads", () => {
    // Regression guard for the dev-server 500s: webpack follows every
    // await import() it can parse, so instrumentation.js must not reach
    // Node-only code outside the compile-time NEXT_RUNTIME guard.
    const source = readFileSync(
      fileURLToPath(new URL("../../src/instrumentation.js", import.meta.url)),
      "utf8",
    );
    // No static imports at all.
    expect(source).not.toMatch(/^import\s/m);
    // The only dynamic import is the guarded nodejs boot module.
    const dynamicImports = source.match(/import\(\s*"[^"]+"\s*\)/g) || [];
    expect(dynamicImports).toEqual(['import("./instrumentation.node.js")']);
  });
});
