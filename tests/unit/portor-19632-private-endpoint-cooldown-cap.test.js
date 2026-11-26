import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(async () => ({})),
  getSettings: vi.fn(async () => ({})),
}));

vi.mock("@/lib/localDb", () => ({ ...dbMocks, validateApiKey: vi.fn() }));
vi.mock("@/shared/services/providerRateLimitEvidence", () => ({
  recordProviderRateLimitEvidence: vi.fn(),
  clearProviderRateLimitEvidence: vi.fn(),
}));

const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");

const PROVIDER = "openai-compatible-chat-node";

async function fail(baseUrl, status = 429, { resetsAtMs = Date.now() + 120_000, backoffLevel = 6 } = {}) {
  dbMocks.getProviderConnections.mockResolvedValue([
    { id: "conn-a", provider: PROVIDER, backoffLevel, providerSpecificData: { baseUrl } },
  ]);
  return markAccountUnavailable("conn-a", status, "Too many requests", PROVIDER, "model-a", resetsAtMs);
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getSettings.mockResolvedValue({});
});

describe("OmniRoute #19632 private endpoint cooldown cap", () => {
  it.each([
    "http://127.0.0.1:11434/v1", "http://localhost:1234/v1", "http://[::1]:8080/v1",
    "http://192.168.1.20:8080/v1", "http://10.1.2.3/v1",
  ])("benches %s for seconds despite a long reset hint", async (baseUrl) => {
    const result = await fail(baseUrl);
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeLessThanOrEqual(5_000);
  });

  it.each([429, 503])("skips the backoff ladder on %s without a reset hint", async (status) => {
    const result = await fail("http://127.0.0.1:11434/v1", status, { resetsAtMs: null });
    expect(result.cooldownMs).toBeLessThanOrEqual(5_000);
  });

  it("leaves a public host on its reset hint", async () => {
    const result = await fail("https://api.example.com/v1");
    expect(result.cooldownMs).toBeGreaterThanOrEqual(100_000);
  });

  it("keeps a retry delay the operator configured", async () => {
    dbMocks.getSettings.mockResolvedValue({ retryDelayByProvider: { [PROVIDER]: 60 } });
    const result = await fail("http://127.0.0.1:11434/v1", 429, { resetsAtMs: null });
    expect(result.cooldownMs).toBe(60_000);
  });
});
