/**
 * SSRF guard on OIDC discovery (`fetchOidcDiscovery`).
 *
 * Issuer URLs from settings / login / discovery test must not target
 * link-local, private, or metadata hosts. Public issuers still fetch
 * `/.well-known/openid-configuration` (mocked here — no network).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const { fetchOidcDiscovery } = await import("../../src/lib/auth/oidc.js");

function okDiscovery(issuer) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/jwks`,
    }),
  };
}

describe("fetchOidcDiscovery — SSRF guard", () => {
  it.each([
    ["loopback IPv4", "http://127.0.0.1"],
    ["loopback hostname", "https://localhost"],
    ["link-local / cloud metadata", "http://169.254.169.254"],
    ["RFC1918 10/8", "https://10.0.0.1"],
    ["RFC1918 172.16/12", "https://172.16.0.1"],
    ["RFC1918 192.168/16", "http://192.168.1.1"],
    [".internal suffix", "https://oidc.corp.internal"],
    [".local suffix", "https://login.local"],
    ["IPv6 loopback", "http://[::1]"],
  ])("denies %s issuer before fetch", async (_label, issuerUrl) => {
    await expect(fetchOidcDiscovery(issuerUrl)).rejects.toThrow(/Blocked URL:/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows a public issuer and fetches discovery (mocked)", async () => {
    const issuer = "https://accounts.example.com";
    fetchMock.mockResolvedValueOnce(okDiscovery(issuer));

    const discovery = await fetchOidcDiscovery(issuer);

    expect(discovery.issuer).toBe(issuer);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(`${issuer}/.well-known/openid-configuration`);
    expect(init).toMatchObject({ cache: "no-store" });
  });

  it("trims trailing slashes before assert and fetch", async () => {
    const issuer = "https://idp.example.org";
    fetchMock.mockResolvedValueOnce(okDiscovery(issuer));

    await fetchOidcDiscovery(`${issuer}/`);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`${issuer}/.well-known/openid-configuration`);
  });
});
