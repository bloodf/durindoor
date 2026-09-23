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
describe("amazon-q device-code route", () => {
  beforeEach(() => {
    clearOAuthFlowsForTests();
    vi.clearAllMocks();
    mocks.ensureOutboundProxyInitialized.mockResolvedValue();
    mocks.getProvider.mockReturnValue({ flowType: "device_code" });
    mocks.generateAuthData.mockResolvedValue({ codeVerifier: "v", codeChallenge: "c", flowType: "device_code" });
    mocks.createProviderConnection.mockImplementation(async (data) => ({ id: "connection-1", ...data }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("forwards the IAM Identity Center options and polls with the stored client", async () => {
    mocks.requestDeviceCode.mockResolvedValue({
      device_code: "aws-device-code",
      user_code: "WXYZ-1234",
      verification_uri: "https://device.sso.us-east-1.amazonaws.com",
      expires_in: 600,
      _clientId: "client-id",
      _clientSecret: "client-secret",
    });
    mocks.pollForToken.mockResolvedValue({ success: true, tokens: { accessToken: "aws", providerSpecificData: {} } });

    const started = await post("amazon-q", "device-code", {
      proxyMode: "direct",
      startUrl: "https://acme.awsapps.com/start",
      region: "eu-west-1",
      authMethod: "idc",
    });
    expect(started.status).toBe(200);
    expect(mocks.requestDeviceCode.mock.calls[0][0]).toBe("amazon-q");
    expect(mocks.requestDeviceCode.mock.calls[0][1]).toBeUndefined();
    expect(mocks.requestDeviceCode.mock.calls[0][2]).toEqual({
      startUrl: "https://acme.awsapps.com/start",
      region: "eu-west-1",
      authMethod: "idc",
    });
    expect(JSON.stringify(started.body)).not.toContain("client-secret");

    await post("amazon-q", "poll", { flowId: started.body.flowId });
    expect(mocks.pollForToken).toHaveBeenCalledWith(
      "amazon-q",
      "aws-device-code",
      null,
      { _clientId: "client-id", _clientSecret: "client-secret" },
      expect.anything(),
    );
  });
});
