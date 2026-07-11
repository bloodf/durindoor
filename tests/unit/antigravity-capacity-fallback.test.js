import { beforeEach, describe, expect, it, vi } from "vitest";
import { getProviderCredentials, markAccountUnavailable } from "../../src/sse/services/auth.js";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  validateApiKey: mocks.validateApiKey,
  getSettings: mocks.getSettings,
}));

describe("Antigravity capacity fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([
      { id: "ag-1", provider: "antigravity", email: "ag@example.com", backoffLevel: 4 },
      { id: "agy-1", provider: "agy", email: "agy@example.com", backoffLevel: 4 },
    ]);
  });

  it("falls back without writing model cooldown for agy capacity errors", async () => {
    const result = await markAccountUnavailable(
      "agy-1",
      503,
      '{"reason":"MODEL_CAPACITY_EXHAUSTED","message":"No capacity available for model claude-opus-4-6-thinking on the server"}',
      "agy",
      "claude-opus-4-6-thinking",
    );

    expect(result).toEqual({ shouldFallback: true, cooldownMs: 0 });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("falls back without writing model cooldown for MODEL_CAPACITY_EXHAUSTED", async () => {
    const result = await markAccountUnavailable(
      "ag-1",
      503,
      '{"reason":"MODEL_CAPACITY_EXHAUSTED","message":"No capacity available for model claude-opus-4-6-thinking on the server"}',
      "antigravity",
      "claude-opus-4-6-thinking",
    );

    expect(result).toEqual({ shouldFallback: true, cooldownMs: 0 });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("keeps normal cooldown behavior for non-Antigravity capacity text", async () => {
    const result = await markAccountUnavailable(
      "ag-1",
      503,
      "No capacity available for model x",
      "kiro",
      "some-model",
    );

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "ag-1",
      expect.objectContaining({
        testStatus: "unavailable",
        errorCode: 503,
      }),
    );
  });

  it("falls back without cooldown for recoverable Antigravity project 403", async () => {
    const result = await markAccountUnavailable(
      "ag-1",
      403,
      {
        error: {
          status: "PERMISSION_DENIED",
          message: "Cloud AI Companion API has not been used in project 123 before or it is disabled.",
          details: [{ reason: "SERVICE_DISABLED" }],
        },
      },
      "antigravity",
      "claude-sonnet-4-6",
    );

    expect(result).toEqual({ shouldFallback: true, cooldownMs: 0 });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });
});

// U-16 #2514: end-to-end account selection. A stateful connection store backs
// the localDb mock so a markAccountUnavailable(modelLock) written for the
// primary is observed by the next getProviderCredentials call.
describe("Antigravity secondary-account quota fallback (U-16 #2514)", () => {
  let connections;

  beforeEach(() => {
    vi.clearAllMocks();
    connections = [
      {
        id: "agy-primary", provider: "agy", email: "primary@example.com",
        isActive: true, authType: "oauth", accessToken: "tok-primary", priority: 1,
      },
      {
        id: "agy-secondary", provider: "agy", email: "secondary@example.com",
        isActive: true, authType: "oauth", accessToken: "tok-secondary", priority: 2,
      },
    ];
    mocks.getProviderConnections.mockImplementation(async ({ provider } = {}) => {
      const rows = provider ? connections.filter((c) => c.provider === provider) : connections;
      return rows.map((c) => ({ ...c }));
    });
    mocks.updateProviderConnection.mockImplementation(async (id, patch) => {
      const row = connections.find((c) => c.id === id);
      if (row) Object.assign(row, patch);
      return row;
    });
    mocks.getSettings.mockResolvedValue({});
  });

  it("locks primary on quota-exhausted 429 and selects the secondary account", async () => {
    const model = "claude-opus-4-6-thinking";

    const first = await getProviderCredentials("agy", null, model);
    expect(first.connectionId).toBe("agy-primary");

    const resetMs = Date.now() + 160 * 3600 * 1000;
    const body = "individual quota reached";
    const mark = await markAccountUnavailable("agy-primary", 429, body, "agy", model, resetMs);

    expect(mark.shouldFallback).toBe(true);
    // Core behavior: AGY quota windows (~160h) exceed the old 30-min cap.
    expect(mark.cooldownMs).toBeGreaterThan(30 * 60 * 1000);
    expect(mark.cooldownMs).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);

    const primaryAfter = connections.find((c) => c.id === "agy-primary");
    const lockExpiry = new Date(primaryAfter[`modelLock_${model}`]).getTime();
    expect(Math.abs(lockExpiry - resetMs)).toBeLessThan(5000);
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "agy-primary",
      expect.objectContaining({
        testStatus: "unavailable",
        errorCode: 429,
        [`modelLock_${model}`]: expect.anything(),
      }),
    );

    const second = await getProviderCredentials("agy", null, model);
    expect(second.connectionId).toBe("agy-secondary");
    expect(second.accessToken).toBe("tok-secondary");
  });
});
