import { describe, it, expect, vi, beforeEach } from "vitest";
import { configurePxpipe } from "../../../src/lib/autoConfigure/pxpipe.js";
import * as installModule from "../../../src/lib/pxpipe/install.js";
import * as loaderModule from "../../../src/lib/pxpipe/loader.js";

vi.mock("../../../src/lib/pxpipe/install.js", async () => ({
  getInstallInfo: vi.fn(),
}));

vi.mock("../../../src/lib/pxpipe/loader.js", async () => ({
  selfTest: vi.fn(),
}));

describe("configurePxpipe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips when dependency not present", async () => {
    installModule.getInstallInfo.mockReturnValue({ installed: false });
    const res = await configurePxpipe({ pxpipeEnabled: false, pxpipeMinChars: 0, pxpipeTimeoutMs: 0 });
    expect(res.changed).toBe(false);
    expect(res.wouldChange).toBe(false);
    expect(res.actions.some((a) => a.includes("not detected"))).toBe(true);
  });

  it("self-tests the bundled transformer before enabling it", async () => {
    installModule.getInstallInfo.mockReturnValue({ installed: true, version: "1.0.0", path: "/x" });
    loaderModule.selfTest.mockResolvedValue({ ok: true, reason: "below_min_chars" });
    const res = await configurePxpipe({ pxpipeEnabled: false, pxpipeMinChars: 0, pxpipeTimeoutMs: 0 });
    expect(loaderModule.selfTest).toHaveBeenCalledTimes(1);
    expect(res.changed).toBe(true);
    expect(res.running).toBe(true);
    expect(res.updates).toEqual({ pxpipeEnabled: true, pxpipeMinChars: 25000, pxpipeTimeoutMs: 15000 });
  });

  it("reports a bundled transformer health error without rewriting settings", async () => {
    installModule.getInstallInfo.mockReturnValue({ installed: true, version: "1.0.0", path: "/x" });
    loaderModule.selfTest.mockRejectedValue(new Error("transform returned an unexpected shape"));
    const res = await configurePxpipe({ pxpipeEnabled: true, pxpipeMinChars: 25000, pxpipeTimeoutMs: 15000 });
    expect(res.changed).toBe(false);
    expect(res.running).toBe(false);
    expect(res.updates).toEqual({});
    expect(res.actions).toContain("pxpipe-proxy health check failed: transform returned an unexpected shape");
  });

  it("does not enable when the transformer self-test reports unhealthy", async () => {
    installModule.getInstallInfo.mockReturnValue({ installed: true, version: "1.0.0", path: "/x" });
    loaderModule.selfTest.mockResolvedValue({ ok: false, reason: "invalid_transform" });
    const res = await configurePxpipe({ pxpipeEnabled: false, pxpipeMinChars: 0, pxpipeTimeoutMs: 0 });
    expect(res.changed).toBe(false);
    expect(res.running).toBe(false);
    expect(res.updates).toEqual({});
    expect(res.actions).toContain("pxpipe-proxy health check failed: invalid_transform");
  });

  it("is idempotent", async () => {
    installModule.getInstallInfo.mockReturnValue({ installed: true, version: "1.0.0", path: "/x" });
    loaderModule.selfTest.mockResolvedValue({ ok: true, reason: "below_min_chars" });
    const res = await configurePxpipe({ pxpipeEnabled: true, pxpipeMinChars: 25000, pxpipeTimeoutMs: 15000 });
    expect(res.changed).toBe(false);
    expect(res.wouldChange).toBe(false);
  });

  it("dry-run reports changes without applying", async () => {
    installModule.getInstallInfo.mockReturnValue({ installed: true, version: "1.0.0", path: "/x" });
    const res = await configurePxpipe({ pxpipeEnabled: false, pxpipeMinChars: 0, pxpipeTimeoutMs: 0 }, { dryRun: true });
    expect(res.changed).toBe(false);
    expect(res.wouldChange).toBe(true);
    expect(res.running).toBeNull();
    expect(res.updates).toEqual({});
  });
});
