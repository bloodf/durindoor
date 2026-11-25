/**
 * Codex sign-in and request compatibility (#2034).
 *
 * Pins the Codex OAuth contract against the upstream sources resolved for this
 * work order:
 *
 * - router-for-me/CLIProxyAPI `main` @ 6faa8d20b2673404cff70a2f2d9537ae0d0e684d
 *   - `sdk/auth/codex_device.go` — the Codex device flow (headless sign-in).
 *   - `internal/auth/codex/openai_auth.go` — browser PKCE exchange + refresh.
 *   - `cmd/fetch_codex_models/main.go` — the authenticated model catalog request.
 * - router-for-me/EasyCLIProxyAPI `main` @ e4223d5eefa22a3301ca7e2a28d05897432b07f9
 * - cheaper-inference/OmniRoute `release/v3.8.55`
 *   @ e3c1531afd07d5e06f7ffab658584a7ae2e3627e
 *
 * Every outbound call in this file is served by a closed mock: no provider API,
 * no paid API, no browser and no real credential is contacted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createProviderConnection: vi.fn(),
  ensureOutboundProxyInitialized: vi.fn(),
  fetch: vi.fn(),
  proxyAwareFetch: vi.fn(),
}));

vi.mock("open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
  default: vi.fn(),
}));
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
vi.mock("@/lib/localDb", () => ({
  createProviderConnection: mocks.createProviderConnection,
  getProviderConnectionById: vi.fn(),
  getProxyPoolById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/oauth/utils/server", () => ({
  clearCodexSession: vi.fn(),
  clearXaiSession: vi.fn(),
  getCodexSessionStatus: vi.fn(),
  getXaiSessionStatus: vi.fn(),
  registerCodexSession: vi.fn(),
  registerXaiSession: vi.fn(),
  startCodexProxy: vi.fn(),
  startXaiProxy: vi.fn(),
  stopCodexProxy: vi.fn(),
  stopXaiProxy: vi.fn(),
}));

import { CODEX_CONFIG } from "../../src/lib/oauth/constants/oauth.js";
import {
  clearOAuthFlowsForTests
} from "../../src/lib/oauth/flowStore.js";
import { getProvider } from "../../src/lib/oauth/providers.js";

const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_DEVICE_USER_CODE_URL =
  "https://auth.openai.com/api/accounts/deviceauth/usercode";
const CODEX_DEVICE_TOKEN_URL =
  "https://auth.openai.com/api/accounts/deviceauth/token";
const CODEX_DEVICE_VERIFICATION_URL = "https://auth.openai.com/codex/device";
const CODEX_DEVICE_REDIRECT_URI = "https://auth.openai.com/deviceauth/callback";

function makeJwt(payload) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}

const CODEX_ID_TOKEN = makeJwt({
  email: "operator@example.com",
  "https://api.openai.com/auth": {
    chatgpt_account_id: "acct-codex-1",
    chatgpt_plan_type: "plus",
  },
});

const originalFetch = global.fetch;

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

/** Route the closed outbound mock by upstream URL. */
function mockUpstream(handlers) {
  mocks.fetch.mockImplementation(async (url) => {
    const handler = handlers[String(url)];
    if (!handler) throw new Error(`Unexpected outbound request: ${url}`);
    return typeof handler === "function" ? handler() : handler;
  });
}

async function postRoute(provider, action, body) {
  const { POST } = await import(
    "../../src/app/api/oauth/[provider]/[action]/route.js"
  );
  return POST(
    { json: async () => body },
    { params: Promise.resolve({ provider, action }) }
  );
}

