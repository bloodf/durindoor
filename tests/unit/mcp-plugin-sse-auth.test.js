/**
 * MCP plugin SSE session leak + LOCAL_ONLY auth (issue #564).
 *
 * Intent of upstream 9router #3498 / #3527, implemented independently:
 * - Unauthenticated remote message/sse must be denied (LOCAL_ONLY + in-handler).
 * - Abort must unregister the bridge session (cancel alone is not enough).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canAccessLocalOnlyRoute: vi.fn(async () => true),
  findPlugin: vi.fn(() => ({ name: "browsermcp" })),
  registerSession: vi.fn(() => "sid-test-1"),
  unregisterSession: vi.fn(),
  sendToChild: vi.fn(),
}));

vi.mock("@/dashboardGuard", () => ({
  canAccessLocalOnlyRoute: mocks.canAccessLocalOnlyRoute,
}));

vi.mock("@/lib/mcp/stdioSseBridge", () => ({
  findPlugin: mocks.findPlugin,
  registerSession: mocks.registerSession,
  unregisterSession: mocks.unregisterSession,
  sendToChild: mocks.sendToChild,
}));

const { GET: sseGet } = await import("../../src/app/api/mcp/[plugin]/sse/route.js");
const { POST: messagePost } = await import("../../src/app/api/mcp/[plugin]/message/route.js");

function pluginParams(plugin = "browsermcp") {
  return { params: Promise.resolve({ plugin }) };
}

function sseRequest({ signal } = {}) {
  const controller = signal ? null : new AbortController();
  return {
    signal: signal || controller.signal,
    _controller: controller,
    method: "GET",
    nextUrl: { pathname: `/api/mcp/browsermcp/sse` },
    headers: new Headers({ host: "localhost:20128" }),
    url: "http://localhost:20128/api/mcp/browsermcp/sse",
  };
}

function messageRequest({ host = "router.example.com", headers = {}, body = { jsonrpc: "2.0", id: 1, method: "ping" } } = {}) {
  return {
    method: "POST",
    nextUrl: { pathname: `/api/mcp/browsermcp/message` },
    headers: new Headers({ host, "content-type": "application/json", ...headers }),
    url: `http://${host}/api/mcp/browsermcp/message`,
    json: async () => body,
  };
}

describe("MCP plugin SSE abort cleanup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canAccessLocalOnlyRoute.mockResolvedValue(true);
    mocks.findPlugin.mockReturnValue({ name: "browsermcp" });
    mocks.registerSession.mockReturnValue("sid-test-1");
  });

  it("aborting the SSE request unregisters the session", async () => {
    const controller = new AbortController();
    const request = sseRequest({ signal: controller.signal });
    const res = await sseGet(request, pluginParams());
    expect(mocks.registerSession).toHaveBeenCalledTimes(1);
    expect(mocks.unregisterSession).not.toHaveBeenCalled();

    controller.abort();
    expect(mocks.unregisterSession).toHaveBeenCalledWith("browsermcp", "sid-test-1");
    expect(res.headers.get("content-type")).toBe("text/event-stream");
  });

  it("reader.cancel() still unregisters the session", async () => {
    const request = sseRequest();
    const res = await sseGet(request, pluginParams());
    expect(mocks.registerSession).toHaveBeenCalledTimes(1);

    await res.body.cancel();
    expect(mocks.unregisterSession).toHaveBeenCalledWith("browsermcp", "sid-test-1");
  });

  it("abort + cancel release exactly once", async () => {
    const controller = new AbortController();
    const request = sseRequest({ signal: controller.signal });
    const res = await sseGet(request, pluginParams());

    controller.abort();
    await res.body.cancel();
    expect(mocks.unregisterSession).toHaveBeenCalledTimes(1);
  });

  it("ten reconnect aborts leave no stranded unregister debt", async () => {
    for (let i = 0; i < 10; i++) {
      mocks.registerSession.mockReturnValueOnce(`sid-${i}`);
      const controller = new AbortController();
      await sseGet(sseRequest({ signal: controller.signal }), pluginParams());
      controller.abort();
    }
    expect(mocks.registerSession).toHaveBeenCalledTimes(10);
    expect(mocks.unregisterSession).toHaveBeenCalledTimes(10);
  });

  it("unknown plugin 404s without registering", async () => {
    mocks.findPlugin.mockReturnValue(null);
    const res = await sseGet(sseRequest(), pluginParams("nope"));
    expect(res.status).toBe(404);
    expect(mocks.registerSession).not.toHaveBeenCalled();
  });

  it("denies SSE when local-only gate fails", async () => {
    mocks.canAccessLocalOnlyRoute.mockResolvedValue(false);
    const res = await sseGet(sseRequest(), pluginParams());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Local only: CLI token required");
    expect(mocks.registerSession).not.toHaveBeenCalled();
  });
});

describe("MCP plugin message auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canAccessLocalOnlyRoute.mockResolvedValue(true);
    mocks.findPlugin.mockReturnValue({ name: "browsermcp" });
  });

  it("denies message POST when local-only gate fails", async () => {
    mocks.canAccessLocalOnlyRoute.mockResolvedValue(false);
    const res = await messagePost(messageRequest(), pluginParams());
    expect(res.status).toBe(403);
    expect(mocks.sendToChild).not.toHaveBeenCalled();
  });

  it("forwards JSON-RPC when gate allows", async () => {
    const body = { jsonrpc: "2.0", id: 2, method: "tools/list" };
    const res = await messagePost(messageRequest({ body }), pluginParams());
    expect(res.status).toBe(202);
    expect(mocks.sendToChild).toHaveBeenCalledWith("browsermcp", body);
  });

  it("unknown plugin 404s without sending", async () => {
    mocks.findPlugin.mockReturnValue(null);
    const res = await messagePost(messageRequest(), pluginParams("nope"));
    expect(res.status).toBe(404);
    expect(mocks.sendToChild).not.toHaveBeenCalled();
  });
});
