import { beforeEach, describe, expect, it, vi } from "vitest";

// The Headroom proxy is a child of the gateway, so it is reaped on every
// systemd restart and dropped on every container restart. instrumentation
// register() revives it at boot for all deployment shapes.
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

async function load() {
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
    const { ensureHeadroomProxy } = await load();

    await ensureHeadroomProxy();

    expect(mocks.startHeadroomProxy).toHaveBeenCalledWith({ port: 9100 });
  });

  it("defaults to port 8787 when the URL carries no port", async () => {
    mocks.getSettings.mockResolvedValue({ headroomEnabled: true, headroomUrl: "http://localhost" });
    const { ensureHeadroomProxy } = await load();

    await ensureHeadroomProxy();

    expect(mocks.startHeadroomProxy).toHaveBeenCalledWith({ port: 8787 });
  });

  it("never starts a proxy the operator has not enabled", async () => {
    mocks.getSettings.mockResolvedValue({ headroomEnabled: false });
    const { ensureHeadroomProxy } = await load();

    await ensureHeadroomProxy();

    expect(mocks.startHeadroomProxy).not.toHaveBeenCalled();
  });

  it("leaves a remote proxy alone — we only manage our own", async () => {
    mocks.isLoopbackHeadroomUrl.mockReturnValue(false);
    mocks.getSettings.mockResolvedValue({ headroomEnabled: true, headroomUrl: "https://headroom.example.com" });
    const { ensureHeadroomProxy } = await load();

    await ensureHeadroomProxy();

    expect(mocks.startHeadroomProxy).not.toHaveBeenCalled();
  });

  it("is idempotent when a managed proxy is already alive", async () => {
    mocks.getManagedPid.mockReturnValue(1234);
    mocks.getSettings.mockResolvedValue({ headroomEnabled: true, headroomUrl: "http://localhost:8787" });
    const { ensureHeadroomProxy } = await load();

    await ensureHeadroomProxy();

    expect(mocks.startHeadroomProxy).not.toHaveBeenCalled();
  });

  it("register() renames the process and never throws or blocks when the proxy fails", async () => {
    mocks.getSettings.mockRejectedValue(new Error("database unavailable"));
    const { register } = await load();
    const original = process.title;
    process.title = "next-server (v16)";

    try {
      expect(() => register()).not.toThrow();
      expect(process.title).toBe("9router (v16)");
      // register() must not await the 8s startup probe; the rejection is
      // swallowed asynchronously without surfacing an unhandled rejection.
      await new Promise((resolve) => setImmediate(resolve));
      expect(mocks.startHeadroomProxy).not.toHaveBeenCalled();
    } finally {
      process.title = original;
    }
  });
});
