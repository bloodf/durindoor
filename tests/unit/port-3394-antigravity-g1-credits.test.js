// Upstream decolua/9router#3394: read google.rpc.ErrorInfo from a 429 so an
// account that ran out of Google One AI credits gets a long lock.
//
// DurinDoor redacts the 429 body before account fallback runs, so the reason
// must travel in the rate-limit evidence. Every response here is synthetic.
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
const evidenceMocks = vi.hoisted(() => ({
  recordProviderRateLimitEvidence: vi.fn(),
  clearProviderRateLimitEvidence: vi.fn(),
}));
const refreshProviderQuota = vi.hoisted(() => vi.fn());

vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("@/shared/services/providerRateLimitEvidence", () => evidenceMocks);
vi.mock("@/shared/services/providerQuotaTracker", () => ({ refreshProviderQuota }));
vi.mock("@/lib/webhooks/index.js", () => ({ notifyWebhookEvent: vi.fn() }));

const { parseRateLimitEvidence, parseUpstreamError } = await import("../../open-sse/utils/error.js");
const { AntigravityExecutor } = await import("../../open-sse/executors/antigravity.js");
const { evaluateProviderFailure, __resetAntigravity429StrikesForTests } = await import("../../src/sse/handlers/chat/singleModel/providerHooks.js");
const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");

const MODEL = "gemini-3.8-flash-high";
const DAY_MS = 24 * 60 * 60 * 1000;
const ERROR_INFO = "type.googleapis.com/google.rpc.ErrorInfo";

function creditsBody({ reason = "INSUFFICIENT_G1_CREDITS_BALANCE", metadata } = {}) {
  return JSON.stringify({
    error: {
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      message: "Resource has been exhausted (e.g. check quota).",
      details: [{ "@type": ERROR_INFO, reason, domain: "cloudcode-pa.googleapis.com", ...(metadata ? { metadata } : null) }],
    },
  });
}

const parse = (body) => parseUpstreamError(new Response(body, { status: 429 }), new AntigravityExecutor(), {});

describe("port 9router #3394: Antigravity G1 credit exhaustion from ErrorInfo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetAntigravity429StrikesForTests();
    dbMocks.getSettings.mockResolvedValue({});
    dbMocks.getProviderConnections.mockResolvedValue([{ id: "acc-a", provider: "antigravity", isActive: true }]);
    dbMocks.updateProviderConnection.mockResolvedValue({ applied: true });
  });

  it("marks the redacted 429 as exhausted credits instead of a request-scoped rejection", async () => {
    const parsed = await parse(creditsBody());

    expect(parsed.message).toBe("Rate limit exceeded");
    expect(parsed.rateLimitEvidence).toMatchObject({ state: "exhausted", resetAtMs: null, creditsExhausted: true });
    expect(parsed.noQuotaMetadata).toBe(false);
    expect(JSON.stringify(parsed)).not.toContain("INSUFFICIENT_G1_CREDITS_BALANCE");
  });

  it("locks the whole account for a day and allows account fallback", async () => {
    const parsed = await parse(creditsBody());
    // chatCore adds a short local reset to a 429 that has no upstream reset.
    const result = {
      status: 429,
      error: `[429]: ${parsed.message}`,
      resetsAtMs: Date.now() + 2_000,
      rateLimitEvidence: parsed.rateLimitEvidence,
      antigravityQuotaSignal: parsed.antigravityQuotaSignal,
      noQuotaMetadata: parsed.noQuotaMetadata,
    };
    const ctx = { provider: "antigravity", model: MODEL, request: new Request("http://localhost/v1"), requestSignal: null };
    const attempt = { credentials: { connectionId: "acc-a" }, activeConnection: null };
    const state = { refreshedQuotaConnectionIds: new Set(), excludeConnectionIds: new Set() };

    const failure = await evaluateProviderFailure(ctx, state, attempt, result, null);
    expect(failure.kind).toBe("ok");

    const fallback = await markAccountUnavailable("acc-a", 429, result.error, "antigravity", MODEL, failure.fallbackResetAt, {
      rateLimitEvidence: failure.fallbackEvidence,
    });

    expect(fallback.shouldFallback).toBe(true);
    expect(fallback.cooldownMs).toBeGreaterThan(DAY_MS - 5_000);
    expect(fallback.cooldownMs).toBeLessThanOrEqual(DAY_MS);
    expect(dbMocks.updateProviderConnection.mock.calls[0][1]).toHaveProperty("modelLock___all");
    expect(evidenceMocks.recordProviderRateLimitEvidence).toHaveBeenCalledWith(expect.objectContaining({ state: "exhausted" }));
  });

  it("keeps an upstream reset timestamp as the lock deadline", async () => {
    const stamp = new Date(Date.now() + 3_600_000).toISOString();
    const parsed = await parse(creditsBody({ metadata: { quotaResetTimeStamp: stamp } }));

    expect(parsed.resetsAtMs).toBe(Date.parse(stamp));
    expect(parsed.rateLimitEvidence.creditsExhausted).toBeUndefined();
  });

  it("ignores the credit reason outside ErrorInfo and outside Antigravity", () => {
    const echoed = JSON.stringify({ error: { code: 429, message: "INSUFFICIENT_G1_CREDITS_BALANCE", details: [] } });

    expect(parseRateLimitEvidence({ status: 429, bodyText: echoed, provider: "antigravity" }).creditsExhausted).toBeUndefined();
    expect(parseRateLimitEvidence({ status: 429, bodyText: creditsBody(), provider: "openai" }).creditsExhausted).toBeUndefined();
  });
});
