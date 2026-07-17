import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { parseRateLimitEvidence } from "../../open-sse/utils/error.js";
import { BACKOFF_CONFIG, MAX_RATE_LIMIT_COOLDOWN_MS } from "../../open-sse/config/errorConfig.js";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  recordProviderRateLimitEvidence: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getApiKeyByKey: vi.fn(),
  validateApiKey: vi.fn(),
  updateProviderConnection: mocks.updateProviderConnection,
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  getQuotaReservationPressure: vi.fn(),
}));
vi.mock("@/shared/services/providerRateLimitEvidence", () => ({
  recordProviderRateLimitEvidence: mocks.recordProviderRateLimitEvidence,
  clearProviderRateLimitEvidence: vi.fn(),
}));

// OmniRoute #6731 — an apikey-category 429 whose body explicitly reports an
// exhausted daily/weekly/monthly quota must honor the real reset window and be
// classified state:"exhausted", not silently retried on the generic ~seconds
// exponential backoff. Ordinary transient 429s keep their backoff semantics.
describe("#6731 apikey 429 explicit quota-exhausted text", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_800_000_000_000);
  });
  afterEach(() => vi.useRealTimers());

  it("benches an explicit 3-day quota reset for the parsed window", () => {
    const body = JSON.stringify({
      error: "You have exceeded your weekly usage quota. Your quota will reset in 3 days.",
    });
    const result = checkFallbackError(429, body, 0);

    expect(result.shouldFallback).toBe(true);
    expect(result.rateLimitEvidence?.state).toBe("exhausted");
    // Exactly 3 days under the frozen clock.
    expect(result.cooldownMs).toBe(3 * 24 * 3600 * 1000);
    expect(result.cooldownMs).toBeGreaterThan(60 * 60 * 1000); // far above transient backoff
  });

  it("preserves exhausted state on resetless quota text (no parseable deadline)", () => {
    const result = checkFallbackError(429, "You have reached your weekly usage limit", 0);

    expect(result.shouldFallback).toBe(true);
    expect(result.rateLimitEvidence?.state).toBe("exhausted");
    // No invented long deadline — falls back to the short bench.
    expect(result.cooldownMs).toBeLessThanOrEqual(BACKOFF_CONFIG.max);
  });

  it("parses quota text from a non-string (object) error body", () => {
    const result = checkFallbackError(
      429,
      { error: "You have exceeded your weekly usage quota. Your quota will reset in 3 days." },
      0,
    );
    expect(result.shouldFallback).toBe(true);
    expect(result.rateLimitEvidence?.state).toBe("exhausted");
    expect(result.cooldownMs).toBeGreaterThan(60 * 60 * 1000);
  });

  it("keeps an ordinary transient 429 on exponential backoff", () => {
    const result = checkFallbackError(429, "Rate limit exceeded", 0);

    expect(result.shouldFallback).toBe(true);
    expect(result.rateLimitEvidence).toBeUndefined();
    expect(result.cooldownMs).toBe(BACKOFF_CONFIG.base); // level 1 = base
    expect(result.newBackoffLevel).toBe(1);
  });

  it("keeps a bare 429 (no body) on exponential backoff", () => {
    const result = checkFallbackError(429, "", 0);

    expect(result.shouldFallback).toBe(true);
    expect(result.rateLimitEvidence).toBeUndefined();
    expect(result.cooldownMs).toBe(BACKOFF_CONFIG.base);
  });

  it("clamps a 14-day monthly quota reset to the configured cap", () => {
    const result = checkFallbackError(429, "Monthly quota exceeded; reset in 14 days", 0);

    expect(result.shouldFallback).toBe(true);
    expect(result.rateLimitEvidence?.state).toBe("exhausted");
    expect(result.cooldownMs).toBe(MAX_RATE_LIMIT_COOLDOWN_MS);
  });

  it("rejects an absurd Retry-After header duration as resetless exhaustion", () => {
    const body = "monthly quota exceeded";
    const evidence = parseRateLimitEvidence({
      status: 429,
      bodyText: body,
      headers: { get: () => "999999999" },
      now: Date.now(),
    });

    expect(evidence.state).toBe("exhausted");
    expect(evidence.resetAtMs).toBeNull();
    expect(evidence.source).toBe("local_policy");
  });
});

// The classifier fix only matters if markAccountUnavailable propagates it into
// durable evidence. These cases exercise the full auth.js path with a mocked
// DB, catching any ordering/persistence regression the direct tests cannot.
describe("#6731 markAccountUnavailable propagation", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([
      { id: "oc-1", provider: "ollama-cloud", backoffLevel: 0 },
    ]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const load = async () => (await import("../../src/sse/services/auth.js")).markAccountUnavailable;

  it("returns ~3 days + retryAtKnown:true for an explicit 3-day quota reset", async () => {
    const mark = await load();
    const result = await mark(
      "oc-1", 429,
      JSON.stringify({ error: "You have exceeded your weekly usage quota. Your quota will reset in 3 days." }),
      "ollama-cloud", "deepseek-v4-pro",
    );

    expect(result.retryAtKnown).toBe(true);
    expect(result.cooldownMs).toBe(3 * 24 * 3600 * 1000);
    expect(mocks.recordProviderRateLimitEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ state: "exhausted", resetAtMs: expect.any(Number) }),
    );
  });

  it("persists resetless exhaustion as state:exhausted resetAtMs:null", async () => {
    const mark = await load();
    const result = await mark("oc-1", 429, "You have reached your weekly usage limit", "ollama-cloud", "deepseek-v4-pro");

    expect(result.retryAtKnown).toBe(false);
    expect(mocks.recordProviderRateLimitEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ state: "exhausted", resetAtMs: null }),
    );
  });

  it("keeps a transient 429 on base backoff as an ordinary cooldown", async () => {
    const mark = await load();
    const result = await mark("oc-1", 429, "Rate limit exceeded", "ollama-cloud", "deepseek-v4-pro");

    expect(result.cooldownMs).toBe(BACKOFF_CONFIG.base);
    expect(result.retryAtKnown).toBe(true);
    expect(mocks.recordProviderRateLimitEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ state: "cooldown" }),
    );
  });
});
