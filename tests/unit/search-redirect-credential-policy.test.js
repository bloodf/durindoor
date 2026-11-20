/**
 * Redirect-hop credential binding for /v1/search (DurinDoor #1073 follow-up).
 *
 * The shipped policy (unit/search-credential-destination-1073.test.js) decides
 * WHERE a stored search credential may go before the request is dispatched.
 * A redirect is a second destination: the provider answers 30x and the same
 * headers — the stored key included — ride along to the new host. The
 * destination decision was not applied to that hop, so an authorized provider
 * could hand the stored credential to any host it named.
 *
 * This suite pins the invariant: the credential only reaches a destination the
 * administrator authorized for this connection, redirect or not.
 *
 * Policy-level only: predeclared synthetic destinations (RFC 5737
 * documentation addresses and a documentation hostname), a synthetic
 * non-secret credential value, a stubbed fetch, no server, no outbound
 * traffic, no real provider and no real credentials. Nothing here reproduces
 * an exposure or proves an exploit.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleSearchCore } from "../../open-sse/handlers/search/index.js";
import {
  SearchCredentialRedirectError,
  assertSearchCredentialRedirectBinding
} from "../../open-sse/handlers/search/baseUrl.js";

// Synthetic, non-secret fixtures.
const STORED_KEY = "fixture-operator-key-1073";

// Predeclared synthetic destinations. The two IP literals are RFC 5737
// documentation addresses (TEST-NET-2 / TEST-NET-3): public literals, so the
// public-only egress guard accepts them without any DNS resolution. The
// hostname is a reserved documentation name and never resolves.
const REGISTRY_ENDPOINT = "https://api.search.brave.com/res/v1";
const OPERATOR_ENDPOINT = "https://198.51.100.20/search";
const FOREIGN_ENDPOINT = "https://203.0.113.99/collect";

const KEYED_PROVIDER = {
  id: "brave-search",
  authType: "apikey",
  method: "GET",
  baseUrl: REGISTRY_ENDPOINT
};

const KEYLESS_PROVIDER = {
  id: "searxng",
  authType: "none",
  method: "GET",
  baseUrl: "https://searxng.example.com"
};

const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
  status: 200,
  headers: { "Content-Type": "application/json" }
});

const redirectResponse = (location) => new Response(null, {
  status: 302,
  headers: { Location: location }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("trusted (registry) destination", () => {
  it("refuses a redirect that would carry the stored credential to another destination", async () => {
    const fetchSpy = vi.fn(async () => redirectResponse(FOREIGN_ENDPOINT));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await handleSearchCore({
      body: { query: "durindoor" },
      provider: { id: "brave-search" },
      providerConfig: KEYED_PROVIDER,
      credentials: { apiKey: STORED_KEY }
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toMatch(/not an authorized destination/i);
    // The refusal must not echo the credential it is protecting.
    expect(result.error).not.toContain(STORED_KEY);
    // The unauthorized destination was never dispatched.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("api.search.brave.com");
    for (const [calledUrl] of fetchSpy.mock.calls) {
      expect(String(calledUrl)).not.toContain("203.0.113.99");
    }
  });

  it("keeps a redirect that stays on the authorized destination", async () => {
    let hop = 0;
    const fetchSpy = vi.fn(async () => {
      hop += 1;
      if (hop === 1) return redirectResponse(`${REGISTRY_ENDPOINT}/web/search?count=5&q=durindoor`);
      return jsonResponse({ web: { results: [] } });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await handleSearchCore({
      body: { query: "durindoor" },
      provider: { id: "brave-search" },
      providerConfig: KEYED_PROVIDER,
      credentials: { apiKey: STORED_KEY }
    });

    expect(result.success, result.error).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const [calledUrl] of fetchSpy.mock.calls) {
      expect(String(calledUrl)).toContain("api.search.brave.com");
    }
  });

  it("keeps the keyless trusted path on the platform's own redirect handling", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ results: [] }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await handleSearchCore({
      body: { query: "durindoor" },
      provider: { id: "searxng" },
      providerConfig: KEYLESS_PROVIDER,
      credentials: null
    });

    expect(result.success, result.error).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // No credential travels, so the trusted path is not switched to the
    // hop-by-hop dispatcher.
    expect(fetchSpy.mock.calls[0][1]?.redirect).not.toBe("manual");
  });

  it("keeps the provider's no-redirect policy on the trusted path", async () => {
    const fetchSpy = vi.fn(async () => redirectResponse(FOREIGN_ENDPOINT));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await handleSearchCore({
      body: { query: "durindoor" },
      provider: { id: "brave-search" },
      providerConfig: { ...KEYED_PROVIDER, preventRedirects: true },
      credentials: { apiKey: STORED_KEY }
    });

    expect(result.success).toBe(false);
    // The redirect response is surfaced, not followed.
    expect(result.error).toMatch(/302/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("operator-configured destination", () => {
  it("refuses a redirect that would carry the stored credential to another destination", async () => {
    const fetchSpy = vi.fn(async () => redirectResponse(FOREIGN_ENDPOINT));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await handleSearchCore({
      body: { query: "durindoor" },
      provider: { id: "brave-search" },
      providerConfig: KEYED_PROVIDER,
      credentials: { apiKey: STORED_KEY, providerSpecificData: { baseUrl: OPERATOR_ENDPOINT } }
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toMatch(/not an authorized destination/i);
    expect(result.error).not.toContain(STORED_KEY);
    // Only the operator destination was dispatched; the foreign one was not.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("198.51.100.20");
  });

  it("keeps a redirect that stays on the operator destination", async () => {
    let hop = 0;
    const fetchSpy = vi.fn(async () => {
      hop += 1;
      if (hop === 1) return redirectResponse(`${OPERATOR_ENDPOINT}/web/search?count=5&q=durindoor`);
      return jsonResponse({ web: { results: [] } });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await handleSearchCore({
      body: { query: "durindoor" },
      provider: { id: "brave-search" },
      providerConfig: KEYED_PROVIDER,
      credentials: { apiKey: STORED_KEY, providerSpecificData: { baseUrl: OPERATOR_ENDPOINT } }
    });

    expect(result.success, result.error).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const [calledUrl] of fetchSpy.mock.calls) {
      expect(String(calledUrl)).toContain("198.51.100.20");
    }
  });
});

describe("caller-selected destination", () => {
  it("is still refused before any dispatch for a credential-bearing provider", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await handleSearchCore({
      body: { query: "durindoor", provider_options: { baseUrl: FOREIGN_ENDPOINT } },
      provider: { id: "brave-search" },
      providerConfig: KEYED_PROVIDER,
      credentials: { apiKey: STORED_KEY }
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain("provider_options.baseUrl");
    expect(result.error).not.toContain(STORED_KEY);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("redirect hop binding helper", () => {
  it("refuses a hop target outside the authorized destinations", () => {
    expect(() => assertSearchCredentialRedirectBinding({
      config: KEYED_PROVIDER,
      params: { token: STORED_KEY },
      url: FOREIGN_ENDPOINT,
      init: { headers: { "X-Subscription-Token": STORED_KEY } }
    })).toThrow(SearchCredentialRedirectError);
  });

  it("allows a hop target on an authorized destination", () => {
    expect(() => assertSearchCredentialRedirectBinding({
      config: KEYED_PROVIDER,
      params: { token: STORED_KEY },
      url: `${REGISTRY_ENDPOINT}/web/search?count=5`,
      init: { headers: { "X-Subscription-Token": STORED_KEY } }
    })).not.toThrow();
  });

  it("allows a hop that carries no credential", () => {
    // A query credential the redirect dropped travels nowhere, so there is
    // nothing to bind on that hop.
    expect(() => assertSearchCredentialRedirectBinding({
      config: { id: "google-pse", baseUrl: "https://www.googleapis.com/customsearch/v1" },
      params: { token: STORED_KEY },
      url: FOREIGN_ENDPOINT,
      init: { headers: { Accept: "application/json" } }
    })).not.toThrow();
  });
});
