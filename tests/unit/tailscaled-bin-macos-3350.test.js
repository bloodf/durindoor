import { describe, expect, it } from "vitest";
import { resolveTailscaledBin } from "../../src/lib/tunnel/tailscale/tailscale.js";

const only = (...paths) => (candidate) => paths.includes(candidate);

describe("upstream #3350: tailscaled path on macOS", () => {
  it("finds the Apple Silicon Homebrew daemon", () => {
    expect(resolveTailscaledBin({ isMac: true, exists: only("/opt/homebrew/bin/tailscaled") }))
      .toBe("/opt/homebrew/bin/tailscaled");
  });

  it("keeps preferring the /usr/local daemon and returns null when none exists", () => {
    const both = only("/usr/local/bin/tailscaled", "/opt/homebrew/bin/tailscaled");
    expect(resolveTailscaledBin({ isMac: true, exists: both })).toBe("/usr/local/bin/tailscaled");
    expect(resolveTailscaledBin({ isMac: true, exists: () => false })).toBeNull();
  });

  it("probes only fixed system paths, since the result can run under sudo", () => {
    const probed = [];
    resolveTailscaledBin({ isMac: true, exists: (candidate) => { probed.push(candidate); return false; } });
    expect(probed).toEqual(["/usr/local/bin/tailscaled", "/opt/homebrew/bin/tailscaled"]);
  });

  it("leaves Linux resolution to PATH", () => {
    expect(resolveTailscaledBin({ isMac: false, exists: () => true })).toBe("tailscaled");
  });
});
