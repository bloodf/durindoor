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
  hasExactRequestOrigin: vi.fn(() => true),
  hasTrustedLocalOrigin: vi.fn(() => true),
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
vi.mock("@/lib/auth/requestOrigin", () => ({ hasExactRequestOrigin: mocks.hasExactRequestOrigin, hasTrustedLocalOrigin: mocks.hasTrustedLocalOrigin }));
vi.mock("@/lib/auth/loginLimiter", () => ({
  checkLock: mocks.checkLock, recordFail: mocks.recordFail, recordSuccess: mocks.recordSuccess, getClientIp: mocks.getClientIp,
}));
vi.mock("@/dashboardGuard", () => ({ isLocalRequest: mocks.isLocalRequest }));
vi.mock("@/lib/auth/passwordChangeProof", () => ({ issuePasswordChangeProof: mocks.issuePasswordChangeProof }));

const { POST } = await import("../../src/app/api/auth/login/route.js");

function request(password = "123456", headers = {}) {
  return new Request("http://durindoor.test/api/auth/login", { method: "POST", headers, body: JSON.stringify({ password }) });
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
    mocks.hasExactRequestOrigin.mockReturnValue(true);
    mocks.hasTrustedLocalOrigin.mockReturnValue(true);
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
    expect(mocks.issuePasswordChangeProof).toHaveBeenCalledWith(undefined, "initial");
    expect(mocks.recordFail).toHaveBeenCalledWith(undefined);
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("rejects hostile Origins before bcrypt even with matching forwarded headers", async () => {
    mocks.getSettings.mockResolvedValue({ password: "default-hash" });
    mocks.hasExactRequestOrigin.mockReturnValue(false);

    const response = await POST(request("123456", { origin: "https://evil.test", "x-forwarded-host": "evil.test", "x-forwarded-proto": "https" }));

    expect(response.status).toBe(403);
    expect(mocks.compare).not.toHaveBeenCalled();
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

  it("does not issue a cookie when the password epoch changes after validation", async () => {
    mocks.isUsingDefaultPassword.mockResolvedValue(false);
    mocks.getSettings
      .mockResolvedValueOnce({ password: "custom-hash", passwordSessionEpoch: "epoch-A" })
      .mockResolvedValueOnce({ password: "new-hash", passwordSessionEpoch: "epoch-B" });
    mocks.compare.mockResolvedValue(true);

    const response = await POST(request("custom-password"));

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Login state changed, please retry" });
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
    expect(mocks.recordSuccess).not.toHaveBeenCalled();
  });

  it("does not issue a cookie when signing races with a password epoch update", async () => {
    mocks.isUsingDefaultPassword.mockResolvedValue(false);
    mocks.getSettings
      .mockResolvedValueOnce({ password: "custom-hash", passwordSessionEpoch: "epoch-A" })
      .mockResolvedValueOnce({ password: "custom-hash", passwordSessionEpoch: "epoch-A" })
      .mockResolvedValueOnce({ password: "new-hash", passwordSessionEpoch: "epoch-B" });
    mocks.compare.mockResolvedValue(true);
    let resume;
    mocks.setDashboardAuthCookie.mockImplementation(async () => {
      await new Promise((resolve) => { resume = resolve; });
      throw new Error("AUTH_EPOCH_RACE");
    });

    const pending = POST(request("custom-password"));
    await vi.waitFor(() => expect(mocks.setDashboardAuthCookie).toHaveBeenCalledOnce());
    resume();
    const response = await pending;
    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "Login state changed, please retry" });
    expect(mocks.recordSuccess).not.toHaveBeenCalled();
  });

  it("treats a loopback peer with an attacker Host and Origin as remote", async () => {
    mocks.isLocalRequest.mockReturnValue(true);
    mocks.hasTrustedLocalOrigin.mockReturnValue(false);

    const response = await POST(request("123456", { host: "evil.example:20128", origin: "http://evil.example:20128" }));

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ success: true, mustChangePassword: true });
    expect(mocks.issuePasswordChangeProof).not.toHaveBeenCalled();
  });

  it("falls through to the remote branch when only Host is loopback but Origin is rebinding target", async () => {
    mocks.isLocalRequest.mockReturnValue(true);
    mocks.hasTrustedLocalOrigin.mockReturnValue(false);

    const response = await POST(request("123456", { host: "localhost:20128", origin: "http://evil.example" }));

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ success: true, mustChangePassword: true });
    expect(mocks.issuePasswordChangeProof).not.toHaveBeenCalled();
  });

  it("requires an Origin when only Host is provided to issue a proof", async () => {
    mocks.isLocalRequest.mockReturnValue(true);
    mocks.hasTrustedLocalOrigin.mockReturnValue(false);
    mocks.hasExactRequestOrigin.mockReturnValue(true);

    const response = await POST(request("123456", { host: "evil.example" }));

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ success: true, mustChangePassword: true });
    expect(mocks.issuePasswordChangeProof).not.toHaveBeenCalled();
  });
});
