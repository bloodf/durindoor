/**
 * #2034 helper invariant: processAttemptResult treats a failure after partial
 * upstream output as terminal before the Antigravity 504 timeout replay, the
 * request-buffer (507) replay, the pin, quota and fallback paths. The public
 * route proof lives in antigravity-partial-output-no-replay-2034.test.js.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/sse/services/auth.js", async (importOriginal) => ({ ...(await importOriginal()), markAccountUnavailable: vi.fn(async () => ({ shouldFallback: true })) }));

const { processAttemptResult } = await import("../../src/sse/handlers/chat/singleModel/postProcess.js");
const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
const { runWithTransientBackendRetry } = await import("../../open-sse/services/transientBackendRetry.js");

const BUFFER_ERROR = "exceeded request buffer limit while retrying upstream";
const state = (extra = {}) => ({
  excludeConnectionIds: new Set(), attemptCounts: new Map([["account-a", 1]]), attemptedBlockers: new Map(),
  antigravityTimeoutResponse: null, requestReplayConnectionId: null, requestReplayAttempted: false,
  lastError: null, lastStatus: null, lastErrorCode: null, accountAttempts: 1, ...extra,
});
const attempt = { credentials: { connectionId: "account-a", connectionName: "a" } };
const failure = (status, error, partial) => {
  const response = new Response(JSON.stringify({ error: { message: error } }), { status });
  return { success: false, status, error, response, ...(partial ? { upstreamPartialOutput: true } : {}) };
};

describe("#2034 processAttemptResult ordering", () => {
  beforeEach(() => vi.clearAllMocks());
  const cases = [];
  for (const provider of ["antigravity", "agy"]) {
    for (const preferredConnectionId of [null, "account-a"]) {
      for (const [status, error] of [[504, "backend timeout"], [507, BUFFER_ERROR]]) cases.push([provider, preferredConnectionId, status, error]);
    }
  }

  it.each(cases)("%s pin=%s: partial output then %s is terminal with no retry state", async (provider, preferredConnectionId, status, error) => {
    const loop = state();
    const result = failure(status, error, true);
    const decision = await processAttemptResult({ provider, model: "gemini-3.7-flash-high", preferredConnectionId }, loop, attempt, result);
    expect(decision).toEqual({ kind: "terminal", response: result.response });
    expect(decision.response.status).toBe(status);
    expect(decision.response.upstreamPartialOutput).toBe(true);
    expect(loop.excludeConnectionIds.size).toBe(0);
    expect(loop.attemptCounts.get("account-a")).toBe(1);
    expect(loop.antigravityTimeoutResponse).toBeNull();
    expect(loop.requestReplayAttempted).toBe(false);
    expect(loop.requestReplayConnectionId).toBeNull();
    expect(markAccountUnavailable).not.toHaveBeenCalled();
    expect(await decision.response.json()).toEqual({ error: { message: error } });
  });

  it("stays terminal after an earlier sibling timeout and an earlier buffer replay", async () => {
    const earlier = new Response("earlier", { status: 504 });
    const loop = state({ antigravityTimeoutResponse: earlier, requestReplayAttempted: true, requestReplayConnectionId: "account-a" });
    const result = failure(504, "backend timeout", true);
    const decision = await processAttemptResult({ provider: "antigravity", model: "m" }, loop, attempt, result);
    expect(decision.response).toBe(result.response);
    expect(loop.antigravityTimeoutResponse).toBe(earlier);
    expect(loop.excludeConnectionIds.size).toBe(0);
  });

  it("the parent reproducer: a 504 after partial tool output does not replay", async () => {
    const response = new Response("backend timeout", { status: 504 });
    const loop = { excludeConnectionIds: new Set(), attemptCounts: new Map() };
    const decision = await processAttemptResult({ provider: "antigravity", model: "gemini-3.7-flash-high" }, loop, { credentials: { connectionId: "account-a" } },
      { success: false, status: 504, error: "backend timeout", upstreamPartialOutput: true, response });
    expect(decision).toEqual({ kind: "terminal", response });
  });

  it("no-output failures keep the existing replay policy", async () => {
    const timeoutLoop = state();
    expect(await processAttemptResult({ provider: "antigravity", model: "m" }, timeoutLoop, attempt, failure(504, "backend timeout"))).toEqual({ kind: "retry" });
    expect(timeoutLoop.excludeConnectionIds.has("account-a")).toBe(true);
    expect(timeoutLoop.antigravityTimeoutResponse.skipAntigravityTimeoutReplay).toBe(true);

    const pinned = failure(504, "backend timeout");
    expect(await processAttemptResult({ provider: "antigravity", model: "m", preferredConnectionId: "account-a" }, state(), attempt, pinned)).toEqual({ kind: "terminal", response: pinned.response });

    const bufferLoop = state();
    expect(await processAttemptResult({ provider: "antigravity", model: "m" }, bufferLoop, attempt, failure(507, BUFFER_ERROR))).toEqual({ kind: "retry" });
    expect(bufferLoop.requestReplayConnectionId).toBe("account-a");
    expect(bufferLoop.attemptCounts.has("account-a")).toBe(false);
  });

  it("the outer transient retry honors the flag left on the Response", async () => {
    const result = failure(504, "backend timeout", true);
    await processAttemptResult({ provider: "antigravity", model: "m" }, state(), attempt, result);
    let calls = 0;
    const final = await runWithTransientBackendRetry(async () => { calls++; return result.response; }, { sleep: async () => {} });
    expect(final).toBe(result.response);
    expect(calls).toBe(1);
  });
});
