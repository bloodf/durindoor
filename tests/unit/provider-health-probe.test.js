import { describe, expect, it, vi } from "vitest";
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

  it("Devin specialty probe routes through proxy-aware fetcher and forces redirect:manual", async () => {
    const calls = [];
    const fetcher = async (url, options) => {
      calls.push({ url: String(url), options });
      return { ok: true, status: 200, text: async () => "" };
    };
    const conn = { id: "dev1", provider: "devin", apiKey: "cog_token", providerSpecificData: {} };
    const result = await probeConnectionHealth(conn, { fetcher, proxyConfig: null });
    expect(result.valid).toBe(true);
    expect(result.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.devin.ai/v1/sessions?limit=1");
    expect(calls[0].options.redirect).toBe("manual");
    expect(calls[0].options.headers?.Authorization).toBe("Bearer cog_token");
  });

  it("Devin specialty probe uses Vercel relay when configured, leaving direct fetcher unused", async () => {
    const { __setOriginalFetchForTesting } = await import("../../open-sse/utils/proxyFetch.js");
    const relayCalls = [];
    const directSpy = vi.fn();
    const restore = __setOriginalFetchForTesting(async (url, options) => {
      relayCalls.push({ url: String(url), options });
      return { ok: true, status: 200, text: async () => "" };
    });
    try {
      const conn = { id: "dev1", provider: "devin", apiKey: "cog_token", providerSpecificData: {} };
      const result = await probeConnectionHealth(conn, {
        fetcher: directSpy,
        proxyConfig: { vercelRelayUrl: "https://relay.example.test" },
      });
      expect(result.valid).toBe(true);
      expect(directSpy).not.toHaveBeenCalled();
      expect(relayCalls).toHaveLength(1);
      expect(relayCalls[0].url).toBe("https://relay.example.test");
      const headers = relayCalls[0].options.headers instanceof Headers
        ? Object.fromEntries(relayCalls[0].options.headers.entries())
        : relayCalls[0].options.headers;
      expect(headers["x-relay-target"]).toBe("https://api.devin.ai");
      expect(headers["x-relay-path"]).toBe("/v1/sessions?limit=1");
      expect(headers.authorization).toBe("Bearer cog_token");
      expect(relayCalls[0].options.redirect).toBe("manual");
    } finally {
      restore();
    }
  });

  it("Devin specialty probe rejects 401 without leaking upstream error text", async () => {
    const fetcher = async () => ({ ok: false, status: 401, text: async () => "secret detail" });
    const conn = { id: "dev2", provider: "devin", apiKey: "bad", providerSpecificData: {} };
    const result = await probeConnectionHealth(conn, { fetcher, proxyConfig: null });
    expect(result.valid).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toBe("Invalid API key");
    expect(result.error).not.toContain("secret detail");
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

export {};
