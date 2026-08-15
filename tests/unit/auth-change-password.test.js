import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init = {}) => ({ body, status: init.status || 200 })),
  consumePasswordChangeProof: vi.fn(),
  getClientIp: vi.fn(),
  genSalt: vi.fn(),
  hash: vi.fn(),
  updateSettings: vi.fn(),
  DEFAULT_PASSWORD: "123456",
  invalidateDefaultPasswordCache: vi.fn(),
  cookies: vi.fn(),
  setDashboardAuthCookie: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("@/lib/auth/passwordChangeProof", () => ({ consumePasswordChangeProof: mocks.consumePasswordChangeProof }));
vi.mock("@/lib/auth/loginLimiter", () => ({ getClientIp: mocks.getClientIp }));
vi.mock("bcryptjs", () => ({ default: { genSalt: mocks.genSalt, hash: mocks.hash } }));
vi.mock("@/lib/localDb", () => ({ updateSettings: mocks.updateSettings }));
vi.mock("@/lib/auth/dashboardSession", () => ({
  DEFAULT_PASSWORD: mocks.DEFAULT_PASSWORD,
  invalidateDefaultPasswordCache: mocks.invalidateDefaultPasswordCache,
  setDashboardAuthCookie: mocks.setDashboardAuthCookie,
}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

const { POST } = await import("../../src/app/api/auth/change-password/route.js");

function request(body) {
  return new Request("http://durindoor.test/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/change-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClientIp.mockReturnValue("198.51.100.4");
    mocks.consumePasswordChangeProof.mockReturnValue(true);
    mocks.genSalt.mockResolvedValue("salt");
    mocks.hash.mockResolvedValue("new-hash");
    mocks.updateSettings.mockResolvedValue({ password: "new-hash" });
    mocks.cookies.mockResolvedValue({ set: vi.fn() });
  });

  it("rejects a missing or invalid flow proof before changing password", async () => {
    const missing = await POST(request({ newPassword: "long-enough-password" }));
    expect(missing.status).toBe(403);
    expect(mocks.updateSettings).not.toHaveBeenCalled();

    mocks.consumePasswordChangeProof.mockReturnValue(false);
    const invalid = await POST(request({ proof: "wrong", newPassword: "long-enough-password" }));
    expect(invalid.status).toBe(403);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects an empty replacement password", async () => {
    const response = await POST(request({ proof: "proof", newPassword: "" }));
    expect(response.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects the built-in default before consuming a proof", async () => {
    const response = await POST(request({ proof: "proof", newPassword: mocks.DEFAULT_PASSWORD }));

    expect(response.status).toBe(400);
    expect(mocks.consumePasswordChangeProof).not.toHaveBeenCalled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("changes password, clears default state, and creates dashboard session", async () => {
    const response = await POST(request({ proof: "proof", newPassword: "long-enough-password" }));

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
    expect(mocks.updateSettings).toHaveBeenCalledWith({ password: "new-hash" });
    expect(mocks.invalidateDefaultPasswordCache).toHaveBeenCalledOnce();
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledOnce();
  });
});
