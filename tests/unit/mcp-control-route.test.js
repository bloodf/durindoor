import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listTools: vi.fn(),
  callTool: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
  getConsistentMachineId: vi.fn(),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
}));

vi.mock("@/lib/mcp/control/tools", () => ({
  listTools: mocks.listTools,
  callTool: mocks.callTool,
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: mocks.verifyDashboardAuthToken,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  validateApiKey: mocks.validateApiKey,
  validateGatewayKey: vi.fn(),
}));

const { POST } = await import("../../src/app/api/mcp/control/route");
const { proxy } = await import("../../src/dashboardGuard.js");

function makeRequest(body) {
  return {
    json: vi.fn().mockResolvedValue(body),
  };
}

function guardRequest(pathname, headers = {}, method = "POST", cookies = {}) {
  const normalizedHeaders = new Headers(headers);
  return {
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: normalizedHeaders,
    method,
    cookies: { get: vi.fn((name) => cookies[name] ?? undefined) },
    url: `http://localhost${pathname}`,
  };
}

describe("mcp-control route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listTools.mockReturnValue([{ name: "tool_1" }]);
  });

  it("handles initialize", async () => {
    const res = await POST(makeRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }));
    const body = await res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(1);
    expect(body.result.serverInfo.name).toBe("durindoor-control");
  });

  it("handles notifications/initialized with empty 202", async () => {
    const res = await POST(makeRequest({ jsonrpc: "2.0", method: "notifications/initialized" }));
    expect(res.status).toBe(202);
    expect(res.body).toBeNull();
  });

  it("handles tools/list", async () => {
    const res = await POST(makeRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
    const body = await res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(2);
    expect(body.result.tools).toEqual([{ name: "tool_1" }]);
  });

  it("handles tools/call and serializes result as text", async () => {
    mocks.callTool.mockResolvedValue({ ok: true });
    const res = await POST(makeRequest({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "tool_1", arguments: { a: 1 } },
    }));
    const body = await res.json();
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe(3);
    expect(body.result.content[0].text).toBe(JSON.stringify({ ok: true }, null, 2));
  });

  it("returns JSON-RPC error for tools/call failure with HTTP 200", async () => {
    const error = new Error("Bad request");
    error.status = 400;
    mocks.callTool.mockRejectedValue(error);

    const res = await POST(makeRequest({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "tool_1", arguments: {} },
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error.code).toBe(400);
    expect(body.error.message).toBe("Bad request");
  });

  it("returns JSON-RPC error for missing method", async () => {
    const res = await POST(makeRequest({ jsonrpc: "2.0", id: 5, method: "unknown" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error.code).toBe(-32601);
  });

  it("returns JSON-RPC error for invalid jsonrpc", async () => {
    const res = await POST(makeRequest({ jsonrpc: "1.0", id: 6, method: "initialize" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error.code).toBe(-32600);
  });

  it("returns JSON-RPC error for non-string method", async () => {
    const res = await POST(makeRequest({ jsonrpc: "2.0", id: 7, method: 123 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error.code).toBe(-32600);
  });

  it("returns JSON-RPC error for tools/call without name", async () => {
    const res = await POST(makeRequest({ jsonrpc: "2.0", id: 8, method: "tools/call", params: {} }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error.code).toBe(-32602);
  });

  it("returns parse error for invalid JSON body", async () => {
    const req = { json: vi.fn().mockRejectedValue(new Error("bad json")) };
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error.code).toBe(-32700);
  });
});

describe("dashboard guard mcp-control auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  it("allows mcp-control with a valid dashboard JWT", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    const response = await proxy(guardRequest("/api/mcp/control", {
      host: "router.example.com",
    }, "POST", { auth_token: { value: "valid-jwt" } }));
    expect(response).toBeDefined();
    expect(response.status).toBe(200);
    expect(mocks.verifyDashboardAuthToken).toHaveBeenCalledWith("valid-jwt");
  });

  it("rejects mcp-control with an invalid dashboard JWT", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
    const response = await proxy(guardRequest("/api/mcp/control", {
      host: "router.example.com",
      cookie: "auth_token=bad-jwt",
    }, "POST", { auth_token: { value: "bad-jwt" } }));
    expect(response.status).toBe(401);
  });

  it("rejects mcp-control without auth", async () => {
    const response = await proxy(guardRequest("/api/mcp/control", {
      host: "router.example.com",
    }));
    expect(response.status).toBe(401);
  });

  it("keeps mcp-control-evil as local-only", async () => {
    const response = await proxy(guardRequest("/api/mcp/control-evil", {
      host: "router.example.com",
    }));
    expect(response.status).toBe(403);
  });

  it("rejects mcp-control when requireLogin=false and no CLI/API/JWT", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
    const response = await proxy(guardRequest("/api/mcp/control", {
      host: "router.example.com",
    }));
    expect(response.status).toBe(401);
  });

  it("allows mcp-control with CLI token when requireLogin=false", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    const response = await proxy(guardRequest("/api/mcp/control", {
      host: "router.example.com",
      "x-9r-cli-token": "cli-token",
    }));
    expect(response).toBeDefined();
    expect(response.status).toBe(200);
  });

  it("allows mcp-control with API key when requireLogin=false", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    mocks.validateApiKey.mockResolvedValue(true);
    const response = await proxy(guardRequest("/api/mcp/control", {
      host: "router.example.com",
      authorization: "Bearer sk-valid",
    }));
    expect(response).toBeDefined();
    expect(response.status).toBe(200);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });
});
