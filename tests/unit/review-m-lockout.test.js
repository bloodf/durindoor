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

  it("reserveAttempt caps concurrent slots before credential work without locking confirmed fails yet", () => {
    const outcomes = [];
    for (let i = 0; i < 8; i++) {
      outcomes.push(reserveAttempt("203.0.113.50"));
    }
    expect(outcomes.filter((o) => !o.locked)).toHaveLength(5);
    expect(outcomes.filter((o) => o.locked)).toHaveLength(3);
    // In-flight only — lock engages when failures are confirmed.
    expect(checkLock("203.0.113.50").locked).toBe(false);
    for (let i = 0; i < 5; i++) recordFail("203.0.113.50");
    expect(checkLock("203.0.113.50").locked).toBe(true);
  });

  it("refuses success while locked after concurrent confirmed failures", () => {
    for (let i = 0; i < 5; i++) {
      expect(reserveAttempt("198.51.100.21").locked).toBe(false);
    }
    for (let i = 0; i < 5; i++) recordFail("198.51.100.21");
    expect(checkLock("198.51.100.21").locked).toBe(true);
    const wouldSucceed = !checkLock("198.51.100.21").locked;
    expect(wouldSucceed).toBe(false);
    if (wouldSucceed) recordSuccess("198.51.100.21");
    expect(checkLock("198.51.100.21").locked).toBe(true);
  });

  it("allows a correct attempt after four prior failures (fifth slot)", () => {
    for (let i = 0; i < 4; i++) {
      expect(reserveAttempt("203.0.113.8").locked).toBe(false);
      recordFail("203.0.113.8");
    }
    expect(reserveAttempt("203.0.113.8").locked).toBe(false);
    expect(checkLock("203.0.113.8").locked).toBe(false);
    recordSuccess("203.0.113.8");
    expect(checkLock("203.0.113.8").locked).toBe(false);
  });

  it("releaseReservation undoes one in-flight slot without clearing prior fails", () => {
    recordFail("203.0.113.9");
    recordFail("203.0.113.9");
    expect(reserveAttempt("203.0.113.9").locked).toBe(false);
    releaseReservation("203.0.113.9");
    // Two confirmed fails remain; three more confirmed fails lock.
    expect(reserveAttempt("203.0.113.9").locked).toBe(false);
    recordFail("203.0.113.9");
    expect(reserveAttempt("203.0.113.9").locked).toBe(false);
    recordFail("203.0.113.9");
    expect(reserveAttempt("203.0.113.9").locked).toBe(false);
    recordFail("203.0.113.9");
    expect(checkLock("203.0.113.9").locked).toBe(true);
  });
});
