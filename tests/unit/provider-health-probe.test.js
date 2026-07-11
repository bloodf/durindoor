import { describe, expect, it } from "vitest";
import { probeConnectionHealth } from "../../src/lib/providerHealthProbe.js";

const okFetch = (status = 200) => async () => ({ ok: status >= 200 && status < 300, status });

describe("probeConnectionHealth", () => {
  it("blocks a private OpenAI-compatible base URL via the SSRF guard", async () => {
    const conn = {
      id: "c1",
      provider: "openai-compatible-local",
      name: "evil",
      apiKey: "k",
      providerSpecificData: { baseUrl: "http://169.254.169.254/latest/meta-data" },
    };
    const result = await probeConnectionHealth(conn, { fetcher: okFetch(), proxyConfig: null });
    expect(result.blocked).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("classifies 401 as invalid (reachable, bad key) for OpenAI-compatible", async () => {
    const conn = {
      id: "c2",
      provider: "openai-compatible-pub",
      name: "pub",
      apiKey: "bad",
      providerSpecificData: { baseUrl: "https://example.com/v1" },
    };
    const result = await probeConnectionHealth(conn, { fetcher: okFetch(401), proxyConfig: null });
    expect(result.valid).toBe(false);
    expect(result.status).toBe(401);
  });

  it("treats 2xx from OpenAI-compatible /models as valid and forces redirect:manual", async () => {
    const calls = [];
    const fetcher = async (url, options) => { calls.push({ url: String(url), options }); return { ok: true, status: 200 }; };
    const conn = {
      id: "c3",
      provider: "openai-compatible-pub2",
      name: "pub2",
      apiKey: "k",
      providerSpecificData: { baseUrl: "https://example.com/v1" },
    };
    const result = await probeConnectionHealth(conn, { fetcher, proxyConfig: null });
    expect(result.valid).toBe(true);
    expect(result.status).toBe(200);
    // SSRF redirect protection: every probe fetch must forbid auto-follow so a
    // 3xx cannot bounce past the initial-URL guard to metadata/RFC1918.
    expect(calls[0].options.redirect).toBe("manual");
  });

  it("blocks a private Anthropic-compatible base URL via the SSRF guard", async () => {
    const fetcher = async () => { throw new Error("fetch must not be called for blocked URL"); };
    const conn = {
      id: "ac1",
      provider: "anthropic-compatible-evil",
      name: "evil",
      apiKey: "k",
      providerSpecificData: { baseUrl: "http://169.254.169.254/latest/meta-data" },
    };
    const result = await probeConnectionHealth(conn, { fetcher, proxyConfig: null });
    expect(result.blocked).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("blocks a private local OpenAI-compatible (lm-studio) base URL via the SSRF guard", async () => {
    const fetcher = async () => { throw new Error("fetch must not be called for blocked URL"); };
    const conn = {
      id: "ls1",
      provider: "lm-studio",
      name: "evil-lm",
      apiKey: "k",
      providerSpecificData: { baseUrl: "http://169.254.169.254/latest/meta-data" },
    };
    const result = await probeConnectionHealth(conn, { fetcher, proxyConfig: null });
    expect(result.blocked).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("blocks a private registry noAuth (auggie) base URL via the SSRF guard", async () => {
    // auggie's registry baseUrl is the non-HTTP auggie:// scheme (skipped by
    // httpProbeTarget); supplying a private HTTP baseUrl routes through
    // probeRegistryNoAuth, which must still be SSRF-guarded.
    const fetcher = async () => { throw new Error("fetch must not be called for blocked URL"); };
    const conn = {
      id: "ag1",
      provider: "auggie",
      name: "evil-aug",
      apiKey: "k",
      providerSpecificData: { baseUrl: "http://169.254.169.254/latest/meta-data" },
    };
    const result = await probeConnectionHealth(conn, { fetcher, proxyConfig: null });
    expect(result.blocked).toBe(true);
    expect(result.valid).toBe(false);
  });

  it("returns an error result for a connection with no probe target", async () => {
    const result = await probeConnectionHealth(null);
    expect(result.valid).toBe(false);
  });

  it("mimo-free probes the provider host origin, never the catalog modelsFetcher host", async () => {
    const seen = [];
    const fetcher = async (url) => { seen.push(String(url)); return { ok: true, status: 200 }; };
    const conn = { id: "m1", provider: "mimo-free", name: "mimo", providerSpecificData: {} };
    const result = await probeConnectionHealth(conn, { fetcher, proxyConfig: null });
    expect(result.valid).toBe(true);
    expect(seen[0]).toBe("https://api.xiaomimimo.com");
    expect(seen[0]).not.toContain("models.dev");
    expect(seen[0]).not.toContain("/chat/models");
  });

  it("mimo-free 5xx is reported down (reachable host, failing service)", async () => {
    const fetcher = async () => ({ ok: false, status: 503 });
    const conn = { id: "m1", provider: "mimo-free", name: "mimo", providerSpecificData: {} };
    const result = await probeConnectionHealth(conn, { fetcher, proxyConfig: null });
    expect(result.valid).toBe(false);
    expect(result.status).toBe(503);
  });

  it("auggie non-HTTP transport returns unconfigured, not healthy and not blocked", async () => {
    const fetcher = async () => { throw new Error("fetch must not be called for auggie://"); };
    const conn = { id: "a1", provider: "auggie", name: "auggie", providerSpecificData: {} };
    const result = await probeConnectionHealth(conn, { fetcher, proxyConfig: null });
    expect(result.blocked).not.toBe(true);
    expect(result.valid).toBe(false);
    expect(result.unconfigured).toBe(true);
  });
});
