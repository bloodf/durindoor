import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ update: vi.fn(), refresh: vi.fn(), copilot: vi.fn() }));
vi.mock("../../src/lib/localDb.js", async (original) => ({ ...(await original()), updateProviderConnection: mocks.update }));
vi.mock("../../open-sse/services/oauthCredentialManager.js", async (original) => ({
  ...(await original()), refreshProviderCredentials: mocks.refresh, shouldRefreshCredentials: () => false
}));
vi.mock("../../open-sse/services/tokenRefresh.js", async (original) => ({
  ...(await original()), refreshCopilotToken: mocks.copilot
}));
import { checkAndRefreshToken } from "../../src/sse/services/tokenRefresh.js";
import { requestDeviceCode, pollForToken } from "../../src/lib/oauth/providers.js";

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("batch 2 public provider wiring", () => {
  it.each(["builder-id", "idc"])("registers Kiro %s through the existing device provider", async (authMethod) => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ clientId: "client", clientSecret: "secret" }))
      .mockResolvedValueOnce(Response.json({ deviceCode: "device", userCode: "code", expiresIn: 60 }));
    vi.stubGlobal("fetch", fetch);
    const proxy = { proxyUrl: "http://selected.invalid" };
    await requestDeviceCode("kiro", "challenge", { authMethod, region: "eu-west-1", startUrl: "https://organization.awsapps.com/start" }, proxy);
    const payload = JSON.parse(fetch.mock.calls[0][1].body);
    if (authMethod === "idc") expect(payload).not.toHaveProperty("issuerUrl");
    else expect(payload.issuerUrl).toBeTruthy();
    expect(fetch.mock.calls[0][0]).toBe("https://oidc.eu-west-1.amazonaws.com/client/register");
    expect(fetch.mock.calls.every(([, options]) => options.proxyOptions === proxy)).toBe(true);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject({ clientId: "client", clientSecret: "secret", startUrl: "https://organization.awsapps.com/start" });
  });

  it("uses the Qwen helper through the public provider API without exposing upstream text", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("synthetic-secret", { status: 400 }));
    vi.stubGlobal("fetch", fetch);
    await expect(requestDeviceCode("qwen", "challenge")).rejects.toThrow("Qwen device authorization failed");
    expect(await pollForToken("qwen", "device", "verifier")).toMatchObject({ success: false, error: "oauth_upstream_error" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("suppresses non-protocol Copilot poll fields through the public provider API", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "slow_down", error_description: "synthetic-secret" })));
    const result = await pollForToken("github", "device", "verifier");
    expect(result).toMatchObject({ success: false, error: "slow_down" });
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
  });
});

describe("Copilot exchange compare-and-swap", () => {
  it.each(["reconnect", "delete", "rotation", "proxy"])("refuses stale work after %s", async (change) => {
    const original = {
      id: "connection", connectionId: "connection", provider: "github", authType: "oauth",
      accessToken: "oauth-old", refreshToken: "refresh-old", updatedAt: "revision-old",
      providerSpecificData: { proxyPoolId: "pool-old", copilotToken: "expired", copilotTokenExpiresAt: 1 }
    };
    let stored = structuredClone(original);
    mocks.copilot.mockImplementation(async () => {
      if (change === "delete") stored = null;
      if (change === "reconnect") stored = { ...stored, accessToken: "oauth-new", updatedAt: "revision-new" };
      if (change === "rotation") stored = { ...stored, refreshToken: "refresh-new" };
      if (change === "proxy") stored.providerSpecificData = { ...stored.providerSpecificData, proxyPoolId: "pool-new" };
      return { token: "stale-result", expiresAt: 2_000_000_000 };
    });
    mocks.update.mockImplementation(async (_id, patch, options) => {
      const applied = options.shouldCommitConnection(stored);
      if (applied) stored = { ...stored, ...patch };
      return { applied, connection: stored };
    });
    const result = await checkAndRefreshToken("github", original);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.copilot).toHaveBeenCalledTimes(1);
    expect(result.providerSpecificData.copilotToken).toBe("expired");
    expect(stored?.providerSpecificData.copilotToken).not.toBe("stale-result");
    if (change === "delete") expect(stored).toBeNull();
    if (change === "proxy") expect(stored.providerSpecificData.proxyPoolId).toBe("pool-new");
    if (change === "reconnect") expect(stored.accessToken).toBe("oauth-new");
    if (change === "rotation") expect(stored.refreshToken).toBe("refresh-new");
  });
});
