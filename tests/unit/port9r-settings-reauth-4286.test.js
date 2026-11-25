import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  verifyDashboardPassword: vi.fn(),
  hasValidCliToken: vi.fn(),
  canModify: vi.fn(),
  checkLock: vi.fn(),
  recordFail: vi.fn(),
  recordSuccess: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: (body, init) => Response.json(body, init) } }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: vi.fn() })) }));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
  updateSettingsWithPasswordEpoch: vi.fn(),
  PasswordEpochMismatchError: class extends Error {},
}));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn(), resetComboScoring: vi.fn() }));
vi.mock("@/lib/auth/dashboardSession", () => ({
  DEFAULT_PASSWORD: "123456",
  invalidateDefaultPasswordCache: vi.fn(),
  verifyDashboardPassword: mocks.verifyDashboardPassword,
  setDashboardAuthCookie: vi.fn(),
  validateDashboardPassword: () => null,
}));
vi.mock("@/lib/auth/passwordChangeProof", () => ({ resetPasswordChangeProofs: vi.fn() }));
vi.mock("@/lib/auth/loginLimiter", () => ({
  checkLock: mocks.checkLock,
  recordFail: mocks.recordFail,
  recordSuccess: mocks.recordSuccess,
  getClientIp: () => "203.0.113.7",
}));
vi.mock("@/dashboardGuard", () => ({ hasValidCliToken: mocks.hasValidCliToken, isOperatorRequest: vi.fn(async () => true) }));
vi.mock("@/lib/settings/settingsPatchAuth", async () => ({
  ...(await vi.importActual("@/lib/settings/settingsPatchAuth")),
  canModifySecurityCriticalSettings: mocks.canModify,
}));

const { PATCH } = await import("../../src/app/api/settings/route.js");

const CURRENT = {
  requireLogin: true, requireApiKey: true, tunnelDashboardAccess: false, authMode: "password",
  oidcIssuerUrl: "https://id.example", oidcAllowedEmails: ["ops@example.com"],
};
const patch = (body) => PATCH(new Request("http://localhost/api/settings", { method: "PATCH", body: JSON.stringify(body) }));

describe("9router#4286: weakening security settings needs the current password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ ...CURRENT });
    mocks.updateSettings.mockImplementation(async (updates) => ({ ...CURRENT, ...updates }));
    mocks.canModify.mockResolvedValue(true);
    mocks.hasValidCliToken.mockResolvedValue(false);
    mocks.verifyDashboardPassword.mockImplementation(async (value) => value === "correct horse");
    mocks.checkLock.mockReturnValue({ locked: false });
  });

  it.each([
    ["requireLogin", false],
    ["requireApiKey", false],
    ["tunnelDashboardAccess", true],
    ["authMode", "oidc"],
    ["oidcIssuerUrl", "https://attacker.example"],
    ["oidcClientSecret", "new-secret"],
    ["oidcAllowedEmails", ["ops@example.com", "intruder@example.com"]],
  ])("refuses a session-only change of %s", async (key, value) => {
    const response = await patch({ [key]: value });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "REAUTH_REQUIRED", fields: [key] });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(mocks.recordFail).not.toHaveBeenCalled();
  });

  it("rejects a wrong password and counts it toward the login lockout", async () => {
    const response = await patch({ requireLogin: false, currentPassword: "guess" });

    expect(response.status).toBe(401);
    expect(mocks.recordFail).toHaveBeenCalledWith("203.0.113.7");
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("does not check a password while the caller is locked out", async () => {
    mocks.checkLock.mockReturnValue({ locked: true, retryAfter: 30 });

    const response = await patch({ requireLogin: false, currentPassword: "correct horse" });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(mocks.verifyDashboardPassword).not.toHaveBeenCalled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("applies the change with the password and never stores it", async () => {
    expect((await patch({ requireLogin: false, currentPassword: "correct horse" })).status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith({ requireLogin: false });
    expect(mocks.recordSuccess).toHaveBeenCalled();
  });

  it("lets a valid CLI token through without a password", async () => {
    mocks.hasValidCliToken.mockResolvedValue(true);

    expect((await patch({ authMode: "oidc" })).status).toBe(200);
    expect(mocks.verifyDashboardPassword).not.toHaveBeenCalled();
  });

  it.each([
    ["turning protection on", { requireLogin: true, requireApiKey: true, tunnelDashboardAccess: false }],
    ["re-saving stored sign-in values", { authMode: "password", oidcIssuerUrl: "https://id.example", oidcAllowedEmails: "OPS@example.com", oidcAllowedDomains: [], oidcClientSecret: "" }],
    ["an unrelated setting", { rtkEnabled: true }],
  ])("does not prompt for %s", async (_label, body) => {
    expect((await patch(body)).status).toBe(200);
    expect(mocks.verifyDashboardPassword).not.toHaveBeenCalled();
  });
});
