import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init = {}) => ({ body, status: init.status || 200 })),
  getSettings: vi.fn(),
  compare: vi.fn(),
  cookies: vi.fn(),
  setDashboardAuthCookie: vi.fn(),
  isOidcConfigured: vi.fn(),
  checkLock: vi.fn(() => ({ locked: false })),
  recordFail: vi.fn(),
  recordSuccess: vi.fn(),
  getClientIp: vi.fn(),
  isLocalRequest: vi.fn(),
  isUsingDefaultPassword: vi.fn(async () => true),
  issuePasswordChangeProof: vi.fn(() => "password-change-proof"),
  consoleError: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("bcryptjs", () => ({ default: { compare: mocks.compare } }));
vi.mock("@/lib/auth/dashboardSession", () => ({
  isUsingDefaultPassword: mocks.isUsingDefaultPassword,
  setDashboardAuthCookie: mocks.setDashboardAuthCookie,
}));
vi.mock("@/lib/auth/oidc", () => ({ isOidcConfigured: mocks.isOidcConfigured }));
vi.mock("@/lib/auth/loginLimiter", () => ({
  checkLock: mocks.checkLock, recordFail: mocks.recordFail, recordSuccess: mocks.recordSuccess, getClientIp: mocks.getClientIp,
}));
vi.mock("@/dashboardGuard", () => ({ isLocalRequest: mocks.isLocalRequest }));
vi.mock("@/lib/auth/passwordChangeProof", () => ({ issuePasswordChangeProof: mocks.issuePasswordChangeProof }));

const { POST } = await import("../../src/app/api/auth/login/route.js");

function request(password = "123456") {
  return new Request("http://durindoor.test/api/auth/login", { method: "POST", body: JSON.stringify({ password }) });
}

describe("POST /api/auth/login default-password safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.checkLock.mockReset().mockReturnValue({ locked: false });
    mocks.recordFail.mockReset().mockReturnValue({ remainingBeforeLock: 4 });
    mocks.recordSuccess.mockReset();
    mocks.getSettings.mockResolvedValue({});
    mocks.isUsingDefaultPassword.mockResolvedValue(true);
    mocks.isOidcConfigured.mockReturnValue(false);
    mocks.cookies.mockResolvedValue({ set: vi.fn() });
    mocks.isLocalRequest.mockReturnValue(false);
    vi.spyOn(console, "error").mockImplementation(mocks.consoleError);
  });

  it("logs a redacted error event and returns a stable code on unexpected failure", async () => {
    mocks.getSettings.mockRejectedValue(new Error("SENTINEL_LOGIN_ERROR"));

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: "Login failed" });
    expect(mocks.consoleError).toHaveBeenCalledWith("[auth] login failed");
    expect(mocks.consoleError).not.toHaveBeenCalledWith(expect.stringContaining("SENTINEL_LOGIN_ERROR"));
  });

  it("rejects a remote default-password session before issuing auth_token", async () => {
    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ success: true, mustChangePassword: true });
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("returns a local one-time password-change proof without issuing auth_token", async () => {
    mocks.isLocalRequest.mockReturnValue(true);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ success: true, mustChangePassword: true, requiresPasswordChange: true, proof: "password-change-proof" });
    expect(mocks.issuePasswordChangeProof).toHaveBeenCalledWith(undefined);
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("rejects a remote stored hash of the built-in password before issuing auth_token", async () => {
    mocks.getSettings.mockResolvedValue({ password: "default-hash" });
    mocks.compare.mockResolvedValue(true);
    mocks.isUsingDefaultPassword.mockResolvedValue(true);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ success: true, mustChangePassword: true });
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("rate limits repeated remote logins using a stored default hash", async () => {
    mocks.getSettings.mockResolvedValue({ password: "default-hash" });
    mocks.compare.mockResolvedValue(true);
    let failures = 0;
    mocks.recordFail.mockImplementation(() => ({ remainingBeforeLock: Math.max(0, 4 - ++failures) }));
    mocks.checkLock.mockImplementation(() => failures >= 5 ? { locked: true, retryAfter: 30 } : { locked: false });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect((await POST(request())).status).toBe(403);
    }
    expect((await POST(request())).status).toBe(429);
    expect(mocks.recordSuccess).not.toHaveBeenCalled();
  });

  it("rejects a remote INITIAL_PASSWORD set to the built-in password", async () => {
    vi.stubEnv("INITIAL_PASSWORD", "123456");
    mocks.isUsingDefaultPassword.mockResolvedValue(true);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ success: true, mustChangePassword: true });
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("allows a remote stored custom password without mustChangePassword", async () => {
    mocks.getSettings.mockResolvedValue({ password: "custom-hash" });
    mocks.compare.mockResolvedValue(true);
    mocks.isUsingDefaultPassword.mockResolvedValue(false);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, mustChangePassword: false });
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledOnce();
  });
});
