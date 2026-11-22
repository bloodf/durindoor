import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(async () => ({ headroomUrl: "http://127.0.0.1:8099/base" })),
  validateGatewayKey: vi.fn(async (value) => value === "key-a" ? { id: "a" } : value === "key-b" ? { id: "b" } : null),
  handleJsonRpc: vi.fn(async (_request, body) => ({ kind: "response", body })),
}));

vi.mock("next/server", () => ({ NextResponse: class extends Response {
  static json(body, init) { return Response.json(body, init); }
} }));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings, validateGatewayKey: mocks.validateGatewayKey }));
vi.mock("@/lib/headroom/detect", () => ({ DEFAULT_HEADROOM_URL: "http://127.0.0.1:8099" }));
vi.mock("@/lib/mcp/gateway/handler", () => ({ handleJsonRpc: mocks.handleJsonRpc }));

const { GET: proxyGet } = await import("../../src/app/api/headroom/proxy/[...path]/route.js");
const { GET: sseGet } = await import("../../src/app/api/mcp-gateway/sse/route.js");
const { POST: messagePost } = await import("../../src/app/api/mcp-gateway/message/route.js");
const sessions = await import("../../src/lib/mcp/gateway/sseSessions.js");

function authRequest(url, key, method = "GET") {
  return new Request(url, { method, headers: { Authorization: `Bearer ${key}` } });
}

describe("headroom traversal and MCP SSE session boundaries", () => {
  beforeEach(() => {
    sessions.__test__.getStore().clear();
    mocks.validateGatewayKey.mockClear();
    mocks.handleJsonRpc.mockClear();
  });
  afterEach(() => {
    sessions.__test__.stopSweeper();
    vi.restoreAllMocks();
  });

  it.each(["..", "%2e%2e", "%252e%252e", "%2e", "%2f..%2fsecret"]) (
    "rejects traversal segment %s before fetching upstream", async (segment) => {
      global.fetch = vi.fn();
      const response = await proxyGet(
        new Request("https://dashboard.example/api/headroom/proxy/x"),
        { params: Promise.resolve({ path: [segment, "secret"] }) },
      );
      expect(response.status).toBe(400);
      expect(global.fetch).not.toHaveBeenCalled();
    },
  );

  it("binds the SSE endpoint to its creating key and denies other keys", async () => {
    const response = await sseGet(authRequest("https://router.example/api/mcp-gateway/sse", "key-a"));
    const reader = response.body.getReader();
    const endpoint = new TextDecoder().decode((await reader.read()).value);
    const sid = endpoint.match(/sessionId=([^\n]+)/)[1];
    const wrong = await messagePost(new Request(`https://router.example/api/mcp-gateway/message?sessionId=${sid}`, {
      method: "POST", headers: { Authorization: "Bearer key-b" }, body: "{}",
    }));
    expect(wrong.status).toBe(404);
    const right = await messagePost(new Request(`https://router.example/api/mcp-gateway/message?sessionId=${sid}`, {
      method: "POST", headers: { Authorization: "Bearer key-a", "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1 }),
    }));
    expect(right.status).toBe(202);
    expect(mocks.handleJsonRpc).toHaveBeenCalledTimes(1);
    await reader.cancel();
  });

  it("requires a valid key to create an SSE session", async () => {
    const response = await sseGet(new Request("https://router.example/api/mcp-gateway/sse"));
    expect(response.status).toBe(401);
    expect(sessions.__test__.getStore().size).toBe(0);
  });

  it("caps active sessions per key and globally", () => {
    for (let i = 0; i < sessions.MAX_SESSIONS_PER_KEY; i++) {
      expect(sessions.registerSession(() => {}, "a")).toBeTruthy();
    }
    expect(sessions.registerSession(() => {}, "a")).toBeNull();
    sessions.__test__.getStore().clear();
    for (let i = 0; i < sessions.MAX_SESSIONS_TOTAL; i++) {
      expect(sessions.registerSession(() => {}, `key-${i}`)).toBeTruthy();
    }
    expect(sessions.registerSession(() => {}, "overflow")).toBeNull();
  });
});
