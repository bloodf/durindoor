import { beforeEach, describe, expect, it, vi } from "vitest";
import { markAccountUnavailable } from "../../src/sse/services/auth.js";
import {
  KIRO_CREDIT_EXHAUSTION_PROBE_MS,
  MAX_RATE_LIMIT_COOLDOWN_MS,
} from "../../open-sse/config/errorConfig.js";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  getProviderConnectionById: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  getProviderConnectionById: mocks.getProviderConnectionById,
  getSettings: mocks.getSettings,
  validateApiKey: vi.fn(),
}));

vi.mock("@/shared/services/providerRateLimitEvidence", () => ({
  recordProviderRateLimitEvidence: vi.fn(),
  clearProviderRateLimitEvidence: vi.fn(),
}));

describe("#2664 — markAccountUnavailable caps Kiro credit-exhaustion cooldown at a daily probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProviderConnection.mockResolvedValue({});
    mocks.getProviderConnectionById.mockResolvedValue(null);
    mocks.getProviderConnections.mockResolvedValue([
      { id: "kiro-1", provider: "kiro", backoffLevel: 0 },
      { id: "codex-1", provider: "codex", backoffLevel: 0 },
    ]);
  });

  it("caps a far-future Kiro reset at ~24h, not the 7-day generic max", async () => {
    const weeksAway = Date.now() + 30 * 24 * 60 * 60 * 1000; // ~30 days
    const result = await markAccountUnavailable("kiro-1", 402, "Kiro monthly credit limit reached", "kiro", null, weeksAway);
    expect(result.shouldFallback).toBe(true);
    // Capped at the kiro daily probe window (allow a small execution delta).
    expect(result.cooldownMs).toBeLessThanOrEqual(KIRO_CREDIT_EXHAUSTION_PROBE_MS);
    expect(result.cooldownMs).toBeGreaterThan(KIRO_CREDIT_EXHAUSTION_PROBE_MS - 60_000);
  });

  it("still allows the full generic max for a non-capped provider", async () => {
    const weeksAway = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const result = await markAccountUnavailable("codex-1", 429, "usage limit", "codex", null, weeksAway);
    expect(result.shouldFallback).toBe(true);
    // Codex is not in RESET_COOLDOWN_CAP_MS -> capped at the 7-day generic max.
    expect(result.cooldownMs).toBeLessThanOrEqual(MAX_RATE_LIMIT_COOLDOWN_MS);
    expect(result.cooldownMs).toBeGreaterThan(KIRO_CREDIT_EXHAUSTION_PROBE_MS);
  });
});
