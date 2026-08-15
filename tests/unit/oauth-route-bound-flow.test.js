import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProviderConnection: vi.fn(),
  ensureOutboundProxyInitialized: vi.fn(),
  exchangeTokens: vi.fn(),
  generateAuthData: vi.fn(),
  getProvider: vi.fn(),
  pollForToken: vi.fn(),
  requestDeviceCode: vi.fn(),
  getProxyPoolById: vi.fn(),
  clearCodexSession: vi.fn(),
  clearXaiSession: vi.fn(),
  getCodexSessionStatus: vi.fn(),
  getXaiSessionStatus: vi.fn(),
  startCodexProxy: vi.fn(),
  stopCodexProxy: vi.fn(),
  stopXaiProxy: vi.fn(),
  registerCodexSession: vi.fn(),
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({}));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    }),
  },
}));
vi.mock("@/lib/network/initOutboundProxy", () => ({
  ensureOutboundProxyInitialized: mocks.ensureOutboundProxyInitialized,
}));
vi.mock("@/models", () => ({
  createProviderConnection: mocks.createProviderConnection,
  getProxyPoolById: mocks.getProxyPoolById,
}));
vi.mock("@/lib/oauth/providers.js", () => ({
  exchangeTokens: mocks.exchangeTokens,
  extractCodexAccountInfo: () => ({}),
  generateAuthData: mocks.generateAuthData,
  getProvider: mocks.getProvider,
  pollForToken: mocks.pollForToken,
  requestDeviceCode: mocks.requestDeviceCode,
}));
vi.mock("@/lib/oauth/utils/server", () => ({
  clearCodexSession: mocks.clearCodexSession,
  clearXaiSession: mocks.clearXaiSession,
  getCodexSessionStatus: mocks.getCodexSessionStatus,
  getXaiSessionStatus: mocks.getXaiSessionStatus,
  registerCodexSession: mocks.registerCodexSession,
  registerXaiSession: vi.fn(),
  startCodexProxy: mocks.startCodexProxy,
  startXaiProxy: vi.fn(),
  stopCodexProxy: mocks.stopCodexProxy,
  stopXaiProxy: mocks.stopXaiProxy,
}));

import {
  claimOAuthFlow,
  clearOAuthFlowsForTests,
  getOAuthFlow,
} from "@/lib/oauth/flowStore.js";

function request(body) {
  return { json: async () => body };
}

async function post(provider, action, body) {
  const { POST } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
  return POST(request(body), { params: Promise.resolve({ provider, action }) });
}

async function get(provider, action, query = "") {
  const { GET } = await import("../../src/app/api/oauth/[provider]/[action]/route.js");
  return GET(new Request(`http://localhost/api/oauth/${provider}/${action}${query}`), {
    params: Promise.resolve({ provider, action }),
  });
}

