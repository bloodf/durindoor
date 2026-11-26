/**
 * A new Azure connection with no resource endpoint can never work: `azure-openai`
 * falls back to the registry's example host, and `azure` to api.openai.com.
 * Both would send the Azure key to a host that is not the operator's resource.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: vi.fn(async () => true) }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => []),
  getProviderConnectionById: vi.fn(),
  getProviderNodes: vi.fn(() => []),
  getProxyPoolById: vi.fn(),
  getProviderNodeById: vi.fn(),
  createProviderConnection: vi.fn(async (data) => ({ id: "c1", ...data })),
  updateProviderConnection: vi.fn(),
  deleteProviderConnection: vi.fn()
}));

const { POST: createProvider } = await import("@/app/api/providers/route.js");
const db = await import("@/lib/localDb");

async function create(provider, extra = {}) {
  const res = await createProvider(new Request("http://localhost/api/providers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider, apiKey: "test-key", name: "Azure", ...extra })
  }));
  return { status: res.status, body: await res.json() };
}

describe("port(omniroute) #20103: an Azure connection needs a resource endpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AZURE_ENDPOINT", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ["no providerSpecificData", {}],
    ["a blank baseUrl", { providerSpecificData: { baseUrl: "   " } }],
    ["a non-string baseUrl", { providerSpecificData: { baseUrl: false } }],
    ["only the legacy azureEndpoint field, which this executor does not read", { providerSpecificData: { azureEndpoint: "https://r.openai.azure.com" } }]
  ])("refuses azure-openai with %s", async (_label, extra) => {
    const { status, body } = await create("azure-openai", extra);
    expect(status).toBe(400);
    expect(body.error).toContain("providerSpecificData.baseUrl");
    expect(db.createProviderConnection).not.toHaveBeenCalled();
  });

  it("accepts azure-openai with a base URL, nested or top-level", async () => {
    expect((await create("azure-openai", { providerSpecificData: { baseUrl: "https://r.openai.azure.com" } })).status).toBe(201);
    expect((await create("azure-openai", { azureEndpoint: "https://r.openai.azure.com" })).status).toBe(201);
  });

  it("refuses azure without an endpoint when AZURE_ENDPOINT is unset", async () => {
    const { status, body } = await create("azure", { providerSpecificData: { azureEndpoint: " ", deployment: "gpt-5" } });
    expect(status).toBe(400);
    expect(body.error).toContain("providerSpecificData.azureEndpoint");
    expect(db.createProviderConnection).not.toHaveBeenCalled();
  });

  it("accepts azure with its own endpoint or the AZURE_ENDPOINT fallback", async () => {
    expect((await create("azure", { providerSpecificData: { azureEndpoint: "https://r.openai.azure.com" } })).status).toBe(201);
    vi.stubEnv("AZURE_ENDPOINT", "https://env.openai.azure.com");
    expect((await create("azure")).status).toBe(201);
  });

  it("leaves providers with their own endpoint alone", async () => {
    expect((await create("openai")).status).toBe(201);
    expect((await create("azure-ai")).status).toBe(201);
  });
});
