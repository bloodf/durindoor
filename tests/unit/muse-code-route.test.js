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
describe("muse-code device-code route", () => {
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

  it("starts without PKCE and polls without a verifier", async () => {
    mocks.requestDeviceCode.mockResolvedValue({
      device_code: "meta-device-code",
      user_code: "ABCD",
      verification_uri: "https://auth.meta.com/device",
      expires_in: 600,
      interval: 5,
    });
    mocks.pollForToken.mockResolvedValue({ success: false, pending: true, error: "authorization_pending" });

    const started = await post("muse-code", "device-code", { proxyMode: "direct" });
    expect(started.status).toBe(200);
    expect(mocks.requestDeviceCode.mock.calls[0][1]).toBeUndefined();
    expect(JSON.stringify(started.body)).not.toContain("meta-device-code");

    const pending = await post("muse-code", "poll", { flowId: started.body.flowId });
    expect(pending.body).toMatchObject({ success: false, pending: true });
    expect(mocks.pollForToken).toHaveBeenCalledWith("muse-code", "meta-device-code", null, null, expect.anything());
  });
});
