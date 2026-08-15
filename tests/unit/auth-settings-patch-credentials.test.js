import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init = {}) => ({ body, status: init.status || 200 })),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  genSalt: vi.fn(),
  hash: vi.fn(),
  compare: vi.fn(),
  invalidateDefaultPasswordCache: vi.fn(),
  applyOutboundProxyEnv: vi.fn(),
  resetComboRotation: vi.fn(),
  resetComboScoring: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("@/shared/constants/freeNoAuthProviders", () => ({ FREE_NO_AUTH_PROVIDER_IDS: [] }));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: mocks.applyOutboundProxyEnv }));
vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: mocks.resetComboRotation,
  resetComboScoring: mocks.resetComboScoring,
}));
vi.mock("@/lib/auth/dashboardSession", () => ({
  DEFAULT_PASSWORD: "123456",
  invalidateDefaultPasswordCache: mocks.invalidateDefaultPasswordCache,
  validateDashboardPassword: (password) => {
    if (typeof password !== "string" || password.length < 6) return "Password must be at least 6 characters";
    return password === "123456" ? "Password must not use the built-in default" : null;
  },
}));
vi.mock("bcryptjs", () => ({
  default: {
    genSalt: mocks.genSalt,
    hash: mocks.hash,
    compare: mocks.compare,
  },
}));

const { PATCH } = await import("../../src/app/api/settings/route.js");

describe("settings PATCH password credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.genSalt.mockResolvedValue("salt");
    mocks.hash.mockResolvedValue("new-hash");
    mocks.updateSettings.mockImplementation(async (updates) => updates);
    mocks.compare.mockResolvedValue(false);
  });

  it("rejects newPassword equal to the built-in default", async () => {
    mocks.getSettings.mockResolvedValue({ password: "stored-hash" });

    const response = await PATCH({
      json: async () => ({
        currentPassword: "long-enough-current",
        newPassword: "123456",
      }),
    });

    expect(response.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(mocks.invalidateDefaultPasswordCache).not.toHaveBeenCalled();
  });

  it("rejects newPassword equal to INITIAL_PASSWORD when no stored hash is configured", async () => {
    vi.stubEnv("INITIAL_PASSWORD", "operator-secret");
    mocks.getSettings.mockResolvedValue({});

    const response = await PATCH({
      json: async () => ({ newPassword: "operator-secret" }),
    });

    expect(response.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("rejects newPassword equal to INITIAL_PASSWORD when stored hash matches it", async () => {
    vi.stubEnv("INITIAL_PASSWORD", "operator-secret");
    mocks.compare.mockResolvedValue(true);
    mocks.getSettings.mockResolvedValue({ password: "stored-hash" });

    const response = await PATCH({
      json: async () => ({
        currentPassword: "operator-secret",
        newPassword: "operator-secret",
      }),
    });

    expect(response.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("strips currentPassword and newPassword from the persistence body", async () => {
    mocks.getSettings.mockResolvedValue({ password: "stored-hash" });
    mocks.compare.mockResolvedValue(true);
    mocks.updateSettings.mockResolvedValue({ password: "new-hash" });

    const response = await PATCH({
      json: async () => ({
        currentPassword: "long-enough-current",
        newPassword: "long-enough-new",
        tunnelDashboardAccess: false,
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      password: "new-hash",
      tunnelDashboardAccess: false,
    }));
    const persisted = mocks.updateSettings.mock.calls[0][0];
    expect(persisted).not.toHaveProperty("currentPassword");
    expect(persisted).not.toHaveProperty("newPassword");
  });

  it("uses INITIAL_PASSWORD for the no-hash current-password check", async () => {
    vi.stubEnv("INITIAL_PASSWORD", "operator-secret");
    mocks.getSettings.mockResolvedValue({});

    const response = await PATCH({
      json: async () => ({
        currentPassword: "wrong",
        newPassword: "long-enough-new",
      }),
    });

    expect(response.status).toBe(401);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("accepts INITIAL_PASSWORD as the current password when no hash is stored", async () => {
    vi.stubEnv("INITIAL_PASSWORD", "operator-secret");
    mocks.getSettings.mockResolvedValue({});

    const response = await PATCH({
      json: async () => ({
        currentPassword: "operator-secret",
        newPassword: "long-enough-new",
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      password: "new-hash",
    }));
  });
});
