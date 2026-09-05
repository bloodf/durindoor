import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init = {}) => ({ body, status: init.status || 200 })),
  getSettings: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("@/shared/constants/freeNoAuthProviders", () => ({ FREE_NO_AUTH_PROVIDER_IDS: [] }));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: vi.fn(),
  updateSettingsWithPasswordEpoch: vi.fn(),
  PasswordEpochMismatchError: class PasswordEpochMismatchError extends Error {},
}));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({ resetComboRotation: vi.fn(), resetComboScoring: vi.fn() }));
vi.mock("@/lib/auth/dashboardSession", () => ({
  DEFAULT_PASSWORD: "123456",
  invalidateDefaultPasswordCache: vi.fn(),
  setDashboardAuthCookie: vi.fn(),
  validateDashboardPassword: vi.fn(),
  verifyDashboardPassword: vi.fn(),
}));
vi.mock("@/lib/auth/passwordChangeProof", () => ({ resetPasswordChangeProofs: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("bcryptjs", () => ({ default: {} }));
vi.mock("@/lib/settings/settingsPatchAuth", () => ({
  AUTH_CRITICAL_SETTING_KEYS: [], SECRET_SETTING_KEYS: [], canModifySecurityCriticalSettings: vi.fn(), stripSettingKeys: vi.fn(),
}));

const { GET } = await import("../../src/app/api/settings/route.js");
const originalObservability = process.env.OBSERVABILITY_ENABLED;
const originalRequestLogs = process.env.ENABLE_REQUEST_LOGS;

describe("GET /api/settings observability", () => {
  beforeEach(() => {
    mocks.getSettings.mockResolvedValue({ enableObservability: false });
    delete process.env.OBSERVABILITY_ENABLED;
    delete process.env.ENABLE_REQUEST_LOGS;
  });

  afterEach(() => {
    if (originalObservability === undefined) delete process.env.OBSERVABILITY_ENABLED;
    else process.env.OBSERVABILITY_ENABLED = originalObservability;
    if (originalRequestLogs === undefined) delete process.env.ENABLE_REQUEST_LOGS;
    else process.env.ENABLE_REQUEST_LOGS = originalRequestLogs;
    vi.clearAllMocks();
  });

  it("prefers a non-empty OBSERVABILITY_ENABLED value over the stored setting", async () => {
    process.env.OBSERVABILITY_ENABLED = "true";
    process.env.ENABLE_REQUEST_LOGS = "false";
    const response = await GET();
    expect(response.body.enableObservability).toBe(true);
    expect(response.body).not.toHaveProperty("ENABLE_REQUEST_LOGS");
  });

  it("falls back to the stored setting when OBSERVABILITY_ENABLED is empty or unset", async () => {
    mocks.getSettings.mockResolvedValue({ enableObservability: true });
    process.env.OBSERVABILITY_ENABLED = "";
    expect((await GET()).body.enableObservability).toBe(true);
    delete process.env.OBSERVABILITY_ENABLED;
    expect((await GET()).body.enableObservability).toBe(true);
  });

  it("does not leak enableRequestLogs or arbitrary env state", async () => {
    process.env.OBSERVABILITY_ENABLED = "true";
    const response = await GET();
    expect(response.body).not.toHaveProperty("enableRequestLogs");
    expect(response.body).not.toHaveProperty("env");
    expect(response.body).not.toHaveProperty("process");
  });
});
