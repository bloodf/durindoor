import { beforeEach, describe, expect, it, vi } from "vitest";
import { markAccountUnavailable } from "../../src/sse/services/auth.js";

// OmniRoute #10920, adapted: operator opts a provider into egress-IP-bucketed
// cooldown via settings.egressBucketedProviders; DurinDoor buckets by the
// connection's configured proxy pool id (no historical egress-IP log exists
// in this fork), see applyEgressBucketCooldown in src/sse/services/auth.js.

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

function connection(id, overrides = {}) {
  return {
    id,
    provider: "opencode",
    backoffLevel: 0,
    testStatus: "active",
    isActive: true,
    providerSpecificData: {},
    ...overrides,
  };
}

describe("#10920 — egress-IP-bucketed cooldown cools siblings on the same proxy pool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProviderConnection.mockResolvedValue({});
    mocks.getProviderConnectionById.mockResolvedValue(null);
  });

  it("cools a sibling on the same proxy pool when the provider is opted in", async () => {
    mocks.getSettings.mockResolvedValue({ egressBucketedProviders: ["opencode"] });
    mocks.getProviderConnections.mockResolvedValue([
      connection("c1", { providerSpecificData: { proxyPoolId: "pool-a" } }),
      connection("c2", { providerSpecificData: { proxyPoolId: "pool-a" } }),
      connection("c3", { providerSpecificData: { proxyPoolId: "pool-b" } }),
    ]);

    const result = await markAccountUnavailable("c1", 429, "rate limit reached", "opencode");
    expect(result.shouldFallback).toBe(true);

    // c1 itself is persisted, plus c2 (same pool). c3 (different pool) is left alone.
    const updatedIds = mocks.updateProviderConnection.mock.calls.map((call) => call[0]);
    expect(updatedIds).toContain("c1");
    expect(updatedIds).toContain("c2");
    expect(updatedIds).not.toContain("c3");

    const c2Call = mocks.updateProviderConnection.mock.calls.find((call) => call[0] === "c2");
    expect(c2Call[1]).toMatchObject({ testStatus: "unavailable", errorCode: 429 });
    expect(c2Call[1].modelLock___all).toBeTruthy();
  });

  it("does nothing when the provider is not opted in", async () => {
    mocks.getSettings.mockResolvedValue({ egressBucketedProviders: [] });
    mocks.getProviderConnections.mockResolvedValue([
      connection("c1", { providerSpecificData: { proxyPoolId: "pool-a" } }),
      connection("c2", { providerSpecificData: { proxyPoolId: "pool-a" } }),
    ]);

    await markAccountUnavailable("c1", 429, "rate limit reached", "opencode");

    const updatedIds = mocks.updateProviderConnection.mock.calls.map((call) => call[0]);
    expect(updatedIds).toEqual(["c1"]);
  });

  it("never buckets connections with no configured proxy pool", async () => {
    mocks.getSettings.mockResolvedValue({ egressBucketedProviders: ["opencode"] });
    mocks.getProviderConnections.mockResolvedValue([
      connection("c1", { providerSpecificData: {} }),
      connection("c2", { providerSpecificData: {} }),
    ]);

    await markAccountUnavailable("c1", 429, "rate limit reached", "opencode");

    const updatedIds = mocks.updateProviderConnection.mock.calls.map((call) => call[0]);
    expect(updatedIds).toEqual(["c1"]);
  });

  it("never shortens a sibling that already has an active lock", async () => {
    mocks.getSettings.mockResolvedValue({ egressBucketedProviders: ["opencode"] });
    const farFutureLock = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mocks.getProviderConnections.mockResolvedValue([
      connection("c1", { providerSpecificData: { proxyPoolId: "pool-a" } }),
      connection("c2", {
        providerSpecificData: { proxyPoolId: "pool-a" },
        modelLock___all: farFutureLock,
      }),
    ]);

    await markAccountUnavailable("c1", 429, "rate limit reached", "opencode");

    const updatedIds = mocks.updateProviderConnection.mock.calls.map((call) => call[0]);
    expect(updatedIds).not.toContain("c2");
  });

  it("skips a reauth-quarantined sibling", async () => {
    mocks.getSettings.mockResolvedValue({ egressBucketedProviders: ["opencode"] });
    mocks.getProviderConnections.mockResolvedValue([
      connection("c1", { providerSpecificData: { proxyPoolId: "pool-a" } }),
      connection("c2", { providerSpecificData: { proxyPoolId: "pool-a" }, testStatus: "reauth_required" }),
    ]);

    await markAccountUnavailable("c1", 429, "rate limit reached", "opencode");

    const updatedIds = mocks.updateProviderConnection.mock.calls.map((call) => call[0]);
    expect(updatedIds).not.toContain("c2");
  });
});
