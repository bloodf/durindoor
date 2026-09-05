import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isLocalRequest: vi.fn(),
}));

vi.mock("@/dashboardGuard", () => ({
  isLocalRequest: mocks.isLocalRequest,
}));

function request(body) {
  return new Request("http://router.example.com/api/cli-tools/cowork-mcp-tools", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const { POST } = await import("../../src/app/api/cli-tools/cowork-mcp-tools/route.js");

describe("cowork-mcp-tools SSRF guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isLocalRequest.mockReturnValue(false);
    globalThis.fetch = vi.fn();
  });

  it.each([
    "http://127.0.0.1:18731/internal-admin",
    "http://10.0.0.5/mcp",
    "http://192.168.1.1/mcp",
    "http://localhost:3000/mcp",
  ])("rejects remote probes to %s before fetch", async (url) => {
    const response = await POST(request({ url }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "URL not allowed" });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("still requires url", async () => {
    const response = await POST(request({}));

    expect(response.status).toBe(400);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("allows a local peer to probe a loopback MCP server", async () => {
    mocks.isLocalRequest.mockReturnValue(true);
    globalThis.fetch
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers(), text: vi.fn().mockResolvedValue("") })
      .mockResolvedValueOnce({ ok: true, status: 202, headers: new Headers() })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: vi.fn().mockResolvedValue({ result: { tools: [] } }),
      });

    const response = await POST(request({ url: "http://127.0.0.1:18731/mcp" }));

    expect(response.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it("probes public MCP servers through initialize, notification, and tools/list", async () => {
    globalThis.fetch
      .mockResolvedValueOnce({ ok: true, status: 200, headers: new Headers({ "mcp-session-id": "session-1" }), text: vi.fn().mockResolvedValue("") })
      .mockResolvedValueOnce({ ok: true, status: 202, headers: new Headers() })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "application/json" }),
        json: vi.fn().mockResolvedValue({ result: { tools: [{ name: "weather", description: "Get weather" }] } }),
      });

    const response = await POST(request({ url: "https://mcp.example.com/tools" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tools: [{ name: "weather", description: "Get weather" }] });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(1, "https://mcp.example.com/tools", expect.objectContaining({ body: expect.stringContaining('"method":"initialize"') }));
    expect(globalThis.fetch).toHaveBeenNthCalledWith(2, "https://mcp.example.com/tools", expect.objectContaining({ body: expect.stringContaining('"method":"notifications/initialized"') }));
    expect(globalThis.fetch).toHaveBeenNthCalledWith(3, "https://mcp.example.com/tools", expect.objectContaining({ body: expect.stringContaining('"method":"tools/list"'), headers: expect.objectContaining({ "mcp-session-id": "session-1" }) }));
  });
});
