import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A proxy URL's `user:password@` is a live credential. The management surface
 * now accepts an application API key, which is an inference credential rather
 * than an operator session, so every read path must redact it for that caller
 * — list AND detail, or the redaction is trivially bypassed by asking for the
 * other endpoint.
 */
const PROXY_URL = "http://proxyuser:s3cret@proxy.internal:8080";

const mocks = vi.hoisted(() => ({
  isOperatorRequest: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
  getProxyPoolById: vi.fn(),
  updateProxyPool: vi.fn(),
  getProviderConnections: vi.fn(),
  getProviderConnectionById: vi.fn(),
  getProviderNodes: vi.fn(),
}));

vi.mock("@/dashboardGuard", () => ({
  isOperatorRequest: mocks.isOperatorRequest,
}));

vi.mock("@/models", () => ({
  getProxyPools: mocks.getProxyPools,
  getProxyPoolById: mocks.getProxyPoolById,
  getProviderConnections: mocks.getProviderConnections,
  getProviderConnectionById: mocks.getProviderConnectionById,
  getProviderNodes: mocks.getProviderNodes,
  createProxyPool: vi.fn(),
  updateProxyPool: mocks.updateProxyPool,
  deleteProxyPool: vi.fn(),
  updateProviderConnection: vi.fn(),
  deleteProviderConnection: vi.fn(),
  createProviderConnection: vi.fn(),
  getProviderNodeById: vi.fn(),
}));

const request = (url = "http://localhost:20128/api/proxy-pools") => new Request(url);

describe("proxy credential reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([]);
    mocks.getProviderNodes.mockResolvedValue([]);
  });

  describe("proxy pools", () => {
    it("redacts the pool credential for an API-key caller on both list and detail", async () => {
      mocks.isOperatorRequest.mockResolvedValue(false);
      mocks.getProxyPools.mockResolvedValue([{ id: "p1", name: "pool", proxyUrl: PROXY_URL }]);
      mocks.getProxyPoolById.mockResolvedValue({ id: "p1", name: "pool", proxyUrl: PROXY_URL });

      const { GET: list } = await import("@/app/api/proxy-pools/route.js");
      const { GET: detail } = await import("@/app/api/proxy-pools/[id]/route.js");

      const listed = await (await list(request())).json();
      const shown = await (await detail(request(), { params: Promise.resolve({ id: "p1" }) })).json();

      for (const [label, url] of [
        ["list", listed.proxyPools[0].proxyUrl],
        ["detail", shown.proxyPool.proxyUrl],
      ]) {
        expect(url, `${label} must not leak the password`).not.toContain("s3cret");
        expect(url, `${label} must not leak the username`).not.toContain("proxyuser");
        expect(url, `${label} keeps the endpoint readable`).toContain("proxy.internal:8080");
      }
    });

    it("gives an operator the verbatim pool credential", async () => {
      mocks.isOperatorRequest.mockResolvedValue(true);
      mocks.getProxyPools.mockResolvedValue([{ id: "p1", proxyUrl: PROXY_URL }]);

      const { GET: list } = await import("@/app/api/proxy-pools/route.js");
      const listed = await (await list(request())).json();

      expect(listed.proxyPools[0].proxyUrl).toBe(PROXY_URL);
    });

    it("redacts the pool credential echoed back by a mutation", async () => {
      // A mutation response is a read: PUT an unrelated field and the stored
      // credential comes back in the echo unless that path redacts too.
      mocks.isOperatorRequest.mockResolvedValue(false);
      mocks.getProxyPoolById.mockResolvedValue({ id: "p1", name: "pool", proxyUrl: PROXY_URL });
      mocks.updateProxyPool.mockResolvedValue({ id: "p1", name: "renamed", proxyUrl: PROXY_URL });

      const { PUT } = await import("@/app/api/proxy-pools/[id]/route.js");
      const response = await PUT(
        new Request("http://localhost:20128/api/proxy-pools/p1", {
          method: "PUT",
          body: JSON.stringify({ name: "renamed" }),
        }),
        { params: Promise.resolve({ id: "p1" }) }
      );
      const body = await response.json();

      expect(body.proxyPool.proxyUrl).not.toContain("s3cret");
      expect(body.proxyPool.proxyUrl).toContain("proxy.internal:8080");
      expect(body.proxyPool.name).toBe("renamed");
    });
  });

  describe("provider connections", () => {
    const connection = {
      id: "c1",
      provider: "openai",
      name: "conn",
      providerSpecificData: { connectionProxyUrl: PROXY_URL, baseUrl: "https://api.openai.com" },
    };

    it("redacts connectionProxyUrl for an API-key caller on both list and detail", async () => {
      mocks.isOperatorRequest.mockResolvedValue(false);
      mocks.getProviderConnections.mockResolvedValue([connection]);
      mocks.getProviderConnectionById.mockResolvedValue(connection);

      const { GET: list } = await import("@/app/api/providers/route.js");
      const { GET: detail } = await import("@/app/api/providers/[id]/route.js");

      const listed = await (await list(request("http://localhost:20128/api/providers"))).json();
      const shown = await (
        await detail(request("http://localhost:20128/api/providers/c1"), {
          params: Promise.resolve({ id: "c1" }),
        })
      ).json();

      for (const [label, conn] of [
        ["list", listed.connections[0]],
        ["detail", shown.connection],
      ]) {
        const url = conn.providerSpecificData.connectionProxyUrl;
        expect(url, `${label} must not leak the password`).not.toContain("s3cret");
        expect(url, `${label} must not leak the username`).not.toContain("proxyuser");
        expect(url, `${label} keeps the endpoint readable`).toContain("proxy.internal:8080");
      }
    });

    it("gives an operator the verbatim connection credential", async () => {
      mocks.isOperatorRequest.mockResolvedValue(true);
      mocks.getProviderConnectionById.mockResolvedValue(connection);

      const { GET: detail } = await import("@/app/api/providers/[id]/route.js");
      const shown = await (
        await detail(request("http://localhost:20128/api/providers/c1"), {
          params: Promise.resolve({ id: "c1" }),
        })
      ).json();

      expect(shown.connection.providerSpecificData.connectionProxyUrl).toBe(PROXY_URL);
    });
  });

  describe("headroom status", () => {
    it("redacts the headroom URL for an API-key caller and keeps it for an operator", async () => {
      vi.doMock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
      vi.doMock("@/lib/headroom/detect", () => ({
        DEFAULT_HEADROOM_URL: "http://127.0.0.1:8000",
        getHeadroomStatus: vi.fn().mockResolvedValue({ running: true }),
      }));
      vi.doMock("@/lib/headroom/process", () => ({ getManagedPid: () => null }));
      mocks.getSettings.mockResolvedValue({ headroomUrl: PROXY_URL });

      const { GET } = await import("@/app/api/headroom/status/route.js");

      mocks.isOperatorRequest.mockResolvedValue(false);
      const redacted = await (await GET(request("http://localhost:20128/api/headroom/status"))).json();
      expect(redacted.url).not.toContain("s3cret");
      expect(redacted.url).toContain("proxy.internal:8080");

      mocks.isOperatorRequest.mockResolvedValue(true);
      const verbatim = await (await GET(request("http://localhost:20128/api/headroom/status"))).json();
      expect(verbatim.url).toBe(PROXY_URL);
    });
  });
});
