import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  jsonResponse: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
  })),
  getApiKeyById: vi.fn(),
  getGatewayKeyById: vi.fn(),
  isLocalRequest: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: mocks.jsonResponse,
  },
}));

vi.mock("@/lib/localDb", () => ({
  getApiKeyById: mocks.getApiKeyById,
  getGatewayKeyById: mocks.getGatewayKeyById,
}));

vi.mock("@/dashboardGuard", () => ({
  isLocalRequest: mocks.isLocalRequest,
}));

// Import after mocks are set up
const { GET: revealApiKey } = await import("../../src/app/api/keys/[id]/reveal/route");
const { GET: revealGatewayKey } = await import(
  "../../src/app/api/mcp-gateway/keys/[id]/reveal/route"
);

function request(headers = {}) {
  return {
    headers: new Headers(headers),
    url: "http://localhost/api/keys/k1/reveal",
  };
}

describe("GET /api/keys/[id]/reveal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the raw stored secret so it can be re-copied", async () => {
    mocks.getApiKeyById.mockResolvedValue({ id: "k1", name: "test", key: "sk-real-secret-123" });

    const response = await revealApiKey(request(), { params: Promise.resolve({ id: "k1" }) });

    expect(response.status).toBe(200);
    expect(response.body.key).toBe("sk-real-secret-123");
  });

  it("404s when the key does not exist", async () => {
    mocks.getApiKeyById.mockResolvedValue(null);

    const response = await revealApiKey(request(), { params: Promise.resolve({ id: "missing" }) });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Key not found");
  });
});

describe("GET /api/mcp-gateway/keys/[id]/reveal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the raw gateway secret for a local request", async () => {
    mocks.isLocalRequest.mockReturnValue(true);
    mocks.getGatewayKeyById.mockResolvedValue({ id: "g1", key: "gw-real-secret-456" });

    const response = await revealGatewayKey(request({ host: "localhost:20128" }), {
      params: Promise.resolve({ id: "g1" }),
    });

    expect(response.status).toBe(200);
    expect(response.body.key).toBe("gw-real-secret-456");
  });

  it("rejects reveal from a remote request (local-only, like create)", async () => {
    mocks.isLocalRequest.mockReturnValue(false);

    const response = await revealGatewayKey(request({ host: "remote.example.com" }), {
      params: Promise.resolve({ id: "g1" }),
    });

    expect(response.status).toBe(403);
    expect(mocks.getGatewayKeyById).not.toHaveBeenCalled();
  });

  it("404s when the gateway key does not exist", async () => {
    mocks.isLocalRequest.mockReturnValue(true);
    mocks.getGatewayKeyById.mockResolvedValue(null);

    const response = await revealGatewayKey(request({ host: "localhost:20128" }), {
      params: Promise.resolve({ id: "missing" }),
    });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Key not found");
  });
});
