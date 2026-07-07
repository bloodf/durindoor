import { describe, it, expect, vi, afterEach } from "vitest";

describe("OmniRoute open web/OAuth provider ports", () => {
  afterEach(() => vi.restoreAllMocks());

  it("resolves web-cookie provider host links from registry websites", async () => {
    const { resolveWebProviderHost } = await import("../../src/shared/constants/providers.js");

    expect(resolveWebProviderHost("grok-web")).toEqual({
      url: "https://grok.com",
      host: "grok.com",
    });
    expect(resolveWebProviderHost("missing-web", "https://example.test/path/to/models")).toEqual({
      url: "https://example.test",
      host: "example.test",
    });
    expect(resolveWebProviderHost("grok-web", "not a url")).toEqual({
      url: "https://grok.com",
      host: "grok.com",
    });
  });

  it("computes unique default API key connection names", async () => {
    const { computeDefaultConnectionName } = await import("../../src/shared/utils/connectionNames.js");

    expect(computeDefaultConnectionName(0)).toBe("main");
    expect(computeDefaultConnectionName(1)).toBe("main-2");
    expect(computeDefaultConnectionName(4)).toBe("main-5");
    expect(computeDefaultConnectionName(undefined)).toBe("main");
  });

  it("routes Kiro runtime by profileArn region before stored IdC token region", async () => {
    const {
      resolveKiroRuntimeRegion,
      buildKiroProfileDiscoveryRegions,
      discoverKiroProfileArnAcrossRegions,
    } = await import("../../open-sse/config/kiroRegions.js");
    const { KiroExecutor } = await import("../../open-sse/executors/kiro.js");
    const profileArn = "arn:aws:codewhisperer:eu-central-1:123456789012:profile/ABC";

    expect(resolveKiroRuntimeRegion({ region: "eu-north-1", profileArn })).toBe("eu-central-1");
    expect(buildKiroProfileDiscoveryRegions("eu-north-1")).toEqual([
      "eu-central-1",
      "us-east-1",
      "eu-north-1",
    ]);

    const requested = [];
    const arn = await discoverKiroProfileArnAcrossRegions("token", "eu-north-1", async (url) => {
      requested.push(String(url));
      if (String(url).includes("eu-central-1")) {
        return new Response(JSON.stringify({ profiles: [{ arn: profileArn }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ profiles: [] }), { status: 200 });
    });
    expect(arn).toBe(profileArn);
    expect(requested[0]).toBe("https://q.eu-central-1.amazonaws.com");

    const executor = new KiroExecutor();
    expect(executor.buildUrl("claude-sonnet-4.5", true, 0, {
      providerSpecificData: { authMethod: "idc", region: "eu-north-1", profileArn },
    })).toBe("https://q.eu-central-1.amazonaws.com/generateAssistantResponse");
  });

  it("adds GLM team quota headers and type=2 when organization/project ids are configured", async () => {
    const { buildGlmQuotaFetch, getGlmTeamQuotaConfig } = await import("../../open-sse/services/usage/misc.js");
    const providerSpecificData = {
      glmOrganizationId: "org-123",
      glmProjectId: "project-456",
    };

    expect(getGlmTeamQuotaConfig(providerSpecificData)).toEqual({
      state: "configured",
      organizationId: "org-123",
      projectId: "project-456",
    });

    const fetchConfig = buildGlmQuotaFetch("key", "glm-cn", providerSpecificData);
    expect(fetchConfig.url).toContain("type=2");
    expect(fetchConfig.headers).toMatchObject({
      Authorization: "Bearer key",
      "bigmodel-organization": "org-123",
      "bigmodel-project": "project-456",
    });
  });

  it("maps M365 enterprise/work tier settings into the websocket query", async () => {
    const {
      buildWsUrl,
      resolveConnectionParams,
      M365_ENTERPRISE_OVERRIDES,
      M365_INDIVIDUAL_DEFAULTS,
    } = await import("../../open-sse/executors/copilot-m365-connection.js");
    const { applyM365Tier, isM365TierCapableProvider, normalizeM365TierValue } =
      await import("../../src/shared/utils/m365Tier.js");

    expect(isM365TierCapableProvider("copilot-m365-web")).toBe(true);
    expect(isM365TierCapableProvider("copilot-web")).toBe(false);
    expect(normalizeM365TierValue("work")).toBe("enterprise");
    expect(normalizeM365TierValue("included")).toBe("edu");

    const enterpriseParams = resolveConnectionParams({
      apiKey: "access_token=tok; chathubPath=user@tenant",
      providerSpecificData: { tier: "enterprise" },
    });
    expect(enterpriseParams).toMatchObject(M365_ENTERPRISE_OVERRIDES);

    const enterpriseUrl = new URL(buildWsUrl(enterpriseParams));
    expect(enterpriseUrl.searchParams.get("agent")).toBe("work");
    expect(enterpriseUrl.searchParams.get("scenario")).toBe("officeweb");
    expect(enterpriseUrl.searchParams.get("licenseType")).toBe("Premium");

    const individualData = { tier: "enterprise", customUserAgent: "test" };
    applyM365Tier(individualData, "");
    expect(individualData).toEqual({ tier: null, customUserAgent: "test" });

    const individualUrl = new URL(buildWsUrl({
      host: "substrate.office.com",
      chathubPath: "user@tenant",
      accessToken: "tok",
    }));
    expect(individualUrl.searchParams.get("agent")).toBe(M365_INDIVIDUAL_DEFAULTS.agent);
  });

  it("falls back to a web-cookie provider website when generic validation lacks a config probe", async () => {
    const { POST } = await import("../../src/app/api/providers/validate/route.js");
    const { WEB_COOKIE_PROVIDERS } = await import("../../src/shared/constants/providers.js");
    const provider = "test-web-cookie-fallback";
    const calls = [];

    WEB_COOKIE_PROVIDERS[provider] = { name: "Test Web", website: "https://example.test/chat" };
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response("", { status: 404 });
    });

    try {
      const response = await POST(new Request("http://localhost/api/providers/validate", {
          method: "POST",
          body: JSON.stringify({
          provider,
          apiKey: "session-cookie=value",
        }),
      }));

      await expect(response.json()).resolves.toMatchObject({ valid: true, error: null });
      expect(calls[0].url).toBe("https://example.test/models");
      expect(calls[0].init.headers.Cookie).toBe("session-cookie=value");
    } finally {
      delete WEB_COOKIE_PROVIDERS[provider];
    }
  });

  it("routes openai-format web-cookie providers with wss baseUrl through cookie fallback validation", async () => {
    const { POST } = await import("../../src/app/api/providers/validate/route.js");
    const { WEB_COOKIE_PROVIDERS } = await import("../../src/shared/constants/providers.js");
    const { PROVIDERS } = await import("../../open-sse/config/providers.js");
    const provider = "test-openai-wss-web-cookie";
    const calls = [];

    WEB_COOKIE_PROVIDERS[provider] = { name: "Test WSS Web", website: "https://web.example.test/chat" };
    PROVIDERS[provider] = {
      baseUrl: "wss://socket.example.test/chat",
      format: "openai",
      authType: "cookie",
    };
    globalThis.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response("", { status: 404 });
    });

    try {
      const response = await POST(new Request("http://localhost/api/providers/validate", {
        method: "POST",
        body: JSON.stringify({
          provider,
          apiKey: "session-cookie=value",
        }),
      }));

      await expect(response.json()).resolves.toMatchObject({ valid: true, error: null });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("https://web.example.test/models");
      expect(calls[0].init.method).toBe("GET");
      expect(calls[0].init.headers.Cookie).toBe("session-cookie=value");
    } finally {
      delete WEB_COOKIE_PROVIDERS[provider];
      delete PROVIDERS[provider];
    }
  });
});
