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

  it("honors an explicit proxy adapter and never replays its failure directly", async () => {
    const direct = vi.fn();
    const proxy = "http://selected-proxy.example.test:8080";
    const url = "https://provider.example.test/";
    direct.withProxy = vi.fn(async (_url, _options, _proxy, dispatch) =>
      dispatch(async () => new Response("proxied"))
    );
    const config = { connectionProxyEnabled: true, connectionProxyUrl: proxy, strictProxy: true };
    const response = await proxyAwareFetch(url, { directFetch: direct }, config);
    expect(await response.text()).toBe("proxied");
    expect(direct.withProxy).toHaveBeenCalledWith(url, expect.objectContaining({ redirect: "error" }), proxy, expect.any(Function));
    expect(direct).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    direct.withProxy.mockRejectedValueOnce(new Error("connection failed"));
    await expect(proxyAwareFetch(url, { directFetch: direct }, config)).rejects.toThrow("strictProxy=true");
    expect(direct).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
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
