import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveClientApiKey: vi.fn(),
  getApiKeyById: vi.fn(),
  getApiKeyProviderConnectionIds: vi.fn(),
  getApiKeyUsageLimitStatus: vi.fn(),
  getApiKeyUsageTotals: vi.fn(),
  getProviderConnections: vi.fn(),
  listProviderQuotaSnapshots: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: (body, init = {}) => ({ body, status: init.status || 200 }) },
}));
vi.mock("@/sse/services/auth.js", () => ({ resolveClientApiKey: mocks.resolveClientApiKey }));
vi.mock("@/lib/localDb", () => mocks);

const route = await import("../../src/app/api/usage/me/route.js");

function request(query = "") {
  return new Request(`http://localhost/api/usage/me${query}`, {
    headers: { Authorization: "Bearer sk-caller-key" },
  });
}

describe("GET /api/usage/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getApiKeyById.mockResolvedValue({
      id: "key-1",
      name: "caller",
      isActive: true,
      expiresAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      dailyLimitTokens: null,
      policy: { maxTokens: null, maxCostUsd: null },
    });
    mocks.getApiKeyUsageTotals.mockResolvedValue({
      totalTokens: 42,
      totalCost: 0.5,
      totalRequests: 3,
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
    mocks.getApiKeyUsageLimitStatus.mockResolvedValue({ enforced: false, exceeded: false });
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue([]);
    mocks.getProviderConnections.mockResolvedValue([
      { id: "conn-1", provider: "openai", name: "primary", key: "secret-should-never-leak" },
      { id: "conn-2", provider: "anthropic", name: "secondary", key: "another-secret" },
    ]);
    mocks.listProviderQuotaSnapshots.mockResolvedValue([]);
  });

  it("rejects a caller with no resolvable stored API key identity", async () => {
    mocks.resolveClientApiKey.mockResolvedValue({ apiKey: null, auth: { ok: true, stored: false, operator: true } });
    const res = await route.GET(request());
    expect(res.status).toBe(401);
    expect(mocks.getApiKeyById).not.toHaveBeenCalled();
  });

  it("rejects an invalid or expired key", async () => {
    mocks.resolveClientApiKey.mockResolvedValue({ apiKey: "sk-bad", auth: { ok: false, stored: true, apiKeyId: undefined } });
    const res = await route.GET(request());
    expect(res.status).toBe(401);
  });

  it("scopes the response to only the caller's own key: no secrets, no other keys", async () => {
    mocks.resolveClientApiKey.mockResolvedValue({
      apiKey: "sk-caller-key",
      auth: { ok: true, stored: true, apiKeyId: "key-1" },
    });
    const res = await route.GET(request());
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("key-1");
    expect(res.body.usage.lifetime.totalTokens).toBe(42);
    expect(res.body).not.toHaveProperty("key");
    for (const connection of res.body.connections) {
      expect(connection).not.toHaveProperty("key");
    }
    expect(mocks.getApiKeyUsageTotals).toHaveBeenCalledWith("key-1");
    expect(mocks.getApiKeyUsageLimitStatus).toHaveBeenCalledWith("sk-caller-key");
  });

  it("restricts connection snapshots to the key's scoped connections, not every connection", async () => {
    mocks.resolveClientApiKey.mockResolvedValue({
      apiKey: "sk-caller-key",
      auth: { ok: true, stored: true, apiKeyId: "key-1" },
    });
    mocks.getApiKeyProviderConnectionIds.mockResolvedValue(["conn-2"]);
    const res = await route.GET(request());
    expect(res.body.connections).toHaveLength(1);
    expect(res.body.connections[0].id).toBe("conn-2");
  });

  it("rejects an unsupported format value before touching the database", async () => {
    const res = await route.GET(request("?format=csv"));
    expect(res.status).toBe(400);
    expect(mocks.resolveClientApiKey).not.toHaveBeenCalled();
  });

  it("accepts format=json", async () => {
    mocks.resolveClientApiKey.mockResolvedValue({
      apiKey: "sk-caller-key",
      auth: { ok: true, stored: true, apiKeyId: "key-1" },
    });
    const res = await route.GET(request("?format=json"));
    expect(res.status).toBe(200);
  });
});
