import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe("provider-node base URL validation", () => {
  it.each([
    "file:///etc/passwd",
    "https://user:pass@example.com/v1",
    "http://169.254.169.254/latest/meta-data",
    42,
  ])("rejects invalid create base URL %s", async (baseUrl) => {
    vi.resetModules();
    const createProviderNode = vi.fn();
    vi.doMock("next/server", () => ({ NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200 }) } }));
    vi.doMock("@/dashboardGuard", () => ({ canManageAccessConfig: async () => true }));
    vi.doMock("@/models", () => ({ createProviderNode, getProviderNodes: async () => [] }));
    const { POST } = await import("@/app/api/provider-nodes/route.js");
    const response = await POST(new Request("http://localhost/api/provider-nodes", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Node", prefix: "node", apiType: "chat", baseUrl }),
    }));
    expect(response.status).toBe(400);
    expect(createProviderNode).not.toHaveBeenCalled();
  });

  it.each(["file:///etc/passwd", 42])("rejects an invalid update base URL %s before mutating the node", async (baseUrl) => {
    vi.resetModules();
    const updateProviderNode = vi.fn();
    vi.doMock("next/server", () => ({ NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200 }) } }));
    vi.doMock("@/dashboardGuard", () => ({ canManageAccessConfig: async () => true }));
    vi.doMock("@/models", () => ({
      getProviderNodeById: async () => ({ id: "node", type: "openai-compatible", prefix: "node" }),
      updateProviderNode,
    }));
    const { PUT } = await import("@/app/api/provider-nodes/[id]/route.js");
    const response = await PUT(new Request("http://localhost/api/provider-nodes/node", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Node", prefix: "node", apiType: "chat", baseUrl }),
    }), { params: Promise.resolve({ id: "node" }) });
    expect(response.status).toBe(400);
    expect(updateProviderNode).not.toHaveBeenCalled();
  });

  it("lists compatible provider-node models with guarded manual redirects", async () => {
    vi.resetModules();
    const upstreamFetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "model-a" }] }), { status: 200 }));
    vi.doMock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: upstreamFetch }));
    vi.doMock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: async () => ({}) }));
    const { fetchConnectionModels } = await import("@/app/api/providers/[id]/models/fetchConnectionModels.js");
    const result = await fetchConnectionModels({
      id: "connection", provider: "openai-compatible-chat-node", apiKey: "secret",
      providerSpecificData: { baseUrl: "https://provider.example.test/v1" },
    });
    expect(result.models).toEqual([{ id: "model-a" }]);
    expect(upstreamFetch).toHaveBeenCalledWith("https://provider.example.test/v1/models", expect.objectContaining({
      redirect: "manual", headers: { "Content-Type": "application/json", Authorization: "Bearer secret" },
    }), {});
  });
});
