import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ buildModelsList: vi.fn(), getModelInfo: vi.fn() }));

vi.mock("@/app/api/v1/models/buildModelsList.js", () => ({
  LLM_KIND: "llm",
  buildModelsList: mocks.buildModelsList,
}));
vi.mock("@/sse/services/model.js", () => ({ getModelInfo: mocks.getModelInfo }));
vi.mock("@/sse/services/apiKeyPolicyIdentity.js", () => ({
  canonicalizePolicyModelIdentity(value) {
    return value.startsWith("ag/") ? value.replace(/^ag\//, "antigravity/") : value;
  },
}));
vi.mock("next/server", () => ({ NextResponse: { json: (body, init = {}) => new Response(JSON.stringify(body), { status: init.status || 200 }) } }));

describe("API-key policy catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildModelsList.mockResolvedValue([
      { id: "combo", owned_by: "combo" },
      { id: "ag/gemini", name: "Gemini", capabilities: { vision: true } },
      { id: "img/flux", name: "Flux" },
      { id: "web/search", name: "Search", kind: "webSearch" },
      { id: "web/fetch", name: "Fetch", kind: "webFetch" },
      { id: "ag/gemini", name: "duplicate" },
    ]);
    mocks.getModelInfo.mockImplementation(async (id) => {
      const [provider, model] = id.split("/");
      return { provider: provider === "ag" ? "antigravity" : provider, model };
    });
  });

  it("requests every modality, excludes combos, canonicalizes, and deduplicates", async () => {
    const { buildApiKeyPolicyCatalog } = await import("@/app/api/keys/policy-catalog/route.js");
    const catalog = await buildApiKeyPolicyCatalog();
    const kinds = mocks.buildModelsList.mock.calls[0][0];
    expect(kinds).toEqual(expect.arrayContaining(["llm", "image", "tts", "stt", "embedding", "moderation", "rerank", "webSearch", "webFetch", "music", "video"]));
    expect(catalog.map((entry) => entry.id)).toEqual(["antigravity/gemini", "img/flux", "web/fetch", "web/search"]);
    expect(catalog.find((entry) => entry.id === "web/search")?.kinds).toEqual(["webSearch"]);
    expect(catalog.some((entry) => entry.id === "combo")).toBe(false);
  });
});
