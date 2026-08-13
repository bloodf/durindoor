import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROXY_FETCH_POOL_CONFIG } from "../../open-sse/config/runtimeConfig.js";

import {
  __clearProxyDispatchersForTesting,
  __setOriginalFetchForTesting,
  getDirectDispatcherOptionsForTest,
  proxyAwareFetch,
} from "../../open-sse/utils/proxyFetch.js";

describe("proxyFetch connection pooling", () => {
  let fetchMock;
  let restoreFetch;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    restoreFetch = __setOriginalFetchForTesting(fetchMock);
    __clearProxyDispatchersForTesting();
  });

  afterEach(() => {
    restoreFetch?.();
    __clearProxyDispatchersForTesting();
    vi.restoreAllMocks();
  });

  it("reuses one direct dispatcher beyond the configured connection cap", async () => {
    const requestCount = PROXY_FETCH_POOL_CONFIG.directConnectionsPerOrigin + 1;

    await Promise.all(Array.from({ length: requestCount }, (_, index) =>
      proxyAwareFetch(`https://provider.example.test/${index}`, {}, { disableEnvProxy: true })
    ));

    const dispatchers = fetchMock.mock.calls.map(([, options]) => options.dispatcher);
    expect(fetchMock).toHaveBeenCalledTimes(requestCount);
    expect(new Set(dispatchers)).toHaveLength(1);
    expect(getDirectDispatcherOptionsForTest()).toMatchObject({
      connections: PROXY_FETCH_POOL_CONFIG.directConnectionsPerOrigin,
      keepAliveMaxTimeout: PROXY_FETCH_POOL_CONFIG.keepAliveMaxTimeoutMs,
      maxCachedSessions: PROXY_FETCH_POOL_CONFIG.directMaxCachedSessions,
      pipelining: PROXY_FETCH_POOL_CONFIG.pipelining,
    });
  });

  it("reuses the selected proxy pool instead of the direct pool under concurrency", async () => {
    const proxyUrl = "http://selected-proxy.example.test:8080";
    const proxyOptions = {
      connectionProxyEnabled: true,
      connectionProxyUrl: proxyUrl,
      disableEnvProxy: true,
    };

    await Promise.all([
      proxyAwareFetch("https://provider.example.test/first", {}, proxyOptions),
      proxyAwareFetch("https://provider.example.test/second", {}, proxyOptions),
    ]);

    const firstDispatcher = fetchMock.mock.calls[0][1].dispatcher;
    const secondDispatcher = fetchMock.mock.calls[1][1].dispatcher;
    expect(firstDispatcher).toBe(secondDispatcher);
  });

  it("keeps direct and proxy traffic on distinct dispatchers", async () => {
    const proxyOptions = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://selected-proxy.example.test:8080",
      disableEnvProxy: true,
    };

    await Promise.all([
      proxyAwareFetch("https://provider.example.test/direct", {}, { disableEnvProxy: true }),
      proxyAwareFetch("https://provider.example.test/proxied", {}, proxyOptions),
    ]);

    const directDispatcher = fetchMock.mock.calls[0][1].dispatcher;
    const proxyDispatcher = fetchMock.mock.calls[1][1].dispatcher;
    expect(directDispatcher).not.toBe(proxyDispatcher);
  });
});
