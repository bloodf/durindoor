import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  cookies: vi.fn(),
  getSettings: vi.fn(),
  isOidcConfigured: vi.fn(),
  getDashboardAuthSession: vi.fn(),
  isUsingDefaultPassword: vi.fn(async () => false),
}));

vi.mock("next/server", () => ({ NextResponse: { json: mocks.json } }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/lib/auth/oidc", () => ({ isOidcConfigured: mocks.isOidcConfigured }));
vi.mock("@/lib/auth/dashboardSession", () => ({
  getDashboardAuthSession: mocks.getDashboardAuthSession,
  isUsingDefaultPassword: mocks.isUsingDefaultPassword,
}));

const { GET } = await import("../../src/app/api/auth/status/route.js");

describe("GET /api/auth/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: true, authMode: "password" });
    mocks.cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "session-token" })) });
    mocks.isOidcConfigured.mockReturnValue(false);
    vi.unstubAllEnvs();
  });

  it("reports authentication status for a valid or invalid session", async () => {
    mocks.getDashboardAuthSession.mockResolvedValueOnce({ authenticated: true });
    expect((await GET()).body.authenticated).toBe(true);

    mocks.getDashboardAuthSession.mockResolvedValueOnce(null);
    expect((await GET()).body.authenticated).toBe(false);
  });

  // Header.js reads `data.displayName` first when labelling the signed-in user,
  // so the port that added `authenticated` must not drop the existing field.
  it("keeps returning displayName for the header", async () => {
    mocks.getDashboardAuthSession.mockResolvedValueOnce({ oidc: true, oidcName: "Ada Lovelace" });
    expect((await GET()).body.displayName).toBe("Ada Lovelace");

    mocks.getDashboardAuthSession.mockResolvedValueOnce(null);
    expect((await GET()).body.displayName).toBe("Password user");
  });
  it("passes settings through to isUsingDefaultPassword and forwards its result", async () => {
    mocks.getDashboardAuthSession.mockResolvedValue(null);
    const settings = { requireLogin: true, authMode: "password", password: "custom-hash" };
    mocks.getSettings.mockResolvedValue(settings);
    mocks.isUsingDefaultPassword.mockResolvedValueOnce(false);

    expect((await GET()).body.usingDefaultPassword).toBe(false);
    expect(mocks.isUsingDefaultPassword).toHaveBeenLastCalledWith(settings);

    mocks.isUsingDefaultPassword.mockResolvedValueOnce(true);
    expect((await GET()).body.usingDefaultPassword).toBe(true);
  });


  it("fails closed when status dependencies throw", async () => {
    mocks.getSettings.mockRejectedValue(new Error("database unavailable"));

    const response = await GET();

    expect(response.body.authenticated).toBe(false);
    expect(response.body.requireLogin).toBe(true);
    expect(response.body.usingDefaultPassword).toBe(false);
  });
});
