import { beforeEach, describe, expect, it } from "vitest";
import { isValidRequestCap, parseRequestCapFromBody } from "open-sse/services/rateLimitManager/requestCap.js";
import {
  _learnedRequestCapState,
  _resetLearnedRequestCaps,
  clearLearnedRequestCap,
  getLearnedRpmCap,
  learnRequestCapFromBody
} from "open-sse/services/learnedRequestCap.js";
import { isOverLimit, recordRequest, _resetRpmLimiter } from "@/sse/services/rpmLimiter.js";

describe("requestCap parser (#13895)", () => {
  it("parses TokenRouter-style prose into a request cap", () => {
    const cap = parseRequestCapFromBody(
      "You have reached the request limit: Maximum 5 requests within 1 minutes"
    );
    expect(cap).toEqual({ requests: 5, windowMs: 60_000 });
  });

  it("parses 'N requests per M seconds'", () => {
    const cap = parseRequestCapFromBody("Rate limit exceeded: limit of 10 requests per 2 minutes");
    expect(cap).toEqual({ requests: 10, windowMs: 120_000 });
  });

  it("parses 'N RPM' when prefixed with a cap word", () => {
    const cap = parseRequestCapFromBody("Rate limit: 20 RPM");
    expect(cap).toEqual({ requests: 20, windowMs: 60_000 });
  });

  it("does not read a bare usage figure as a ceiling", () => {
    expect(parseRequestCapFromBody("current usage: 4 rpm")).toBeNull();
    expect(parseRequestCapFromBody("you made 120 requests in 1 minute")).toBeNull();
  });

  it("returns null for text with no cap phrasing", () => {
    expect(parseRequestCapFromBody("Internal server error")).toBeNull();
    expect(parseRequestCapFromBody(null)).toBeNull();
    expect(parseRequestCapFromBody(undefined)).toBeNull();
  });

  it("stringifies a JSON error body before parsing", () => {
    const cap = parseRequestCapFromBody({ error: "Maximum 3 requests within 1 minute" });
    expect(cap).toEqual({ requests: 3, windowMs: 60_000 });
  });

  it("rejects an out-of-range cap", () => {
    expect(isValidRequestCap({ requests: 0, windowMs: 60_000 })).toBe(false);
    expect(isValidRequestCap({ requests: 5, windowMs: 500 })).toBe(false);
    expect(isValidRequestCap({ requests: 5, windowMs: 25 * 3_600_000 })).toBe(false);
  });
});

describe("learnedRequestCap (#13895)", () => {
  beforeEach(() => {
    _resetLearnedRequestCaps();
    _resetRpmLimiter();
  });

  it("learns and normalizes a cap to requests-per-minute", () => {
    const rpm = learnRequestCapFromBody("conn-1", "Maximum 10 requests within 2 minutes");
    expect(rpm).toBe(5);
    expect(getLearnedRpmCap("conn-1")).toBe(5);
  });

  it("returns null and records nothing when the body has no cap", () => {
    const rpm = learnRequestCapFromBody("conn-1", "Internal server error");
    expect(rpm).toBeNull();
    expect(getLearnedRpmCap("conn-1")).toBe(0);
  });

  it("clearLearnedRequestCap forgets the connection", () => {
    learnRequestCapFromBody("conn-1", "Maximum 5 requests within 1 minute");
    expect(getLearnedRpmCap("conn-1")).toBe(5);
    clearLearnedRequestCap("conn-1");
    expect(getLearnedRpmCap("conn-1")).toBe(0);
  });

  it("expires a stale learned cap", () => {
    const now = Date.now();
    learnRequestCapFromBody("conn-1", "Maximum 5 requests within 1 minute", now);
    expect(getLearnedRpmCap("conn-1", now + 61 * 60_000)).toBe(0);
    expect(_learnedRequestCapState().connections).toBe(0);
  });

  it("tightens rpmLimiter admission below the configured provider RPM", () => {
    // Configured provider RPM is 100, but the connection's own 429 stated 2/min.
    learnRequestCapFromBody("conn-1", "Maximum 2 requests within 1 minute");
    const now = Date.now();
    recordRequest("conn-1", 100, now);
    recordRequest("conn-1", 100, now + 1);
    expect(isOverLimit("conn-1", 100, now + 2)).toBe(true);
  });

  it("never widens a tighter configured provider RPM", () => {
    // Learned cap (20/min) is looser than the configured RPM (2/min); the
    // configured value must still win.
    learnRequestCapFromBody("conn-1", "Maximum 20 requests within 1 minute");
    const now = Date.now();
    recordRequest("conn-1", 2, now);
    recordRequest("conn-1", 2, now + 1);
    expect(isOverLimit("conn-1", 2, now + 2)).toBe(true);
  });

  it("paces an unconfigured (unlimited) provider RPM under a learned cap", () => {
    learnRequestCapFromBody("conn-1", "Maximum 1 requests within 1 minute");
    const now = Date.now();
    recordRequest("conn-1", 0, now);
    expect(isOverLimit("conn-1", 0, now + 1)).toBe(true);
  });
});
