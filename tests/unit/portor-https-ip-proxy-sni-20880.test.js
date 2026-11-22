import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __clearProxyDispatchersForTesting,
  createIpProxyClient,
  proxyAwareFetch,
  __setOriginalFetchForTesting,
  __getProxyDispatcherCacheSnapshotForTesting,
} from "../../open-sse/utils/proxyFetch.js";

async function servernameSeenBy(requested) {
  const seen = [];
  const connect = vi.fn((params, callback) => {
    seen.push(params);
    callback(new Error("stop"));
  });
  const pool = createIpProxyClient(new URL("https://203.0.113.9:8443"), { connect });
  await pool.connect({ path: "api.example.test:443", servername: requested }).catch(() => {});
  await pool.destroy();
  return seen[0]?.servername;
}

describe("HTTPS proxy addressed by IP keeps working on Node 26 (port of OmniRoute #20880)", () => {
  afterEach(() => __clearProxyDispatchersForTesting());

  it("drops an IP-literal SNI but keeps a DNS-name SNI", async () => {
    expect(await servernameSeenBy("203.0.113.9")).toBeUndefined();
    expect(await servernameSeenBy("2001:db8::1")).toBeUndefined();
    expect(await servernameSeenBy("proxy.example.test")).toBe("proxy.example.test");
  });

  it("falls back to a plain Pool when no connector is supplied", () => {
    const pool = createIpProxyClient(new URL("https://203.0.113.9:8443"), {});
    expect(typeof pool.request).toBe("function");
    return pool.destroy();
  });

  it("builds the pooled proxy dispatcher for an https IP proxy", async () => {
    const restore = __setOriginalFetchForTesting(vi.fn(async () => new Response("ok")));
    try {
      await proxyAwareFetch("https://provider.example.test/", {}, {
        connectionProxyEnabled: true, connectionProxyUrl: "https://203.0.113.9:8443", disableEnvProxy: true
      });
      expect(__getProxyDispatcherCacheSnapshotForTesting().size).toBe(1);
    } finally {
      restore();
    }
  });
});
