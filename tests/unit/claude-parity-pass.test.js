// Closed-mock regression for OmniRoute 5ffa68e83544 Claude refresh errors.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", async (original) => ({
  ...(await original()),
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { refreshClaudeOAuthToken } from "../../open-sse/services/tokenRefresh/providers.js";
import { __clearRefreshDedupCacheForTesting } from "../../open-sse/services/tokenRefresh/dedup.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("Claude refresh error envelopes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __clearRefreshDedupCacheForTesting();
  });

  it.each([
    [JSON.stringify({ error: "invalid_request" }), "invalid_request"],
    [JSON.stringify({ error: { code: "invalid_request" } }), "invalid_request"],
    [JSON.stringify(JSON.stringify({ error: "invalid_grant" })), "invalid_grant"],
    ["invalid_request", "invalid_request"],
  ])("classifies %s as requiring sign-in", async (body, code) => {
    proxyAwareFetch.mockResolvedValue(new Response(body, { status: 400 }));
    expect(await refreshClaudeOAuthToken("mock-refresh")).toEqual({
      error: "unrecoverable_refresh_error", code,
    });
  });

  it("keeps a server failure transient", async () => {
    proxyAwareFetch.mockResolvedValue(new Response('{"error":"server_error"}', { status: 503 }));
    expect(await refreshClaudeOAuthToken("mock-refresh")).toBeNull();
  });

  it("does not mistake unrelated JSON metadata for a refresh error", async () => {
    proxyAwareFetch.mockResolvedValue(new Response('{"error":"server_error","debug":"invalid_request"}', { status: 503 }));
    expect(await refreshClaudeOAuthToken("mock-refresh")).toBeNull();
  });

  it("propagates permanent errors through the executor used by credential refresh", async () => {
    proxyAwareFetch.mockResolvedValue(new Response('{"error":{"code":"invalid_request"}}', { status: 400 }));
    const executor = new DefaultExecutor("claude");
    expect(await executor.refreshCredentials({ refreshToken: "mock-refresh" })).toEqual({
      error: "unrecoverable_refresh_error", code: "invalid_request",
    });
  });

  it("honors the bounded refresh rate-limit window for the same token", async () => {
    vi.useFakeTimers();
    try {
      proxyAwareFetch.mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "retry-after": "10" } }));
      proxyAwareFetch.mockResolvedValueOnce(Response.json({ access_token: "new" }));
      const executor = new DefaultExecutor("claude");
      expect(await executor.refreshCredentials({ refreshToken: "limited-refresh" })).toBeNull();
      expect(await executor.refreshCredentials({ refreshToken: "limited-refresh" })).toBeNull();
      expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10000);
      expect((await executor.refreshCredentials({ refreshToken: "limited-refresh" })).accessToken).toBe("new");
      expect(proxyAwareFetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
