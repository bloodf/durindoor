import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ settings: {}, getSettings: vi.fn(), updateSettings: vi.fn(), cookieDelete: vi.fn() }));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ delete: mocks.cookieDelete }) }));

const session = await import("../../src/lib/auth/dashboardSession.js");
const logout = await import("../../src/app/api/auth/logout/route.js");

describe("logout session revocation requires an authenticated same-origin request (#2459)", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", "unit-test-jwt-secret-do-not-reuse");
    session.__resetJwtSecretForTests();
    mocks.settings = { passwordSessionEpoch: "epoch-A", mfaEnabled: false };
    mocks.getSettings.mockImplementation(async () => ({ ...mocks.settings }));
    mocks.updateSettings.mockImplementation(async (patch) => {
      mocks.settings = { ...mocks.settings, ...patch };
    });
    mocks.cookieDelete.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    session.__resetJwtSecretForTests();
  });

  function request({ origin = "http://localhost", token } = {}) {
    return new Request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: {
        host: "localhost",
        ...(origin ? { origin } : {}),
        ...(token ? { cookie: `auth_token=${token}` } : {}),
      },
    });
  }

  it("does not rotate the epoch for anonymous logout", async () => {
    await logout.POST(request({ token: undefined }));

    expect(mocks.settings.passwordSessionEpoch).toBe("epoch-A");
    expect(mocks.cookieDelete).toHaveBeenCalledWith("auth_token");
  });

  it("does not rotate the epoch for a cross-origin request with a valid cookie", async () => {
    const token = await session.createDashboardAuthToken({ passwordSessionEpoch: "epoch-A" });

    await logout.POST(request({ origin: "https://attacker.example", token }));

    expect(mocks.settings.passwordSessionEpoch).toBe("epoch-A");
    expect(await session.verifyDashboardAuthToken(token)).toBe(true);
  });

  it("rotates the epoch for an authenticated same-origin logout", async () => {
    const token = await session.createDashboardAuthToken({ passwordSessionEpoch: "epoch-A" });

    await logout.POST(request({ token }));

    expect(mocks.settings.passwordSessionEpoch).not.toBe("epoch-A");
    expect(await session.verifyDashboardAuthToken(token)).toBe(false);
  });
});