describe("server-bound OAuth route", () => {
  beforeEach(() => {
    clearOAuthFlowsForTests();
    vi.clearAllMocks();
    mocks.ensureOutboundProxyInitialized.mockResolvedValue();
    mocks.stopCodexProxy.mockResolvedValue();
    mocks.stopXaiProxy.mockResolvedValue();
    mocks.startCodexProxy.mockResolvedValue({ success: true });
    mocks.registerCodexSession.mockReturnValue(true);
    mocks.getProvider.mockReturnValue({ flowType: "authorization_code_pkce" });
    mocks.createProviderConnection.mockImplementation(async (data, options = {}) => {
      if (options.shouldCommit && !options.shouldCommit()) {
        throw new Error("OAuth flow was cancelled or superseded before commit");
      }
      return { id: "connection-1", ...data };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("binds verifier, redirect, metadata, and direct routing to one state", async () => {
    mocks.generateAuthData.mockResolvedValue({
      authUrl: "https://provider.test/authorize",
      state: "bound-state",
      codeVerifier: "server-verifier",
      codeChallenge: "challenge",
      flowType: "authorization_code_pkce",
    });
    mocks.exchangeTokens.mockResolvedValue({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
      providerSpecificData: { accountId: "account-1" },
    });

    const authorize = await post("codex", "authorize", {
      redirectUri: "http://localhost:1455/auth/callback",
      meta: { tenant: "server-tenant" },
      proxyMode: "direct",
    });
    expect(authorize.status).toBe(200);
    expect(authorize.body).not.toHaveProperty("codeVerifier");
    expect(authorize.body).not.toHaveProperty("codeChallenge");

    const exchange = await post("codex", "exchange", {
      code: "oauth-code",
      state: "bound-state",
      flowId: authorize.body.flowId,
      redirectUri: "https://attacker.test/callback",
      codeVerifier: "attacker-verifier",
      meta: { tenant: "attacker" },
      proxyMode: "strict-pool",
      proxyPoolId: "attacker-pool",
    });

    expect(exchange.status).toBe(200);
    expect(mocks.exchangeTokens).toHaveBeenCalledWith(
      "codex",
      "oauth-code",
      "http://localhost:1455/auth/callback",
      "server-verifier",
      "bound-state",
      { tenant: "server-tenant" },
      { disableEnvProxy: true, strictProxy: false },
    );
    expect(mocks.createProviderConnection.mock.calls[0][0]).toEqual(expect.objectContaining({
      providerSpecificData: {
        accountId: "account-1",
        codexFingerprintMode: "session",
        proxyPoolId: null,
        oauthProxy: { mode: "direct", poolId: null },
      },
    }));

    const replay = await post("codex", "exchange", {
      code: "oauth-code",
      state: "bound-state",
      flowId: authorize.body.flowId,
    });
    expect(replay.status).toBe(410);
    expect(mocks.exchangeTokens).toHaveBeenCalledTimes(1);
  });

  it("keeps a JWT import claim active until the asynchronous DB commit finishes", async () => {
    mocks.generateAuthData.mockResolvedValue({
      authUrl: "https://provider.test/authorize",
      state: "jwt-state",
      codeVerifier: "jwt-verifier",
      flowType: "authorization_code_pkce",
    });
    mocks.createProviderConnection.mockImplementationOnce(async (data, options = {}) => {
      await Promise.resolve();
      expect(options.shouldCommit()).toBe(true);
      return { id: "jwt-connection", ...data };
    });
    const payload = Buffer.from(JSON.stringify({
      email: "jwt@example.test",
      account_id: "jwt-account",
    })).toString("base64url");
    const jwt = `eyJ.${payload}.signature`;

    const authorize = await post("codex", "authorize", { proxyMode: "direct" });
    const exchange = await post("codex", "exchange", {
      code: jwt,
      state: "jwt-state",
      flowId: authorize.body.flowId,
    });

    expect(exchange.status).toBe(200);
    expect(mocks.createProviderConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        authType: "access_token",
        accessToken: jwt,
        email: "jwt@example.test",
        providerSpecificData: expect.objectContaining({
          chatgptAccountId: "jwt-account",
          oauthProxy: { mode: "direct", poolId: null },
        }),
      }),
      expect.objectContaining({ shouldCommit: expect.any(Function) }),
    );
    expect((await post("codex", "exchange", {
      code: jwt,
      state: "jwt-state",
      flowId: authorize.body.flowId,
    })).status).toBe(410);
  });

  it("rejects a mismatched callback state without consuming the valid flow", async () => {
    mocks.generateAuthData.mockResolvedValue({
      authUrl: "https://provider.test/authorize",
      state: "expected-state",
      codeVerifier: "verifier",
      flowType: "authorization_code_pkce",
    });
    mocks.exchangeTokens.mockResolvedValue({ accessToken: "access-token" });
    const authorize = await post("claude", "authorize", { proxyMode: "direct" });

    const mismatch = await post("claude", "exchange", {
      code: "oauth-code",
      state: "wrong-state",
      flowId: authorize.body.flowId,
    });
    expect(mismatch.status).toBe(400);
    expect(mocks.exchangeTokens).not.toHaveBeenCalled();

    const valid = await post("claude", "exchange", {
      code: "oauth-code",
      state: "expected-state",
      flowId: authorize.body.flowId,
    });
    expect(valid.status).toBe(200);
    expect(mocks.exchangeTokens).toHaveBeenCalledTimes(1);
  });

  it("returns conflict while another device poll owns the flow", async () => {
    mocks.getProvider.mockReturnValue({ flowType: "device_code" });
    mocks.generateAuthData.mockResolvedValue({
      codeVerifier: "device-verifier",
      codeChallenge: "device-challenge",
      flowType: "device_code",
    });
    mocks.requestDeviceCode.mockResolvedValue({
      device_code: "server-device-code",
      user_code: "ABCD-EFGH",
      verification_uri: "https://provider.test/device",
      expires_in: 300,
    });
    const started = await post("qoder", "device-code", { proxyMode: "direct" });
    const claim = claimOAuthFlow({ flowId: started.body.flowId, provider: "qoder" });

    expect(claim).not.toBeNull();
    const conflict = await post("qoder", "poll", { flowId: started.body.flowId });
    expect(conflict.status).toBe(409);
    expect(mocks.pollForToken).not.toHaveBeenCalled();
  });

  it("returns a redacted bad-gateway response for upstream exchange failures", async () => {
    mocks.generateAuthData.mockResolvedValue({
      authUrl: "https://provider.test/authorize",
      state: "upstream-state",
      codeVerifier: "upstream-verifier",
      flowType: "authorization_code_pkce",
    });
    mocks.exchangeTokens.mockRejectedValue(
      new Error('Token exchange failed: {"refresh_token":"secret-refresh"}'),
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const authorize = await post("claude", "authorize", { proxyMode: "direct" });

    const failed = await post("claude", "exchange", {
      code: "oauth-code",
      state: "upstream-state",
      flowId: authorize.body.flowId,
    });

    expect(failed.status).toBe(502);
    expect(JSON.stringify(failed.body)).toContain("[redacted]");
    expect(JSON.stringify(failed.body)).not.toContain("secret-refresh");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("secret-refresh");
    errorLog.mockRestore();
  });

  it("does not persist a late exchange after a newer login supersedes it", async () => {
    mocks.generateAuthData
      .mockResolvedValueOnce({
        authUrl: "https://provider.test/authorize",
        state: "old-state",
        codeVerifier: "old-verifier",
        flowType: "authorization_code_pkce",
      })
      .mockResolvedValueOnce({
        authUrl: "https://provider.test/authorize",
        state: "new-state",
        codeVerifier: "new-verifier",
        flowType: "authorization_code_pkce",
      });
    let finishExchange;
    mocks.exchangeTokens.mockImplementationOnce(() => new Promise((resolve) => {
      finishExchange = resolve;
    }));

    const oldFlow = await post("claude", "authorize", { proxyMode: "direct", ownerId: "modal-owner" });
    const oldCompletion = post("claude", "exchange", {
      code: "old-code",
      state: "old-state",
      flowId: oldFlow.body.flowId,
    });
    await vi.waitFor(() => expect(mocks.exchangeTokens).toHaveBeenCalledOnce());

    const newFlow = await post("claude", "authorize", { proxyMode: "direct", ownerId: "modal-owner" });
    expect(newFlow.body.state).toBe("new-state");
    finishExchange({ accessToken: "late-access-token" });

    const oldResult = await oldCompletion;
    expect(oldResult.status).toBe(410);
    expect(oldResult.body.error).toMatch(/cancelled or superseded/i);
    expect(mocks.createProviderConnection).toHaveBeenCalledOnce();
    expect(mocks.createProviderConnection.mock.calls[0][1].shouldCommit()).toBe(false);
  });

  it("rejects secret metadata on legacy GET authorization URLs", async () => {
    const response = await get(
      "gitlab",
      "authorize",
      "?redirect_uri=http%3A%2F%2Flocalhost%2Fcallback&clientId=id&clientSecret=secret-value",
    );

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/POST body/i);
    expect(JSON.stringify(response.body)).not.toContain("secret-value");
    expect(mocks.generateAuthData).not.toHaveBeenCalled();
  });

  it("keeps device codes, PKCE, and provider secrets server-side across polls", async () => {
    mocks.getProvider.mockReturnValue({ flowType: "device_code" });
    mocks.generateAuthData.mockResolvedValue({
      codeVerifier: "generic-verifier",
      codeChallenge: "generic-challenge",
      flowType: "device_code",
    });
    mocks.requestDeviceCode.mockResolvedValue({
      device_code: "server-device-code",
      user_code: "ABCD-EFGH",
      verification_uri: "https://provider.test/device",
      expires_in: 300,
      interval: 1,
      codeVerifier: "provider-verifier",
      _qoderMachineId: "server-machine-id",
      _qoderNonce: "server-nonce",
    });
    mocks.pollForToken
      .mockResolvedValueOnce({ success: false, pending: true, error: "authorization_pending" })
      .mockResolvedValueOnce({
        success: true,
        tokens: {
          accessToken: "device-access",
          providerSpecificData: { machineId: "saved-machine" },
        },
      });

    const started = await post("qoder", "device-code", { proxyMode: "direct" });
    expect(JSON.stringify(started.body)).not.toContain("server-device-code");
    expect(JSON.stringify(started.body)).not.toContain("provider-verifier");
    expect(JSON.stringify(started.body)).not.toContain("server-machine-id");
    expect(started.body.user_code).toBe("ABCD-EFGH");

    const attackerFields = {
      flowId: started.body.flowId,
      deviceCode: "attacker-device",
      codeVerifier: "attacker-verifier",
      extraData: { _qoderMachineId: "attacker-machine" },
      proxyPoolId: "attacker-pool",
    };
    const pending = await post("qoder", "poll", attackerFields);
    expect(pending.body.pending).toBe(true);
    const complete = await post("qoder", "poll", attackerFields);
    expect(complete.body.success).toBe(true);

    expect(mocks.pollForToken).toHaveBeenNthCalledWith(
      1,
      "qoder",
      "server-device-code",
      "provider-verifier",
      {
        _qoderMachineId: "server-machine-id",
        _qoderNonce: "server-nonce",
      },
      { disableEnvProxy: true, strictProxy: false },
    );
    expect(mocks.pollForToken).toHaveBeenCalledTimes(2);
  });

  it("registers fixed-port callbacks by opaque flow instead of client PKCE", async () => {
    mocks.generateAuthData.mockResolvedValue({
      authUrl: "https://provider.test/authorize",
      state: "fixed-state",
      codeVerifier: "fixed-verifier",
      flowType: "authorization_code_pkce",
    });
    const authorize = await post("codex", "authorize", {
      redirectUri: "http://localhost:1455/auth/callback",
      proxyMode: "direct",
    });

    const started = await post("codex", "start-proxy", {
      appPort: 20127,
      flowId: authorize.body.flowId,
      codeVerifier: "attacker-verifier",
      proxyPoolId: "attacker-pool",
    });

    expect(started.status).toBe(200);
    expect(mocks.stopCodexProxy).toHaveBeenCalledBefore(mocks.startCodexProxy);
    expect(mocks.registerCodexSession).toHaveBeenCalledWith({
      state: "fixed-state",
      flowId: authorize.body.flowId,
    });
  });

  it("does not let an old xAI manual exchange stop a successor session", async () => {
    mocks.generateAuthData.mockResolvedValue({
      authUrl: "https://provider.test/authorize",
      state: "xai-manual-state",
      codeVerifier: "xai-verifier",
      flowType: "authorization_code_pkce",
    });
    let finishExchange;
    mocks.exchangeTokens.mockImplementationOnce(() => new Promise((resolve) => {
      finishExchange = resolve;
    }));

    const authorize = await post("xai", "authorize", { proxyMode: "direct" });
    mocks.getXaiSessionStatus.mockReturnValue({ flowId: authorize.body.flowId });
    const completion = post("xai", "manual-code", {
      code: "manual-code",
      state: "xai-manual-state",
      flowId: authorize.body.flowId,
    });
    await vi.waitFor(() => expect(mocks.exchangeTokens).toHaveBeenCalledOnce());

    mocks.getXaiSessionStatus.mockReturnValue({ flowId: "successor-flow" });
    finishExchange({ accessToken: "xai-access-token" });

    expect((await completion).status).toBe(200);
    expect(mocks.clearXaiSession).not.toHaveBeenCalled();
    expect(mocks.stopXaiProxy).not.toHaveBeenCalled();
  });

  it("does not stop a fixed-port listener owned by another flow", async () => {
    mocks.generateAuthData.mockResolvedValue({
      authUrl: "https://provider.test/authorize",
      state: "old-fixed-state",
      codeVerifier: "old-fixed-verifier",
      flowType: "authorization_code_pkce",
    });
    const authorize = await post("codex", "authorize", { proxyMode: "direct" });
    mocks.getCodexSessionStatus.mockReturnValue({ flowId: "successor-flow" });

    const stopped = await post("codex", "stop-proxy", {
      state: "old-fixed-state",
      flowId: authorize.body.flowId,
    });

    expect(stopped.status).toBe(200);
    expect(stopped.body).toEqual({ success: true, stopped: false });
    expect(mocks.stopCodexProxy).not.toHaveBeenCalled();
    expect(getOAuthFlow({ flowId: authorize.body.flowId, provider: "codex" })).not.toBeNull();
  });
});
