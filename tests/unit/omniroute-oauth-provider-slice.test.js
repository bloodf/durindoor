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
    const { PROVIDERS, PROVIDER_OAUTH } = await import("../../open-sse/providers/index.js");

    expect(resolveProviderAlias("agy")).toBe("agy");
    expect(PROVIDERS.agy.format).toBe("antigravity");
    expect(PROVIDERS.agy.clientId).toBe(PROVIDERS.antigravity.clientId);
    expect(PROVIDER_OAUTH.agy.tokenUrl).toBe(PROVIDER_OAUTH.antigravity.tokenUrl);
    expect(getExecutor("agy").getProvider()).toBe("agy");
  });

  it("maps grok-cli device-code tokens into serializable OAuth credentials", async () => {
    const { getProvider } = await import("../../src/lib/oauth/providers.js");
    const idToken = makeJwt({
      sub: "user-1",
      email: "grok@example.com",
      team_id: "team-1",
    });
    const grok = getProvider("grok-cli");
    expect(grok.flowType).toBe("device_code");

    const mapped = grok.mapTokens(
      {
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 1800,
        scope: "openid grok-cli:access",
        id_token: idToken,
      },
      { user: { userId: "user-1", email: "grok@example.com" } }
    );

    expect(mapped.accessToken).toBe("access-1");
    expect(mapped.refreshToken).toBe("refresh-1");
    expect(mapped.expiresIn).toBe(1800);
    expect(mapped.email).toBe("grok@example.com");
    expect(mapped.providerSpecificData).toMatchObject({
      authMethod: "device_code",
      userId: "user-1",
      email: "grok@example.com",
      idToken,
    });
  });

  it("maps expiry and null refresh when device flow omits a refresh token", async () => {
    const { getProvider } = await import("../../src/lib/oauth/providers.js");
    const grok = getProvider("grok-cli");
    const mapped = grok.mapTokens({ access_token: "a", expires_in: 900 }, null);
    expect(mapped.refreshToken).toBeNull();
    expect(mapped.expiresIn).toBe(900);
    expect(mapped.providerSpecificData.authMethod).toBe("device_code");
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

  it("grok-cli executor adds CLI headers and strips rejected params", async () => {
    const { GrokCliExecutor } = await import("../../open-sse/executors/grok-cli.js");
    const executor = new GrokCliExecutor();

    const headers = executor.buildHeaders({ accessToken: "token" }, false);
    expect(headers.Authorization).toBe("Bearer token");
    expect(headers.Accept).toBe("application/json");
    expect(headers["x-grok-client-identifier"]).toBe("grok-pager");

    const body = executor.transformRequest("grok-build", {
      messages: [],
      presencePenalty: 1,
      frequencyPenalty: 1,
      logprobs: true,
      topLogprobs: 5,
    }, true);

    expect(body).toMatchObject({ model: "grok-build", stream: true });
    expect(body.messages).toBeUndefined();
    expect(body.input).toBeDefined();
    expect(body.presencePenalty).toBeUndefined();
    expect(body.frequencyPenalty).toBeUndefined();
    expect(body.logprobs).toBeUndefined();
    expect(body.topLogprobs).toBeUndefined();
  });
});
