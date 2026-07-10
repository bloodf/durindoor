import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init = {}) => ({ body, status: init.status || 200 }),
  },
}));
vi.mock("@/lib/localDb", () => mocks);
vi.mock("@/lib/network/outboundProxy", () => ({ applyOutboundProxyEnv: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: vi.fn(),
  resetComboScoring: vi.fn(),
}));
vi.mock("@/shared/services/quotaAutoPing", () => ({ runQuotaAutoPingTick: vi.fn() }));

const settingsRoute = await import("../../src/app/api/settings/route.js");

describe("settings API legacy MITM secret filtering", () => {
  beforeEach(() => vi.clearAllMocks());

  it("never returns legacy sudo ciphertext from GET", async () => {
    mocks.getSettings.mockResolvedValue({
      theme: "dark",
      password: "password-hash",
      oidcClientSecret: "oidc-secret",
      mitmSudoEncrypted: "machine-decryptable-ciphertext",
    });

    const response = await settingsRoute.GET();

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ theme: "dark", hasPassword: true });
    expect(response.body).not.toHaveProperty("password");
    expect(response.body).not.toHaveProperty("oidcClientSecret");
    expect(response.body).not.toHaveProperty("mitmSudoEncrypted");
  });

  it("never returns legacy sudo ciphertext from PATCH", async () => {
    mocks.updateSettings.mockResolvedValue({
      theme: "light",
      mitmSudoEncrypted: "machine-decryptable-ciphertext",
    });

    const response = await settingsRoute.PATCH({
      json: async () => ({ theme: "light" }),
    });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ theme: "light" }));
    expect(response.body).not.toHaveProperty("mitmSudoEncrypted");
  });
});
