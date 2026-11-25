import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ row: null, fetch: vi.fn() }));
vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: vi.fn(async () => true) }));
vi.mock("@/lib/localDb", () => ({
  getInstanceById: vi.fn(async () => state.row),
  updateInstance: vi.fn(async (_id, patch) => (state.row = { ...state.row, ...patch })),
  deleteInstance: vi.fn(async () => true),
}));
vi.mock("@/lib/mcp/gateway/stdioClient", () => ({ closeInstance: vi.fn() }));
vi.mock("open-sse/utils/outboundUrlGuard.js", () => ({
  assertOutboundUrlAllowed: (url) => new URL(url),
  assertResolvedAddressAllowed: vi.fn(),
  getProviderValidationGuard: () => "none",
  guardedProbeFetch: state.fetch,
  OutboundUrlGuardError: class extends Error {},
}));

const { PUT, DELETE } = await import("../../src/app/api/mcp-gateway/instances/[id]/route.js");
const { listTools, __test__ } = await import("../../src/lib/mcp/gateway/httpClient.js");
const context = { params: Promise.resolve({ id: "one" }) };
const put = (body) => PUT(new Request("http://localhost/", { method: "PUT", body: JSON.stringify(body) }), context);

beforeEach(() => {
  __test__.getSessionStore().clear();
  state.fetch.mockReset();
  state.row = { id: "one", slug: "one", transport: "http", url: "https://old.example/mcp", oauth: false,
    oauthTokens: { access_token: "secret", client: { clientId: "old" }, metadata: { issuer: "old" }, _lastChallenge: "old" } };
});

function upstream({ stale = false, always404 = false } = {}) {
  let initialization = 0;
  state.fetch.mockImplementation(async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.method === "initialize") initialization++;
    const status = body.method === "tools/list" && (always404 || (stale && initialization === 1)) ? 404 : 200;
    const result = body.method === "initialize" ? { protocolVersion: "2025-06-18", serverInfo: { name: "test" } } : { tools: [] };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), {
      status, headers: { "content-type": "application/json", ...(body.method === "initialize" ? { "mcp-session-id": `session-${initialization}` } : {}) },
    });
  });
}

describe("MCP instance edits and HTTP sessions", () => {
  it("clears origin-bound OAuth state on an origin change but preserves it for a path edit", async () => {
    const tokens = state.row.oauthTokens;
    expect((await put({ url: "https://old.example/other" })).status).toBe(200);
    expect(state.row.oauthTokens).toEqual(tokens);
    expect((await put({ url: "https://new.example/mcp" })).status).toBe(200);
    expect(state.row.oauthTokens).toBeNull();
  });

  it("initializes at the edited URL and evicts on deletion", async () => {
    upstream();
    await listTools(state.row);
    expect((await put({ url: "https://new.example/mcp" })).status).toBe(200);
    await listTools(state.row);
    const inits = state.fetch.mock.calls.filter(([, options]) => JSON.parse(options.body).method === "initialize");
    expect(inits.map(([url]) => url)).toEqual(["https://old.example/mcp", "https://new.example/mcp"]);
    await DELETE(new Request("http://localhost/", { method: "DELETE" }), context);
    expect(__test__.getSessionStore().has("one")).toBe(false);
  });

  it("reinitializes once after a stale session 404 and retries with the new session", async () => {
    upstream({ stale: true });
    await expect(listTools(state.row)).resolves.toEqual([]);
    const calls = state.fetch.mock.calls.filter(([, options]) => JSON.parse(options.body).method === "tools/list");
    expect(calls.map(([, options]) => options.headers["mcp-session-id"])).toEqual(["session-1", "session-2"]);
  });

  it("stops after one recovery when the new session also returns 404", async () => {
    upstream({ always404: true });
    await expect(listTools(state.row)).rejects.toMatchObject({ status: 404 });
    expect(state.fetch.mock.calls.filter(([, options]) => JSON.parse(options.body).method === "initialize")).toHaveLength(2);
  });
});
