import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __clearProxyDispatchersForTesting,
  __getProxyDispatcherCacheSnapshotForTesting,
  __setOriginalFetchForTesting,
  __setProxyDispatcherForTesting,
  proxyAwareFetch,
} from "../../open-sse/utils/proxyFetch.js";

describe("OAuth strict proxy transport", () => {
  let fetchMock;
  let restoreFetch;
  let originalHttpProxy;
  let originalHttpsProxy;

  beforeEach(() => {
    originalHttpProxy = process.env.HTTP_PROXY;
    originalHttpsProxy = process.env.HTTPS_PROXY;
    fetchMock = vi.fn().mockResolvedValue(new Response("ok"));
    restoreFetch = __setOriginalFetchForTesting(fetchMock);
    __clearProxyDispatchersForTesting();
  });

  afterEach(() => {
    restoreFetch?.();
    __clearProxyDispatchersForTesting();
    vi.restoreAllMocks();
    if (originalHttpProxy === undefined) delete process.env.HTTP_PROXY;
    else process.env.HTTP_PROXY = originalHttpProxy;
    if (originalHttpsProxy === undefined) delete process.env.HTTPS_PROXY;
    else process.env.HTTPS_PROXY = originalHttpsProxy;
  });

  it("fails before network access when a strict route has no usable proxy", async () => {
    process.env.HTTPS_PROXY = "http://ambient-proxy.example.test:8080";

    await expect(proxyAwareFetch(
      "https://provider.example.test/token",
      { method: "POST" },
      { disableEnvProxy: true, strictProxy: true },
    )).rejects.toThrow(/Proxy required but unavailable/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows explicit direct routing without inheriting an ambient proxy", async () => {
    process.env.HTTPS_PROXY = "http://ambient-proxy.example.test:8080";

    const response = await proxyAwareFetch(
      "https://provider.example.test/token",
      { method: "POST" },
      { disableEnvProxy: true, strictProxy: false },
    );

    expect(await response.text()).toBe("ok");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses the selected strict pool instead of ambient routing", async () => {
    process.env.HTTPS_PROXY = "http://ambient-proxy.example.test:8080";
    const response = await proxyAwareFetch(
      "https://provider.example.test/token",
      { method: "POST" },
      {
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://selected-proxy.example.test:8080",
        disableEnvProxy: true,
        strictProxy: true,
      },
    );

    expect(await response.text()).toBe("ok");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://provider.example.test/token",
      expect.objectContaining({ dispatcher: expect.any(Object) }),
    );
  });

  it("keys dispatchers by non-secret digests while keeping credentialed routes isolated", async () => {
    const firstDispatcher = { close: vi.fn().mockResolvedValue() };
    const secondDispatcher = { close: vi.fn().mockResolvedValue() };
    const firstProxy = "http://alice:first-secret@proxy.example.test:8080";
    const secondProxy = "http://alice:second-secret@proxy.example.test:8080";
    __setProxyDispatcherForTesting(firstProxy, firstDispatcher);
    __setProxyDispatcherForTesting(secondProxy, secondDispatcher);

    await proxyAwareFetch(
      "https://provider.example.test/token",
      { method: "POST" },
      { connectionProxyEnabled: true, connectionProxyUrl: firstProxy, disableEnvProxy: true },
    );
    await proxyAwareFetch(
      "https://provider.example.test/token",
      { method: "POST" },
      { connectionProxyEnabled: true, connectionProxyUrl: secondProxy, disableEnvProxy: true },
    );

    expect(fetchMock.mock.calls[0][1].dispatcher).toBe(firstDispatcher);
    expect(fetchMock.mock.calls[1][1].dispatcher).toBe(secondDispatcher);
    const snapshot = __getProxyDispatcherCacheSnapshotForTesting();
    expect(snapshot.size).toBe(2);
    expect(snapshot.keys).toEqual([
      expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    ]);
    expect(new Set(snapshot.keys).size).toBe(2);
    expect(JSON.stringify(snapshot)).not.toContain("alice");
    expect(JSON.stringify(snapshot)).not.toContain("first-secret");
    expect(JSON.stringify(snapshot)).not.toContain("second-secret");
  });

  it("does not expose a strict proxy failure cause containing credentials", async () => {
    const proxyUrl = "http://alice:proxy-secret@proxy.example.test:8080";
    __setProxyDispatcherForTesting(proxyUrl, { close: vi.fn().mockResolvedValue() });
    fetchMock.mockRejectedValueOnce(
      new Error("connect http://alice:proxy-secret@proxy.example.test:8080?token=raw-token"),
    );

    let failure;
    try {
      await proxyAwareFetch(
        "https://provider.example.test/token",
        { method: "POST" },
        {
          connectionProxyEnabled: true,
          connectionProxyUrl: proxyUrl,
          disableEnvProxy: true,
          strictProxy: true,
        },
      );
    } catch (error) {
      failure = error;
    }

    expect(failure?.message).toBe("[ProxyFetch] Proxy required but failed (strictProxy=true)");
    expect(failure?.message).not.toContain("proxy-secret");
    expect(failure?.message).not.toContain("raw-token");
  });

  it("redacts a best-effort proxy failure before debug logging and falling back", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const proxyUrl = "http://alice:proxy-secret@proxy.example.test:8080";
    __setProxyDispatcherForTesting(proxyUrl, { close: vi.fn().mockResolvedValue() });
    fetchMock
      .mockRejectedValueOnce(
        new Error("connect http://alice:proxy-secret@proxy.example.test:8080?token=raw-token"),
      )
      .mockResolvedValueOnce(new Response("direct"));

    const response = await proxyAwareFetch(
      "https://provider.example.test/token",
      { method: "POST" },
      { connectionProxyEnabled: true, connectionProxyUrl: proxyUrl, disableEnvProxy: true },
    );

    expect(await response.text()).toBe("direct");
    const output = debug.mock.calls.flat().join(" ");
    expect(warn).not.toHaveBeenCalled();
    expect(output).toContain("[redacted]");
    expect(output).not.toContain("proxy-secret");
    expect(output).not.toContain("raw-token");
  });

  it("does not block new routes while an evicted dispatcher is still streaming", async () => {
    const neverCloses = { close: vi.fn(() => new Promise(() => {})) };
    __setProxyDispatcherForTesting("http://proxy-0.example.test:8080", neverCloses);
    for (let index = 1; index < 20; index += 1) {
      __setProxyDispatcherForTesting(`http://proxy-${index}.example.test:8080`, {
        close: vi.fn().mockResolvedValue(),
      });
    }

    const response = await Promise.race([
      proxyAwareFetch(
        "https://provider.example.test/token",
        { method: "POST" },
        {
          connectionProxyEnabled: true,
          connectionProxyUrl: "http://proxy-new.example.test:8080",
          disableEnvProxy: true,
          strictProxy: true,
        },
      ),
      new Promise((_, reject) => setTimeout(
        () => reject(new Error("dispatcher eviction blocked")),
        250,
      )),
    ]);

    expect(await response.text()).toBe("ok");
    expect(neverCloses.close).toHaveBeenCalledOnce();
  });
});
