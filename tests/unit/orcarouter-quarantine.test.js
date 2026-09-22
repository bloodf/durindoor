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

const ROW = {
  id: "orca-a",
  provider: "orcarouter",
  name: "orca-a",
  authType: "oauth",
  accessToken: "sk-orca-current",
  apiKey: "sk-orca-current",
  backoffLevel: 0,
  isActive: true,
  updatedAt: "2026-09-21T10:00:00.000Z",
  "modelLock_openai/gpt-5.5": "2026-09-21T11:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.updateProviderConnection.mockResolvedValue({});
  dbMocks.getProviderConnectionById.mockResolvedValue(null);
  dbMocks.getProviderConnections.mockResolvedValue([{ ...ROW }]);
});

describe("OrcaRouter rejected-key quarantine", () => {
  it("takes a rejected key out of rotation as reauth_required, like Codex", async () => {
    const result = await markAccountUnavailable(
      "orca-a", 401, "Invalid API key", "orcarouter", "openai/gpt-5.5", null,
      { usedCredential: "sk-orca-current" },
    );

    expect(result).toEqual({ shouldFallback: true, cooldownMs: 0 });
    expect(dbMocks.updateProviderConnection).toHaveBeenCalledTimes(1);
    const [id, patch, options] = dbMocks.updateProviderConnection.mock.calls[0];
    expect(id).toBe("orca-a");
    expect(patch).toMatchObject({
      testStatus: "reauth_required",
      isActive: false,
      needsReauth: true,
      reauthReason: "credential_rejected",
      errorCode: 401,
      backoffLevel: 0,
      "modelLock_openai/gpt-5.5": null,
    });
    // The write is fenced on the row version that was loaded.
    expect(options).toEqual({ expectedUpdatedAt: ROW.updatedAt });
  });

  it("skips the write when the row changed underneath (concurrent re-login)", async () => {
    const conflict = Object.assign(new Error("changed"), { code: "PROVIDER_CONNECTION_REVISION_CONFLICT" });
    dbMocks.updateProviderConnection.mockRejectedValueOnce(conflict);

    const result = await markAccountUnavailable(
      "orca-a", 401, "Invalid API key", "orcarouter", "openai/gpt-5.5", null,
      { usedCredential: "sk-orca-current" },
    );
    expect(result).toEqual({ shouldFallback: true, cooldownMs: 0 });
    expect(dbMocks.updateProviderConnection).toHaveBeenCalledTimes(1);
  });

  it("does not quarantine a key a newer login already replaced", async () => {
    await markAccountUnavailable(
      "orca-a", 401, "Invalid API key", "orcarouter", "openai/gpt-5.5", null,
      { usedCredential: "sk-orca-previous" },
    );
    // Nothing at all is written onto the replacement key: no status, no lock.
    expect(dbMocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("keeps a quota or permission 403 on the normal cooldown path", async () => {
    await markAccountUnavailable(
      "orca-a", 403, "Monthly quota exceeded", "orcarouter", "openai/gpt-5.5", null,
      { usedCredential: "sk-orca-current" },
    );
    for (const [, patch] of dbMocks.updateProviderConnection.mock.calls) {
      expect(patch.testStatus).not.toBe("reauth_required");
      expect(patch.needsReauth).toBeUndefined();
    }
  });

  // OpenAI-style bodies as OrcaRouter returns them.
  const MODEL_PERMISSION_403 = [
    JSON.stringify({ error: { message: "Unauthorized model: openai/o3-pro is not enabled for this organization", type: "permission_error", code: "model_not_allowed" } }),
    JSON.stringify({ error: { message: "This API key cannot use openai/o3-pro: model disabled by your organization admin", type: "permission_error", code: "model_not_allowed" } }),
  ];
  const REVOKED_KEY_403 = [
    JSON.stringify({ error: { message: "API key has been revoked", type: "authentication_error", code: "invalid_api_key" } }),
    JSON.stringify({ error: { message: "Incorrect API key provided: sk-orca-****1234", type: "invalid_request_error", code: "invalid_api_key" } }),
  ];

  it.each(MODEL_PERMISSION_403)("keeps a model-permission 403 key in rotation: %s", async (body) => {
    await markAccountUnavailable(
      "orca-a", 403, body, "orcarouter", "openai/o3-pro", null,
      { usedCredential: "sk-orca-current" },
    );
    for (const [, patch] of dbMocks.updateProviderConnection.mock.calls) {
      expect(patch.testStatus).not.toBe("reauth_required");
      expect(patch.isActive).not.toBe(false);
      expect(patch.needsReauth).toBeUndefined();
    }
  });

  it.each(REVOKED_KEY_403)("quarantines a revoked-key 403: %s", async (body) => {
    await markAccountUnavailable(
      "orca-a", 403, body, "orcarouter", "openai/gpt-5.5", null,
      { usedCredential: "sk-orca-current" },
    );
    expect(dbMocks.updateProviderConnection).toHaveBeenCalledTimes(1);
    expect(dbMocks.updateProviderConnection.mock.calls[0][1]).toMatchObject({
      testStatus: "reauth_required",
      isActive: false,
      needsReauth: true,
    });
  });
});
