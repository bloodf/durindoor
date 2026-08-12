import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import {
  getClaudeUsage,
  __clearOAuthQuotaCacheForTesting,
} from "../../open-sse/services/usage/claude.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { USAGE_APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function oauthSuccessBody() {
  return {
    five_hour: { utilization: 15, resets_at: "2026-07-17T20:00:00Z" },
    seven_day: { utilization: 42, resets_at: "2026-07-24T00:00:00Z" },
  };
}

function legacySuccessBody() {
  return { used: 100, total: 1000 };
}

function legacySettingsBody() {
  return { organization_id: "org-123", plan: "Pro", organization_name: "Test Org" };
}

describe("Claude usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __clearOAuthQuotaCacheForTesting();
  });

  it("parses OAuth response and sends Claude CLI headers", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(oauthSuccessBody()));

    const usage = await getClaudeUsage("oauth-token-1", null, "oauth");

    expect(usage.plan).toBe("Claude Code");
    expect(usage.quotas["session (5h)"]).toMatchObject({
      used: 15,
      total: 100,
      remaining: 85,
      remainingPercentage: 85,
      unlimited: false,
    });
    expect(usage.quotas["weekly (7d)"]).toMatchObject({
      used: 42,
      total: 100,
      remaining: 58,
      remainingPercentage: 58,
      unlimited: false,
    });

    const headers = proxyAwareFetch.mock.calls[0][1].headers;
    expect(headers["X-App"]).toBe("cli");
    expect(headers["Anthropic-Beta"]).toContain("oauth-2025-04-20");
    expect(Object.keys(headers)).not.toContain("anthropic-beta");
  });

  it("coalesces concurrent OAuth quota polls for the same credential", async () => {
    let resolveResponse;
    proxyAwareFetch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveResponse = resolve;
      })
    );

    const first = getClaudeUsage("oauth-token-concurrent", null, "oauth");
    const second = getClaudeUsage("oauth-token-concurrent", null, "oauth");

    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    resolveResponse(jsonResponse(oauthSuccessBody()));
    const [firstUsage, secondUsage] = await Promise.all([first, second]);
    expect(firstUsage).toEqual(secondUsage);
  });

  it("returns cached quotas with stale markers on 429", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(oauthSuccessBody()));
    await getClaudeUsage("oauth-token-2", null, "oauth");

    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "rate_limited" }, 429));
    const usage = await getClaudeUsage("oauth-token-2", null, "oauth");

    expect(usage.quotas["session (5h)"]).toMatchObject({ used: 15, total: 100 });
    expect(usage.stale).toBe(true);
    expect(usage.rateLimited).toBe(true);
    expect(usage.staleReason).toBe("Rate limited; showing cached quota.");
    expect(usage.message).toBeUndefined();
  });

  it("returns exact rate-limit error and suppresses polls during cooldown without cached quotas", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "rate_limited" }, 429));

    const first = await getClaudeUsage("oauth-token-3", null, "oauth");
    const second = await getClaudeUsage("oauth-token-3", null, "oauth");

    expect(first).toEqual({ message: "Rate limited, try again later." });
    expect(second).toEqual({ message: "Rate limited, try again later." });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("returns cached quotas with stale markers on 5xx", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(oauthSuccessBody()));
    await getClaudeUsage("oauth-token-4", null, "oauth");

    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "internal_error" }, 503));
    const usage = await getClaudeUsage("oauth-token-4", null, "oauth");

    expect(usage.quotas["session (5h)"]).toMatchObject({ used: 15, total: 100 });
    expect(usage.stale).toBe(true);
    expect(usage.rateLimited).toBeUndefined();
    expect(usage.staleReason).toBe("Claude usage temporarily unavailable; showing cached quota.");
    expect(usage.message).toBeUndefined();
  });

  it("returns 5xx message when no cached quota exists", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "internal_error" }, 503));
    const usage = await getClaudeUsage("oauth-token-5", null, "oauth");

    expect(usage.message).toBe("Claude usage temporarily unavailable. Try again later.");
    expect(usage.quotas).toBeUndefined();
  });

  it("treats every OAuth 401 as credential expiry without legacy fallback", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({ error: { type: "unsupported_token_type", message: "OAuth token required" } }, 401)
    );

    const usage = await getClaudeUsage("oauth-token-6", null, "oauth");

    expect(usage.message).toBe(
      "Claude authentication expired (401). Re-authorize or refresh the connection."
    );
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("reports an expired consumer OAuth credential on 401", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({ error: { type: "invalid_token", message: "Invalid bearer token" } }, 401)
    );

    const usage = await getClaudeUsage("oauth-token-expired", null, "oauth");

    expect(usage).toEqual({
      message: "Claude authentication expired (401). Re-authorize or refresh the connection.",
    });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it.each([404, 405])("falls back to the legacy usage endpoint on OAuth HTTP %i", async (status) => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse({ error: "unsupported_endpoint" }, status))
      .mockResolvedValueOnce(jsonResponse(legacySettingsBody()))
      .mockResolvedValueOnce(jsonResponse(legacySuccessBody()));

    const usage = await getClaudeUsage(`oauth-token-legacy-${status}`, null, "oauth");

    expect(usage.plan).toBe("Pro");
    expect(usage.quotas).toMatchObject(legacySuccessBody());
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
  });

  it("returns the OAuth error without legacy fallback on generic HTTP 400", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({ error: { type: "invalid_request_error", message: "Malformed usage request" } }, 400)
    );

    const usage = await getClaudeUsage("oauth-token-generic-400", null, "oauth");

    expect(usage).toEqual({
      message: "Claude connected. Unable to fetch usage: Malformed usage request",
    });
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
  });

  it("does not fall back to legacy API for expired consumer OAuth 403", async () => {
    proxyAwareFetch.mockResolvedValueOnce(
      jsonResponse({ error: { type: "invalid_request_error", message: "Your session has expired, please re-authorize" } }, 403)
    );

    const usage = await getClaudeUsage("oauth-token-7", null, "oauth");

    expect(usage.quotas).toBeUndefined();
    expect(usage.message).toMatch(/Unable to fetch usage/);
  });

  it("dispatches API-key connection to legacy path via getUsageForProvider", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce(jsonResponse(legacySettingsBody()))
      .mockResolvedValueOnce(jsonResponse(legacySuccessBody()));

    const usage = await getUsageForProvider({
      provider: "claude",
      apiKey: "sk-ant-api-123",
      authType: "apikey",
    });

    expect(usage.plan).toBe("Pro");
    expect(usage.quotas).toMatchObject(legacySuccessBody());
    expect(proxyAwareFetch.mock.calls[0][1].headers.Authorization).toBe("Bearer sk-ant-api-123");
  });

  it("preserves quota rows through parseQuotaData when stale", async () => {
    proxyAwareFetch.mockResolvedValueOnce(jsonResponse(oauthSuccessBody()));
    await getClaudeUsage("oauth-token-8", null, "oauth");

    proxyAwareFetch.mockResolvedValueOnce(jsonResponse({ error: "rate_limited" }, 429));
    const usage = await getClaudeUsage("oauth-token-8", null, "oauth");

    const parsed = parseQuotaData("claude", usage);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ name: "session (5h)", used: 15, total: 100 });
    expect(parsed[1]).toMatchObject({ name: "weekly (7d)", used: 42, total: 100 });
  });

  it("registers Claude for both OAuth and API-key usage via registry features", () => {
    const claude = REGISTRY.find((r) => r.id === "claude");
    expect(claude?.features?.usage).toBe(true);
    expect(claude?.features?.usageApikey).toBe(true);
    expect(USAGE_APIKEY_PROVIDERS).toContain("claude");
  });
});
