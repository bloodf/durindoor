/**
 * An authorization-code exchange that yields no credential must not be saved as
 * an active connection, nor overwrite the row being reconnected.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeTokens: vi.fn(),
  createProviderConnection: vi.fn(),
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/oauth/providers.js", () => ({ exchangeTokens: mocks.exchangeTokens }));
vi.mock("@/lib/localDb", () => ({
  createProviderConnection: mocks.createProviderConnection,
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));
vi.mock("@/lib/oauth/proxySelection.js", () => ({
  buildOAuthProxyMetadataPatch: () => ({}),
  resolveOAuthProxySelection: vi.fn(async () => ({})),
}));

const { exchangeAndSaveAuthorizationCode } = await import("../../src/lib/oauth/flowCompletion.js");

describe("upstream #3350: tokenless authorization-code exchange", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["new sign-in", {}],
    ["reconnect", { connectionId: "conn-9" }],
  ])("saves nothing on a %s", async (_name, payload) => {
    mocks.exchangeTokens.mockResolvedValue({ accessToken: undefined, refreshToken: null });

    await expect(exchangeAndSaveAuthorizationCode("claude", "code", "state", { payload }))
      .rejects.toMatchObject({ code: "OAUTH_UPSTREAM_FAILURE", message: "Token exchange returned no access token" });

    expect(mocks.createProviderConnection).not.toHaveBeenCalled();
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it.each([
    ["an access token", { accessToken: "access" }],
    ["only an API key (OrcaRouter)", { apiKey: "key" }],
  ])("saves an exchange that yields %s", async (_name, tokens) => {
    mocks.exchangeTokens.mockResolvedValue(tokens);
    mocks.createProviderConnection.mockResolvedValue({ id: "new-1" });

    const { connection } = await exchangeAndSaveAuthorizationCode("orcarouter", "code", "state", null);

    expect(connection).toEqual({ id: "new-1" });
    expect(mocks.createProviderConnection).toHaveBeenCalledTimes(1);
  });
});