describe("Codex sign-in parity (#2034)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearOAuthFlowsForTests();
    global.fetch = mocks.fetch;
    mocks.ensureOutboundProxyInitialized.mockResolvedValue();
    mocks.createProviderConnection.mockImplementation(async (data) => ({
      id: "connection-codex-1",
      ...data,
    }));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("registry OAuth contract", () => {
    it("exposes the upstream device-flow endpoints next to the browser PKCE ones", () => {
      expect(CODEX_CONFIG.clientId).toBe(CODEX_CLIENT_ID);
      expect(CODEX_CONFIG.authorizeUrl).toBe("https://auth.openai.com/oauth/authorize");
      expect(CODEX_CONFIG.codeChallengeMethod).toBe("S256");
      expect(CODEX_CONFIG.fixedPort).toBe(1455);
      expect(CODEX_CONFIG.callbackPath).toBe("/auth/callback");
      expect(CODEX_CONFIG.deviceCodeUrl).toBe(CODEX_DEVICE_USER_CODE_URL);
      expect(CODEX_CONFIG.deviceTokenUrl).toBe(CODEX_DEVICE_TOKEN_URL);
      expect(CODEX_CONFIG.deviceVerificationUrl).toBe(CODEX_DEVICE_VERIFICATION_URL);
      expect(CODEX_CONFIG.deviceRedirectUri).toBe(CODEX_DEVICE_REDIRECT_URI);
    });

    it("keeps browser PKCE as the primary flow and the device flow alongside it", () => {
      const provider = getProvider("codex");
      expect(provider.flowType).toBe("authorization_code_pkce");
      expect(typeof provider.deviceFlow?.requestDeviceCode).toBe("function");
      expect(typeof provider.deviceFlow?.pollToken).toBe("function");
    });
  });

  describe("browser PKCE sign-in", () => {
    it("builds the upstream authorization URL with the PKCE challenge", async () => {
      const { generateAuthData } = await import("../../src/lib/oauth/providers.js");
      const authData = await generateAuthData("codex", "http://localhost:1455/auth/callback", null, null);
      const url = new URL(authData.authUrl);

      expect(url.origin + url.pathname).toBe("https://auth.openai.com/oauth/authorize");
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("client_id")).toBe(CODEX_CLIENT_ID);
      expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:1455/auth/callback");
      expect(url.searchParams.get("code_challenge")).toBe(authData.codeChallenge);
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("state")).toBe(authData.state);
      expect(url.searchParams.get("scope")).toBe("openid profile email offline_access");
      expect(url.searchParams.get("id_token_add_organizations")).toBe("true");
      expect(url.searchParams.get("codex_cli_simplified_flow")).toBe("true");
    });

    it("exchanges the authorization code with the upstream form contract", async () => {
      mockUpstream({
        [CODEX_CONFIG.tokenUrl]: jsonResponse({
          access_token: "codex-access",
          refresh_token: "codex-refresh",
          id_token: CODEX_ID_TOKEN,
          expires_in: 3600,
        }),
      });

      const { exchangeTokens } = await import("../../src/lib/oauth/providers.js");
      const mapped = await exchangeTokens(
        "codex",
        "auth-code",
        "http://localhost:1455/auth/callback",
        "verifier",
        "state",
        null,
        null
      );

      const [url, init] = mocks.fetch.mock.calls[0];
      expect(url).toBe(CODEX_CONFIG.tokenUrl);
      expect(init.method).toBe("POST");
      const body = new URLSearchParams(init.body);
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("client_id")).toBe(CODEX_CLIENT_ID);
      expect(body.get("code")).toBe("auth-code");
      expect(body.get("redirect_uri")).toBe("http://localhost:1455/auth/callback");
      expect(body.get("code_verifier")).toBe("verifier");

      expect(mapped.accessToken).toBe("codex-access");
      expect(mapped.refreshToken).toBe("codex-refresh");
      expect(mapped.idToken).toBe(CODEX_ID_TOKEN);
      expect(mapped.email).toBe("operator@example.com");
      expect(mapped.providerSpecificData.chatgptAccountId).toBe("acct-codex-1");
      expect(mapped.providerSpecificData.chatgptPlanType).toBe("plus");
    });
  });

  describe("device-code sign-in (headless)", () => {
    it("asks auth.openai.com for a user code and keeps the device handle server-side", async () => {
      mockUpstream({
        [CODEX_DEVICE_USER_CODE_URL]: jsonResponse({
          device_auth_id: "device-auth-id-1",
          user_code: "WXYZ-1234",
          interval: 5,
        }),
      });

      const { requestDeviceCode } = await import("../../src/lib/oauth/providers.js");
      const deviceData = await requestDeviceCode("codex", undefined, {}, null);

      const [url, init] = mocks.fetch.mock.calls[0];
      expect(url).toBe(CODEX_DEVICE_USER_CODE_URL);
      expect(init.method).toBe("POST");
      expect(init.headers["Content-Type"]).toBe("application/json");
      expect(JSON.parse(init.body)).toEqual({ client_id: CODEX_CLIENT_ID });

      expect(deviceData.user_code).toBe("WXYZ-1234");
      expect(deviceData.verification_uri).toBe(CODEX_DEVICE_VERIFICATION_URL);
      expect(deviceData.verification_uri_complete).toContain("WXYZ-1234");
      expect(deviceData.interval).toBe(5);
      expect(deviceData.expires_in).toBeGreaterThan(0);
    });

    it("polls the device token endpoint with the device handle and the user code", async () => {
      mockUpstream({
        [CODEX_DEVICE_TOKEN_URL]: jsonResponse({
          authorization_code: "device-auth-code",
          code_verifier: "server-verifier",
          code_challenge: "server-challenge",
        }),
        [CODEX_CONFIG.tokenUrl]: jsonResponse({
          access_token: "codex-access",
          refresh_token: "codex-refresh",
          id_token: CODEX_ID_TOKEN,
          expires_in: 3600,
        }),
      });

      const { pollForToken } = await import("../../src/lib/oauth/providers.js");
      const result = await pollForToken(
        "codex",
        "device-auth-id-1",
        null,
        { _userCode: "WXYZ-1234" },
        null
      );

      const [pollUrl, pollInit] = mocks.fetch.mock.calls[0];
      expect(pollUrl).toBe(CODEX_DEVICE_TOKEN_URL);
      expect(JSON.parse(pollInit.body)).toEqual({
        device_auth_id: "device-auth-id-1",
        user_code: "WXYZ-1234",
      });

      expect(result.success).toBe(true);
      expect(result.tokens.accessToken).toBe("codex-access");
      expect(result.tokens.refreshToken).toBe("codex-refresh");
      expect(result.tokens.idToken).toBe(CODEX_ID_TOKEN);
      expect(result.tokens.providerSpecificData.chatgptAccountId).toBe("acct-codex-1");
    });

    it("exchanges the device authorization code with the device redirect URI", async () => {
      mockUpstream({
        [CODEX_DEVICE_TOKEN_URL]: jsonResponse({
          authorization_code: "device-auth-code",
          code_verifier: "server-verifier",
          code_challenge: "server-challenge",
        }),
        [CODEX_CONFIG.tokenUrl]: jsonResponse({
          access_token: "codex-access",
          refresh_token: "codex-refresh",
          id_token: CODEX_ID_TOKEN,
          expires_in: 3600,
        }),
      });

      const { pollForToken } = await import("../../src/lib/oauth/providers.js");
      await pollForToken("codex", "device-auth-id-1", null, { _userCode: "WXYZ-1234" }, null);

      const exchangeCall = mocks.fetch.mock.calls.find(
        ([url]) => url === CODEX_CONFIG.tokenUrl
      );
      expect(exchangeCall).toBeTruthy();
      const body = new URLSearchParams(exchangeCall[1].body);
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code")).toBe("device-auth-code");
      expect(body.get("code_verifier")).toBe("server-verifier");
      expect(body.get("redirect_uri")).toBe(CODEX_DEVICE_REDIRECT_URI);
    });

    it("treats a forbidden device poll as pending instead of a failure", async () => {
      mockUpstream({
        [CODEX_DEVICE_TOKEN_URL]: jsonResponse({ error: "not_authorized" }, 403),
      });

      const { pollForToken } = await import("../../src/lib/oauth/providers.js");
      const result = await pollForToken(
        "codex",
        "device-auth-id-1",
        null,
        { _userCode: "WXYZ-1234" },
        null
      );

      expect(result.success).toBe(false);
      expect(result.pending).toBe(true);
      expect(result.error).toBe("authorization_pending");
    });
  });

  describe("device-code route (real handler, closed outbound mock)", () => {
    it("starts a Codex device flow and never returns the device handle", async () => {
      mockUpstream({
        [CODEX_DEVICE_USER_CODE_URL]: jsonResponse({
          device_auth_id: "device-auth-id-1",
          user_code: "WXYZ-1234",
        }),
      });

      const started = await postRoute("codex", "device-code", { proxyMode: "direct" });

      expect(started.status).toBe(200);
      expect(started.body.flowId).toBeTruthy();
      expect(started.body.user_code).toBe("WXYZ-1234");
      expect(started.body.verification_uri).toBe(CODEX_DEVICE_VERIFICATION_URL);
      expect(JSON.stringify(started.body)).not.toContain("device-auth-id-1");
    });

    it("completes the flow into an OAuth connection in the existing model", async () => {
      mockUpstream({
        [CODEX_DEVICE_USER_CODE_URL]: jsonResponse({
          device_auth_id: "device-auth-id-1",
          user_code: "WXYZ-1234",
        }),
        [CODEX_DEVICE_TOKEN_URL]: jsonResponse({
          authorization_code: "device-auth-code",
          code_verifier: "server-verifier",
          code_challenge: "server-challenge",
        }),
        [CODEX_CONFIG.tokenUrl]: jsonResponse({
          access_token: "codex-access",
          refresh_token: "codex-refresh",
          id_token: CODEX_ID_TOKEN,
          expires_in: 3600,
        }),
      });

      const started = await postRoute("codex", "device-code", { proxyMode: "direct" });
      expect(started.status).toBe(200);

      const polled = await postRoute("codex", "poll", { flowId: started.body.flowId });

      expect(polled.status).toBe(200);
      expect(polled.body.success).toBe(true);
      expect(mocks.createProviderConnection).toHaveBeenCalledTimes(1);

      const connection = mocks.createProviderConnection.mock.calls[0][0];
      expect(connection.provider).toBe("codex");
      expect(connection.authType).toBe("oauth");
      expect(connection.accessToken).toBe("codex-access");
      expect(connection.refreshToken).toBe("codex-refresh");
      expect(connection.idToken).toBe(CODEX_ID_TOKEN);
      expect(connection.email).toBe("operator@example.com");
      expect(connection.providerSpecificData.chatgptAccountId).toBe("acct-codex-1");
      expect(connection.providerSpecificData.chatgptPlanType).toBe("plus");
    });
  });

  describe("account-scoped authenticated model discovery", () => {
    it("binds the catalog request to the account decoded from the id token", async () => {
      const { fetchConnectionModels } = await import(
        "../../src/app/api/providers/[id]/models/fetchConnectionModels.js"
      );
      mocks.proxyAwareFetch.mockResolvedValue(
        jsonResponse({ models: [{ slug: "gpt-6.1-sol", display_name: "GPT 6.1 Sol" }] })
      );

      const result = await fetchConnectionModels({
        id: "connection-codex-1",
        provider: "codex",
        accessToken: "codex-access",
        idToken: CODEX_ID_TOKEN,
        providerSpecificData: {},
      });

      expect(result.error).toBeUndefined();
      const [url, init] = mocks.proxyAwareFetch.mock.calls[0];
      expect(String(url)).toContain("https://chatgpt.com/backend-api/codex/models");
      expect(String(url)).toContain("client_version=");
      expect(init.headers.Authorization).toBe("Bearer codex-access");
      expect(init.headers["ChatGPT-Account-ID"]).toBe("acct-codex-1");
      expect(init.headers.originator).toBe("codex_cli_rs");
    });

    it("keeps an imported credential account-scoped", async () => {
      const { fetchConnectionModels } = await import(
        "../../src/app/api/providers/[id]/models/fetchConnectionModels.js"
      );
      mocks.proxyAwareFetch.mockResolvedValue(jsonResponse({ models: [] }));

      // A bulk-imported credential: an access token plus the id token, with no
      // explicit account field in providerSpecificData.
      await fetchConnectionModels({
        id: "connection-codex-imported",
        provider: "codex",
        accessToken: "imported-access",
        idToken: CODEX_ID_TOKEN,
        providerSpecificData: { codexFingerprintMode: "session" },
      });

      const [, init] = mocks.proxyAwareFetch.mock.calls[0];
      expect(init.headers["ChatGPT-Account-ID"]).toBe("acct-codex-1");
    });

    it("still prefers an explicit account id over the id token", async () => {
      const { fetchConnectionModels } = await import(
        "../../src/app/api/providers/[id]/models/fetchConnectionModels.js"
      );
      mocks.proxyAwareFetch.mockResolvedValue(jsonResponse({ models: [] }));

      await fetchConnectionModels({
        id: "connection-codex-explicit",
        provider: "codex",
        accessToken: "codex-access",
        idToken: CODEX_ID_TOKEN,
        providerSpecificData: { chatgptAccountId: "acct-explicit" },
      });

      const [, init] = mocks.proxyAwareFetch.mock.calls[0];
      expect(init.headers["ChatGPT-Account-ID"]).toBe("acct-explicit");
    });
  });
});
