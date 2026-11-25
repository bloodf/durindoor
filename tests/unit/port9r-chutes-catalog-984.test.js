import { describe, expect, it, vi } from "vitest";
import { FILTERS } from "@/app/api/providers/suggested-models/filters.js";
import { GET, isAllowedSuggestedModelsFetcher } from "@/app/api/providers/suggested-models/route.js";
import { LIVE_MODEL_RESOLVERS } from "@/app/api/v1/models/modelCatalogSources.js";

const url = "https://llm.chutes.ai/v1/models";

describe("Chutes catalog", () => {
  it("normalizes slash IDs and rejects malformed entries", () => {
    expect(FILTERS["chutes-all"]([{ id: "org/model", context_length: 4096 }, { id: "org/model" }, { id: 7 }])).toEqual([{ id: "org/model", name: "org/model" }]);
    expect(FILTERS["chutes-all"]([])).toEqual([]);
  });

  it("allows only the registered public catalog", () => {
    expect(isAllowedSuggestedModelsFetcher(url, "chutes-all")).toBe(true);
    expect(isAllowedSuggestedModelsFetcher("http://127.0.0.1/models", "chutes-all")).toBe(false);
  });

  it("reports upstream errors and empty catalogs distinctly", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ data: [] }));
    try {
      const request = new Request(`http://localhost/api/providers/suggested-models?${new URLSearchParams({ url, type: "chutes-all" })}`);
      expect(await (await GET(request)).json()).toEqual({ data: [], error: "Failed to fetch provider models: 503" });
      expect(await (await GET(request)).json()).toEqual({ data: [] });
      expect(fetchMock.mock.calls[0][1].redirect).toBe("error");
    } finally { fetchMock.mockRestore(); }
  });

  it("fetches the credentialed catalog only from Chutes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "org/private" }] })));
    try {
      const result = await LIVE_MODEL_RESOLVERS.chutes({ id: "test-984", provider: "chutes", apiKey: "key-984", providerSpecificData: { baseUrl: "http://127.0.0.1" } }, "none");
      expect(result.models.map((model) => model.id)).toEqual(["org/private"]);
      expect(fetchMock.mock.calls[0][0]).toBe(url);
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer key-984");
    } finally { fetchMock.mockRestore(); }
  });
});
