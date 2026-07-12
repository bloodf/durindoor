import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression coverage for the rotation-aware proactive-refresh skip in
// testOAuthConnection (src/app/api/providers/[id]/test/testUtils.js).
// Front 2 (OmniRoute 697946381d): Codex/OpenAI share one Auth0 client_id and
// mint single-use refresh_tokens, so a manual "Test connection" click on an
// expired sibling account must NOT proactively refresh — parallel refreshes
// revoke the whole token family (openai/codex#9648). The probe runs with the
// current access_token; genuine expiry is handled by the reactive,
// serialized 401 path. Non-rotating providers keep proactive refresh.

const mocks = vi.hoisted(() => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

function expiredOauthConnection(provider) {
  return {
    id: `conn-${provider}`,
    provider,
    authType: "oauth",
    accessToken: `stale-${provider}-token`,
    refreshToken: `refresh-${provider}-token`,
    // Explicitly expired (also avoids the maxRefreshAgeMs stale path).
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
    lastRefreshAt: new Date().toISOString(),
    providerSpecificData: {},
  };
}

describe("testOAuthConnection rotation-aware proactive refresh skip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProviderConnection.mockResolvedValue(undefined);
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      vercelRelayUrl: "",
    });
  });

  it("skips proactive refresh for an expired rotating provider (codex) and probes with the current token", async () => {
    mocks.getProviderConnectionById.mockResolvedValue(expiredOauthConnection("codex"));
    const { __setProviderTestFetchForTesting, testSingleConnection } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    const probeFetch = vi.fn(async (url, options) => {
      // Only the Codex probe may fire — the OAuth token endpoint must not.
      expect(String(url)).toContain("chatgpt.com/backend-api/codex/responses");
      expect(options.headers.Authorization).toBe("Bearer stale-codex-token");
      // 400 is the accepted "auth succeeded" status for the codex probe.
      return new Response("{}", { status: 400 });
    });
    const restoreFetch = __setProviderTestFetchForTesting(probeFetch);

    try {
      const result = await testSingleConnection("conn-codex");

      expect(result.valid, JSON.stringify(result)).toBe(true);
      expect(result.refreshed).toBe(false);
      expect(probeFetch).toHaveBeenCalledTimes(1);
      // Status bookkeeping may persist, but no refreshed token must be written.
      for (const [, update] of mocks.updateProviderConnection.mock.calls) {
        expect(update).not.toMatchObject({ accessToken: expect.anything() });
        expect(update).not.toMatchObject({ refreshToken: expect.anything() });
      }
    } finally {
      restoreFetch();
    }
  });

  it("skips proactive refresh for an expired claude sibling (anthropic-oauth rotation group)", async () => {
    mocks.getProviderConnectionById.mockResolvedValue(expiredOauthConnection("claude"));
    const { __setProviderTestFetchForTesting, testSingleConnection } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    const probeFetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const restoreFetch = __setProviderTestFetchForTesting(probeFetch);

    try {
      const result = await testSingleConnection("conn-claude");

      // checkExpiry config: skipped refresh leaves the expired token as-is,
      // so the test reports expiry instead of minting a family-revoking refresh.
      expect(result.refreshed).toBe(false);
      expect(result.error).toBe("Token expired");
      expect(probeFetch).not.toHaveBeenCalled();
      // Status bookkeeping may persist, but no refreshed token must be written.
      for (const [, update] of mocks.updateProviderConnection.mock.calls) {
        expect(update).not.toMatchObject({ accessToken: expect.anything() });
        expect(update).not.toMatchObject({ refreshToken: expect.anything() });
      }
    } finally {
      restoreFetch();
    }
  });

  it("still proactively refreshes an expired non-rotating provider (gemini-cli)", async () => {
    mocks.getProviderConnectionById.mockResolvedValue(expiredOauthConnection("gemini-cli"));
    const { __setProviderTestFetchForTesting, testSingleConnection } = await import(
      "../../src/app/api/providers/[id]/test/testUtils.js"
    );
    const probeFetch = vi.fn(async (url) => {
      if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
        // Proactive refresh must happen for non-rotating providers.
        return new Response(
          JSON.stringify({ access_token: "fresh-gemini-token", expires_in: 3600 }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    });
    const restoreFetch = __setProviderTestFetchForTesting(probeFetch);

    try {
      const result = await testSingleConnection("conn-gemini-cli");

      expect(result.valid, JSON.stringify(result)).toBe(true);
      expect(result.refreshed).toBe(true);
      // The OAuth refresh POST must happen for non-rotating providers.
      expect(probeFetch).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining("oauth2.googleapis.com/token"),
        expect.anything(),
        expect.anything(),
      );
    } finally {
      restoreFetch();
    }
  });
});
