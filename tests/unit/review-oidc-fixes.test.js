/**
 * Regression tests for #2195 (OIDC allowlist + revocable OIDC sessions) and
 * #2196 (OIDC test route never sends the stored secret to another issuer;
 * OIDC fetches use the resolving SSRF guard).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  fetchOidcDiscovery: vi.fn(),
  probeOidcClientSecret: vi.fn(),
  getOidcRuntimeConfig: vi.fn(),
  exchangeOidcCode: vi.fn(),
  verifyOidcIdToken: vi.fn(),
  setDashboardAuthCookie: vi.fn(async () => {}),
  cookieGet: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, getSettingsSync: () => ({}) }));
vi.mock("@/dashboardGuard", () => ({
  canAccessManagementApi: vi.fn(async () => true),
  hasExactRequestOrigin: vi.fn(() => true),
  hasValidCliToken: vi.fn(async () => false),
  isOperatorRequest: vi.fn(async () => true),
}));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) => ({ kind: "json", body, status: init.status ?? 200 }),
    redirect: (url) => ({ kind: "redirect", url: String(url) }),
  },
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: mocks.cookieGet, set: vi.fn(), delete: vi.fn() })),
}));

const realOidc = await vi.importActual("../../src/lib/auth/oidc.js");

describe("#2195 OIDC allowlist", () => {
  const { checkOidcIdentityAllowed, isOidcAllowlistEmpty, warnIfOidcAllowlistEmpty, __resetOidcWarningForTests } = realOidc;

  it("refuses every identity when all three allowlists are empty", () => {
    expect(isOidcAllowlistEmpty({})).toBe(true);
    expect(checkOidcIdentityAllowed({ sub: "u1", email: "a@b.test", email_verified: true }, {}))
      .toEqual({ allowed: false, reason: "oidc_allowlist_empty" });
  });

  it("matches subjects exactly", () => {
    const settings = { oidcAllowedSubjects: ["u1"] };
    expect(checkOidcIdentityAllowed({ sub: "u1" }, settings).allowed).toBe(true);
    expect(checkOidcIdentityAllowed({ sub: "u2" }, settings)).toEqual({ allowed: false, reason: "oidc_not_allowed" });
  });

  it("requires email_verified === true for email and domain matches", () => {
    const settings = { oidcAllowedEmails: ["ops@example.com"], oidcAllowedDomains: ["corp.test"] };
    expect(checkOidcIdentityAllowed({ sub: "x", email: "OPS@example.com", email_verified: true }, settings).allowed).toBe(true);
    expect(checkOidcIdentityAllowed({ sub: "x", email: "ops@example.com" }, settings).allowed).toBe(false);
    expect(checkOidcIdentityAllowed({ sub: "x", email: "ops@example.com", email_verified: "true" }, settings).allowed).toBe(false);
    expect(checkOidcIdentityAllowed({ sub: "x", email: "me@corp.test", email_verified: true }, settings).allowed).toBe(true);
    expect(checkOidcIdentityAllowed({ sub: "x", email: "me@corp.test", email_verified: false }, settings).allowed).toBe(false);
    expect(checkOidcIdentityAllowed({ sub: "x", email: "me@evilcorp.test", email_verified: true }, settings).allowed).toBe(false);
  });

  it("logs a single server warning when OIDC is enabled with empty allowlists", () => {
    __resetOidcWarningForTests();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnIfOidcAllowlistEmpty({ authMode: "password" });
    expect(warn).not.toHaveBeenCalled();
    warnIfOidcAllowlistEmpty({ authMode: "oidc" });
    warnIfOidcAllowlistEmpty({ authMode: "both" });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("guards the allowlist settings as auth-critical with empty defaults", async () => {
    const { AUTH_CRITICAL_SETTING_KEYS } = await import("../../src/lib/settings/settingsPatchAuth.js");
    for (const key of ["oidcAllowedSubjects", "oidcAllowedEmails", "oidcAllowedDomains"]) {
      expect(AUTH_CRITICAL_SETTING_KEYS).toContain(key);
    }
    const repo = fs.readFileSync(path.resolve(__dirname, "../../src/lib/db/repos/settingsRepo.js"), "utf8");
    expect(repo).toMatch(/oidcAllowedSubjects: \[\]/);
    expect(repo).toMatch(/oidcAllowedEmails: \[\]/);
    expect(repo).toMatch(/oidcAllowedDomains: \[\]/);
  });

  it("explains the empty-allowlist refusal on the login page and warns in settings", () => {
    const login = fs.readFileSync(path.resolve(__dirname, "../../src/app/login/page.js"), "utf8");
    expect(login).toContain("oidc_allowlist_empty");
    expect(login).toMatch(/loopback/);
    const profile = fs.readFileSync(path.resolve(__dirname, "../../src/app/(dashboard)/dashboard/profile/OidcLoginCard.jsx"), "utf8");
    expect(profile).toContain("OIDC allowlist is empty");
  });
});

describe("#2195 OIDC callback and start enforce the allowlist", () => {
  let callback;
  let start;
  beforeEach(async () => {
    vi.stubEnv("BASE_URL", "https://gw.test");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
    vi.resetModules();
    vi.doMock("@/lib/auth/oidc", () => ({
      ...realOidc,
      fetchOidcDiscovery: mocks.fetchOidcDiscovery,
      getOidcRuntimeConfig: mocks.getOidcRuntimeConfig,
      exchangeOidcCode: mocks.exchangeOidcCode,
      verifyOidcIdToken: mocks.verifyOidcIdToken,
    }));
    vi.doMock("@/lib/auth/dashboardSession", () => ({
      setDashboardAuthCookie: mocks.setDashboardAuthCookie,
      shouldUseSecureCookie: () => false,
    }));
    mocks.setDashboardAuthCookie.mockClear();
    mocks.fetchOidcDiscovery.mockReset();
    mocks.getOidcRuntimeConfig.mockResolvedValue({ issuerUrl: "https://idp.example", clientId: "c", clientSecret: "s", scopes: "openid" });
    mocks.fetchOidcDiscovery.mockResolvedValue({ issuer: "https://idp.example", token_endpoint: "https://idp.example/token", jwks_uri: "https://idp.example/jwks", authorization_endpoint: "https://idp.example/auth" });
    mocks.exchangeOidcCode.mockResolvedValue({ id_token: "idt" });
    mocks.cookieGet.mockImplementation((name) => ({ value: name === "oidc_state" ? "st" : "x" }));
    callback = await import("../../src/app/api/auth/oidc/callback/route.js");
    start = await import("../../src/app/api/auth/oidc/start/route.js");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("@/lib/auth/oidc");
    vi.doUnmock("@/lib/auth/dashboardSession");
  });

  const cb = () => callback.GET(new Request("http://gw.test/api/auth/oidc/callback?code=c&state=st"));

  it("refuses an authenticated identity that is not allowlisted", async () => {
    mocks.getSettings.mockResolvedValue({ authMode: "oidc", oidcAllowedEmails: ["ops@example.com"] });
    mocks.verifyOidcIdToken.mockResolvedValue({ sub: "stranger", email: "stranger@gmail.test", email_verified: true });
    const res = await cb();
    expect(new URL(res.url).searchParams.get("error")).toBe("oidc_not_allowed");
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("refuses an unverified email even when it is allowlisted", async () => {
    mocks.getSettings.mockResolvedValue({ authMode: "oidc", oidcAllowedEmails: ["ops@example.com"] });
    mocks.verifyOidcIdToken.mockResolvedValue({ sub: "x", email: "ops@example.com", email_verified: false });
    await cb();
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("refuses all OIDC logins when the allowlist is empty", async () => {
    mocks.getSettings.mockResolvedValue({ authMode: "oidc" });
    mocks.verifyOidcIdToken.mockResolvedValue({ sub: "x" });
    const res = await cb();
    expect(new URL(res.url).searchParams.get("error")).toBe("oidc_allowlist_empty");
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("issues a session for an allowlisted subject", async () => {
    mocks.getSettings.mockResolvedValue({ authMode: "oidc", oidcAllowedSubjects: ["u1"] });
    mocks.verifyOidcIdToken.mockResolvedValue({ sub: "u1" });
    const res = await cb();
    expect(new URL(res.url).pathname).toBe("/dashboard");
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ oidc: true, oidcSub: "u1" }));
  });

  it("start refuses with a clear error code when the allowlist is empty", async () => {
    mocks.getOidcRuntimeConfig.mockResolvedValue({ issuerUrl: "https://idp.example", clientId: "c", clientSecret: "s", allowlistEmpty: true });
    const res = await start.GET(new Request("http://gw.test/api/auth/oidc/start"));
    expect(new URL(res.url).searchParams.get("error")).toBe("oidc_allowlist_empty");
    expect(mocks.fetchOidcDiscovery).not.toHaveBeenCalled();
  });

  it("getOidcRuntimeConfig reports an empty allowlist", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.getSettings.mockResolvedValue({ authMode: "oidc", oidcIssuerUrl: "https://idp.example", oidcClientId: "c", oidcClientSecret: "s" });
    expect((await realOidc.getOidcRuntimeConfig()).allowlistEmpty).toBe(true);
    mocks.getSettings.mockResolvedValue({ authMode: "oidc", oidcIssuerUrl: "https://idp.example", oidcClientId: "c", oidcClientSecret: "s", oidcAllowedDomains: ["corp.test"] });
    expect((await realOidc.getOidcRuntimeConfig()).allowlistEmpty).toBe(false);
  });
});

describe("#2195 OIDC sessions are revocable", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", "unit-test-jwt-secret-do-not-reuse");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("a password change/reset (epoch rotation) ends existing OIDC sessions", async () => {
    vi.resetModules();
    const session = await vi.importActual("../../src/lib/auth/dashboardSession.js");
    session.__resetJwtSecretForTests();
    mocks.getSettings.mockResolvedValue({ passwordSessionEpoch: "e1" });
    const token = await session.createDashboardAuthToken({ oidc: true, oidcSub: "u1" });
    await expect(session.verifyDashboardAuthToken(token)).resolves.toBe(true);
    expect(await session.getDashboardAuthSession(token)).toMatchObject({ oidc: true });
    mocks.getSettings.mockResolvedValue({ passwordSessionEpoch: "e2" });
    await expect(session.verifyDashboardAuthToken(token)).resolves.toBe(false);
    expect(await session.getDashboardAuthSession(token)).toBeNull();
    session.__resetJwtSecretForTests();
  });
});

describe("#2196 OIDC test route keeps the stored secret on the saved issuer", () => {
  let POST;
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("@/lib/auth/oidc", () => ({
      fetchOidcDiscovery: mocks.fetchOidcDiscovery,
      probeOidcClientSecret: mocks.probeOidcClientSecret,
      getPublicOrigin: () => "https://gw.test",
    }));
    mocks.fetchOidcDiscovery.mockReset().mockResolvedValue({ token_endpoint: "https://evil.test/token" });
    mocks.probeOidcClientSecret.mockReset().mockResolvedValue({ tested: false, valid: null, message: "skipped" });
    mocks.getSettings.mockResolvedValue({ oidcIssuerUrl: "https://idp.example/", oidcClientId: "c", oidcClientSecret: "stored-secret" });
    ({ POST } = await import("../../src/app/api/auth/oidc/test/route.js"));
  });
  afterEach(() => vi.doUnmock("@/lib/auth/oidc"));

  const call = (body) => POST({ headers: new Headers(), json: async () => body });

  it("does not send the stored secret to a different body issuer", async () => {
    await call({ issuerUrl: "https://evil.test" });
    expect(mocks.probeOidcClientSecret).toHaveBeenCalledWith(expect.objectContaining({ clientSecret: "" }));
  });

  it("uses the stored secret when the body issuer equals the saved issuer", async () => {
    await call({ issuerUrl: "https://idp.example" });
    expect(mocks.probeOidcClientSecret).toHaveBeenCalledWith(expect.objectContaining({ clientSecret: "stored-secret" }));
    mocks.probeOidcClientSecret.mockClear();
    await call({});
    expect(mocks.probeOidcClientSecret).toHaveBeenCalledWith(expect.objectContaining({ clientSecret: "stored-secret" }));
  });

  it("still probes with an explicitly supplied secret for a new issuer", async () => {
    await call({ issuerUrl: "https://new.example", clientSecret: "typed" });
    expect(mocks.probeOidcClientSecret).toHaveBeenCalledWith(expect.objectContaining({ clientSecret: "typed" }));
  });
});

describe("#2196 OIDC fetches use the resolving SSRF guard", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("blocks a discovery redirect to an internal host", async () => {
    fetchMock.mockResolvedValueOnce({ status: 302, ok: false, headers: new Headers({ location: "http://169.254.169.254/latest" }) });
    await expect(realOidc.fetchOidcDiscovery("https://8.8.8.8")).rejects.toThrow(/Blocked URL/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("guards the token endpoint taken from discovery", async () => {
    await expect(realOidc.probeOidcClientSecret({ tokenEndpoint: "http://127.0.0.1/token", clientId: "c", clientSecret: "s", redirectUri: "https://gw.test/cb" }))
      .rejects.toThrow(/Blocked URL/);
    await expect(realOidc.exchangeOidcCode({ tokenEndpoint: "http://10.0.0.1/token", clientId: "c", code: "x", redirectUri: "r", codeVerifier: "v" }))
      .rejects.toThrow(/Blocked URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("guards the JWKS endpoint taken from discovery", async () => {
    await expect(realOidc.verifyOidcIdToken({ idToken: "a.b.c", issuer: "i", audience: "a", jwksUri: "http://192.168.1.1/jwks", nonce: "n" }))
      .rejects.toThrow(/Blocked URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
