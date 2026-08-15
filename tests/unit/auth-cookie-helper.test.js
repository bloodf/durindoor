import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getSettingsSync: vi.fn(),
  cookieSet: vi.fn(),
  cookieDelete: vi.fn(),
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getSettingsSync: mocks.getSettingsSync,
}));
const { setDashboardAuthCookie, shouldUseSecureCookie } = await import("../../src/lib/auth/dashboardSession.js");
const originalBaseUrl = process.env.BASE_URL;
const originalAuthCookieSecure = process.env.AUTH_COOKIE_SECURE;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.BASE_URL;
  delete process.env.AUTH_COOKIE_SECURE;
});
afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env.BASE_URL;
  else process.env.BASE_URL = originalBaseUrl;
  if (originalAuthCookieSecure === undefined) delete process.env.AUTH_COOKIE_SECURE;
  else process.env.AUTH_COOKIE_SECURE = originalAuthCookieSecure;
});

function request(headers = {}) {
  return new Request("http://durindoor.test/api/auth/login", { headers });
}

describe("setDashboardAuthCookie epoch guard", () => {
  it("does not emit a cookie when DB epoch changed while signing", async () => {
    mocks.getSettingsSync.mockReturnValueOnce({ passwordSessionEpoch: "epoch-B" });

    await expect(setDashboardAuthCookie({ set: mocks.cookieSet, delete: mocks.cookieDelete }, request(), { passwordSessionEpoch: "epoch-A" }, "epoch-A")).rejects.toThrow("AUTH_EPOCH_RACE");
    expect(mocks.cookieSet).not.toHaveBeenCalled();
  });

  it("emits a cookie when DB epoch still matches after signing", async () => {
    mocks.getSettingsSync.mockReturnValue({ passwordSessionEpoch: "epoch-A" });

    await setDashboardAuthCookie({ set: mocks.cookieSet, delete: mocks.cookieDelete }, request(), { passwordSessionEpoch: "epoch-A" }, "epoch-A");

    expect(mocks.cookieSet).toHaveBeenCalledOnce();
  });
});

describe("shouldUseSecureCookie", () => {
  it("uses HTTPS BASE_URL despite hostile XFP", () => {
    process.env.BASE_URL = "https://durindoor.example/";
    expect(shouldUseSecureCookie(request({ "x-forwarded-proto": "http" }))).toBe(true);
  });

  it("ignores hostile XFP without configured public origin", () => {
    expect(shouldUseSecureCookie(request({ "x-forwarded-proto": "https" }))).toBe(false);
  });

  it("uses direct HTTPS request URLs", () => {
    expect(shouldUseSecureCookie(new Request("https://durindoor.test/api/auth/login"))).toBe(true);
  });

  it("respects forced Secure cookie configuration", () => {
    process.env.AUTH_COOKIE_SECURE = "true";
    expect(shouldUseSecureCookie(request())).toBe(true);
  });
});
