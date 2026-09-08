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
    mocks.getSettings.mockRejectedValue(new Error("database unavailable"));
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    const { register } = await loadHook();
    const original = process.title;
    process.title = "next-server (v16)";

    try {
      expect(() => register()).not.toThrow();
      // The node boot module loads through a dynamic import; wait for it.
      await vi.waitFor(() => expect(process.title).toBe("9router (v16)"));
      // register() must not await the 8s startup probe; the rejection is
      // swallowed asynchronously without surfacing an unhandled rejection.
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
