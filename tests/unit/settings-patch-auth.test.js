import { beforeEach, describe, expect, it, vi } from "vitest";

describe("settingsPatchAuth.canModifySecurityCriticalSettings", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("accepts CLI token", async () => {
    vi.doMock("@/dashboardGuard", () => ({
      hasValidCliToken: vi.fn(async () => true),
    }));
    vi.doMock("@/lib/auth/dashboardSession", () => ({
      verifyDashboardAuthToken: vi.fn(async () => false),
    }));
    vi.doMock("next/headers", () => ({
      cookies: vi.fn(async () => ({ get: vi.fn(() => undefined) })),
    }));

    const { canModifySecurityCriticalSettings } = await import("../../src/lib/settings/settingsPatchAuth.js");
    await expect(canModifySecurityCriticalSettings({ headers: { get: vi.fn() } })).resolves.toBe(true);
  });

  it("accepts valid dashboard JWT", async () => {
    vi.doMock("@/dashboardGuard", () => ({
      hasValidCliToken: vi.fn(async () => false),
    }));
    vi.doMock("@/lib/auth/dashboardSession", () => ({
      verifyDashboardAuthToken: vi.fn(async (token) => token === "valid-jwt"),
    }));
    vi.doMock("next/headers", () => ({
      cookies: vi.fn(async () => ({
        get: vi.fn((name) => (name === "auth_token" ? { value: "valid-jwt" } : undefined)),
      })),
    }));

    const { canModifySecurityCriticalSettings } = await import("../../src/lib/settings/settingsPatchAuth.js");
    await expect(canModifySecurityCriticalSettings({ headers: { get: vi.fn() } })).resolves.toBe(true);
  });

  it.each([
    ["trusted loopback headers", { host: "localhost:20128", "x-9r-real-ip": "127.0.0.1", "x-9r-peer-token": "trusted-wrapper" }],
    ["remote headers", { host: "router.example.com", "x-9r-real-ip": "203.0.113.10" }],
  ])("rejects %s without JWT or CLI proof", async (_label, headers) => {
    vi.doMock("@/dashboardGuard", () => ({
      hasValidCliToken: vi.fn(async () => false),
    }));
    vi.doMock("@/lib/auth/dashboardSession", () => ({
      verifyDashboardAuthToken: vi.fn(async () => false),
    }));
    vi.doMock("next/headers", () => ({
      cookies: vi.fn(async () => ({ get: vi.fn(() => undefined) })),
    }));

    const { canModifySecurityCriticalSettings } = await import("../../src/lib/settings/settingsPatchAuth.js");
    const request = { headers: { get: (name) => headers[name] } };
    await expect(canModifySecurityCriticalSettings(request)).resolves.toBe(false);
  });

  it("fails closed for a malformed request", async () => {
    const { canModifySecurityCriticalSettings } = await import("../../src/lib/settings/settingsPatchAuth.js");
    await expect(canModifySecurityCriticalSettings(undefined)).resolves.toBe(false);
  });
});

describe("settingsPatchAuth.stripSettingKeys", () => {
  it("removes only keys that exist on the body", async () => {
    const { stripSettingKeys } = await import("../../src/lib/settings/settingsPatchAuth.js");
    const body = { requireLogin: false, theme: "dark" };
    expect(stripSettingKeys(body, ["requireLogin", "missing"])).toBe(true);
    expect(body).toEqual({ theme: "dark" });
    expect(stripSettingKeys(body, ["requireLogin"])).toBe(false);
  });
});
