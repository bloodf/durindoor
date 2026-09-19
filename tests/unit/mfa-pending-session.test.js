import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSettings: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));

const {
  createDashboardAuthToken,
  verifyDashboardAuthToken,
  getDashboardAuthSession,
  createMfaPendingToken,
  getMfaPendingSession,
  __resetJwtSecretForTests,
} = await import("../../src/lib/auth/dashboardSession.js");

describe("MFA-pending tokens (decolua/9router#4144)", () => {
  beforeEach(() => {
    vi.stubEnv("JWT_SECRET", "unit-test-jwt-secret-do-not-reuse");
    __resetJwtSecretForTests();
    mocks.getSettings.mockResolvedValue({ passwordSessionEpoch: "initial" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    __resetJwtSecretForTests();
  });

  it("round-trips through getMfaPendingSession", async () => {
    const token = await createMfaPendingToken();
    const payload = await getMfaPendingSession(token);
    expect(payload?.scope).toBe("mfa_pending");
  });

  it("never verifies as a real session, even under a matching password epoch", async () => {
    const token = await createMfaPendingToken({ passwordSessionEpoch: "initial" });
    await expect(verifyDashboardAuthToken(token)).resolves.toBe(false);
    await expect(getDashboardAuthSession(token)).resolves.toBeNull();
  });

  it("rejects a real session token as a pending session", async () => {
    const token = await createDashboardAuthToken({ passwordSessionEpoch: "initial" });
    await expect(getMfaPendingSession(token)).resolves.toBeNull();
  });

  it("rejects malformed/empty tokens", async () => {
    await expect(getMfaPendingSession("")).resolves.toBeNull();
    await expect(getMfaPendingSession("garbage")).resolves.toBeNull();
  });
});
