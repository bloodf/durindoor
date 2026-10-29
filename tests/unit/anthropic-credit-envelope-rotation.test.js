import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1364 review: Anthropic ships prepaid credit exhaustion as HTTP 400 with
 * `error.type: "invalid_request_error"`. chat.js drives account rotation via
 * markAccountUnavailable(result.status, result.error, …, { errorBody }), so
 * the credit phrase must win despite that early-exit type — without rotating
 * ordinary invalid_request_error schema failures.
 */
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

const ANTHROPIC_CREDIT_MESSAGE =
  "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.";

const ANTHROPIC_CREDIT_ENVELOPE = {
  type: "error",
  error: {
    type: "invalid_request_error",
    message: ANTHROPIC_CREDIT_MESSAGE,
  },
};

const ANTHROPIC_SCHEMA_ENVELOPE = {
  type: "error",
  error: {
    type: "invalid_request_error",
    message: "messages.0: Field required",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.updateProviderConnection.mockResolvedValue({});
  dbMocks.getProviderConnectionById.mockResolvedValue(null);
  dbMocks.getSettings.mockResolvedValue({});
  dbMocks.getProviderConnections.mockResolvedValue([{
    id: "anthropic-a",
    provider: "anthropic",
    name: "anthropic-a",
    backoffLevel: 0,
  }]);
});

describe("Anthropic credit envelope account rotation (#1364)", () => {
  it("marks the account unavailable for the real Anthropic credit envelope", async () => {
    // chat.js passes result.error (message or raw body) plus errorBody. Probe
    // the envelope as errorText so invalid_request_error is present in the
    // classifier input the way the reviewer's checkFallbackError probe did.
    const result = await markAccountUnavailable(
      "anthropic-a",
      400,
      JSON.stringify(ANTHROPIC_CREDIT_ENVELOPE),
      "anthropic",
      "claude-sonnet-4-5",
      null,
      { errorBody: ANTHROPIC_CREDIT_ENVELOPE },
    );

    expect(result).toEqual({
      shouldFallback: true,
      cooldownMs: 120000,
      retryAt: expect.any(String),
      retryAtKnown: true,
      status: 400,
    });
    expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith(
      "anthropic-a",
      expect.objectContaining({
        testStatus: "unavailable",
        errorCode: 400,
        "modelLock_claude-sonnet-4-5": expect.any(String),
      }),
      expect.objectContaining({ refuseIfReauth: true, returnCommitResult: true }),
    );
  });

  it("does not rotate for a normal invalid_request_error envelope", async () => {
    const result = await markAccountUnavailable(
      "anthropic-a",
      400,
      JSON.stringify(ANTHROPIC_SCHEMA_ENVELOPE),
      "anthropic",
      "claude-sonnet-4-5",
      null,
      { errorBody: ANTHROPIC_SCHEMA_ENVELOPE },
    );

    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(dbMocks.updateProviderConnection).not.toHaveBeenCalled();
  });
});
