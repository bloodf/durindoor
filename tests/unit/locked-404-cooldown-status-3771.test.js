import { describe, expect, it } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { unavailableResponse } from "../../open-sse/utils/error.js";
import { summarizeBlockedConnections } from "../../src/sse/services/auth/connectionLocks.js";

const NOW = Date.now();
const LOCK_UNTIL = new Date(NOW + 118_000).toISOString();
const summarize = (errorCode) => summarizeBlockedConnections(
  [{ id: "conn", errorCode, "modelLock_gpt-x": LOCK_UNTIL }], new Map(), "gpt-x", "gpt-x", NOW
);

describe("upstream 9router #3771: status while a 404 cooldown is open", () => {
  it("answers 503 with Retry-After instead of replaying the cooled-down 404", () => {
    // Premise: a bodyless 404 locks the account, a wrong-model 404 does not.
    expect(checkFallbackError(404, "HTTP 404").shouldFallback).toBe(true);
    expect(checkFallbackError(404, "model gpt-x not found").shouldFallback).toBe(false);

    const summary = summarize(404);
    expect(summary).toMatchObject({ status: 503, message: "Provider unavailable", retryAfter: LOCK_UNTIL });

    const response = unavailableResponse(summary.status, summary.message, summary.retryAfter, summary.retryAfterHuman);
    expect(response.status).toBe(503);
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(100);
  });

  it.each([400, 401, 402, 403, 500])("leaves a locked %i unchanged", (code) => {
    expect(summarize(code)).toMatchObject({ status: code, retryAfter: null });
  });
});
