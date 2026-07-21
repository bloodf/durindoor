/**
 * saveOAuthConnection reconnect-replacement path.
 *
 * A durable reauth_required row must be revived IN PLACE via the "Reconnect"
 * flow, not duplicated. When `extra.connectionId` is supplied, saveOAuthConnection
 * validates the target (exists, same provider, authType oauth) and calls
 * updateProviderConnection with fresh tokens + cleared reauth state; otherwise it
 * creates a new row.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProviderConnection: vi.fn(),
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/models", () => ({
  createProviderConnection: mocks.createProviderConnection,
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));
// Keep proxy-metadata merge a pure passthrough so the test asserts routing only.
vi.mock("@/lib/oauth/proxySelection.js", () => ({
  buildOAuthProxyMetadataPatch: () => ({}),
  resolveOAuthProxySelection: vi.fn(),
}));

const { saveOAuthConnection } = await import("../../src/lib/oauth/flowCompletion.js");

const TOKENS = { accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 3600 };

describe("saveOAuthConnection reconnect replacement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a new connection when no connectionId is provided", async () => {
    mocks.createProviderConnection.mockResolvedValue({ id: "new-1" });

    const result = await saveOAuthConnection("codex", TOKENS, {}, {});

    expect(mocks.createProviderConnection).toHaveBeenCalledTimes(1);
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
    expect(result).toEqual({ id: "new-1" });
  });

  it("replaces the target row in place and clears the reauth state", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-9",
      provider: "codex",
      authType: "oauth",
      testStatus: "reauth_required",
      errorCode: "REAUTH",
    });
    mocks.updateProviderConnection.mockResolvedValue({ applied: true, connection: { id: "conn-9" } });

    const result = await saveOAuthConnection("codex", TOKENS, {}, { connectionId: "conn-9" });

    expect(mocks.createProviderConnection).not.toHaveBeenCalled();
    expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(1);
    const [id, patch] = mocks.updateProviderConnection.mock.calls[0];
    expect(id).toBe("conn-9");
    expect(patch).toMatchObject({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      testStatus: "active",
      lastError: null,
      errorCode: null,
      lastErrorAt: null,
    });
    expect(result).toEqual({ id: "conn-9" });
  });

  it("refuses a missing reconnect target", async () => {
    mocks.getProviderConnectionById.mockResolvedValue(null);

    await expect(
      saveOAuthConnection("codex", TOKENS, {}, { connectionId: "gone" }),
    ).rejects.toMatchObject({ code: "OAUTH_RECONNECT_TARGET_MISSING" });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
    expect(mocks.createProviderConnection).not.toHaveBeenCalled();
  });

  it("refuses a reconnect target of a different provider", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-x",
      provider: "claude",
      authType: "oauth",
    });

    await expect(
      saveOAuthConnection("codex", TOKENS, {}, { connectionId: "conn-x" }),
    ).rejects.toMatchObject({ code: "OAUTH_RECONNECT_TARGET_MISMATCH" });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("refuses a reconnect target that is not an OAuth row", async () => {
    mocks.getProviderConnectionById.mockResolvedValue({
      id: "conn-api",
      provider: "codex",
      authType: "api_key",
    });

    await expect(
      saveOAuthConnection("codex", TOKENS, {}, { connectionId: "conn-api" }),
    ).rejects.toMatchObject({ code: "OAUTH_RECONNECT_TARGET_MISMATCH" });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });
});
