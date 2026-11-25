// A Freebuff account keeps its paid session through transient failures and
// rotates only when it cannot serve. Every upstream response is a local stub.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connection: null }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => [mocks.connection]),
  getProviderConnectionById: vi.fn(async () => mocks.connection),
  updateProviderConnection: vi.fn(async (_id, patch) => Object.assign(mocks.connection, patch)),
  getSettings: vi.fn(async () => ({})),
}));

const { markAccountUnavailable } = await import("../../src/sse/services/auth/accountErrors.js");
const { FreebuffExecutor } = await import("../../open-sse/executors/freebuff.js");
const { parseUpstreamError } = await import("../../open-sse/utils/error.js");

const MODEL = "deepseek/deepseek-v4-flash";
const locks = () => Object.keys(mocks.connection).filter((key) => key.startsWith("modelLock_"));

// Run one chat failure through the real executor and error parser.
async function fail(status, body, headers = {}) {
  const executor = new FreebuffExecutor({
    fetch: async (url) => url.endsWith("/chat/completions")
      ? new Response(JSON.stringify(body), { status, headers })
      : new Response(JSON.stringify({ instanceId: "i", runId: "r" })),
  });
  const { response } = await executor.execute({
    model: MODEL,
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: false,
    credentials: { apiKey: "synthetic", providerSpecificData: { enableSessionDispatch: true } },
  });
  const parsed = await parseUpstreamError(response, executor);
  const outcome = await markAccountUnavailable("one", parsed.statusCode, parsed.message, "freebuff", MODEL, parsed.resetsAtMs, {
    rateLimitEvidence: parsed.rateLimitEvidence,
    errorBody: parsed.errorBody,
  });
  return { outcome, parsed };
}

describe("Freebuff session-preserving fallback (OmniRoute #20655)", () => {
  beforeEach(() => {
    mocks.connection = { id: "one", provider: "freebuff", authType: "apikey", apiKey: "synthetic", priority: 1, isActive: true };
  });

  it.each([
    [500, { error: "boom" }],
    [503, { error: "busy" }],
    [409, { error: "model busy" }],
    [429, { pool: "freebucks", recentCount: 1, limit: 5, retryAfterMs: 5000 }],
    [429, { error: "overusage" }],
  ])("keeps the account after a transient %s", async (status, body) => {
    const { outcome } = await fail(status, body);

    expect(outcome.shouldFallback).toBe(false);
    expect(locks()).toEqual([]);
  });

  it.each([
    [429, { status: "rate_limited", pool: "freebucks", recentCount: 5, limit: 5 }],
    [429, { padding: "x".repeat(400), pool: "freebucks", freebucksShortfall: 3 }],
    [402, { pool: "freebucks", balance: 0 }],
  ])("rotates and locks the whole account when Freebucks are spent (%s)", async (status, body) => {
    const reset = 3 * 60 * 60 * 1000;
    const { outcome, parsed } = await fail(status, { ...body, retryAfterMs: reset });

    expect(parsed.resetsAtMs).toBeGreaterThan(Date.now() + reset - 60_000);
    expect(outcome.shouldFallback).toBe(true);
    expect(locks()).toEqual(["modelLock___all"]);
  });

  it("still rotates away from a rejected token", async () => {
    const { outcome } = await fail(401, { error: "bad token" });

    expect(outcome.shouldFallback).toBe(true);
  });
});
