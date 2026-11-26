import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(async () => []),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getProviderNodes: vi.fn(async () => []),
  getSettings: vi.fn(async () => ({})),
}));
vi.mock("@/lib/localDb", async (importOriginal) => ({ ...await importOriginal(), ...db }));
vi.mock("@/models", async (importOriginal) => ({ ...await importOriginal(), ...db }));
vi.mock("@/sse/services/modelAccess.js", () => ({
  filterModelsForRequest: async (_request, models) => models,
  getRequestModelDiscoveryOptions: async () => ({}),
}));
const catalog = vi.hoisted(() => ({ buildModelsList: vi.fn() }));
vi.mock("../../src/app/api/v1/models/buildModelsList.js", () => ({ LLM_KIND: "llm", ...catalog }));

const { GET } = await import("../../src/app/api/v1/models/[...model]/route.js");
const get = async (id) => {
  const response = await GET(new Request(`http://x/v1/models/${id}`), { params: Promise.resolve({ model: [id] }) });
  return { status: response.status, body: await response.json() };
};

describe("9router #3871 - bare model ids and concurrent model tests", () => {
  beforeEach(() => {
    catalog.buildModelsList.mockReset();
    catalog.buildModelsList.mockResolvedValue([
      { id: "openrouter/anthropic/claude-sonnet-4-6", object: "model" },
      { id: "cc/claude-sonnet-4-6", object: "model" },
    ]);
  });

  it("resolves a bare registry id to the provider-prefixed model", async () => {
    expect(await get("claude-sonnet-4-6")).toMatchObject({ status: 200, body: { id: "cc/claude-sonnet-4-6" } });
  });

  it("answers model_not_found for a registry id no provider serves", async () => {
    catalog.buildModelsList.mockResolvedValue([]);
    expect(await get("claude-sonnet-4-6")).toMatchObject({ status: 404, body: { error: { code: "model_not_found" } } });
  });

  it("keeps an unknown segment off the catalog", async () => {
    expect((await get("nope")).body.error.message).toContain("Unknown model kind: nope");
    expect(catalog.buildModelsList).not.toHaveBeenCalled();
  });

  it.each([
    "../../src/app/(dashboard)/dashboard/providers/[id]/CompatibleModelsSection.js",
    "../../src/app/(dashboard)/dashboard/providers/components/ModelsCard.js",
  ])("tracks each model test separately in %s", (path) => {
    const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
    expect(source).toContain("if (testingModelIds.has(modelId)) return;");
    expect(source).toContain("next.delete(modelId)");
    expect(source).not.toMatch(/\btestingModelId\b/);
  });
});
