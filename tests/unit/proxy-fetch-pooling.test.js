import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  it("reuses a bounded direct pool across requests", async () => {
    await Promise.all([
      proxyAwareFetch("https://first.example.test/a", {}, { disableEnvProxy: true }),
      proxyAwareFetch("https://second.example.test/b", {}, { disableEnvProxy: true }),
    ]);

    const firstDispatcher = fetchMock.mock.calls[0][1].dispatcher;
    const secondDispatcher = fetchMock.mock.calls[1][1].dispatcher;
    expect(firstDispatcher).toBe(secondDispatcher);
    expect(getDirectDispatcherOptionsForTest()).toMatchObject({
      connections: 32,
      keepAliveMaxTimeout: 60_000,
      maxCachedSessions: 16,
      pipelining: 1,
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
});
