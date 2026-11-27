import { describe, expect, it, vi } from "vitest";
import { buildRegistryProviderProbe, probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";

// AI/ML API serves GET /v1/models without authentication, so a models probe
// answers 200 for any key. GET /v1/key returns 401 for a bad key.
const KEY_URL = "https://api.aimlapi.com/v1/key";

describe("upstream 9router #5882 - AI/ML API key validation uses /v1/key", () => {
  it("probes the key endpoint instead of the public model list", () => {
    const probe = buildRegistryProviderProbe("aimlapi", "test-key");
    expect(probe.url).toBe(KEY_URL);
    expect(probe.options.headers.Authorization).toBe("Bearer test-key");
    expect(probe.accepts).toBe("ok");
  });

  it("rejects a key the provider refuses even though /v1/models is public", async () => {
    const fetcher = vi.fn(async (url) => {
      const href = String(url);
      if (href.endsWith("/v1/models")) return new Response("{\"data\":[]}", { status: 200 });
      if (href === KEY_URL) return new Response("{\"error\":\"unauthorized\"}", { status: 401 });
      return new Response("{}", { status: 401 });
    });
    const result = await probeRegistryProvider("aimlapi", "bad-key", fetcher);
    expect(result.valid).toBe(false);
    expect(fetcher.mock.calls.map(([url]) => String(url))).not.toContain("https://api.aimlapi.com/v1/models");
  });

  it("accepts a key the key endpoint confirms", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    const result = await probeRegistryProvider("aimlapi", "good-key", fetcher);
    expect(result.valid).toBe(true);
    expect(String(fetcher.mock.calls[0][0])).toBe(KEY_URL);
  });
});
