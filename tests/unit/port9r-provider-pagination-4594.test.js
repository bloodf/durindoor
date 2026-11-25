import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => [
    { id: "1", provider: "openai", name: "Alpha", apiKey: "secret" },
    { id: "2", provider: "openai", name: "Beta", apiKey: "secret" },
    { id: "3", provider: "other", name: "Beta" },
  ],
  getProviderNodes: async () => [], createProviderConnection: vi.fn(), getProviderNodeById: vi.fn(), getProxyPoolById: vi.fn(),
}));
vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: async () => false }));
const { GET } = await import("../../src/lib/providerRouteHandlers.js");

describe("provider connection listing", () => {
  it("filters and paginates without exposing credentials", async () => {
    const response = await GET(new Request("http://localhost/api/providers?provider=openai&q=a&page=2&pageSize=1"));
    const result = await response.json();
    expect(result).toMatchObject({ total: 2, page: 2, pageSize: 1, connections: [{ id: "2", name: "Beta" }] });
    expect(result.connections[0]).not.toHaveProperty("apiKey");
  });
  it("keeps the unfiltered response shape", async () => {
    const result = await (await GET(new Request("http://localhost/api/providers"))).json();
    expect(result.connections).toHaveLength(3);
    expect(result).not.toHaveProperty("total");
  });
});
