import { describe, expect, it, vi } from "vitest";
import { getProviderQuotaAdapter, PROVIDER_QUOTA_ADAPTERS } from "../../open-sse/services/quota/providers/index.js";
import { PROVIDER_QUOTA_CONFIG } from "../../open-sse/config/providerQuota.js";

const NOW = Date.parse("2026-01-01T00:00:00.000Z");
const RESET = "2026-01-01T01:00:00.000Z";

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

function providerContext(provider, activeConnection, fetchImpl, overrides = {}) {
  const adapter = getProviderQuotaAdapter(provider);
  return {
    adapter,
    context: {
      config: adapter.config,
      connection: { id: `${provider}-1`, provider, providerSpecificData: {}, ...activeConnection },
      fetchImpl,
      proxyOptions: { strictProxy: true },
      signal: overrides.signal || new AbortController().signal,
      now: () => NOW,
      randomUUID: () => "00000000-0000-4000-8000-000000000001",
      timeoutMs: 1_000,
      maxResponseBytes: 64 * 1024,
      ...overrides,
    },
  };
}

describe("provider quota adapter registry", () => {
  it("resolves every stable provider config and never invents an adapter", () => {
    for (const [provider, config] of Object.entries(PROVIDER_QUOTA_CONFIG)) {
      expect(PROVIDER_QUOTA_ADAPTERS).toHaveProperty(config.adapter);
      expect(getProviderQuotaAdapter(provider)).toMatchObject({
        config,
        fetchQuota: PROVIDER_QUOTA_ADAPTERS[config.adapter],
      });
      if (config.adapter === "kiro") {
        expect(getProviderQuotaAdapter(provider).isConnectionEligible).toEqual(expect.any(Function));
      }
    }
    expect(getProviderQuotaAdapter("xai")).toBeNull();
    expect(getProviderQuotaAdapter("not-a-provider")).toBeNull();
  });

  it("performs no network request when every configured provider lacks its required credential", async () => {
    for (const provider of Object.keys(PROVIDER_QUOTA_CONFIG)) {
      const fetchImpl = vi.fn();
      const { adapter, context } = providerContext(provider, { authType: "apikey" }, fetchImpl);
      await expect(adapter.fetchQuota(context), provider).resolves.toMatchObject({ outcome: "missing" });
      expect(fetchImpl, provider).not.toHaveBeenCalled();
    }
  });

  it("performs Google project discovery before the authoritative quota fetch", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ cloudaicompanionProject: { id: "private-project" }, currentTier: { name: "Pro" } }))
      .mockResolvedValueOnce(jsonResponse({ buckets: [{ modelId: "gemini-pro", remainingFraction: 0.5, resetTime: RESET }] }));
    const { adapter, context } = providerContext("gemini-cli", { authType: "oauth", accessToken: "token-google" }, fetchImpl);

    const result = await adapter.fetchQuota(context);

    expect(result).toMatchObject({ outcome: "success", sourceId: "gemini-cli:retrieve-user-quota:v1" });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].accountKey).toMatch(/^project:h-/);
    expect(JSON.stringify(result)).not.toContain("private-project");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("loadCodeAssist"),
      expect.objectContaining({ method: "POST", body: expect.stringContaining("metadata") }),
      expect.objectContaining({ strictProxy: true }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("retrieveUserQuota"),
      expect.objectContaining({ body: JSON.stringify({ project: "private-project" }) }),
      expect.any(Object),
    );
  });

  it("uses Antigravity's dedicated bootstrap endpoint and client profile headers", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ cloudaicompanionProject: "project-ag", currentTier: { name: "Pro" } }))
      .mockResolvedValueOnce(jsonResponse({ buckets: [{ modelId: "gemini-pro", remainingFraction: 1, resetTime: RESET }] }));
    const { adapter, context } = providerContext("antigravity", { authType: "oauth", accessToken: "token-ag" }, fetchImpl);

    await expect(adapter.fetchQuota(context)).resolves.toMatchObject({ outcome: "success" });
    expect(fetchImpl.mock.calls[0][0]).toContain("daily-cloudcode-pa.sandbox.googleapis.com");
    expect(fetchImpl.mock.calls[0][1].headers).toEqual({
      Authorization: "Bearer token-ag",
      "Content-Type": "application/json",
      "User-Agent": "vscode/1.X.X (Antigravity/4.2.0)",
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ metadata: { ideType: "ANTIGRAVITY" } });
    expect(fetchImpl.mock.calls[1][1].headers).toMatchObject({
      "X-Client-Name": "antigravity",
      "X-Client-Version": expect.any(String),
    });
  });

  it("rejects conflicting Codex account aliases before any network request", async () => {
    const fetchImpl = vi.fn();
    const { adapter, context } = providerContext("codex", {
      authType: "oauth",
      accessToken: "token-codex",
      providerSpecificData: { workspaceId: "workspace-a", accountId: "workspace-b" },
    }, fetchImpl);

    const result = await adapter.fetchQuota(context);

    expect(result).toMatchObject({ outcome: "malformed", sourceId: "codex:wham-usage:v1" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("falls back from Claude OAuth only on an unsupported endpoint status", async () => {
    const successWindow = { weekly: { used: 10 } };
    const fallbackFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, 404))
      .mockResolvedValueOnce(jsonResponse({ organization_id: "org-private", plan: "Team" }))
      .mockResolvedValueOnce(jsonResponse(successWindow));
    const first = providerContext("claude", { authType: "oauth", accessToken: "token-claude" }, fallbackFetch);
    await expect(first.adapter.fetchQuota(first.context)).resolves.toMatchObject({ outcome: "success" });
    expect(fallbackFetch).toHaveBeenCalledTimes(3);

    const authFetch = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    const second = providerContext("claude", { authType: "oauth", accessToken: "token-claude" }, authFetch);
    await expect(second.adapter.fetchQuota(second.context)).resolves.toMatchObject({ outcome: "unauthenticated" });
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it("routes Claude API-key admin usage directly through the legacy organization contract", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ organization_id: "org-private", plan: "Enterprise" }))
      .mockResolvedValueOnce(jsonResponse({ weekly: { used: 10 } }));
    const { adapter, context } = providerContext("claude", { authType: "apikey", apiKey: "key-claude" }, fetchImpl);

    const result = await adapter.fetchQuota(context);
    expect(result).toMatchObject({ outcome: "success" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toContain("/v1/settings");
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({ "x-api-key": "key-claude" });
    expect(fetchImpl.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
    expect(result.rows[0]).toMatchObject({ dimensionKey: "requests:weekly", amounts: { limitKind: "unknown", used: 10 } });
  });

  it("uses Cursor's WorkOS dashboard contract with JSON rather than Connect protobuf", async () => {
    const jwt = `header.${Buffer.from(JSON.stringify({ sub: "cursor-user" })).toString("base64url")}.signature`;
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      billingCycleEnd: RESET,
      planUsage: { limit: 500, totalSpend: 125, totalPercentUsed: 25, autoPercentUsed: 20, apiPercentUsed: 5 },
    }));
    const { adapter, context } = providerContext("cursor", { authType: "oauth", accessToken: jwt }, fetchImpl);

    const result = await adapter.fetchQuota(context);
    expect(result).toMatchObject({ outcome: "success" });
    expect(result.rows[0].accountKey).toMatch(/^account:h-/);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://cursor.com/api/dashboard/get-current-period-usage",
      expect.objectContaining({
        redirect: "error",
        headers: expect.objectContaining({
          Cookie: `WorkosCursorSessionToken=cursor-user::${jwt}`,
          "Content-Type": "application/json",
        }),
      }),
      expect.any(Object),
    );
    expect(fetchImpl.mock.calls[0][1].headers["Content-Type"]).not.toContain("connect+proto");
  });

  it("normalizes a legacy Cursor userId::jwt token without duplicating the cookie identity", async () => {
    const jwt = `header.${Buffer.from(JSON.stringify({ sub: "jwt-user" })).toString("base64url")}.signature`;
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      billingCycleEnd: RESET,
      planUsage: { limit: 500, totalSpend: 125, autoPercentUsed: 20, apiPercentUsed: 5 },
    }));
    const { adapter, context } = providerContext("cursor", {
      authType: "oauth",
      accessToken: `legacy-user::${jwt}`,
    }, fetchImpl);

    const result = await adapter.fetchQuota(context);

    expect(result).toMatchObject({ outcome: "success" });
    expect(result.rows[0].accountKey).toMatch(/^account:h-/);
    expect(fetchImpl.mock.calls[0][1].headers.Cookie).toBe(`WorkosCursorSessionToken=legacy-user::${jwt}`);
  });

  it("rejects a Cursor cookie identity containing header delimiters before fetch", async () => {
    const fetchImpl = vi.fn();
    const { adapter, context } = providerContext("cursor", {
      authType: "oauth",
      accessToken: "not-a-jwt",
      providerSpecificData: { userId: "cursor-user;\r\nCookie: injected" },
    }, fetchImpl);
    await expect(adapter.fetchQuota(context)).resolves.toMatchObject({ outcome: "missing" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, "unauthenticated"],
    [403, "forbidden"],
    [429, "rate_limited"],
  ])("preserves GitHub HTTP %s as %s", async (status, outcome) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ignored: true }, status, { "retry-after": "60" }));
    const { adapter, context } = providerContext("github", { authType: "oauth", accessToken: "token-github" }, fetchImpl);

    await expect(adapter.fetchQuota(context)).resolves.toMatchObject({ outcome });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses the accepted GitHub Copilot internal header profile", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      quota_snapshots: { chat: { used: 1, total: 10 } },
    }));
    const { adapter, context } = providerContext("github", { authType: "oauth", accessToken: "token-github" }, fetchImpl);

    await expect(adapter.fetchQuota(context)).resolves.toMatchObject({ outcome: "success" });
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({
      "X-GitHub-Api-Version": "2026-06-01",
      "User-Agent": "GitHubCopilotChat/0.54.0",
      "Editor-Version": "vscode/1.126.0",
      "Editor-Plugin-Version": "copilot-chat/0.54.0",
    });
  });

  it("uses the accepted Kiro GetUsageLimits POST and stops on an authoritative auth failure", async () => {
    const successBody = {
      subscriptionInfo: { subscriptionTitle: "Pro" },
      nextDateReset: RESET,
      usageBreakdownList: [{ resourceType: "AGENTIC_REQUEST", currentUsageWithPrecision: 1, usageLimitWithPrecision: 10 }],
    };
    const fallbackFetch = vi.fn().mockResolvedValueOnce(jsonResponse(successBody));
    const first = providerContext("kiro", {
      authType: "oauth",
      accessToken: "token-kiro",
      providerSpecificData: { profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/private" },
    }, fallbackFetch);

    await expect(first.adapter.fetchQuota(first.context)).resolves.toMatchObject({ outcome: "success" });
    expect(fallbackFetch).toHaveBeenCalledTimes(1);
    expect(fallbackFetch).toHaveBeenCalledWith(
      "https://codewhisperer.us-east-1.amazonaws.com/",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "x-amz-target": "AmazonCodeWhispererService.GetUsageLimits" }),
      }),
      expect.any(Object),
    );

    const authFetch = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    const second = providerContext("kiro", {
      authType: "oauth",
      accessToken: "token-kiro",
      providerSpecificData: { profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/private" },
    }, authFetch);
    await expect(second.adapter.fetchQuota(second.context)).resolves.toMatchObject({ outcome: "unauthenticated" });
    expect(authFetch).toHaveBeenCalledTimes(1);
  });

  it("discovers a missing Kiro profile in-region before requesting usage", async () => {
    const arn = "arn:aws:codewhisperer:eu-central-1:123456789012:profile/discovered";
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ profiles: [{ arn }] }))
      .mockResolvedValueOnce(jsonResponse({
        usageBreakdownList: [{ resourceType: "AGENTIC_REQUEST", currentUsageWithPrecision: 2, usageLimitWithPrecision: 10 }],
      }));
    const { adapter, context } = providerContext("kiro", {
      authType: "oauth",
      accessToken: "token-kiro",
      providerSpecificData: { region: "eu-central-1" },
    }, fetchImpl);

    await expect(adapter.fetchQuota(context)).resolves.toMatchObject({ outcome: "success" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://q.eu-central-1.amazonaws.com/",
      "https://q.eu-central-1.amazonaws.com/",
    ]);
    expect(fetchImpl.mock.calls[0][1].headers["x-amz-target"]).toContain("ListAvailableProfiles");
    expect(fetchImpl.mock.calls[1][1].body).toContain(arn);
  });

  it("normalizes a legacy ARN region for routing while preserving the stored ARN bytes", async () => {
    const legacyArn = "arn:aws:codewhisperer:US-EAST-1:123456789012:profile/legacy";
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      usageBreakdownList: [{ resourceType: "AGENTIC_REQUEST", currentUsageWithPrecision: 1, usageLimitWithPrecision: 10 }],
    }));
    const { adapter, context } = providerContext("kiro", {
      authType: "oauth",
      accessToken: "token-kiro",
      providerSpecificData: { region: "EU-CENTRAL-1", profileArn: legacyArn },
    }, fetchImpl);

    await expect(adapter.fetchQuota(context)).resolves.toMatchObject({ outcome: "success" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://codewhisperer.us-east-1.amazonaws.com/",
      expect.objectContaining({ body: expect.stringContaining(legacyArn) }),
      expect.any(Object),
    );
  });

  it.each(["api_key", "external_idp"])("keeps the research-only Kiro %s quota variant disabled", async (authMethod) => {
    const fetchImpl = vi.fn();
    const { adapter, context } = providerContext("kiro", {
      authType: authMethod === "api_key" ? "api_key" : "oauth",
      accessToken: "token-kiro",
      providerSpecificData: { authMethod, region: "us-east-1" },
    }, fetchImpl);

    await expect(adapter.fetchQuota(context)).resolves.toMatchObject({ outcome: "missing" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("propagates Kiro caller cancellation and never attempts a later endpoint", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }));
    const { adapter, context } = providerContext("kiro", {
      authType: "oauth",
      accessToken: "token-kiro",
      providerSpecificData: { profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/private" },
    }, fetchImpl, {
      signal: controller.signal,
    });

    const pending = adapter.fetchQuota(context);
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a hostile Kiro region before constructing or fetching an authenticated URL", async () => {
    const fetchImpl = vi.fn();
    const { adapter, context } = providerContext("kiro", {
      authType: "oauth",
      accessToken: "token-kiro",
      providerSpecificData: { region: "attacker.example/" },
    }, fetchImpl);

    await expect(adapter.fetchQuota(context)).resolves.toMatchObject({ outcome: "malformed" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("falls through MiniMax endpoints while preserving each endpoint's count semantics", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({
        base_resp: { status_code: 0 },
        model_remains: [{
          model_name: "MiniMax-M2",
          current_interval_total_count: 100,
          current_interval_usage_count: 75,
          current_interval_remaining_percent: 75,
          remains_time: 3_600_000,
        }],
      }));
    const { adapter, context } = providerContext("minimax", { authType: "apikey", apiKey: "token-minimax" }, fetchImpl);

    const result = await adapter.fetchQuota(context);

    expect(result).toMatchObject({ outcome: "success" });
    expect(result.rows[0].amounts).toMatchObject({ limit: 100, used: 25, remaining: 75 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each(["token plan api key invalid", "coding plan inactive"])(
    "classifies MiniMax HTTP-200 auth message %s without endpoint fallback",
    async (statusMessage) => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
        base_resp: { status_code: 0, status_msg: statusMessage },
        model_remains: [],
      }));
      const { adapter, context } = providerContext("minimax", { authType: "apikey", apiKey: "token-minimax" }, fetchImpl);

      await expect(adapter.fetchQuota(context)).resolves.toMatchObject({ outcome: "unauthenticated" });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it("uses GLM team identity headers and distinct accepted windows", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { limits: [
      { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 10 },
      { type: "TOKENS_LIMIT", unit: 6, number: 1, percentage: 20 },
    ] } }));
    const { adapter, context } = providerContext("glm-cn", {
      authType: "apikey",
      apiKey: "token-glm",
      providerSpecificData: { glmOrganizationId: "org-private", glmProjectId: "project-private" },
    }, fetchImpl);

    const result = await adapter.fetchQuota(context);
    expect(result.rows.map((row) => row.dimensionKey)).toEqual(["tokens:session", "tokens:weekly"]);
    expect(fetchImpl.mock.calls[0][0]).toContain("?type=2");
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({
      "bigmodel-organization": "org-private",
      "bigmodel-project": "project-private",
    });
    expect(JSON.stringify(result)).not.toContain("org-private");
  });

  it("classifies a GLM HTTP-200 payload code 401 without requiring success=false", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ code: 401, message: "not authorized" }));
    const { adapter, context } = providerContext("glm", { authType: "apikey", apiKey: "token-glm" }, fetchImpl);

    await expect(adapter.fetchQuota(context)).resolves.toMatchObject({ outcome: "unauthenticated" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects hostile GLM team header values before fetch", async () => {
    const fetchImpl = vi.fn();
    const { adapter, context } = providerContext("glm", {
      authType: "apikey",
      apiKey: "token-glm",
      providerSpecificData: { glmOrganizationId: "org\r\nAuthorization: injected", glmProjectId: "project" },
    }, fetchImpl);
    await expect(adapter.fetchQuota(context)).resolves.toMatchObject({ outcome: "malformed" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("exchanges a Qoder PAT and maps pooled status without persisting either token", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ token: "jt-short-lived", expires_in: 86400 }))
      .mockResolvedValueOnce(jsonResponse({ userType: "teams", userTag: "Teams", plan: "PLAN_TIER_TEAM", quota: 0, isQuotaExceeded: false, nextResetAt: 1767229200000 }));
    const { adapter, context } = providerContext("qoder", { authType: "apikey", apiKey: "pt-personal-secret" }, fetchImpl);

    const result = await adapter.fetchQuota(context);
    expect(result).toMatchObject({ outcome: "success" });
    expect(result.rows[0]).toMatchObject({ state: "available", amounts: { limitKind: "unlimited" } });
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      "https://openapi.qoder.sh/api/v1/jobToken/exchange",
      "https://openapi.qoder.sh/api/v3/user/status",
    ]);
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe("Bearer jt-short-lived");
    expect(JSON.stringify(result)).not.toContain("pt-personal-secret");
    expect(JSON.stringify(result)).not.toContain("jt-short-lived");
  });

  it("derives a stable non-secret Kimi device ID instead of a timestamp identity", async () => {
    const seenDeviceIds = [];
    const fetchImpl = vi.fn((_url, options) => {
      seenDeviceIds.push(options.headers["X-Msh-Device-Id"]);
      return Promise.resolve(jsonResponse({
        usage: { limit: 100, used: 10, remaining: 90, resetTime: RESET },
      }));
    });
    const activeConnection = { authType: "oauth", accessToken: "token-kimi", providerSpecificData: { userId: "private-user" } };
    const first = providerContext("kimi-coding", activeConnection, fetchImpl);
    const second = providerContext("kimi-coding", activeConnection, fetchImpl);

    await first.adapter.fetchQuota(first.context);
    await second.adapter.fetchQuota(second.context);

    expect(seenDeviceIds).toHaveLength(2);
    expect(seenDeviceIds[0]).toBe(seenDeviceIds[1]);
    expect(seenDeviceIds[0]).toMatch(/^[a-f0-9]{32}$/);
    expect(JSON.stringify(seenDeviceIds)).not.toContain("private-user");
    expect(fetchImpl.mock.calls[0][1].headers).toMatchObject({
      "X-Msh-Platform": "omniroute",
      "X-Msh-Version": "2.1.2",
    });
  });

  it("does not place an unsafe stored Kimi device value into a header", async () => {
    let deviceId;
    const fetchImpl = vi.fn((_url, options) => {
      deviceId = options.headers["X-Msh-Device-Id"];
      return Promise.resolve(jsonResponse({ usage: { limit: 10, used: 1, remaining: 9, resetTime: RESET } }));
    });
    const { adapter, context } = providerContext("kimi-coding", {
      authType: "oauth",
      accessToken: "token-kimi",
      providerSpecificData: { deviceId: "device\r\nAuthorization: injected" },
    }, fetchImpl);
    await adapter.fetchQuota(context);
    expect(deviceId).toMatch(/^[a-f0-9]{32}$/);
    expect(deviceId).not.toContain("injected");
  });
});
