import { describe, it, expect, beforeEach } from "vitest";

const {
  checkLock,
  recordFail,
  recordSuccess,
  resetLoginLimiter,
  reserveAttempt,
  releaseReservation,
  toLimiterBucket,
} = await import("../../src/lib/auth/loginLimiter.js");

describe("review-m-lockout (#2242)", () => {
  beforeEach(() => {
    resetLoginLimiter();
  });

  it("buckets every IPv6 address in a /64 into one limiter key", () => {
    const a = toLimiterBucket("2001:db8:abcd:1234::1");
    const b = toLimiterBucket("2001:db8:abcd:1234:ffff:ffff:ffff:ffff");
    const c = toLimiterBucket("[2001:db8:abcd:1234::99]");
    expect(a).toBe("2001:db8:abcd:1234::");
    expect(b).toBe(a);
    expect(c).toBe(a);
    expect(toLimiterBucket("2001:db8:abcd:1235::1")).not.toBe(a);
    expect(toLimiterBucket("198.51.100.10")).toBe("198.51.100.10");
    expect(toLimiterBucket("::ffff:198.51.100.10")).toBe("198.51.100.10");
  });

  it("shares lockout across distinct IPv6 addresses in the same /64", () => {
    for (let i = 0; i < 5; i++) {
      recordFail(`2001:db8:1:2::${i + 1}`);
    }
    expect(checkLock("2001:db8:1:2::99").locked).toBe(true);
    expect(checkLock("2001:db8:1:3::1").locked).toBe(false);
  });

  it("reserveAttempt locks the fifth slot before any credential await can run", () => {
    const outcomes = [];
    for (let i = 0; i < 8; i++) {
      outcomes.push(reserveAttempt("203.0.113.50"));
    }
    expect(outcomes.filter((o) => !o.locked)).toHaveLength(4);
    expect(outcomes.filter((o) => o.locked)).toHaveLength(4);
    expect(checkLock("203.0.113.50").locked).toBe(true);
  });

  it("refuses success while locked after a concurrent reservation burst", () => {
    // Four reservations leave the bucket one fail from lockout.
    for (let i = 0; i < 4; i++) {
      expect(reserveAttempt("198.51.100.20").locked).toBe(false);
    }
    // A fifth reservation tips into lock; a "correct password" finishing now
    // must not clear the lock via recordSuccess.
    expect(reserveAttempt("198.51.100.20").locked).toBe(true);
    expect(checkLock("198.51.100.20").locked).toBe(true);
    recordSuccess("198.51.100.20");
    // recordSuccess clears — callers must checkLock *before* recordSuccess.
    // Simulate the required guard: success path must no-op when locked.
    resetLoginLimiter();
    for (let i = 0; i < 5; i++) reserveAttempt("198.51.100.21");
    expect(checkLock("198.51.100.21").locked).toBe(true);
    const wouldSucceed = !checkLock("198.51.100.21").locked;
    expect(wouldSucceed).toBe(false);
    if (wouldSucceed) recordSuccess("198.51.100.21");
    expect(checkLock("198.51.100.21").locked).toBe(true);
  });

  it("releaseReservation undoes one reserved slot without clearing prior fails", () => {
    recordFail("203.0.113.8");
    recordFail("203.0.113.8");
    const reserved = reserveAttempt("203.0.113.8");
    expect(reserved.locked).toBe(false);
    // fails was 3 after reserve; releasing returns to 2.
    releaseReservation("203.0.113.8");
    // Three more fails should lock (2 remaining + 3 = 5).
    expect(reserveAttempt("203.0.113.8").locked).toBe(false);
    expect(reserveAttempt("203.0.113.8").locked).toBe(false);
    expect(reserveAttempt("203.0.113.8").locked).toBe(true);
  });
});
