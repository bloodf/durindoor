import { describe, expect, it, vi, beforeEach } from "vitest";
import canopywave from "../../open-sse/providers/registry/canopywave.js";
import swiftrouter from "../../open-sse/providers/registry/swiftrouter.js";
import { githubRateLimit } from "../../open-sse/handlers/chatCore/githubRateLimit.js";
const mocks = vi.hoisted(() => ({ get: vi.fn(), refresh: vi.fn(), proxy: vi.fn(), denied: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: mocks.get }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: mocks.proxy }));
vi.mock("@/shared/services/providerCredentials", () => ({ refreshAndUpdateCredentials: mocks.refresh }));
vi.mock("@/dashboardGuard", () => ({ isNonAdminApiKeyCaller: mocks.denied }));
import { POST } from "../../src/app/api/providers/[id]/refresh-token/route.js";
describe("provider management #871", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.denied.mockResolvedValue(false); });
  it("registers compatible provider endpoints and model discovery", () => {
    expect(canopywave.transport.baseUrl).toBe("https://inference.canopywave.io/v1/chat/completions");
    expect(swiftrouter.modelsFetcher.url).toBe("https://api.swiftrouter.com/v1/models");
  });
  it("parses reset as epoch seconds and excludes arbitrary text", () => {
    const result = githubRateLimit(new Headers({ "x-ratelimit-reset": "1700000000", "x-ratelimit-limit": "100", "x-ratelimit-remaining": "0", "x-ratelimit-resource": "secret" }), 1700000000000);
    expect(result).toEqual({ limit: 100, remaining: 0, resetAt: "2023-11-14T22:13:20.000Z", lastSeenAt: "2023-11-14T22:13:20.000Z" });
    expect(githubRateLimit(new Headers({ "retry-after": "60" }), 1700000000000).resetAt).toBe("2023-11-14T22:14:20.000Z");
  });
  it("denies non-admin callers before reading credentials", async () => {
    mocks.denied.mockResolvedValue(true);
    expect((await POST({}, { params: Promise.resolve({ id: "a" }) })).status).toBe(403);
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it("rotates Codex credentials through the guarded refresh service", async () => {
    const connection = { id: "a", provider: "codex", authType: "oauth", refreshToken: "secret" };
    mocks.get.mockResolvedValue(connection); mocks.proxy.mockResolvedValue({});
    mocks.refresh.mockResolvedValue({ refreshed: true, connection: { expiresAt: "later" } });
    const response = await POST({}, { params: Promise.resolve({ id: "a" }) });
    expect(await response.json()).toEqual({ ok: true, expiresAt: "later" });
    expect(mocks.refresh).toHaveBeenCalledWith(connection, true, {});
  });
});
