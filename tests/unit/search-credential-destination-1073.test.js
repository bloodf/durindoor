/**
 * Port policy for OmniRoute PR #12620 (DurinDoor #1073) — a stored search
 * credential may only travel to a destination the administrator authorized.
 *
 * Source: https://github.com/cheaper-inference/OmniRoute/pull/12620 (merged
 * 2026-09-03, GHSA-3f8g-pfh9-j687 and GHSA-qv45-56jc-4wmj).
 *
 * The defect: `provider_options.baseUrl` (caller input) and the stored
 * provider connection's `providerSpecificData.baseUrl` (operator input) were
 * read through one call, so a caller could name their own PUBLIC host and the
 * builder attached the OPERATOR's key to it — `key=`/`api_key=` in the query
 * for google-pse/searchapi, `X-API-Key`/`Authorization` for the others. The
 * public-only egress guard does not help there: the attacker's own public
 * host passes it.
 *
 * This suite is policy-level only: synthetic endpoint configuration, synthetic
 * non-secret credential values, a stubbed fetch, no server, no outbound
 * traffic and no real credentials. The existing guard suites
 * (`unit/search-ssrf-guard.test.js`, `unit/search-base-url-ssrf.test.js`) keep
 * owning the SSRF/redirect contracts; nothing here weakens them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSearchRequest } from "../../open-sse/handlers/search/callers.js";
import { handleSearchCore } from "../../open-sse/handlers/search/index.js";
import {
  SearchBaseUrlOverrideError,
  assertSearchCredentialBinding,
  resolveSearchBaseUrl
} from "../../open-sse/handlers/search/baseUrl.js";
import { sanitizeErrorMessage } from "../../open-sse/utils/error.js";

// Synthetic, non-secret fixtures. The two endpoints are RFC 5737 documentation
// addresses (TEST-NET-2 / TEST-NET-3): public literals, so the public-only
// guard accepts them without any DNS resolution.
const STORED_KEY = "fixture-operator-key-1073";
const CALLER_ENDPOINT = "https://203.0.113.10/search";
const OPERATOR_ENDPOINT = "https://198.51.100.20/search";

// Synthetic provider search configs (the shapes the dedicated builders read).
const KEYED_PROVIDER = {
  id: "brave-search",
  authType: "apikey",
  method: "GET",
  baseUrl: "https://api.search.brave.com/res/v1"
};
const KEYLESS_PROVIDER = {
  id: "searxng",
  authType: "none",
  method: "GET",
  baseUrl: "https://searxng.example.com"
};
// Keyless, but the builder accepts an optional Bearer: a configured key still
// rides along, so this provider is credential-bearing in practice.
const KEYLESS_WITH_OPTIONAL_TOKEN_PROVIDER = {
  id: "context7",
  authType: "none",
  method: "GET",
  baseUrl: "https://context7.com/api/v1"
};

const queryParams = (extra = {}) => ({
  query: "durindoor",
  maxResults: 5,
  searchType: "web",
  token: STORED_KEY,
  ...extra
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("approved configured origin", () => {
  it("keeps the stored credential on the administrator-configured endpoint", () => {
    const params = queryParams();
    const { url, init } = buildSearchRequest(KEYED_PROVIDER, params);

    expect(url.startsWith("https://api.search.brave.com/res/v1")).toBe(true);
    expect(init.headers["X-Subscription-Token"]).toBe(STORED_KEY);
    expect(() => assertSearchCredentialBinding({ config: KEYED_PROVIDER, params, url, init })).not.toThrow();
  });

  it("keeps the stored credential on the operator's provider-connection endpoint", () => {
    const params = queryParams({ providerSpecificData: { baseUrl: OPERATOR_ENDPOINT } });
    const { url, init } = buildSearchRequest(KEYED_PROVIDER, params);

    expect(url.startsWith(OPERATOR_ENDPOINT)).toBe(true);
    expect(init.headers["X-Subscription-Token"]).toBe(STORED_KEY);
    expect(() => assertSearchCredentialBinding({ config: KEYED_PROVIDER, params, url, init })).not.toThrow();
  });

  it("lets the operator endpoint win over a caller-selected one", () => {
    const params = queryParams({
      providerOptions: { baseUrl: CALLER_ENDPOINT },
      providerSpecificData: { baseUrl: OPERATOR_ENDPOINT }
    });
    const { url, init } = buildSearchRequest(KEYED_PROVIDER, params);

    expect(url.startsWith(OPERATOR_ENDPOINT)).toBe(true);
    expect(() => assertSearchCredentialBinding({ config: KEYED_PROVIDER, params, url, init })).not.toThrow();
  });
});

describe("credentials unavailable for an unauthorized origin selection", () => {
  it("refuses a caller-selected endpoint for a credential-bearing provider", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await handleSearchCore({
      body: { query: "durindoor", provider_options: { baseUrl: CALLER_ENDPOINT } },
      provider: { id: "brave-search" },
      providerConfig: KEYED_PROVIDER,
      credentials: { apiKey: STORED_KEY }
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain("provider_options.baseUrl");
    // The refusal must not echo the credential it is protecting.
    expect(result.error).not.toContain(STORED_KEY);
    // Nothing left the gateway.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a caller-selected endpoint for a keyless provider that accepts an optional token", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await handleSearchCore({
      body: { query: "durindoor", provider_options: { baseUrl: CALLER_ENDPOINT } },
      provider: { id: "context7" },
      providerConfig: KEYLESS_WITH_OPTIONAL_TOKEN_PROVIDER,
      credentials: { apiKey: STORED_KEY }
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain("provider_options.baseUrl");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses the binding when a request would carry the credential to a caller-selected origin", () => {
    const params = queryParams({ providerOptions: { baseUrl: CALLER_ENDPOINT } });
    const { url, init } = buildSearchRequest(KEYED_PROVIDER, params);

    expect(url.startsWith(CALLER_ENDPOINT)).toBe(true);
    expect(() => assertSearchCredentialBinding({ config: KEYED_PROVIDER, params, url, init }))
      .toThrow(SearchBaseUrlOverrideError);
  });

  it("does not let the credential reach a caller-selected origin through the query string", () => {
    // google-pse/searchapi put the key in the query, not in a header — the
    // binding must see that shape too.
    const googlePse = {
      id: "google-pse",
      authType: "apikey",
      method: "GET",
      baseUrl: "https://www.googleapis.com/customsearch/v1"
    };
    const params = queryParams({
      providerOptions: { baseUrl: CALLER_ENDPOINT },
      providerSpecificData: { cx: "fixture-cx" }
    });
    const { url, init } = buildSearchRequest(googlePse, params);

    expect(url).toContain("key=");
    expect(() => assertSearchCredentialBinding({ config: googlePse, params, url, init }))
      .toThrow(SearchBaseUrlOverrideError);
  });
});

describe("existing keyless and redirect contracts", () => {
  it("keeps the keyless custom-search flow working", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await handleSearchCore({
      body: { query: "durindoor", provider_options: { baseUrl: CALLER_ENDPOINT } },
      provider: { id: "searxng" },
      providerConfig: KEYLESS_PROVIDER,
      credentials: null
    });

    expect(result.success, result.error).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("203.0.113.10");
  });

  it("still blocks a private caller-selected endpoint", async () => {
    const result = await handleSearchCore({
      body: { query: "durindoor", provider_options: { baseUrl: "http://127.0.0.1:18999" } },
      provider: { id: "searxng" },
      providerConfig: KEYLESS_PROVIDER,
      credentials: null
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/Blocked/);
  });

  it("keeps the registry endpoint trusted and a caller-selected endpoint behind the public egress path", () => {
    // "registry" keeps the administrator default on the plain proxy path (an
    // internal SearXNG container must keep working); "caller" and "operator"
    // stay behind the public-only guard and the per-hop redirect re-validation.
    expect(resolveSearchBaseUrl(KEYED_PROVIDER, { query: "x" })).toEqual({
      baseUrl: "https://api.search.brave.com/res/v1",
      source: "registry"
    });
    expect(resolveSearchBaseUrl(KEYED_PROVIDER, { query: "x", providerOptions: { baseUrl: CALLER_ENDPOINT } })).toEqual({
      baseUrl: CALLER_ENDPOINT,
      source: "caller"
    });
    expect(resolveSearchBaseUrl(KEYED_PROVIDER, { query: "x", providerSpecificData: { baseUrl: OPERATOR_ENDPOINT } })).toEqual({
      baseUrl: OPERATOR_ENDPOINT,
      source: "operator"
    });
  });
});

describe("error sanitization keeps raw credential shapes out of upstream messages", () => {
  // Upstream #12620 (GHSA-qv45-56jc-4wmj) moved the raw-token shapes into one
  // shared list. DurinDoor has a single error-sanitization implementation, and
  // it already redacts `sk-`/`AIza` shapes; the JWT shape was the missing one.
  const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmaXh0dXJlIn0.ZmFrZS1zaWduYXR1cmU";

  it("redacts a bare JWT-shaped credential from an upstream error body", () => {
    const out = sanitizeErrorMessage(`upstream rejected eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmaXh0dXJlIn0.ZmFrZS1zaWduYXR1cmU`);
    expect(out).not.toContain(JWT);
    expect(out).toContain("[redacted]");
  });

  it("keeps the existing raw credential shapes redacted", () => {
    expect(sanitizeErrorMessage("Incorrect API key provided: sk-proj-AbCdEfGhIjKlMnOpQr"))
      .not.toContain("sk-proj-AbCdEfGhIjKlMnOpQr");
    expect(sanitizeErrorMessage("Bad credentials for AIzaSyA1B2C3D4E5F6G7H8I9J0KaLbMcNdOeP"))
      .not.toContain("AIzaSyA1B2C3D4E5F6G7H8I9J0KaLbMcNdOeP");
  });

  it("does not maul ordinary error prose", () => {
    for (const benign of [
      "Model gpt-5 is not available on this plan",
      "risk score too high",
      "Rate limit reached for requests"
    ]) {
      expect(sanitizeErrorMessage(benign)).toBe(benign);
    }
  });
});
