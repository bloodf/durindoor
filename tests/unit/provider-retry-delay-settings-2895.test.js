import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settings: {},
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) => ({ body, status: init.status || 200 }),
  },
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
  updateSettingsWithPasswordEpoch: vi.fn(),
  PasswordEpochMismatchError: class PasswordEpochMismatchError extends Error {},
}));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: vi.fn(),
  resetComboScoring: vi.fn(),
}));

const settingsRoute = await import("../../src/app/api/settings/route.js");

describe("settings API per-provider retry-delay validation (#2895)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.settings = { retryDelayByProvider: {} };
    mocks.getSettings.mockImplementation(async () => ({ ...mocks.settings }));
    mocks.updateSettings.mockImplementation(async (patch) => {
      mocks.settings = { ...mocks.settings, ...patch };
      return { ...mocks.settings };
    });
  });

  it("persists valid numeric and Auto overrides through PATCH and GET", async () => {
    const retryDelayByProvider = { codex: 120, nvidia: "auto" };

    const patchResponse = await settingsRoute.PATCH({ json: async () => ({ retryDelayByProvider }) });
    const getResponse = await settingsRoute.GET();

    expect(patchResponse.status).toBe(200);
    expect(getResponse.status).toBe(200);
    expect(getResponse.body.retryDelayByProvider).toEqual(retryDelayByProvider);
  });

  it.each([
    null,
    [],
    Object.create({ inherited: true }),
    { nvidia: true },
    { nvidia: false },
    { nvidia: -1 },
    { nvidia: 0 },
    { nvidia: "120" },
    { nvidia: "AUTO" },
    { "": 30 },
    { nvidia: 604_801 },
    { nvidia: Number.POSITIVE_INFINITY },
  ])("rejects invalid retryDelayByProvider %j without changing settings", async (retryDelayByProvider) => {
    const before = structuredClone(mocks.settings);

    const response = await settingsRoute.PATCH({ json: async () => ({ retryDelayByProvider }) });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: "Invalid retryDelayByProvider" });
    expect(mocks.updateSettings).not.toHaveBeenCalled();
    expect(mocks.settings).toEqual(before);
  });
});
