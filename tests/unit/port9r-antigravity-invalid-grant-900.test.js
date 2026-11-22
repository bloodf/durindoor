import { describe, it, expect, vi, beforeEach } from "vitest";

// 9router PR #900: Google's token endpoint answers a revoked Antigravity /
// Gemini CLI refresh token with 400 {"error":"invalid_grant"}. That must
// surface the durable re-auth signal instead of a silent, retryable null.

const proxyAwareFetch = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

const { refreshGoogleToken } = await import("../../open-sse/services/tokenRefresh/providers.js");
const { isUnrecoverableRefreshError } = await import("../../open-sse/services/tokenRefresh.js");
const { __clearRefreshDedupCacheForTesting } = await import("../../open-sse/services/tokenRefresh/dedup.js");

const reply = (status, body) => ({ ok: false, status, text: async () => body });

describe("Google OAuth refresh invalid_grant (9router #900)", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
    __clearRefreshDedupCacheForTesting();
  });

  it("returns an unrecoverable result for invalid_grant", async () => {
    proxyAwareFetch.mockResolvedValue(reply(400, JSON.stringify({
      error: "invalid_grant",
      error_description: "Token has been expired or revoked.",
    })));
    const result = await refreshGoogleToken("rt-revoked", "cid", "secret", null);
    expect(result).toEqual({ error: "invalid_grant" });
    expect(isUnrecoverableRefreshError(result)).toBe(true);
  });

  it("keeps invalid_client and server errors retryable", async () => {
    proxyAwareFetch.mockResolvedValueOnce(reply(401, JSON.stringify({ error: "invalid_client" })));
    expect(await refreshGoogleToken("rt-a", "cid", "secret", null)).toBeNull();
    proxyAwareFetch.mockResolvedValueOnce(reply(503, "Service Unavailable"));
    expect(await refreshGoogleToken("rt-b", "cid", "secret", null)).toBeNull();
  });
});
