import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildOidcAuthorizationUrl: vi.fn(() => new URL("https://provider.example/authorize")),
  createOidcNonce: vi.fn(() => "nonce"),
  createOidcState: vi.fn(() => "state"),
  createPkcePair: vi.fn(() => ({ verifier: "v", challenge: "c" })),
  fetchOidcDiscovery: vi.fn(async () => ({ authorization_endpoint: "https://provider.example/authorize", token_endpoint: "https://provider.example/token" })),
  getOidcRuntimeConfig: vi.fn(async () => ({ issuerUrl: "https://provider.example", clientId: "client", clientSecret: "secret", scopes: "openid" })),
  exchangeOidcCode: vi.fn(),
  verifyOidcIdToken: vi.fn(),
  pickOidcEmail: vi.fn(() => "a@b.test"),
  pickOidcDisplayName: vi.fn(() => "Tester"),
  setDashboardAuthCookie: vi.fn(async () => {}),
  shouldUseSecureCookie: vi.fn(() => false),
  cookies: vi.fn(async () => ({
    set: vi.fn(),
    get: vi.fn(() => undefined),
    delete: vi.fn(),
  })),
}));

vi.mock("@/lib/auth/oidc", async () => {
  const actual = await vi.importActual("@/lib/auth/oidc");
  return { ...actual, buildOidcAuthorizationUrl: mocks.buildOidcAuthorizationUrl, createOidcNonce: mocks.createOidcNonce, createOidcState: mocks.createOidcState, createPkcePair: mocks.createPkcePair, fetchOidcDiscovery: mocks.fetchOidcDiscovery, getOidcRuntimeConfig: mocks.getOidcRuntimeConfig, exchangeOidcCode: mocks.exchangeOidcCode, verifyOidcIdToken: mocks.verifyOidcIdToken, pickOidcEmail: mocks.pickOidcEmail, pickOidcDisplayName: mocks.pickOidcDisplayName };
});
vi.mock("@/lib/auth/dashboardSession", () => ({ setDashboardAuthCookie: mocks.setDashboardAuthCookie, shouldUseSecureCookie: mocks.shouldUseSecureCookie }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/server", () => ({
  NextResponse: {
    redirect: (url) => ({ kind: "redirect", url: String(url), headers: {} }),
  },
}));

const startModule = await import("../../src/app/api/auth/oidc/start/route.js");
const callbackModule = await import("../../src/app/api/auth/oidc/callback/route.js");

function request(url) {
  return new Request(url, { headers: { host: new URL(url).host, "x-forwarded-host": "evil.test", "x-forwarded-proto": "https" } });
}

describe("OIDC routes reject hostile forwarded origin headers", () => {
  it("keeps the redirect_uri on the request origin even with hostile XFH/XFP", async () => {
    mocks.cookies.mockResolvedValueOnce({ set: vi.fn(), get: vi.fn(() => undefined), delete: vi.fn() });
    const response = await startModule.GET(request("http://durindoor.test/api/auth/oidc/start"));
    const redirect = mocks.buildOidcAuthorizationUrl.mock.calls[0][0];
    expect(redirect.redirectUri).toBe("http://durindoor.test/api/auth/oidc/callback");
    expect(response.kind).toBe("redirect");
  });

  it("keeps the missing-code redirect on the request origin", async () => {
    const response = await callbackModule.GET(request("http://durindoor.test/api/auth/oidc/callback"));
    expect(response.kind).toBe("redirect");
    expect(new URL(response.url).origin).toBe("http://durindoor.test");
    expect(new URL(response.url).pathname).toBe("/login");
    expect(new URL(response.url).searchParams.get("error")).toBe("oidc_missing_code");
  });
});
