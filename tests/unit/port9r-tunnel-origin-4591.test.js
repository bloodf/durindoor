import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: vi.fn(async (token) => token === "valid") }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: vi.fn(async () => "machine") }));
const { canAccessLocalOnlyRoute } = await import("../../src/dashboardGuard.js");

function request(path, origin, token = "valid") {
  return { nextUrl: { pathname: path }, url: `https://gateway.example${path}`, method: "POST", headers: new Headers({ host: "gateway.example", origin }), cookies: { get: () => ({ value: token }) } };
}

describe("remote dashboard tunnel controls", () => {
  it.each(["/api/tunnel/enable", "/api/tunnel/disable"])("allows authenticated same-origin %s", async (path) => {
    expect(await canAccessLocalOnlyRoute(request(path, "https://gateway.example"))).toBe(true);
    expect(await canAccessLocalOnlyRoute(request(path, "https://evil.example"))).toBe(false);
    expect(await canAccessLocalOnlyRoute(request(path, "https://gateway.example", "invalid"))).toBe(false);
  });
  it("does not extend remote access to other local routes", async () => {
    expect(await canAccessLocalOnlyRoute(request("/api/tunnel/enable/extra", "https://gateway.example"))).toBe(false);
  });
});
