import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init = {}) => ({ body, status: init.status || 200 })),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  updateSettingsWithPasswordEpoch: vi.fn(),
  PasswordEpochMismatchError: class PasswordEpochMismatchError extends Error {},
  applyOutboundProxyEnv: vi.fn(),
  resetComboRotation: vi.fn(),
  resetComboScoring: vi.fn(),
  verifyDashboardPassword: vi.fn(),
  canModifySecurityCriticalSettings: vi.fn(),
  stripSettingKeys: vi.fn((body, keys) => {
    let stripped = false;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        delete body[key];
        stripped = true;
      }
    }
    return stripped;
  }),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: vi.fn() })) }));
vi.mock("@/shared/constants/freeNoAuthProviders", () => ({ FREE_NO_AUTH_PROVIDER_IDS: [] }));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
  updateSettingsWithPasswordEpoch: mocks.updateSettingsWithPasswordEpoch,
  PasswordEpochMismatchError: mocks.PasswordEpochMismatchError,
}));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: mocks.applyOutboundProxyEnv }));
vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: mocks.resetComboRotation,
  resetComboScoring: mocks.resetComboScoring,
}));
vi.mock("@/lib/auth/dashboardSession", () => ({
  DEFAULT_PASSWORD: "123456",
  invalidateDefaultPasswordCache: vi.fn(),
  verifyDashboardPassword: mocks.verifyDashboardPassword,
  setDashboardAuthCookie: vi.fn(),
  validateDashboardPassword: () => null,
}));
vi.mock("@/lib/auth/passwordChangeProof", () => ({ resetPasswordChangeProofs: vi.fn() }));
vi.mock("bcryptjs", () => ({
  default: {
    genSalt: vi.fn(async () => "salt"),
    hash: vi.fn(async () => "new-hash"),
    compare: vi.fn(async () => false),
  },
}));
vi.mock("node:crypto", () => ({ default: { randomBytes: vi.fn(() => ({ toString: () => "rotated-epoch" })) } }));

vi.mock("@/lib/settings/settingsPatchAuth", async () => {
  const actual = await vi.importActual("@/lib/settings/settingsPatchAuth");
  return {
    ...actual,
    canModifySecurityCriticalSettings: mocks.canModifySecurityCriticalSettings,
    stripSettingKeys: mocks.stripSettingKeys,
  };
});

const { PATCH } = await import("../../src/app/api/settings/route.js");
const {
  AUTH_CRITICAL_SETTING_KEYS,
  SECRET_SETTING_KEYS,
} = await import("../../src/lib/settings/settingsPatchAuth.js");

describe("settings PATCH mass-assignment protection (GHSA-vmjq)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: true, authMode: "password" });
    mocks.updateSettings.mockImplementation(async (updates) => ({ ...updates }));
    mocks.canModifySecurityCriticalSettings.mockResolvedValue(false);
  });

  it("strips secret keys before persistence for every caller", async () => {
    await PATCH({
      json: async () => ({
        password: "attacker-hash",
        passwordSessionEpoch: "attacker-epoch",
        mitmSudoEncrypted: "attacker-ciphertext",
        theme: "dark",
      }),
    });

    const persisted = mocks.updateSettings.mock.calls[0][0];
    expect(persisted).toEqual({ theme: "dark" });
    expect(mocks.stripSettingKeys).toHaveBeenCalledWith(expect.any(Object), SECRET_SETTING_KEYS);
  });

  it.each([
    "requireLogin",
    "authMode",
    "oidcIssuerUrl",
    "oidcClientId",
    "oidcClientSecret",
    "oidcScopes",
    "oidcLoginLabel",
    "tunnelDashboardAccess",
    "enableObservability",
    "outboundProxyEnabled",
    "outboundProxyUrl",
    "outboundNoProxy",
    "exposeComboOnly",
  ])("drops unauthenticated mass assignment of %s", async (key) => {
    await PATCH({
      json: async () => ({ [key]: key === "requireLogin" ? false : `value-for-${key}` }),
    });

    expect(mocks.canModifySecurityCriticalSettings).toHaveBeenCalled();
    expect(mocks.stripSettingKeys).toHaveBeenCalledWith(expect.any(Object), AUTH_CRITICAL_SETTING_KEYS);
    const persisted = mocks.updateSettings.mock.calls[0]?.[0] ?? {};
    expect(persisted).not.toHaveProperty(key);
  });

  it("allows authenticated sessions to persist auth-critical settings", async () => {
    mocks.canModifySecurityCriticalSettings.mockResolvedValue(true);

    await PATCH({
      json: async () => ({
        requireLogin: false,
        authMode: "oidc",
        oidcIssuerUrl: "https://idp.example.com",
        oidcClientId: "client-id",
        oidcClientSecret: "client-secret",
        outboundProxyEnabled: true,
        outboundProxyUrl: "http://proxy.local:8080",
        exposeComboOnly: true,
      }),
    });

    expect(mocks.updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      requireLogin: false,
      authMode: "oidc",
      oidcIssuerUrl: "https://idp.example.com",
      oidcClientId: "client-id",
      oidcClientSecret: "client-secret",
      outboundProxyEnabled: true,
      outboundProxyUrl: "http://proxy.local:8080",
      exposeComboOnly: true,
    }));
  });

  it("still blocks secret mass assignment for authenticated sessions", async () => {
    mocks.canModifySecurityCriticalSettings.mockResolvedValue(true);

    await PATCH({
      json: async () => ({
        requireLogin: true,
        password: "attacker-hash",
        mitmSudoEncrypted: "attacker-ciphertext",
      }),
    });

    const persisted = mocks.updateSettings.mock.calls[0][0];
    expect(persisted).toEqual({ requireLogin: true });
  });

  it("does not strip non-critical settings for unauthenticated callers", async () => {
    await PATCH({
      json: async () => ({
        hidePaidModels: true,
        comboStrategy: "round-robin",
        requireLogin: false,
      }),
    });

    const persisted = mocks.updateSettings.mock.calls[0][0];
    expect(persisted).toMatchObject({
      hidePaidModels: true,
      comboStrategy: "round-robin",
    });
    expect(persisted).not.toHaveProperty("requireLogin");
  });
});
