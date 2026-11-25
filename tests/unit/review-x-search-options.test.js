import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSearchRequest } from "../../open-sse/handlers/search/callers.js";
import { handleSearchCore } from "../../open-sse/handlers/search/index.js";
import tavily from "../../open-sse/providers/registry/tavily.js";

function request(id, options = {}, extra = {}) {
  return JSON.parse(buildSearchRequest(
    { id, baseUrl: `https://api.${id}.com/search` },
    { query: "test", maxResults: 1000, providerOptions: { [id]: options }, ...extra },
  ).init.body);
}

describe("search spending limits", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("limits Exa counts, paid content and advanced options", () => {
    const body = request("exa", { numResults: 1000, type: "deep", additionalQueries: ["one"], unknown: true,
      contents: { text: { maxCharacters: 999999 }, summary: true, subpages: 1000 } });
    expect(body).toMatchObject({ numResults: 10, type: "auto", contents: { text: false, highlights: true } });
    expect(body).not.toHaveProperty("unknown");
    expect(body).not.toHaveProperty("additionalQueries");
    expect(body.contents).not.toHaveProperty("subpages");
  });

  it("limits Tavily depth and extra content even with auto parameters", () => {
    const body = request("tavily", { max_results: 1000, search_depth: "advanced", include_raw_content: true,
      include_answer: true, auto_parameters: true, unknown: true });
    expect(body).toMatchObject({ max_results: 10, search_depth: "basic" });
    for (const key of ["include_raw_content", "include_answer", "auto_parameters", "unknown"]) expect(body).not.toHaveProperty(key);
  });

  it("uses only operator settings to allow bounded paid features", () => {
    const providerSpecificData = { searchLimits: { maxResults: 3, allowAdvanced: true, allowContent: true } };
    expect(request("exa", { type: "deep", contents: { text: true, extras: { links: 1000 } } }, { providerSpecificData }))
      .toMatchObject({ numResults: 3, type: "deep", contents: { text: true, highlights: true } });
    expect(request("tavily", { search_depth: "advanced", include_raw_content: "markdown" }, { providerSpecificData }))
      .toMatchObject({ max_results: 3, search_depth: "advanced", include_raw_content: "markdown" });
    expect(request("tavily", { search_depth: "advanced", searchLimits: { allowAdvanced: true } }).search_depth).toBe("basic");
  });

  it("records provider-reported Tavily credits", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ results: [], usage: { credits: 2 } }))));
    const result = await handleSearchCore({ body: { query: "test" }, provider: tavily,
      providerConfig: tavily.searchConfig, credentials: { apiKey: "test-key" } });
    expect(result.accounting.nativeUnits).toEqual({ credits: 2 });
    expect(result.accounting.meta.nativeUnitsSource).toBe("usage.credits");
  });
});
