/**
 * Unit tests for Codex (OpenAI) refresh token mechanism
 *
 * Verifies that:
 * - Early refresh lead times are configured per provider (synced with CLIProxyAPI)
 * - New refresh_token from response is persisted (token rotation)
 * - Falls back to old refresh_token when server doesn't return new one
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { proxyAwareFetchMock } = vi.hoisted(() => ({
  proxyAwareFetchMock: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: proxyAwareFetchMock,
}));

const originalFetch = global.fetch;

describe("Codex Refresh Token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    global.fetch = originalFetch;
    // Keep the network mock observable while also exposing the third,
    // request-local proxy argument used by the production implementation.
    proxyAwareFetchMock.mockImplementation((url, init, proxyOptions) =>
      global.fetch(url, { ...init, proxyOptions })
    );
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetchWithJson(payload) {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(payload),
    });
    global.fetch = fetchMock;
    return fetchMock;
  }

  describe("refreshCodexToken", () => {
    it("should return new refresh_token when server provides one (token rotation)", async () => {
      const fetchMock = mockFetchWithJson({
          access_token: "new-access",
          refresh_token: "rotated-refresh-token",
          id_token: "new-id-token",
          expires_in: 3600,
      });

      const { refreshCodexToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshCodexToken("old-refresh-token", null);

      expect(result.refreshToken).toBe("rotated-refresh-token");
      expect(result.accessToken).toBe("new-access");
      expect(result.idToken).toBe("new-id-token");
      expect(fetchMock).toHaveBeenCalledWith(
        "https://auth.openai.com/api/accounts/oauth/token",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            Accept: "application/json",
          }),
          body: JSON.stringify({
            client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
            grant_type: "refresh_token",
            refresh_token: "old-refresh-token",
          }),
        })
      );
    });

    it("should keep old refresh_token when server does not return new one", async () => {
      mockFetchWithJson({
          access_token: "new-access",
          expires_in: 3600,
      });

      const { refreshCodexToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshCodexToken("old-refresh-token-without-rotation", null);

      expect(result.refreshToken).toBe("old-refresh-token-without-rotation");
    });

    it("uses the caller's strict-pool route without forcing direct egress", async () => {
      mockFetchWithJson({
        access_token: "strict-access",
        refresh_token: "strict-rotated",
        expires_in: 3600,
      });
      const proxyOptions = {
        proxyMode: "strict-pool",
        proxyPoolId: "pool-a",
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://proxy-a.test:8080",
        strictProxy: true,
        disableEnvProxy: true,
      };

      const { refreshCodexToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshCodexToken("strict-route-refresh", null, proxyOptions);

      expect(result.accessToken).toBe("strict-access");
      expect(proxyAwareFetchMock).toHaveBeenCalledWith(
        "https://auth.openai.com/api/accounts/oauth/token",
        expect.objectContaining({ method: "POST" }),
        proxyOptions
      );
    });
  });

  describe("CodexExecutor credential lifecycle", () => {
    it("should refresh Codex credentials and preserve omitted id_token", async () => {
      mockFetchWithJson({
          access_token: "new-access",
          refresh_token: "rotated-refresh-token",
          expires_in: 3600,
      });

      const { CodexExecutor } = await import("../../open-sse/executors/codex.js");
      const executor = new CodexExecutor();
      const result = await executor.refreshCredentials({
        connectionId: "codex-1",
        refreshToken: "old-refresh-token",
        idToken: "old-id-token",
      }, null);

      expect(result.accessToken).toBe("new-access");
      expect(result.refreshToken).toBe("rotated-refresh-token");
      expect(result.idToken).toBe("old-id-token");
      expect(result.lastRefreshAt).toBeTruthy();
      expect(result.expiresAt).toBeTruthy();
    });

    it("should refresh Codex when lastRefreshAt is older than the upstream stale window", async () => {
      const { CodexExecutor } = await import("../../open-sse/executors/codex.js");
      const executor = new CodexExecutor();
      const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const staleRefresh = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString();
      const recentRefresh = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();

      expect(executor.needsRefresh({
        refreshToken: "refresh-token",
        expiresAt: farFuture,
        lastRefreshAt: staleRefresh,
      })).toBe(true);

      expect(executor.needsRefresh({
        refreshToken: "refresh-token",
        expiresAt: farFuture,
        lastRefreshAt: recentRefresh,
      })).toBe(false);
    });

    it("should de-duplicate concurrent refreshes for the same Codex connection", async () => {
      const fetchMock = mockFetchWithJson({
          access_token: "new-access",
          refresh_token: "rotated-refresh-token",
          expires_in: 3600,
      });

      const { refreshProviderCredentials } = await import("../../open-sse/services/oauthCredentialManager.js");
      const credentials = {
        connectionId: "codex-single-flight",
        refreshToken: "old-refresh-token",
      };

      const [first, second] = await Promise.all([
        refreshProviderCredentials("codex", credentials, null),
        refreshProviderCredentials("codex", credentials, null),
      ]);

      expect(first.accessToken).toBe("new-access");
      expect(second.accessToken).toBe("new-access");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("does not coalesce the same credential across different proxy routes", async () => {
      const fetchMock = mockFetchWithJson({
        access_token: "new-access",
        refresh_token: "rotated-refresh-token",
        expires_in: 3600,
      });
      const { refreshProviderCredentials } = await import("../../open-sse/services/oauthCredentialManager.js");
      const credentials = {
        connectionId: "codex-route-isolation",
        refreshToken: "route-isolation-refresh-token",
      };
      const direct = { proxyMode: "direct", disableEnvProxy: true };
      const strictPool = {
        proxyMode: "strict-pool",
        proxyPoolId: "pool-b",
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://proxy-b.test:8080",
        strictProxy: true,
        disableEnvProxy: true,
      };

      await Promise.all([
        refreshProviderCredentials("codex", credentials, null, direct),
        refreshProviderCredentials("codex", credentials, null, strictPool),
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(proxyAwareFetchMock.mock.calls.map((call) => call[2])).toEqual(
        expect.arrayContaining([
          expect.objectContaining(direct),
          expect.objectContaining(strictPool),
        ])
      );
    });

    it("reconstructs durable direct and strict-pool policy for proactive refresh", async () => {
      const { resolveCredentialProxyOptions } = await import("../../open-sse/services/oauthCredentialManager.js");

      expect(resolveCredentialProxyOptions({
        providerSpecificData: {
          oauthProxy: { mode: "direct" },
          connectionProxyEnabled: true,
          connectionProxyUrl: "http://stale-proxy.test:8080",
        },
      }, {
        proxyMode: "strict-pool",
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://replacement-proxy.test:8080",
        strictProxy: true,
      })).toMatchObject({
        proxyMode: "direct",
        connectionProxyEnabled: false,
        connectionProxyUrl: "",
        disableEnvProxy: true,
        strictProxy: false,
      });

      expect(resolveCredentialProxyOptions({
        providerSpecificData: {
          oauthProxy: { mode: "strict-pool", poolId: "pool-c" },
          connectionProxyEnabled: true,
          connectionProxyUrl: "http://proxy-c.test:8080",
        },
      })).toMatchObject({
        proxyMode: "strict-pool",
        proxyPoolId: "pool-c",
        connectionProxyUrl: "http://proxy-c.test:8080",
        disableEnvProxy: true,
        strictProxy: true,
      });
    });
  });

  describe("getRefreshLeadMs (early refresh config)", () => {
    it("should return provider-specific lead time for OAuth providers", async () => {
      const { getRefreshLeadMs } = await import("../../open-sse/services/tokenRefresh.js");

      // Synced with CLIProxyAPI refresh_registry
      expect(getRefreshLeadMs("codex")).toBe(5 * 24 * 60 * 60 * 1000);   // 5 days
      expect(getRefreshLeadMs("claude")).toBe(4 * 60 * 60 * 1000);       // 4 hours
      expect(getRefreshLeadMs("iflow")).toBe(24 * 60 * 60 * 1000);       // 24 hours
      expect(getRefreshLeadMs("qwen")).toBe(20 * 60 * 1000);             // 20 minutes
      expect(getRefreshLeadMs("kimi-coding")).toBe(5 * 60 * 1000);       // 5 minutes
      expect(getRefreshLeadMs("antigravity")).toBe(5 * 60 * 1000);       // 5 minutes
    });

    it("should fallback to default buffer for unknown providers", async () => {
      const { getRefreshLeadMs, TOKEN_EXPIRY_BUFFER_MS } = await import("../../open-sse/services/tokenRefresh.js");

      expect(getRefreshLeadMs("unknown-provider")).toBe(TOKEN_EXPIRY_BUFFER_MS);
      expect(getRefreshLeadMs("openai")).toBe(TOKEN_EXPIRY_BUFFER_MS);
    });

    it("codex lead should be greater than default buffer", async () => {
      const { getRefreshLeadMs, TOKEN_EXPIRY_BUFFER_MS } = await import("../../open-sse/services/tokenRefresh.js");

      expect(getRefreshLeadMs("codex")).toBeGreaterThan(TOKEN_EXPIRY_BUFFER_MS);
    });
  });
});
