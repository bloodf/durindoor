import { describe, expect, it } from "vitest";
import {
  isResponseStatusRetryable,
  runWithTransientBackendRetry,
  TRANSIENT_BACKEND_STATUS_CODES
} from "open-sse/services/transientBackendRetry.js";

const sleepImpl = async () => {
  // no-op
};

describe("transientBackendRetry", () => {
  it("classifies 502/503/504 as retryable, others not", () => {
    for (const code of [502, 503, 504]) {
      expect(isResponseStatusRetryable(code)).toBe(true);
    }
    for (const code of [400, 401, 403, 404, 409, 422, 429, 500, 501, 505, 507, 510]) {
      expect(isResponseStatusRetryable(code)).toBe(false);
    }
    expect(TRANSIENT_BACKEND_STATUS_CODES.has(429)).toBe(false);
  });

  it("returns the first success without retrying", async () => {
    let calls = 0;
    const result = await runWithTransientBackendRetry(async () => {
      calls++;
      return { ok: true, status: 200, body: "hello" };
    }, { sleep: sleepImpl });
    expect(calls).toBe(1);
    expect(result).toEqual({ ok: true, status: 200, body: "hello" });
  });

  it("retries on 502/503/504 then returns success", async () => {
    let calls = 0;
    const result = await runWithTransientBackendRetry(async () => {
      calls++;
      if (calls < 3) return { ok: false, status: 503, body: null };
      return { ok: true, status: 200, body: "ok" };
    }, { sleep: sleepImpl, maxAttempts: 5, baseMs: 1, capMs: 4 });
    expect(calls).toBe(3);
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  it("returns the last error response when the budget is exhausted", async () => {
    let calls = 0;
    const result = await runWithTransientBackendRetry(async () => {
      calls++;
      return { ok: false, status: 502, body: null };
    }, { sleep: sleepImpl, maxAttempts: 3, baseMs: 1, capMs: 4 });
    expect(calls).toBe(3);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
  });

  it("does not retry a non-transient error status", async () => {
    let calls = 0;
    const result = await runWithTransientBackendRetry(async () => {
      calls++;
      return { ok: false, status: 401, body: "nope" };
    }, { sleep: sleepImpl, maxAttempts: 5, baseMs: 1, capMs: 4 });
    expect(calls).toBe(1);
    expect(result.status).toBe(401);
  });

  it("does not retry 429", async () => {
    let calls = 0;
    const result = await runWithTransientBackendRetry(async () => {
      calls++;
      return { ok: false, status: 429, body: "rate limited" };
    }, { sleep: sleepImpl, maxAttempts: 5, baseMs: 1, capMs: 4 });
    expect(calls).toBe(1);
    expect(result.status).toBe(429);
  });

  it("retries thrown errors until the budget, then throws", async () => {
    let calls = 0;
    await expect(
      runWithTransientBackendRetry(async () => {
        calls++;
        throw new Error("network down");
      }, { sleep: sleepImpl, maxAttempts: 2, baseMs: 1, capMs: 4 })
    ).rejects.toThrow("network down");
    expect(calls).toBe(2);
  });

  it("honours an already-aborted signal before the first attempt", async () => {
    const ac = new AbortController();
    ac.abort();
    let calls = 0;
    await expect(
      runWithTransientBackendRetry(
        async () => {
          calls++;
          return { ok: true, status: 200, body: "x" };
        },
        { sleep: sleepImpl, signal: ac.signal }
      )
    ).rejects.toThrow(/abort/i);
    expect(calls).toBe(0);
  });

  it("default sleep respects AbortSignal without a custom sleep", async () => {
    const ac = new AbortController();
    let calls = 0;
    const promise = runWithTransientBackendRetry(
      async () => {
        calls++;
        return { ok: false, status: 503, body: null };
      },
      { maxAttempts: 5, baseMs: 50, capMs: 100, signal: ac.signal }
    );
    setTimeout(() => ac.abort(), 10);
    const start = Date.now();
    await expect(promise).rejects.toThrow(/abort/i);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(80);
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  it("passes the source label to onRetry", async () => {
    let calls = 0;
    const retries = [];
    await runWithTransientBackendRetry(
      async () => {
        calls++;
        if (calls < 2) return { ok: false, status: 503, body: null };
        return { ok: true, status: 200, body: "ok" };
      },
      {
        sleep: sleepImpl,
        maxAttempts: 3,
        baseMs: 1,
        capMs: 4,
        source: "single-model",
        onRetry: (info) => retries.push(info)
      }
    );
    expect(retries).toHaveLength(1);
    expect(retries[0].source).toBe("single-model");
    expect(retries[0].status).toBe(503);
  });

  it("bounds the decorrelated jitter delay by capMs", async () => {
    const delays = [];
    let calls = 0;
    await runWithTransientBackendRetry(
      async () => {
        calls++;
        return { ok: false, status: 503, body: null };
      },
      {
        sleep: sleepImpl,
        maxAttempts: 5,
        baseMs: 1,
        capMs: 4,
        onRetry: (info) => delays.push(info.delayMs)
      }
    );
    expect(calls).toBe(5);
    for (const delay of delays) {
      expect(delay).toBeLessThanOrEqual(4);
      expect(delay).toBeGreaterThanOrEqual(1);
    }
  });
});
