import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canAccessLocalOnlyRoute: vi.fn(),
  findPlugin: vi.fn(() => ({ name: "browsermcp" })),
  registerSession: vi.fn(() => "sid-pre-aborted"),
  unregisterSession: vi.fn(),
}));

vi.mock("@/dashboardGuard", () => ({
  canAccessLocalOnlyRoute: mocks.canAccessLocalOnlyRoute,
}));

vi.mock("@/lib/mcp/stdioSseBridge", () => ({
  findPlugin: mocks.findPlugin,
  registerSession: mocks.registerSession,
  unregisterSession: mocks.unregisterSession,
}));

const { GET } = await import("../../src/app/api/mcp/[plugin]/sse/route.js");

const params = () => ({ params: Promise.resolve({ plugin: "browsermcp" }) });

describe("port(upstream) #3527: MCP SSE client gone before the session exists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canAccessLocalOnlyRoute.mockResolvedValue(true);
  });

  // An abort listener added to an already-aborted signal never fires, so a
  // session registered here would keep the stdio child alive for good.
  it("registers no session when the client disconnects during the access check", async () => {
    const controller = new AbortController();
    mocks.canAccessLocalOnlyRoute.mockImplementation(async () => {
      controller.abort();
      return true;
    });

    const response = await GET({ signal: controller.signal }, params());

    expect(mocks.registerSession).not.toHaveBeenCalled();
    expect(response.status).toBe(499);
    expect(response.body).toBeNull();
  });

  it("registers no session for an already-aborted request", async () => {
    const response = await GET({ signal: AbortSignal.abort() }, params());

    expect(mocks.registerSession).not.toHaveBeenCalled();
    expect(response.status).toBe(499);
  });
});
