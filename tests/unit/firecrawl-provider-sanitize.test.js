import { describe, it, expect, vi } from "vitest";
import { sanitizeProviderConnectionForClient } from "@/lib/providers/sanitizeProviderConnectionForClient.js";
import { GET as getProviders } from "@/app/api/providers/route.js";
import { GET as getProviderById } from "@/app/api/providers/[id]/route.js";

vi.mock("@/models", () => ({
  getProviderConnections: vi.fn(),
  getProviderConnectionById: vi.fn(),
  getProviderNodes: vi.fn(() => []),
  getProxyPoolById: vi.fn(),
  getProviderNodeById: vi.fn(),
  createProviderConnection: vi.fn(),
}));

describe("firecrawlHeaders sanitizer", () => {
  it("sanitizeProviderConnectionForClient strips firecrawlHeaders", () => {
    const c = {
      id: "fc-1",
      provider: "firecrawl_custom",
      authType: "apikey",
      name: "Firecrawl Local",
      apiKey: "secret",
      firecrawlHeaders: "{\"x-secret\":\"v\"}",
      providerSpecificData: { baseUrl: "http://127.0.0.1:3002/firecrawl" },
    };
    const safe = sanitizeProviderConnectionForClient(c);
    expect(safe).not.toHaveProperty("firecrawlHeaders");
    expect(safe).not.toHaveProperty("apiKey");
    expect(safe.providerSpecificData).toEqual({ baseUrl: "http://127.0.0.1:3002/firecrawl" });
  });

  it("GET /api/providers strips firecrawlHeaders from response", async () => {
    const { getProviderConnections } = await import("@/models");
    getProviderConnections.mockResolvedValue([
      {
        id: "fc-1",
        provider: "firecrawl_custom",
        authType: "apikey",
        name: "Firecrawl Local",
        apiKey: "secret",
        firecrawlHeaders: "{\"x-secret\":\"v\"}",
        providerSpecificData: { baseUrl: "http://127.0.0.1:3002/firecrawl" },
        priority: 0,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const res = await getProviders();
    const body = await res.json();
    expect(body.connections[0]).not.toHaveProperty("firecrawlHeaders");
    expect(body.connections[0]).not.toHaveProperty("apiKey");
    expect(body.connections[0].providerSpecificData).toEqual({ baseUrl: "http://127.0.0.1:3002/firecrawl" });
  });

  it("GET /api/providers/[id] strips firecrawlHeaders from response", async () => {
    const { getProviderConnectionById } = await import("@/models");
    getProviderConnectionById.mockResolvedValue({
      id: "fc-1",
      provider: "firecrawl_custom",
      authType: "apikey",
      name: "Firecrawl Local",
      apiKey: "secret",
      firecrawlHeaders: "{\"x-secret\":\"v\"}",
      providerSpecificData: { baseUrl: "http://127.0.0.1:3002/firecrawl" },
      priority: 0,
      isActive: true,
      createdDb: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const res = await getProviderById(new Request("http://localhost/api/providers/fc-1"), { params: Promise.resolve({ id: "fc-1" }) });
    const body = await res.json();
    expect(body.connection).not.toHaveProperty("firecrawlHeaders");
    expect(body.connection).not.toHaveProperty("apiKey");
    expect(body.connection.providerSpecificData).toEqual({ baseUrl: "http://127.0.0.1:3002/firecrawl" });
  });
});
