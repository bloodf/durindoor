import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init = {}) => ({ body, status: init.status || 200 })),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  genSalt: vi.fn(),
  hash: vi.fn(),
  invalidateDefaultPasswordCache: vi.fn(),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("@/shared/constants/freeNoAuthProviders", () => ({ FREE_NO_AUTH_PROVIDER_IDS: [] }));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: vi.fn(),
  resetComboScoring: vi.fn(),
}));
vi.mock("@/lib/auth/dashboardSession", () => ({
  invalidateDefaultPasswordCache: mocks.invalidateDefaultPasswordCache,
}));
vi.mock("bcryptjs", () => ({ default: { genSalt: mocks.genSalt, hash: mocks.hash } }));

const { PATCH } = await import("../../src/app/api/settings/route.js");

describe("settings password update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({});
    mocks.genSalt.mockResolvedValue("salt");
    mocks.hash.mockResolvedValue("new-hash");
    mocks.updateSettings.mockResolvedValue({ password: "new-hash" });
  });

  it("invalidates default-password state only after storing a replacement password", async () => {
    const response = await PATCH({
      json: async () => ({ newPassword: "long-enough-password" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith({ password: "new-hash" });
    expect(mocks.invalidateDefaultPasswordCache).toHaveBeenCalledOnce();
  });

  it("does not invalidate default-password state when storing the replacement fails", async () => {
    mocks.updateSettings.mockRejectedValue(new Error("database unavailable"));

    const response = await PATCH({
      json: async () => ({ newPassword: "long-enough-password" }),
    });

    expect(response.status).toBe(500);
    expect(mocks.invalidateDefaultPasswordCache).not.toHaveBeenCalled();
  });
});
