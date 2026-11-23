import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshKimiToken } from "open-sse/services/tokenRefresh/providers.js";
import { __clearRefreshDedupCacheForTesting } from "open-sse/services/tokenRefresh/dedup.js";
import { __setOriginalFetchForTesting } from "open-sse/utils/proxyFetch.js";

let restoreFetch;
afterEach(() => {
  restoreFetch?.();
  __clearRefreshDedupCacheForTesting();
  vi.restoreAllMocks();
});

describe.each(["kimi-coding", "kimi-ai"])("%s refresh parity", (provider) => {
  it.each(["invalid_grant", "invalid_request"])("classifies %s as permanent", async (code) => {
    restoreFetch = __setOriginalFetchForTesting(vi.fn(async () => Response.json({ error: code }, { status: 400 })));
    expect(await refreshKimiToken(provider, { refreshToken: `token-${code}` })).toEqual({
      error: "unrecoverable_refresh_error", code,
    });
  });

  it.each([
    { access_token: " " },
    { access_token: 42 },
    { access_token: "valid", refresh_token: " " },
    { access_token: "valid", refresh_token: {} },
  ])("rejects malformed successful credentials %#", async (tokens) => {
    restoreFetch = __setOriginalFetchForTesting(vi.fn(async () => Response.json(tokens)));
    expect(await refreshKimiToken(provider, { refreshToken: "old-token" })).toBeNull();
  });

  it("retains the old refresh token when rotation is omitted", async () => {
    restoreFetch = __setOriginalFetchForTesting(vi.fn(async () => Response.json({ access_token: "new" })));
    expect(await refreshKimiToken(provider, { refreshToken: "old-token" })).toMatchObject({
      accessToken: "new", refreshToken: "old-token",
    });
  });
});
