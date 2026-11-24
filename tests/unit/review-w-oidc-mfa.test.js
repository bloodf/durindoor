import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  cookies: vi.fn(),
  setDashboardAuthCookie: vi.fn(),
  fetchOidcDiscovery: vi.fn(),
  getOidcRuntimeConfig: vi.fn(),
  exchangeOidcCode: vi.fn(),
  verifyOidcIdToken: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("next/server", () => ({ NextResponse: { redirect: (url) => ({ url: String(url) }) } }));
vi.mock("@/lib/auth/oidc", () => ({
  fetchOidcDiscovery: mocks.fetchOidcDiscovery,
  getOidcRuntimeConfig: mocks.getOidcRuntimeConfig,
  exchangeOidcCode: mocks.exchangeOidcCode,
  verifyOidcIdToken: mocks.verifyOidcIdToken,
  checkOidcIdentityAllowed: () => ({ allowed: true }),
  getPublicOrigin: () => "http://gateway.test",
  pickOidcDisplayName: () => "Operator",
  pickOidcEmail: () => "operator@example.test",
}));
vi.mock("@/lib/auth/dashboardSession", () => ({ setDashboardAuthCookie: mocks.setDashboardAuthCookie }));

const session = await vi.importActual("../../src/lib/auth/dashboardSession.js");

describe("OIDC satisfies dashboard MFA when local MFA settings remain enabled", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", "unit-test-jwt-secret-do-not-reuse");
    session.__resetJwtSecretForTests();
    mocks.getSettings.mockResolvedValue({ passwordSessionEpoch: "epoch-A", mfaEnabled: true, mfaSecret: "seed" });
    mocks.cookies.mockResolvedValue({
      get: (name) => ({ value: name === "oidc_state" ? "state" : "nonce-or-verifier" }),
      delete: vi.fn(),
    });
    mocks.getOidcRuntimeConfig.mockResolvedValue({ issuerUrl: "https://idp.example", clientId: "client", clientSecret: "secret" });
    mocks.fetchOidcDiscovery.mockResolvedValue({ issuer: "https://idp.example", token_endpoint: "https://idp.example/token", jwks_uri: "https://idp.example/jwks" });
    mocks.exchangeOidcCode.mockResolvedValue({ id_token: "id-token" });
    mocks.verifyOidcIdToken.mockResolvedValue({ sub: "operator-1" });
    mocks.setDashboardAuthCookie.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    session.__resetJwtSecretForTests();
  });

  it("accepts an OIDC callback session and continues rejecting password sessions without MFA", async () => {
    const oidcToken = await session.createDashboardAuthToken({
      oidc: true,
      mfa: "oidc",
      passwordSessionEpoch: "epoch-A",
    });
    const passwordToken = await session.createDashboardAuthToken({ passwordSessionEpoch: "epoch-A" });

    await expect(session.verifyDashboardAuthToken(oidcToken)).resolves.toBe(true);
    await expect(session.getDashboardAuthSession(oidcToken)).resolves.toMatchObject({ oidc: true, mfa: "oidc" });
    await expect(session.verifyDashboardAuthToken(passwordToken)).resolves.toBe(false);
    await expect(session.getDashboardAuthSession(passwordToken)).resolves.toBeNull();
  });

  it("does not treat an OIDC flag alone as satisfying MFA", async () => {
    const oidcTokenWithoutMfaClaim = await session.createDashboardAuthToken({ oidc: true, passwordSessionEpoch: "epoch-A" });

    await expect(session.verifyDashboardAuthToken(oidcTokenWithoutMfaClaim)).resolves.toBe(false);
  });

  it("marks sessions issued by the OIDC callback as satisfying MFA", async () => {
    const { GET } = await import("../../src/app/api/auth/oidc/callback/route.js");
    await GET(new Request("http://gateway.test/api/auth/oidc/callback?code=code&state=state"));

    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ oidc: true, mfa: "oidc" }),
    );
  });
});
