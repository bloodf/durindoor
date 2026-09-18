// Client-facing Retry-After for the single-account error path.
// unavailableResponse (combo exhaustion) already emitted Retry-After; the
// per-request error path (createErrorResult / errorResponse) did not, so an
// OpenAI-compatible caller saw a bare error and fell back to its own short
// generic backoff, hammering an already-overloaded provider.
import { describe, it, expect } from "vitest";
import { createErrorResult, errorResponse } from "../../open-sse/utils/error.js";

describe("errorResponse emits Retry-After when given a cooldown", () => {
  it("adds the header when retryAfterSec is a positive number", () => {
    const res = errorResponse(429, "overloaded", null, 30);
    expect(Number(res.headers.get("Retry-After"))).toBe(30);
  });

  it("omits the header without a cooldown", () => {
    expect(errorResponse(400, "bad").headers.get("Retry-After")).toBeNull();
    expect(errorResponse(429, "overloaded", null, 0).headers.get("Retry-After")).toBeNull();
    expect(errorResponse(429, "overloaded", null, -5).headers.get("Retry-After")).toBeNull();
  });

  it("keeps the OpenAI-compatible error body and CORS intact", async () => {
    const res = errorResponse(429, "overloaded", null, 10);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const body = await res.json();
    expect(body.error.message).toBe("overloaded");
    expect(body.error.type).toBeTruthy();
  });
});

describe("createErrorResult surfaces resetsAtMs as Retry-After", () => {
  it("emits the header derived from resetsAtMs", () => {
    const result = createErrorResult(429, "overloaded", Date.now() + 30_000);
    expect(result.response.status).toBe(429);
    const header = Number(result.response.headers.get("Retry-After"));
    expect(header).toBeGreaterThan(25);
    expect(header).toBeLessThanOrEqual(31);
  });

  it("omits the header when there is no cooldown", () => {
    expect(createErrorResult(500, "boom").response.headers.get("Retry-After")).toBeNull();
  });

  it("never emits a non-positive Retry-After for an already-expired cooldown", () => {
    // A cooldown that already elapsed must floor to 1s, never 0 or negative —
    // "Retry-After: 0" invites an immediate hot-loop against the provider.
    const header = createErrorResult(429, "late", Date.now() - 10_000).response.headers.get("Retry-After");
    expect(Number(header)).toBeGreaterThanOrEqual(1);
  });

  it("still emits Retry-After when a structured errorBody is present", () => {
    const errorBody = { error: { message: "overloaded", type: "rate_limit_error" } };
    const result = createErrorResult(429, "overloaded", Date.now() + 20_000, errorBody);
    const header = Number(result.response.headers.get("Retry-After"));
    expect(header).toBeGreaterThan(15);
    expect(header).toBeLessThanOrEqual(21);
  });
});
