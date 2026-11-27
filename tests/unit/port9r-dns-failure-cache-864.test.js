import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMORY_CONFIG } from "../../open-sse/config/runtimeConfig.js";
import {
  __resolveRealIPsForTesting as resolveRealIPs,
  __clearRealIpCacheForTesting as clearCache,
  __setOriginalFetchForTesting,
  __setProxyDispatcherForTesting,
  __clearProxyDispatchersForTesting,
  proxyAwareFetch,
} from "../../open-sse/utils/proxyFetch.js";

const host = "cloudcode-pa.googleapis.com";
const answer = () => Response.json({ Answer: [{ type: 1, data: "142.250.9.9" }] });

describe("MITM DNS failure cache (#864)", () => {
  beforeEach(() => {
    clearCache();
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
  });
  afterEach(() => {
    clearCache();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("caches a complete UDP/DoH failure for 60 seconds, then recovers", async () => {
    const udpResolve = vi.fn().mockRejectedValue(new Error("offline"));
    const dohFetch = vi.fn().mockRejectedValue(new Error("offline"));
    const options = { udpResolve, dohFetch };
    expect(await resolveRealIPs(host, options)).toEqual([]);
    expect(udpResolve).toHaveBeenCalledTimes(1);
    expect(dohFetch).toHaveBeenCalledTimes(2);

    udpResolve.mockResolvedValue(["142.250.1.1"]);
    vi.advanceTimersByTime(59_999);
    expect(await resolveRealIPs(host, options)).toEqual([]);
    expect(udpResolve).toHaveBeenCalledTimes(1);
    expect(dohFetch).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(1);
    expect(await resolveRealIPs(host, options)).toEqual(["142.250.1.1"]);
    expect(udpResolve).toHaveBeenCalledTimes(2);
    expect(dohFetch).toHaveBeenCalledTimes(2);
    expect(MEMORY_CONFIG.dnsFailCacheTtlMs).toBe(60_000);
  });

  it("keeps a recovered DoH answer for the positive TTL after UDP failure", async () => {
    const udpResolve = vi.fn().mockRejectedValue(new Error("UDP blocked"));
    const dohFetch = vi.fn().mockResolvedValueOnce(Response.json({ Answer: [] })).mockImplementation(answer);
    const options = { udpResolve, dohFetch };
    expect(await resolveRealIPs(host, options)).toEqual(["142.250.9.9"]);
    vi.advanceTimersByTime(60_001);
    expect(await resolveRealIPs(host, options)).toEqual(["142.250.9.9"]);
    expect(udpResolve).toHaveBeenCalledTimes(1);
    expect(dohFetch).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(MEMORY_CONFIG.dnsCacheTtlMs - 60_001);
    expect(await resolveRealIPs(host, options)).toEqual(["142.250.9.9"]);
    expect(udpResolve).toHaveBeenCalledTimes(2);
    expect(dohFetch).toHaveBeenCalledTimes(3);
  });

  it("does not suppress lookups for another intercepted host", async () => {
    const options = {
      udpResolve: vi.fn().mockResolvedValue([]),
      dohFetch: vi.fn(async () => Response.json({ Answer: [] })),
    };
    expect(await resolveRealIPs(host, options)).toEqual([]);
    expect(await resolveRealIPs("api.individual.githubcopilot.com", options)).toEqual([]);
    expect(options.udpResolve).toHaveBeenCalledTimes(2);
    expect(options.dohFetch).toHaveBeenCalledTimes(4);
  });

  it("keeps explicit proxy routing when a direct DNS failure is cached", async () => {
    expect(await resolveRealIPs(host, {
      udpResolve: async () => [],
      dohFetch: async () => Response.json({ Answer: [] }),
    })).toEqual([]);
    const dispatcher = {};
    const proxyUrl = "http://proxy.example.test:8080";
    const fetch = vi.fn(async () => new Response("proxied"));
    const restoreFetch = __setOriginalFetchForTesting(fetch);
    __setProxyDispatcherForTesting(proxyUrl, dispatcher);
    try {
      const response = await proxyAwareFetch(`https://${host}/test`, {}, {
        connectionProxyEnabled: true, connectionProxyUrl: proxyUrl, strictProxy: true,
      });
      expect(await response.text()).toBe("proxied");
      expect(fetch).toHaveBeenCalledExactlyOnceWith(`https://${host}/test`, { dispatcher, redirect: "error" });
    } finally {
      restoreFetch();
      __clearProxyDispatchersForTesting();
    }
  });
});
