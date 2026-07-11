import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __clearRefreshDedupCacheForTesting,
  __getRefreshDedupCacheSnapshotForTesting,
  dedupRefresh,
  proxyRouteFingerprint,
} from "../../open-sse/services/tokenRefresh/dedup.js";
import {
  __clearCredentialRefreshLocksForTesting,
  __getCredentialRefreshLockSnapshotForTesting,
  withCredentialRefreshLock,
} from "../../open-sse/services/oauthCredentialManager.js";
import { refreshClaudeOAuthToken } from "../../open-sse/services/tokenRefresh/providers.js";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";

describe("OAuth refresh cache security", () => {
  let restoreFetch;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
    __clearRefreshDedupCacheForTesting();
    __clearCredentialRefreshLocksForTesting();
  });

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
    __clearRefreshDedupCacheForTesting();
    __clearCredentialRefreshLocksForTesting();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps refresh tokens and proxy credentials out of de-duplication keys", async () => {
    const refreshToken = "refresh-super-secret";
    const proxyUrl = "http://alice:proxy-password@proxy.example.test:8080";

    await dedupRefresh(
      "codex",
      refreshToken,
      async () => ({ accessToken: "new-token" }),
      null,
      { connectionProxyEnabled: true, connectionProxyUrl: proxyUrl, strictProxy: true },
    );

    const snapshot = __getRefreshDedupCacheSnapshotForTesting();
    expect(snapshot.keys).toEqual([expect.stringMatching(/^sha256:[a-f0-9]{64}$/)]);
    expect(JSON.stringify(snapshot)).not.toContain(refreshToken);
    expect(JSON.stringify(snapshot)).not.toContain("alice");
    expect(JSON.stringify(snapshot)).not.toContain("proxy-password");
    expect(proxyRouteFingerprint({ connectionProxyUrl: proxyUrl })).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("isolates identical token refreshes by route while sharing one route", async () => {
    const calls = [];
    const routeA = { connectionProxyEnabled: true, connectionProxyUrl: "http://a.example.test:8080" };
    const routeB = { connectionProxyEnabled: true, connectionProxyUrl: "http://b.example.test:8080" };

    const [first, shared, isolated] = await Promise.all([
      dedupRefresh("codex", "same-token", async () => {
        calls.push("a");
        return "route-a";
      }, null, routeA),
      dedupRefresh("codex", "same-token", async () => {
        calls.push("a-duplicate");
        return "unexpected";
      }, null, routeA),
      dedupRefresh("codex", "same-token", async () => {
        calls.push("b");
        return "route-b";
      }, null, routeB),
    ]);

    expect([first, shared, isolated]).toEqual(["route-a", "route-a", "route-b"]);
    expect(calls).toEqual(["a", "b"]);
  });

  it("automatically expires completed refresh results", async () => {
    await dedupRefresh("codex", "expiring-token", async () => "ok");
    const initial = __getRefreshDedupCacheSnapshotForTesting();
    expect(initial.size).toBe(1);

    await vi.advanceTimersByTimeAsync(initial.resultTtlMs);

    expect(__getRefreshDedupCacheSnapshotForTesting().size).toBe(0);
  });

  it("caps refresh de-duplication state under high-cardinality inputs", async () => {
    const { maxSize } = __getRefreshDedupCacheSnapshotForTesting();
    for (let index = 0; index < maxSize + 5; index += 1) {
      await dedupRefresh("codex", `token-${index}`, async () => index);
    }

    const snapshot = __getRefreshDedupCacheSnapshotForTesting();
    expect(snapshot.size).toBe(maxSize);
    expect(snapshot.keys.every((key) => /^sha256:[a-f0-9]{64}$/.test(key))).toBe(true);
  });

  it("uses opaque, automatically expiring credential refresh lock keys", async () => {
    let resolveRefresh;
    const refreshToken = "lock-refresh-secret";
    const proxyUrl = "http://lock-user:lock-password@proxy.example.test:8080";
    const pending = withCredentialRefreshLock(
      "codex",
      { refreshToken },
      () => new Promise((resolve) => { resolveRefresh = resolve; }),
      { connectionProxyEnabled: true, connectionProxyUrl: proxyUrl },
    );
    await Promise.resolve();

    const snapshot = __getCredentialRefreshLockSnapshotForTesting();
    expect(snapshot.keys).toEqual([expect.stringMatching(/^sha256:[a-f0-9]{64}$/)]);
    expect(JSON.stringify(snapshot)).not.toContain(refreshToken);
    expect(JSON.stringify(snapshot)).not.toContain("lock-password");

    await vi.advanceTimersByTimeAsync(snapshot.ttlMs);
    expect(__getCredentialRefreshLockSnapshotForTesting().size).toBe(0);
    resolveRefresh("done");
    await expect(pending).resolves.toBe("done");
  });

  it("redacts upstream response secrets before refresh errors reach logs", async () => {
    const responseBody = JSON.stringify({
      error: "invalid_request",
      refresh_token: "body-refresh-secret",
      detail: "connect http://bob:proxy-pass@proxy.example.test:8080?token=query-secret",
    });
    restoreFetch = __setOriginalFetchForTesting(
      vi.fn().mockResolvedValue(new Response(responseBody, { status: 400 })),
    );
    const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };

    await expect(refreshClaudeOAuthToken(
      "request-refresh-secret",
      log,
      { disableEnvProxy: true },
    )).resolves.toBeNull();

    const output = JSON.stringify(log.error.mock.calls);
    expect(output).toContain("[redacted]");
    expect(output).not.toContain("body-refresh-secret");
    expect(output).not.toContain("proxy-pass");
    expect(output).not.toContain("query-secret");
  });
});
