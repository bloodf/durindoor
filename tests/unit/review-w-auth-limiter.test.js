import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ settings: {}, validKey: false }));
vi.mock("next/server", () => {
  class ResponseMock {
    constructor(body, init = {}) { this.body = body; this.status = init.status || 200; }
    static json(body, init) { return new ResponseMock(body, init); }
    static next() { return new ResponseMock(null); }
  }
  return { NextResponse: ResponseMock };
});
vi.mock("next/headers", () => ({ cookies: async () => ({ set() {} }) }));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => mocks.settings, validateApiKey: async () => mocks.validKey, getApiKeyByKey: async () => null }));
vi.mock("@/lib/auth/dashboardSession", () => ({ isUsingDefaultPassword: async () => false, setDashboardAuthCookie: async () => {}, verifyDashboardAuthToken: async () => false }));
vi.mock("@/lib/auth/requestOrigin", () => ({ hasExactRequestOrigin: () => true, hasTrustedLocalOrigin: () => true }));
vi.mock("bcryptjs", () => ({ default: { compare: async (password) => password === "correct" } }));

const limiter = await import("../../src/lib/auth/loginLimiter.js");
const { POST } = await import("../../src/app/api/auth/login/route.js");
const { proxy } = await import("../../src/dashboardGuard.js");
const { isPasswordLoginAllowed } = await import("../../src/lib/auth/oidc.js");
const login = (body) => POST(new Request("http://example.test/api/auth/login", { method: "POST", body }));
function keyRequest() {
  const url = new URL("http://example.test/v1/models");
  return { url: url.href, nextUrl: url, method: "GET", headers: new Headers({ host: "example.test", authorization: "Bearer sk-deadbeef" }), cookies: { get: () => undefined } };
}

describe("authentication limiter regressions", () => {
  beforeEach(() => { limiter.resetLoginLimiter(); mocks.settings = { password: "hash" }; mocks.validKey = false; vi.spyOn(console, "error").mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  it("releases malformed login reservations", async () => {
    for (let i = 0; i < 5; i++) expect((await login("{" )).status).toBe(500);
    expect((await login(JSON.stringify({ password: "correct" }))).status).toBe(200);
  });
  it("rejects password login in configured sso mode", async () => {
    mocks.settings = { ...mocks.settings, authMode: "sso", oidcIssuerUrl: "https://idp.example", oidcClientId: "id", oidcClientSecret: "secret" };
    expect(isPasswordLoginAllowed(mocks.settings)).toBe(false);
    expect((await login(JSON.stringify({ password: "correct" }))).status).toBe(403);
  });
  it("expires abandoned reservations", () => {
    vi.useFakeTimers();
    for (let i = 0; i < 5; i++) expect(limiter.reserveAttempt("unknown").locked).toBe(false);
    expect(limiter.reserveAttempt("unknown").locked).toBe(true);
    vi.advanceTimersByTime(60_001);
    expect(limiter.reserveAttempt("unknown").locked).toBe(false);
  });
  it("does not reset login failures when a legacy key succeeds", async () => {
    for (let i = 0; i < 4; i++) limiter.recordFail("unknown");
    mocks.validKey = true;
    await proxy(keyRequest());
    limiter.recordFail("unknown");
    expect(limiter.checkLock("unknown").locked).toBe(true);
  });
  it("does not lock login after bad legacy keys", async () => {
    for (let i = 0; i < 5; i++) await proxy(keyRequest());
    expect((await login(JSON.stringify({ password: "correct" }))).status).toBe(200);
  });
});
