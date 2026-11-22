import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROXY_DISPATCHER_EVICT_THRESHOLD,
  PROXY_DISPATCHER_FAILURE_WINDOW_MS,
  MAX_PROXY_FAILURE_STREAKS,
  recordProxyDispatcherFailure,
  recordProxyDispatcherSuccess,
  __proxyFailureStreakSizeForTest,
  __resetProxyDispatcherFailuresForTest,
} from "../../open-sse/utils/proxyDispatcherFailures.js";
import {
  __clearProxyDispatchersForTesting,
  __getProxyDispatcherCacheSnapshotForTesting,
  __setOriginalFetchForTesting,
  __setProxyDispatcherForTesting,
  proxyAwareFetch,
} from "../../open-sse/utils/proxyFetch.js";

describe("per-proxy failure streaks (port of OmniRoute #20877)", () => {
  beforeEach(() => __resetProxyDispatcherFailuresForTest());

  it("signals eviction at the threshold and resets on success", () => {
    for (let i = 1; i < PROXY_DISPATCHER_EVICT_THRESHOLD; i++) expect(recordProxyDispatcherFailure("p", 1000 + i)).toBe(false);
    recordProxyDispatcherSuccess("p");
    expect(recordProxyDispatcherFailure("p", 2000)).toBe(false);
    expect(recordProxyDispatcherFailure("p", 2001)).toBe(false);
    expect(recordProxyDispatcherFailure("p", 2002)).toBe(true);
  });

  it("forgets failures older than the window", () => {
    recordProxyDispatcherFailure("p", 0);
    recordProxyDispatcherFailure("p", 1);
    expect(recordProxyDispatcherFailure("p", PROXY_DISPATCHER_FAILURE_WINDOW_MS + 10)).toBe(false);
  });

  it("bounds the number of tracked proxies", () => {
    for (let i = 0; i < MAX_PROXY_FAILURE_STREAKS + 50; i++) recordProxyDispatcherFailure(`p${i}`, 5);
    expect(__proxyFailureStreakSizeForTest()).toBeLessThanOrEqual(MAX_PROXY_FAILURE_STREAKS);
  });
});

describe("proxyAwareFetch evicts a repeatedly failing proxy dispatcher", () => {
  const proxyUrl = "http://flaky-proxy.example.test:8080";
  const config = { connectionProxyEnabled: true, connectionProxyUrl: proxyUrl, disableEnvProxy: true };
  let restore;

  beforeEach(() => {
    __resetProxyDispatcherFailuresForTest();
    __clearProxyDispatchersForTesting();
  });
  afterEach(() => {
    restore?.();
    __clearProxyDispatchersForTesting();
  });

  it("closes and drops the cached dispatcher after repeated 504s, then keeps it after a success", async () => {
    const dispatcher = { close: vi.fn().mockResolvedValue(undefined) };
    __setProxyDispatcherForTesting(proxyUrl, dispatcher, { evictable: true });
    restore = __setOriginalFetchForTesting(vi.fn(async () => new Response("gateway", { status: 504 })));

    for (let i = 0; i < PROXY_DISPATCHER_EVICT_THRESHOLD; i++) {
      expect(__getProxyDispatcherCacheSnapshotForTesting().size).toBe(1);
      await proxyAwareFetch("https://provider.example.test/", {}, config);
    }
    expect(dispatcher.close).toHaveBeenCalledTimes(1);
    expect(__getProxyDispatcherCacheSnapshotForTesting().size).toBe(0);
    restore();

    const healthy = { close: vi.fn() };
    __setProxyDispatcherForTesting(proxyUrl, healthy, { evictable: true });
    restore = __setOriginalFetchForTesting(vi.fn(async () => new Response("ok")));
    for (let i = 0; i < PROXY_DISPATCHER_EVICT_THRESHOLD + 2; i++) await proxyAwareFetch("https://provider.example.test/", {}, config);
    expect(healthy.close).not.toHaveBeenCalled();
    expect(__getProxyDispatcherCacheSnapshotForTesting().size).toBe(1);
  });
});
