import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: vi.fn(async () => true), canManageAccessConfig: vi.fn(async () => true) }));
vi.mock("@/models", () => ({
  getProviderConnections: vi.fn(), getProviderConnectionById: vi.fn(),
  getProviderNodes: vi.fn(() => []), getProviderNodeById: vi.fn(), getProxyPoolById: vi.fn(),
  createProviderConnection: vi.fn(async (data) => ({ id: "xai-fixture", ...data })),
  updateProviderConnection: vi.fn(async (id, data) => ({ id, provider: "xai", authType: "apikey", ...data })),
  deleteProviderConnection: vi.fn(),
}));
const models = await import("@/models");
const { GET: list, POST: create } = await import("@/app/api/providers/route.js");
const { GET: detail, PUT: update } = await import("@/app/api/providers/[id]/route.js");
const { sanitizeProviderConnectionForClient } = await import("@/lib/providers/sanitizeProviderConnectionForClient.js");
const fixture = { id: "xai-fixture", provider: "xai", authType: "apikey", name: "fixture", apiKey: "inference-fixture", managementApiKey: "management-fixture", providerSpecificData: { teamId: "t", managementApiKey: "nested-fixture" } };
const request = (body, method = "POST") => new Request("http://localhost/api/providers/xai-fixture", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = { params: Promise.resolve({ id: fixture.id }) };
const assertRedacted = (body) => {
  const json = JSON.stringify(body);
  expect(json).not.toContain("management-fixture");
  expect(json).not.toContain("nested-fixture");
};
beforeEach(() => {
  vi.clearAllMocks();
  models.getProviderConnections.mockResolvedValue([fixture]);
  models.getProviderConnectionById.mockResolvedValue(fixture);
});
describe("management credential response boundaries", () => {
  it("redacts list, detail and client output", async () => {
    assertRedacted(await (await list(new Request("http://localhost/api/providers"))).json());
    assertRedacted(await (await detail(new Request("http://localhost/api/providers/xai-fixture"), params)).json());
    assertRedacted(sanitizeProviderConnectionForClient(fixture));
  });
  it("creates a separate credential and redacts the mutation response", async () => {
    const res = await create(request(fixture));
    expect(res.status).toBe(201);
    const saved = models.createProviderConnection.mock.calls[0][0];
    expect(saved.managementApiKey).toBe("management-fixture");
    expect(saved.apiKey).toBe("inference-fixture");
    expect(saved.providerSpecificData.managementApiKey).toBeFalsy();
    assertRedacted(await res.json());
  });
  it("updates and clears the top-level field, never returning either metadata copy", async () => {
    for (const managementApiKey of ["management-fixture", ""]) {
      const res = await update(request({ managementApiKey, providerSpecificData: fixture.providerSpecificData }, "PUT"), params);
      expect(res.status).toBe(200);
      expect(models.updateProviderConnection.mock.calls.at(-1)[1].managementApiKey).toBe(managementApiKey);
      assertRedacted(await res.json());
    }
  });
});
