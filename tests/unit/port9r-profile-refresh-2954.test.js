import { describe, expect, it, vi } from "vitest";
import { refreshProfile } from "../../src/app/api/providers/[id]/refresh-profile/profile.js";

const token = (claims) => `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.signature`;

describe("provider profile refresh", () => {
  it("extracts CodeBuddy claims and stores only a masked phone", async () => {
    const fetcher = vi.fn();
    const result = await refreshProfile({ provider: "codebuddy-cn", authType: "oauth", accessToken: token({ nickname: "Alice", preferred_username: "13812345678", sub: "user-1" }), providerSpecificData: { phone: "old", other: true } }, fetcher);
    expect(result).toEqual({ name: "Alice", providerSpecificData: { other: true, phoneMasked: "138****5678", uid: "user-1" } });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requests Qoder CN only from its fixed endpoint and masks phone names", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ name: "13812345678", id: "account" }));
    const result = await refreshProfile({ provider: "qoder-cn", authType: "oauth", accessToken: "secret", providerSpecificData: { baseUrl: "http://127.0.0.1" } }, fetcher);
    expect(fetcher.mock.calls[0][0]).toBe("https://openapi.qoder.com.cn/api/v1/userinfo");
    expect(fetcher.mock.calls[0][1].redirect).toBe("error");
    expect(result).toEqual({ name: "138****5678", providerSpecificData: { baseUrl: "http://127.0.0.1", phoneMasked: "138****5678", userId: "account" } });
    expect(JSON.stringify(result)).not.toContain("13812345678");
  });
  it("rejects other providers and non-OAuth credentials before fetching", async () => {
    const fetcher = vi.fn();
    await expect(refreshProfile({ provider: "qoder", authType: "oauth", accessToken: "secret" }, fetcher)).rejects.toThrow();
    await expect(refreshProfile({ provider: "qoder-cn", authType: "apikey", accessToken: "secret" }, fetcher)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

vi.mock("@/models", () => ({ getProviderConnectionById: vi.fn(), updateProviderConnection: vi.fn() }));
vi.mock("@/dashboardGuard", () => ({ canAccessManagementApi: vi.fn(), isOperatorRequest: vi.fn(), hasExactRequestOrigin: vi.fn() }));
vi.mock("@/lib/webLoginSession", () => ({ isIsolatedLoginRequest: vi.fn() }));

describe("profile refresh endpoint", () => {
  it("rejects cross-origin requests and returns no credentials on success", async () => {
    const guard = await import("@/dashboardGuard");
    const models = await import("@/models");
    const { POST } = await import("../../src/app/api/providers/[id]/refresh-profile/route.js");
    guard.canAccessManagementApi.mockResolvedValue(true);
    guard.isOperatorRequest.mockResolvedValue(true);
    guard.hasExactRequestOrigin.mockReturnValue(false);
    const request = new Request("http://localhost/api/providers/1/refresh-profile", { method: "POST", headers: { origin: "http://evil.test" } });
    expect((await POST(request, { params: { id: "1" } })).status).toBe(403);
    expect(models.getProviderConnectionById).not.toHaveBeenCalled();
    guard.hasExactRequestOrigin.mockReturnValue(true);
    models.getProviderConnectionById.mockResolvedValue({ provider: "codebuddy-cn", authType: "oauth", accessToken: token({ nickname: "Alice" }) });
    models.updateProviderConnection.mockResolvedValue({ accessToken: "secret" });
    const response = await POST(request, { params: { id: "1" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
  });
});
