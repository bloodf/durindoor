import { describe, expect, it, vi } from "vitest";
import { getDirectDispatcherOptionsForTest, parseEyeballsTimeoutMs } from "../../open-sse/utils/proxyFetch.js";

describe("dual-stack connection attempt budget", () => {
  it("uses a one-second default and accepts bounded integer overrides", () => {
    for (const value of [undefined, "", "abc", "12.5", "50", "30001"]) {
      expect(parseEyeballsTimeoutMs(value)).toBe(1000);
    }
    expect(parseEyeballsTimeoutMs("2500")).toBe(2500);
    vi.stubEnv("DURINDOOR_HAPPY_EYEBALLS_TIMEOUT_MS", "2500");
    try {
      expect(getDirectDispatcherOptionsForTest().connect.autoSelectFamilyAttemptTimeout).toBe(2500);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
