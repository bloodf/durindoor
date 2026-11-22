import { describe, it, expect, vi, beforeEach } from "vitest";

// 9router PR #1821: OpenAI's token endpoint rejects a dead Codex refresh token
// with HTTP 401 {error:{code:"token_expired"}}. That must surface re-auth
// (unrecoverable_refresh_error), not be retried as a transient failure.

const proxyAwareFetch = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch }));

const { classifyOAuthRefreshError, refreshCodexToken } = await import("../../open-sse/services/tokenRefresh/providers.js");
const { __clearRefreshDedupCacheForTesting } = await import("../../open-sse/services/tokenRefresh/dedup.js");

const OPENAI_401 = JSON.stringify({
  error: {
    message: "Could not validate your token. Please try signing in again.",
    type: "invalid_request_error",
    code: "token_expired",
  },
});

describe("OAuth refresh 401 / token_expired is permanent (9router #1821)", () => {
  beforeEach(() => {
    proxyAwareFetch.mockReset();
    __clearRefreshDedupCacheForTesting();
  });

  it("classifies OpenAI's 401 token_expired body as permanent", () => {
    const result = classifyOAuthRefreshError(OPENAI_401, 401);
    expect(result.code).toBe("token_expired");
    expect(result.permanent).toBe(true);
  });

  it("treats any 401 from the token endpoint as permanent", () => {
    expect(classifyOAuthRefreshError("Unauthorized", 401).permanent).toBe(true);
  });

  it("treats a token_expired marker as permanent even without a 401", () => {
    expect(classifyOAuthRefreshError(OPENAI_401, 400).permanent).toBe(true);
  });

  it("keeps 429 and 5xx transient", () => {
    expect(classifyOAuthRefreshError('{"error":"rate_limited"}', 429).permanent).toBe(false);
    expect(classifyOAuthRefreshError("upstream unavailable", 503).permanent).toBe(false);
  });

  it("refreshCodexToken returns unrecoverable_refresh_error on 401 token_expired", async () => {
    proxyAwareFetch.mockResolvedValue({ ok: false, status: 401, text: async () => OPENAI_401 });
    const result = await refreshCodexToken("dead-refresh-token-1821", null);
    expect(result).toEqual({ error: "unrecoverable_refresh_error", code: "token_expired" });
  });
});
