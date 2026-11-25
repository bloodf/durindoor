import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  row: null,
  create: vi.fn(async (body) => ({ id: "new", ...body })),
  update: vi.fn(async (_id, body) => ({ ...mocks.row, ...body })),
  listTools: vi.fn(async () => []),
}));
vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: async (request) => request.headers.get("x-principal") === "operator" }));
vi.mock("@/lib/localDb", () => ({
  getInstances: vi.fn(async () => []),
  getInstanceById: vi.fn(async () => mocks.row),
  createInstance: mocks.create,
  updateInstance: mocks.update,
  deleteInstance: vi.fn(),
}));
vi.mock("@/lib/mcp/gateway/stdioClient", () => ({ closeInstance: vi.fn() }));
vi.mock("@/lib/mcp/gateway/client", () => ({ clientFor: vi.fn(() => ({ listTools: mocks.listTools })) }));

const { POST: create } = await import("../../src/app/api/mcp-gateway/instances/route.js");
const { PUT: update } = await import("../../src/app/api/mcp-gateway/instances/[id]/route.js");
const { POST: probe } = await import("../../src/app/api/mcp-gateway/instances/[id]/test/route.js");
const context = { params: Promise.resolve({ id: "one" }) };
const request = (body, principal = "admin") => new Request("http://localhost/api/mcp-gateway/instances", {
  method: "POST", headers: { "content-type": "application/json", "x-principal": principal },
  body: JSON.stringify(body),
});
const stdio = { slug: "local", kind: "command", command: "example" };

describe("MCP stdio operator boundary", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.row = { id: "one", ...stdio, transport: "stdio" }; });
  it("rejects admin key creation of inferred and explicit stdio", async () => {
    expect((await create(request(stdio))).status).toBe(403);
    expect((await create(request({ ...stdio, transport: "stdio" }))).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects edits to stored stdio and sensitive fields on HTTP instances", async () => {
    expect((await update(request({ title: "changed" }), context)).status).toBe(403);
    mocks.row = { id: "one", kind: "http", transport: "http" };
    for (const field of ["command", "args", "env", "transport"]) {
      expect((await update(request({ [field]: "changed" }), context)).status).toBe(403);
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects an admin key probe before client execution", async () => {
    expect((await probe(request({}), context)).status).toBe(403);
    expect(mocks.listTools).not.toHaveBeenCalled();
  });
  it("allows operator create, edit and probe", async () => {
    expect((await create(request(stdio, "operator"))).status).toBe(201);
    expect((await update(request({ args: ["--help"] }, "operator"), context)).status).toBe(200);
    expect((await probe(request({}, "operator"), context)).status).toBe(200);
  });
  it("retains admin key HTTP creation and ordinary HTTP edits and probes", async () => {
    const http = { slug: "remote", kind: "http", transport: "http", url: "https://8.8.8.8/mcp" };
    expect((await create(request(http))).status).toBe(201);
    mocks.row = { id: "one", ...http };
    expect((await update(request({ title: "changed" }), context)).status).toBe(200);
    expect((await probe(request({}), context)).status).toBe(200);
  });
});
