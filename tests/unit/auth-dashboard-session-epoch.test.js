import { beforeEach, describe, expect, it, vi } from "vitest";

// Fail-closed JWT loading requires an explicit secret; do not rely on auto-mint.
process.env.JWT_SECRET ??= "unit-test-jwt-secret-do-not-reuse";

const mocks = vi.hoisted(() => ({ getSettings: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));

const { createDashboardAuthToken, verifyDashboardAuthToken } = await import("../../src/lib/auth/dashboardSession.js");

describe("dashboard password session epoch", () => {
  beforeEach(() => {
    mocks.getSettings.mockResolvedValue({ passwordSessionEpoch: 1 });
  });

  it("rejects a password session from an older password epoch", async () => {
    const token = await createDashboardAuthToken({ passwordSessionEpoch: 0 });
    await expect(verifyDashboardAuthToken(token)).resolves.toBe(false);
  });

  it("keeps OIDC sessions independent of password resets", async () => {
    const token = await createDashboardAuthToken({ oidc: true });
    await expect(verifyDashboardAuthToken(token)).resolves.toBe(true);
  });
});
