import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ update: vi.fn(async () => true), refresh: vi.fn(), copilot: vi.fn() }));
vi.mock("../../src/lib/localDb.js", async (original) => ({ ...(await original()), updateProviderConnection: mocks.update }));
vi.mock("../../open-sse/services/oauthCredentialManager.js", async (original) => ({
  ...(await original()), refreshProviderCredentials: mocks.refresh, shouldRefreshCredentials: () => true,
}));
vi.mock("../../open-sse/services/tokenRefresh.js", async (original) => ({
  ...(await original()), refreshCopilotToken: mocks.copilot,
}));
import { checkAndRefreshToken } from "../../src/sse/services/tokenRefresh.js";

it("persists saved proxy settings rather than resolved runtime proxy fields on refresh", async () => {
  mocks.refresh.mockResolvedValue({ accessToken: "new", providerSpecificData: { account: "refreshed" } });
  await checkAndRefreshToken("codex", {
    connectionId: "connection", accessToken: "old", refreshToken: "refresh", projectId: "project",
    _connection: { providerSpecificData: { proxyPoolId: "pool", account: "old" } },
    providerSpecificData: { proxyPoolId: "pool", account: "old", connectionProxyPoolId: "pool", connectionProxyUrl: "http://runtime", strictProxy: true },
  }, null, { force: true });
  expect(mocks.update).toHaveBeenCalledWith("connection", expect.objectContaining({
    providerSpecificData: { proxyPoolId: "pool", account: "refreshed" },
  }), { returnCommitResult: true, shouldCommitConnection: expect.any(Function) });
  // The write is guarded by the presented token: a newer stored rotation is kept.
  const { shouldCommitConnection } = mocks.update.mock.calls[0][2];
  expect(shouldCommitConnection({ refreshToken: "refresh" })).toBe(true);
  expect(shouldCommitConnection({ refreshToken: "rotated-elsewhere" })).toBe(false);
});

it("keeps saved proxy settings when a Copilot token rotates", async () => {
  mocks.update.mockClear();
  mocks.refresh.mockResolvedValue(null);
  mocks.copilot.mockResolvedValue({ token: "copilot-new", expiresAt: 2_000_000_000 });
  const credentials = {
    connectionId: "github-connection", accessToken: "github-token",
    _connection: { providerSpecificData: { proxyPoolId: "pool" } },
    providerSpecificData: { proxyPoolId: "pool", connectionProxyUrl: "http://runtime", strictProxy: true },
  };
  const refreshed = await checkAndRefreshToken("github", credentials);
  expect(mocks.update).toHaveBeenCalledWith("github-connection", {
    providerSpecificData: { proxyPoolId: "pool", copilotToken: "copilot-new", copilotTokenExpiresAt: 2_000_000_000 },
  });
  expect(refreshed.providerSpecificData.connectionProxyUrl).toBe("http://runtime");
});
