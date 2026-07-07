import { afterEach, describe, expect, it, vi } from "vitest";

function makeJwt(payload) {
  return `eyJhbGciOiJFUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
}

describe("OmniRoute OAuth/session provider slice", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("exposes agy as an Antigravity-backed OAuth provider without alias collision", async () => {
    const { resolveProviderAlias } = await import("../../open-sse/services/model.js");
    const { getExecutor } = await import("../../open-sse/executors/index.js");
    const { getImageAdapter } = await import("../../open-sse/handlers/imageProviders/index.js");
    const { PROVIDERS, PROVIDER_OAUTH } = await import("../../open-sse/providers/index.js");
    const { getProvider } = await import("../../src/lib/oauth/providers.js");
    const { getModelsByProviderId } = await import("../../open-sse/config/providerModels.js");

    expect(resolveProviderAlias("agy")).toBe("agy");
    expect(resolveProviderAlias("gc")).toBe("gemini-cli");
    expect(resolveProviderAlias("gb")).toBe("grok-cli");
    expect(PROVIDERS.agy.format).toBe("antigravity");
    expect(PROVIDERS.agy.clientId).toBe(PROVIDERS.antigravity.clientId);
    expect(PROVIDER_OAUTH.agy.tokenUrl).toBe(PROVIDER_OAUTH.antigravity.tokenUrl);
    expect(getProvider("agy").buildAuthUrl).toBeTypeOf("function");
    expect(getExecutor("agy").getProvider()).toBe("agy");
    expect(getImageAdapter("agy")).toBe(getImageAdapter("antigravity"));
    expect(getModelsByProviderId("gemini-cli").map((m) => m.id)).toContain("gemini-3-flash-preview");
    expect(getModelsByProviderId("grok-cli").map((m) => m.id)).toContain("grok-build");
  });

  it("registers OAuth dashboard health probes before exposing agy and grok-cli", async () => {
    const { OAUTH_TEST_CONFIG } = await import("../../src/app/api/providers/[id]/test/testUtils.js");
    const { PROVIDER_MODELS_CONFIG } = await import("../../src/app/api/providers/[id]/models/route.js");

    expect(OAUTH_TEST_CONFIG.agy).toMatchObject({
      url: "https://www.googleapis.com/oauth2/v1/userinfo?alt=json",
      method: "GET",
      refreshable: true,
    });
    expect(OAUTH_TEST_CONFIG["grok-cli"]).toMatchObject({
      url: "https://cli-chat-proxy.grok.com/v1/chat/completions",
      method: "POST",
      refreshable: true,
      acceptStatuses: [400],
    });
    expect(PROVIDER_MODELS_CONFIG.agy?.customResolver).toBeTypeOf("function");
  });

  it("maps grok-cli auth.json into serializable OAuth credentials", async () => {
    const { mapGrokCliTokens } = await import("../../src/lib/oauth/providers.js");
    const future = new Date(Date.now() + 1800 * 1000).toISOString();
    const jwt = makeJwt({
      sub: "user-1",
      email: "grok@example.com",
      team_id: "team-1",
      tier: 2,
      principal_type: "User",
    });
    const authJson = {
      "https://auth.x.ai::client": {
        key: jwt,
        refresh_token: "refresh-1",
        expires_at: future,
      },
    };

    const mapped = mapGrokCliTokens({ accessToken: authJson });

    expect(mapped.accessToken).toBe(jwt);
    expect(mapped.refreshToken).toBe("refresh-1");
    expect(mapped.email).toBe("grok@example.com");
    expect(mapped.expiresIn).toBeGreaterThan(0);
    expect(mapped.providerSpecificData).toMatchObject({
      userId: "user-1",
      teamId: "team-1",
      tier: 2,
      principalType: "User",
    });
    expect(mapped.providerSpecificData.rawAuthJson).toBeUndefined();
  });

  it("preserves grok-cli refresh tokens from structured import-token bodies", async () => {
    const { mapGrokCliTokens } = await import("../../src/lib/oauth/providers.js");
    const jwt = makeJwt({ sub: "user-2", email: "body@example.com" });

    const mapped = mapGrokCliTokens({ accessToken: jwt, refreshToken: "refresh-body" });

    expect(mapped.accessToken).toBe(jwt);
    expect(mapped.refreshToken).toBe("refresh-body");
    expect(mapped.email).toBe("body@example.com");
    expect(mapped.providerSpecificData).toMatchObject({ userId: "user-2" });
  });

  it("clamps expired grok-cli tokens so refresh can run instead of storing a past expiresAt", async () => {
    const { mapGrokCliTokens } = await import("../../src/lib/oauth/providers.js");
    const jwt = makeJwt({ email: "old@example.com", exp: Math.floor(Date.now() / 1000) - 3600 });

    expect(mapGrokCliTokens(jwt).expiresIn).toBe(1);
  });

  it("refreshes grok-cli credentials through xAI token rotation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 900,
      }),
    }));

    const { refreshTokenByProvider } = await import("../../open-sse/services/tokenRefresh.js");
    const refreshed = await refreshTokenByProvider("grok-cli", { refreshToken: "old-refresh" }, null);

    expect(refreshed).toEqual({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresIn: 900,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://auth.x.ai/oauth2/token",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/x-www-form-urlencoded",
        }),
      })
    );
    const tokenCall = fetch.mock.calls.find(([url, options]) =>
      String(url).includes("/oauth2/token") && options?.body instanceof URLSearchParams
    );
    expect(tokenCall?.[1].body.get("refresh_token")).toBe("old-refresh");
  });

  it("refreshes agy credentials through the Antigravity Google token flow", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "agy-access",
        refresh_token: "agy-refresh-next",
        expires_in: 600,
      }),
    }));

    const { refreshTokenByProvider } = await import("../../open-sse/services/tokenRefresh.js");
    const refreshed = await refreshTokenByProvider("agy", { refreshToken: "agy-refresh-old" }, null);

    expect(refreshed).toEqual({
      accessToken: "agy-access",
      refreshToken: "agy-refresh-next",
      expiresIn: 600,
    });
    const tokenCall = fetch.mock.calls.find(([url]) => String(url).includes("oauth2.googleapis.com/token"));
    expect(tokenCall?.[1].body.get("refresh_token")).toBe("agy-refresh-old");
  });

  it("grok-cli executor adds CLI headers and strips rejected params", async () => {
    const { GrokCliExecutor } = await import("../../open-sse/executors/grok-cli.js");
    const executor = new GrokCliExecutor();

    const headers = executor.buildHeaders({ accessToken: "token" }, false);
    expect(headers.Authorization).toBe("Bearer token");
    expect(headers.Accept).toBe("application/json");
    expect(headers["x-grok-client-identifier"]).toBe("grok_cli_rs");

    const body = executor.transformRequest("grok-build", {
      messages: [],
      presencePenalty: 1,
      presence_penalty: 1,
      frequencyPenalty: 1,
      frequency_penalty: 1,
      logprobs: true,
      topLogprobs: 5,
      top_logprobs: 5,
    }, true);

    expect(body).toMatchObject({ model: "grok-build", stream: true, messages: [] });
    expect(body.presencePenalty).toBeUndefined();
    expect(body.presence_penalty).toBeUndefined();
    expect(body.frequencyPenalty).toBeUndefined();
    expect(body.frequency_penalty).toBeUndefined();
    expect(body.logprobs).toBeUndefined();
    expect(body.topLogprobs).toBeUndefined();
    expect(body.top_logprobs).toBeUndefined();
  });
});
