import { afterEach, describe, expect, it, vi } from "vitest";
import { __clearRefreshDedupCacheForTesting, dedupRefresh } from "../../open-sse/services/tokenRefresh/dedup.js";
import { refreshWithRetry } from "../../open-sse/services/tokenRefresh.js";
import { mergeRefreshedCredentials, shouldRefreshCredentials } from "../../open-sse/services/oauthCredentialManager.js";
import * as serverUtils from "../../src/lib/oauth/utils/server.js";
import * as refreshWrapper from "../../src/sse/services/tokenRefresh.js";

afterEach(() => {
  __clearRefreshDedupCacheForTesting();
  vi.useRealTimers();
});

describe("refresh state regressions", () => {
  it("retries a null refresh with a new call and reuses the success", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn().mockResolvedValueOnce(null).mockResolvedValue({ accessToken: "new" });
    const call = () => dedupRefresh("test", "token", refresh);
    const result = refreshWithRetry(call);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toEqual({ accessToken: "new" });
    await call();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("does not cache thrown refresh failures", async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error("temporary")).mockResolvedValue("ok");
    await expect(dedupRefresh("test", "token", refresh)).rejects.toThrow("temporary");
    await expect(dedupRefresh("test", "token", refresh)).resolves.toBe("ok");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("only retains explicit permanent error results", async () => {
    const transient = vi.fn().mockResolvedValue({ error: "temporarily_unavailable" });
    await dedupRefresh("test", "transient", transient);
    await dedupRefresh("test", "transient", transient);
    expect(transient).toHaveBeenCalledTimes(2);
    const permanent = vi.fn().mockResolvedValue({ error: "invalid_grant" });
    await dedupRefresh("test", "permanent", permanent);
    await dedupRefresh("test", "permanent", permanent);
    expect(permanent).toHaveBeenCalledTimes(1);
  });

  it("replaces an old expiry with a one-hour horizon when refresh omits expiry", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const current = { accessToken: "old", expiresAt: new Date(now - 1000).toISOString() };
    const merged = { ...current, ...mergeRefreshedCredentials("test", current, { accessToken: "new" }, now) };
    expect(merged.expiresAt).toBe(new Date(now + 3600_000).toISOString());
    expect(shouldRefreshCredentials("test", merged, now)).toBe(false);
  });

  it("does not expose the unusable callback helper or unused wrapper exports", () => {
    expect(serverUtils).not.toHaveProperty("waitForCallback");
    expect(refreshWrapper).not.toHaveProperty("getAllAccessTokens");
    expect(refreshWrapper).not.toHaveProperty("formatProviderCredentials");
  });
});
