// GLM / Z.AI error classification. Both a transient rate limit and a
// terminal "out of credit" state can arrive as HTTP 429, so without an
// explicit rule they are indistinguishable and the credit-exhausted account
// gets retried forever.
//
//   {"error":{"code":"1302","message":"Rate limit reached for requests"}}
//   {"error":{"code":"1113","message":"余额不足或无可用资源包,请充值。"}}
//
// 1302 is a transient rate limit; 1113 means the account is out of credit and
// no amount of retrying will fix it.
import { describe, it, expect } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { createErrorResult } from "../../open-sse/utils/error.js";

const GLM_RATE_LIMIT = JSON.stringify({ error: { code: "1302", message: "Rate limit reached for requests" } });
const GLM_NO_BALANCE = JSON.stringify({ error: { code: "1113", message: "余额不足或无可用资源包,请充值。" } });

describe("terminal billing errors are not retried", () => {
  it("classifies GLM 1113 (insufficient balance) as terminal but still cools the account", () => {
    const r = checkFallbackError(429, GLM_NO_BALANCE, 0);
    expect(r.shouldFallback).toBe(true);
    expect(r.terminal).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(0);
  });

  it("classifies an English insufficient-balance body as terminal", () => {
    expect(checkFallbackError(429, "Insufficient balance, please top up").terminal).toBe(true);
  });

  it("treats HTTP 402 as terminal", () => {
    expect(checkFallbackError(402, "payment required").terminal).toBe(true);
  });

  it("does NOT mark a real rate limit as terminal", () => {
    const r = checkFallbackError(429, GLM_RATE_LIMIT, 0);
    expect(r.terminal).toBeFalsy();
    expect(r.newBackoffLevel).toBe(1);
    expect(r.cooldownMs).toBeGreaterThan(0);
  });

  it("keeps billing ahead of rate-limit matching when a body mentions both", () => {
    const mixed = JSON.stringify({ error: { message: "rate limit — 余额不足,请充值" } });
    expect(checkFallbackError(429, mixed).terminal).toBe(true);
  });
});

describe("terminal states never surface a client-facing Retry-After", () => {
  it("omits the header for a terminal billing error even with a cooldown", () => {
    const { cooldownMs, terminal } = checkFallbackError(429, GLM_NO_BALANCE, 0);
    expect(terminal).toBe(true);
    // chatCore only feeds resetsAtMs to createErrorResult when !terminal; a
    // terminal cooldown must never reach the client as Retry-After.
    const res = createErrorResult(429, "insufficient balance").response;
    expect(res.headers.get("Retry-After")).toBeNull();
    expect(cooldownMs).toBeGreaterThan(0);
  });

  it("advertises a retry for a real rate limit routed through createErrorResult", () => {
    const { cooldownMs, terminal } = checkFallbackError(429, GLM_RATE_LIMIT, 3);
    expect(terminal).toBeFalsy();
    const res = createErrorResult(429, "Rate limit reached for requests", Date.now() + cooldownMs).response;
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });
});
