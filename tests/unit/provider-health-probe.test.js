import { describe, expect, it, vi } from "vitest";
import { fetch as undiciFetch } from "undici";

const dnsLookup = vi.hoisted(() => vi.fn());
vi.mock("node:dns", () => ({ lookup: (...args) => dnsLookup(...args) }));

import { probeConnectionHealth } from "../../src/lib/providerHealthProbe.js";

const okFetch = (status = 200) => async () => ({ ok: status >= 200 && status < 300, status });


function rebindToMetadata() {
  dnsLookup.mockImplementation((_hostname, _options, callback) => callback(null, [
    { address: "169.254.169.254", family: 4 },
  ]));
}
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

  it.each([
    ["OpenAI-compatible", {
      id: "dns-openai",
      provider: "openai-compatible-rebind",
      apiKey: "k",
      providerSpecificData: { baseUrl: "http://rebind.example.test/v1" },
    }],
    ["Anthropic-compatible", {
      id: "dns-anthropic",
      provider: "anthropic-compatible-rebind",
      apiKey: "k",
      providerSpecificData: { baseUrl: "http://rebind.example.test/v1" },
    }],
    ["local OpenAI-compatible", {
      id: "dns-local",
      provider: "lm-studio",
      apiKey: "k",
      providerSpecificData: { baseUrl: "http://rebind.example.test/v1" },
    }],
    ["registry no-auth", {
      id: "dns-noauth",
      provider: "auggie",
      apiKey: "k",
      providerSpecificData: { baseUrl: "http://rebind.example.test/v1" },
    }],
  ])("blocks DNS rebinding in the %s health-probe sink", async (_name, connection) => {
    rebindToMetadata();

    const result = await probeConnectionHealth(connection, {
      fetcher: undiciFetch,
      proxyConfig: null,
    });

    expect(result).toMatchObject({ valid: false, status: null, blocked: true });
    expect(dnsLookup).toHaveBeenCalledWith(
      "rebind.example.test",
      expect.objectContaining({ all: true, verbatim: true }),
      expect.any(Function),
    );
  });

  it.each([
    ["saved proxy", {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.example.test:8080",
    }],
    ["relay", { vercelRelayUrl: "https://relay.example.test" }],
  ])("fails closed before remote DNS in the proxied registry-health %s branch", async (_name, proxyConfig) => {
    const directFetcher = vi.fn();
    const connection = {
      id: "dns-proxied-registry",
      provider: "openai",
      apiKey: "k",
      providerSpecificData: { baseUrl: "http://rebind.example.test/v1" },
    };

    const result = await probeConnectionHealth(connection, { fetcher: directFetcher, proxyConfig });

    expect(result).toMatchObject({ valid: false, status: null, blocked: true });
    expect(directFetcher).not.toHaveBeenCalled();
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

  it("normalizes Anthropic-compatible base URL to avoid double /v1", async () => {
    const calls = [];
    const fetcher = async (url) => { calls.push(String(url)); return { ok: true, status: 200 }; };
    const conn = {
      id: "ac-url",
      provider: "anthropic-compatible-norm",
      name: "norm",
      apiKey: "k",
      providerSpecificData: { baseUrl: "https://api.anthropic.com/v1" },
    };
    const result = await probeConnectionHealth(conn, { fetcher, proxyConfig: null });
    expect(result.valid).toBe(true);
    expect(calls[0]).toBe("https://api.anthropic.com/v1/messages");
  });

  it("normalizes Anthropic-compatible base URL ending in /messages", async () => {
    const calls = [];
    const fetcher = async (url) => { calls.push(String(url)); return { ok: true, status: 200 }; };
    const conn = {
      id: "ac-msg",
      provider: "anthropic-compatible-msg",
      name: "msg",
      apiKey: "k",
      providerSpecificData: { baseUrl: "https://api.anthropic.com/v1/messages" },
    };
    const result = await probeConnectionHealth(conn, { fetcher, proxyConfig: null });
    expect(result.valid).toBe(true);
    expect(calls[0]).toBe("https://api.anthropic.com/v1/messages");
  });

  it("marks OpenAI-compatible missing base URL as unconfigured", async () => {
    const result = await probeConnectionHealth(
      { id: "o-miss", provider: "openai-compatible-miss", name: "miss", apiKey: "k", providerSpecificData: {} },
      { fetcher: okFetch(), proxyConfig: null },
    );
    expect(result.unconfigured).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.status).toBeNull();
  });

  it("marks Anthropic-compatible missing base URL as unconfigured", async () => {
    const result = await probeConnectionHealth(
      { id: "ac-miss", provider: "anthropic-compatible-miss", name: "miss", apiKey: "k", providerSpecificData: {} },
      { fetcher: okFetch(), proxyConfig: null },
    );
    expect(result.unconfigured).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.status).toBeNull();
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

  it("Devin specialty probe fails closed when a Vercel relay would replace its guard", async () => {
    const { __setOriginalFetchForTesting } = await import("../../open-sse/utils/proxyFetch.js");
    const relaySpy = vi.fn();
    const directSpy = vi.fn();
    const restore = __setOriginalFetchForTesting(relaySpy);
    try {
      const conn = { id: "dev1", provider: "devin", apiKey: "cog_token", providerSpecificData: {} };
      const result = await probeConnectionHealth(conn, {
        fetcher: directSpy,
        proxyConfig: { vercelRelayUrl: "https://relay.example.test" },
      });
      expect(result).toMatchObject({ valid: false, status: null, blocked: true });
      expect(directSpy).not.toHaveBeenCalled();
      expect(relaySpy).not.toHaveBeenCalled();
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
