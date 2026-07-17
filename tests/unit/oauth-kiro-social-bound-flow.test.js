import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildSocialLoginUrl: vi.fn(),
  exchangeSocialCode: vi.fn(),
  extractEmailFromJWT: vi.fn(),
  createProviderConnection: vi.fn(),
  ensureOutboundProxyInitialized: vi.fn(),
  getProxyPoolById: vi.fn(),
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
vi.mock("@/lib/oauth/utils/pkce", () => ({
  generatePKCE: () => ({
    state: "social-state",
    codeVerifier: "server-social-verifier",
    codeChallenge: "social-challenge",
  }),
}));
vi.mock("@/lib/oauth/services/kiro", () => ({
  KiroService: class {
    buildSocialLoginUrl(...args) {
      return mocks.buildSocialLoginUrl(...args);
    }

    exchangeSocialCode(...args) {
      return mocks.exchangeSocialCode(...args);
    }

    extractEmailFromJWT(...args) {
      return mocks.extractEmailFromJWT(...args);
    }
  },
}));

import { clearOAuthFlowsForTests } from "@/lib/oauth/flowStore.js";

const request = (body) => ({ json: async () => body });

describe("Kiro social OAuth bound flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearOAuthFlowsForTests();
    mocks.ensureOutboundProxyInitialized.mockResolvedValue();
    mocks.buildSocialLoginUrl.mockReturnValue("https://kiro.test/login");
    mocks.extractEmailFromJWT.mockReturnValue("kiro@example.test");
    mocks.exchangeSocialCode.mockResolvedValue({
      accessToken: "kiro-access",
      refreshToken: "kiro-refresh",
      profileArn: "arn:aws:codewhisperer:us-east-1:1:profile/test",
      expiresIn: 3600,
    });
    mocks.createProviderConnection.mockImplementation(async (data, options = {}) => {
      if (options.shouldCommit && !options.shouldCommit()) {
        throw new Error("OAuth flow was cancelled or superseded before commit");
      }
      return { id: "kiro-1", ...data };
    });
  });

  it("keeps PKCE, provider choice, and routing immutable through exchange", async () => {
    const { POST: authorize } = await import(
      "../../src/app/api/oauth/kiro/social-authorize/route.js"
    );
    const started = await authorize(request({ provider: "github", proxyMode: "direct" }));

    expect(started.status).toBe(200);
    expect(started.body).toEqual(expect.objectContaining({
      authUrl: "https://kiro.test/login",
      state: "social-state",
      provider: "github",
    }));
    expect(started.body).not.toHaveProperty("codeVerifier");
    expect(mocks.buildSocialLoginUrl).toHaveBeenCalledWith(
      "github",
      "social-challenge",
      "social-state",
    );

    const { POST: exchange } = await import(
      "../../src/app/api/oauth/kiro/social-exchange/route.js"
    );
    const completed = await exchange(request({
      code: "social-code",
      state: "social-state",
      flowId: started.body.flowId,
      codeVerifier: "attacker-verifier",
      provider: "google",
      proxyMode: "strict-pool",
      proxyPoolId: "attacker-pool",
    }));

    expect(completed.status).toBe(200);
    expect(mocks.exchangeSocialCode).toHaveBeenCalledWith(
      "social-code",
      "server-social-verifier",
      { disableEnvProxy: true, strictProxy: false },
    );
    expect(mocks.createProviderConnection.mock.calls[0][0]).toEqual(expect.objectContaining({
      provider: "kiro",
      providerSpecificData: expect.objectContaining({
        authMethod: "github",
        provider: "Github",
        proxyPoolId: null,
        oauthProxy: { mode: "direct", poolId: null },
      }),
    }));

    const replay = await exchange(request({
      code: "social-code",
      state: "social-state",
      flowId: started.body.flowId,
    }));
    expect(replay.status).toBe(400);
    expect(mocks.exchangeSocialCode).toHaveBeenCalledTimes(1);
  });
});
