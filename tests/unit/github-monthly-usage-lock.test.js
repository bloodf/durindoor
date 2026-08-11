import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  getProviderConnectionById: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: dbMocks.getProviderConnections,
  updateProviderConnection: dbMocks.updateProviderConnection,
  getProviderConnectionById: dbMocks.getProviderConnectionById,
  getSettings: dbMocks.getSettings,
  validateApiKey: vi.fn(),
}));
vi.mock("@/shared/services/providerRateLimitEvidence", () => ({
  recordProviderRateLimitEvidence: vi.fn(),
  clearProviderRateLimitEvidence: vi.fn(),
}));

const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.updateProviderConnection.mockResolvedValue({});
  dbMocks.getProviderConnectionById.mockResolvedValue(null);
  dbMocks.getProviderConnections.mockResolvedValue([{
    id: "github-a",
    provider: "github",
    name: "github-a",
    backoffLevel: 4,
  }]);
});

describe("GitHub monthly usage exhaustion", () => {
  it("locks the whole account until the next UTC month", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T19:30:00.000Z"));

    try {
      await markAccountUnavailable(
        "github-a",
        402,
        "You've reached your additional usage limit for your plan. Go to GitHub settings for details.",
        "github",
        "claude-fable-5",
      );

      expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith(
        "github-a",
        expect.objectContaining({
          modelLock___all: "2026-09-01T00:00:00.000Z",
          testStatus: "unavailable",
          errorCode: 402,
          backoffLevel: 0,
        }),
      );
      expect(dbMocks.updateProviderConnection.mock.calls[0][1])
        .not.toHaveProperty("modelLock_claude-fable-5");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps unrelated GitHub 402 errors model-scoped", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T19:30:00.000Z"));

    try {
      await markAccountUnavailable("github-a", 402, "Payment required", "github", "claude-fable-5");

      expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith(
        "github-a",
        expect.objectContaining({
          "modelLock_claude-fable-5": "2026-08-04T19:32:00.000Z",
        }),
      );
      expect(dbMocks.updateProviderConnection.mock.calls[0][1])
        .not.toHaveProperty("modelLock___all");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Codex invalidated OAuth credentials", () => {
  it("quarantines a permanently invalidated profile until reauthorization", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([{
      id: "codex-a", provider: "codex", name: "codex-a", backoffLevel: 3,
    }]);

    const result = await markAccountUnavailable(
      "codex-a", 401, "Encountered invalidated oauth token for user, failing request", "codex", "gpt-5.6-sol",
    );

    expect(result).toEqual({ shouldFallback: true, cooldownMs: 0 });
    expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith(
      "codex-a",
      expect.objectContaining({
        isActive: false,
        testStatus: "reauth_required",
        errorCode: 401,
        backoffLevel: 0,
      }),
    );
    expect(dbMocks.updateProviderConnection.mock.calls[0][1])
      .not.toHaveProperty("modelLock_gpt-5.6-sol");
  });

  it("keeps ordinary Codex 401 failures on the model cooldown path", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([{
      id: "codex-a", provider: "codex", name: "codex-a", backoffLevel: 0,
    }]);

    await markAccountUnavailable("codex-a", 401, "Unauthorized", "codex", "gpt-5.6-sol");

    expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith(
      "codex-a",
      expect.objectContaining({
        "modelLock_gpt-5.6-sol": expect.any(String),
        testStatus: "unavailable",
        errorCode: 401,
      }),
    );
    expect(dbMocks.updateProviderConnection.mock.calls[0][1])
      .not.toHaveProperty("isActive");
  });
});
