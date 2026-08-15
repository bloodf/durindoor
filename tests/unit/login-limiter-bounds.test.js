import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  recordFail,
  checkLock,
  sweepExpiredAttempts,
  getTrackedIpCount,
  resetLoginLimiter,
  MAX_TRACKED_IPS,
} = await import("../../src/lib/auth/loginLimiter.js");

describe("login limiter bounds", () => {
  beforeEach(() => {
    resetLoginLimiter();
    vi.useRealTimers();
  });
  it("sweeps expired unlocked entries out of memory", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    recordFail("1.1.1.1");
    expect(getTrackedIpCount()).toBe(1);

    // Past FAIL_WINDOW_MS (1h) with no lock in effect.
    vi.setSystemTime(1_000_000 + 2 * 60 * 60 * 1000);
    sweepExpiredAttempts();
    expect(getTrackedIpCount()).toBe(0);
    vi.useRealTimers();
  });

  it("evicts deterministically when the tracked-IP cap is reached", () => {
    for (let i = 0; i < MAX_TRACKED_IPS; i++) {
      recordFail(`10.0.0.${i}`);
    }
    expect(getTrackedIpCount()).toBe(MAX_TRACKED_IPS);

    // First-ever IP should be the oldest and get evicted to make room.
    recordFail("10.0.0.new");
    expect(getTrackedIpCount()).toBe(MAX_TRACKED_IPS);
    expect(checkLock("10.0.0.0").locked).toBe(false);
  });
});
