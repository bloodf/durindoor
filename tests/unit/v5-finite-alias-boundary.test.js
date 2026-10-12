import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the real route, normalizer and NextResponse serializer without
// touching a host database, alias cache, DNS configuration or MITM process.
const boundary = vi.hoisted(() => ({
  getMitmAlias: vi.fn(),
  setMitmAliasAll: vi.fn(),
  getMitmStatus: vi.fn(),
  writeAliasForTool: vi.fn(),
}));
vi.mock("@/models", () => ({
  getMitmAlias: boundary.getMitmAlias,
  setMitmAliasAll: boundary.setMitmAliasAll,
}));
vi.mock("@/mitm/manager", () => ({ getMitmStatus: boundary.getMitmStatus }));
vi.mock("@/lib/mitmAliasCache", () => ({ writeAliasForTool: boundary.writeAliasForTool }));

const { GET, PUT } = await import("../../src/app/api/cli-tools/antigravity-mitm/alias/route.js");
const url = "http://fixture.invalid/api/cli-tools/antigravity-mitm/alias?tool=fixture-tool";
const putRequest = (body) => new Request(url, {
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

function expectNoWrites() {
  expect(boundary.setMitmAliasAll).not.toHaveBeenCalled();
  expect(boundary.writeAliasForTool).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  boundary.getMitmStatus.mockResolvedValue({ dnsStatus: { "fixture-tool": true } });
  boundary.getMitmAlias.mockResolvedValue({});
  boundary.setMitmAliasAll.mockResolvedValue(undefined);
});

describe("finite MITM alias handler boundary (not Next compiler or authorization proof)", () => {
  it.each([
    ["missing tool", { mappings: { alias: "model" } }],
    ["array mappings", { tool: "fixture-tool", mappings: ["model"] }],
    ["scalar mappings", { tool: "fixture-tool", mappings: "model" }],
    ["invalid reasoning effort", { tool: "fixture-tool", mappings: { alias: { model: "model", reasoningEffort: "unsupported-fixture-effort" } } }],
  ])("rejects %s before DNS lookup or persistence", async (_label, body) => {
    const response = await PUT(putRequest(body));
    expect(response.status).toBe(400);
    expect(boundary.getMitmStatus).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it.each([{}, { dnsStatus: {} }, { dnsStatus: { "fixture-tool": false } }])(
    "rejects disabled DNS without database or cache effects: %j",
    async (status) => {
      boundary.getMitmStatus.mockResolvedValue(status);
      const response = await PUT(putRequest({ tool: "fixture-tool", mappings: { alias: "model" } }));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "DNS must be enabled for fixture-tool before editing model mappings" });
      expectNoWrites();
    },
  );

  it("returns normalized stored aliases through the actual GET serializer", async () => {
    boundary.getMitmAlias.mockResolvedValue({ alias: " model ", empty: "  " });
    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ aliases: { alias: { model: "model" } } });
    expectNoWrites();
  });

  it("normalizes and persists enabled-DNS PUT aliases before updating the cache", async () => {
    const mappings = {
      trimmed: " model-one ",
      reasoning: { model: " model-two ", reasoningEffort: " HIGH " },
      empty: "  ",
      invalid: [],
    };
    const normalized = {
      trimmed: { model: "model-one" },
      reasoning: { model: "model-two", reasoningEffort: "high" },
    };
    const response = await PUT(putRequest({ tool: "fixture-tool", mappings }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, aliases: normalized });
    expect(boundary.setMitmAliasAll).toHaveBeenCalledExactlyOnceWith("fixture-tool", normalized);
    expect(boundary.writeAliasForTool).toHaveBeenCalledExactlyOnceWith("fixture-tool", normalized);
    expect(boundary.setMitmAliasAll.mock.invocationCallOrder[0])
      .toBeLessThan(boundary.writeAliasForTool.mock.invocationCallOrder[0]);
  });

  it.each(["read", "status", "save"])("keeps a synthetic %s failure out of the final 500 body", async (stage) => {
    const sentinel = "synthetic-private-sentinel-finite-alias";
    const failure = new Error(sentinel);
    if (stage === "read") boundary.getMitmAlias.mockRejectedValue(failure);
    if (stage === "status") boundary.getMitmStatus.mockRejectedValue(failure);
    if (stage === "save") boundary.setMitmAliasAll.mockRejectedValue(failure);
    const response = stage === "read"
      ? await GET(new Request(url))
      : await PUT(putRequest({ tool: "fixture-tool", mappings: { alias: "model" } }));
    expect(response.status).toBe(500);
    const serialized = await response.text();
    expect(JSON.parse(serialized)).toEqual({ error: stage === "read" ? "Failed to fetch aliases" : "Failed to save aliases" });
    expect(serialized).not.toContain(sentinel);
    expect(boundary.writeAliasForTool).not.toHaveBeenCalled();
    if (stage !== "save") expectNoWrites();
    // The route logs caught messages. This oracle certifies only the response.
  });
});
