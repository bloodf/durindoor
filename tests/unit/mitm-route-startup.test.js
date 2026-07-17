import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMitmStatus: vi.fn(),
  loadEncryptedPassword: vi.fn(),
  startServer: vi.fn(),
  trustCert: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (data, init = {}) => ({
      status: init.status || 200,
      json: async () => data,
    }),
  },
}));

vi.mock("@/mitm/manager", () => ({
  getMitmStatus: mocks.getMitmStatus,
  startServer: mocks.startServer,
  stopServer: vi.fn(),
  enableToolDNS: vi.fn(),
  disableToolDNS: vi.fn(),
  trustCert: mocks.trustCert,
  getCachedPassword: () => null,
  setCachedPassword: vi.fn(),
  loadEncryptedPassword: mocks.loadEncryptedPassword,
  isSudoPasswordRequired: () => false,
  hasMitmCleanupState: () => false,
  isAdmin: () => false,
  initDbHooks: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(() => ({})),
  updateSettings: vi.fn(),
}));

import { PATCH, POST } from "../../src/app/api/cli-tools/antigravity-mitm/route.js";

describe("MITM startup route contention", () => {
  beforeEach(() => {
    mocks.startServer.mockReset();
    mocks.trustCert.mockReset();
    mocks.getMitmStatus.mockReset();
    mocks.loadEncryptedPassword.mockReset();
    mocks.loadEncryptedPassword.mockResolvedValue(null);
  });

  it("returns a stable HTTP 409 for an in-progress startup", async () => {
    mocks.startServer.mockRejectedValue(Object.assign(
      new Error("MITM server is already starting (lock contention)"),
      { code: "MITM_START_IN_PROGRESS" },
    ));

    const response = await POST({
      json: async () => ({ apiKey: "fixture-api-key" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "MITM server is already starting (lock contention)",
      code: "MITM_START_IN_PROGRESS",
    });
  });

  it("purges legacy credentials before accepting a provided sudo password", async () => {
    const purgeError = new Error("legacy credential purge failed");
    mocks.loadEncryptedPassword.mockRejectedValue(purgeError);

    const response = await POST({
      json: async () => ({
        apiKey: "fixture-api-key",
        sudoPassword: "provided-password",
      }),
    });

    expect(response.status).toBe(500);
    expect(mocks.startServer).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ error: purgeError.message });
  });

  it("allows the certificate trust action without a DNS tool identifier", async () => {
    mocks.getMitmStatus.mockResolvedValue({ certTrusted: true });

    const response = await PATCH({
      json: async () => ({ action: "trust-cert" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.trustCert).toHaveBeenCalledWith("");
    await expect(response.json()).resolves.toEqual({ success: true, certTrusted: true });
  });
});
