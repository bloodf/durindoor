import { describe, it, expect, vi, beforeEach } from "vitest";
import { configurePxpipe } from "../../../src/lib/autoConfigure/pxpipe.js";
import * as installModule from "../../../src/lib/pxpipe/install.js";

vi.mock("../../../src/lib/pxpipe/install.js", async () => ({
  getInstallInfo: vi.fn(),
}));

describe("configurePxpipe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips when dependency not present", async () => {
    installModule.getInstallInfo.mockReturnValue({ installed: false });
    const res = configurePxpipe({ pxpipeEnabled: false, pxpipeMinChars: 0, pxpipeTimeoutMs: 0 });
    expect(res.changed).toBe(false);
    expect(res.wouldChange).toBe(false);
    expect(res.actions.some((a) => a.includes("not detected"))).toBe(true);
  });

  it("enables and sets defaults when installed", async () => {
    installModule.getInstallInfo.mockReturnValue({ installed: true, version: "1.0.0", path: "/x" });
    const res = configurePxpipe({ pxpipeEnabled: false, pxpipeMinChars: 0, pxpipeTimeoutMs: 0 });
    expect(res.changed).toBe(true);
    expect(res.updates).toEqual({ pxpipeEnabled: true, pxpipeMinChars: 25000, pxpipeTimeoutMs: 15000 });
  });

  it("is idempotent", async () => {
    installModule.getInstallInfo.mockReturnValue({ installed: true, version: "1.0.0", path: "/x" });
    const res = configurePxpipe({ pxpipeEnabled: true, pxpipeMinChars: 25000, pxpipeTimeoutMs: 15000 });
    expect(res.changed).toBe(false);
    expect(res.wouldChange).toBe(false);
  });

  it("dry-run reports changes without applying", async () => {
    installModule.getInstallInfo.mockReturnValue({ installed: true, version: "1.0.0", path: "/x" });
    const res = configurePxpipe({ pxpipeEnabled: false, pxpipeMinChars: 0, pxpipeTimeoutMs: 0 }, { dryRun: true });
    expect(res.changed).toBe(false);
    expect(res.wouldChange).toBe(true);
    expect(res.updates).toEqual({});
  });
});
