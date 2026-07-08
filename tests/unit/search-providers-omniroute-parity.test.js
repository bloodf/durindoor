import { describe, expect, it } from "vitest";

import { buildSearchRequest } from "../../open-sse/handlers/search/callers.js";
import { normalizeSearchResponse } from "../../open-sse/handlers/search/normalizers.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

const OMNIROUTE_SEARCH_ALIASES = {
  "exa-search": "exa",
  "google-pse-search": "google-pse",
  "linkup-search": "linkup",
  "ollama-search": "ollama",
  "perplexity-search": "perplexity",
  "searchapi-search": "searchapi",
  "searxng-search": "searxng",
  "serper-search": "serper",
  "tavily-search": "tavily",
  "youcom-search": "youcom",
};

describe("OmniRoute search provider parity", () => {
  it("registers OmniRoute search provider IDs as real DurinDoor provider aliases", () => {
    const registryById = new Map(REGISTRY.map((provider) => [provider.id, provider]));
    for (const [alias, providerId] of Object.entries(OMNIROUTE_SEARCH_ALIASES)) {
      expect(registryById.get(providerId)?.aliases).toContain(alias);
      expect(PROVIDER_MEDIA[providerId]?.serviceKinds).toContain("webSearch");
    }
  });

  it("keeps dedicated registry config for Ollama and Perplexity search aliases", () => {
    expect(PROVIDER_MEDIA.ollama.searchConfig).toMatchObject({
      baseUrl: "https://ollama.com/api/web_search",
      method: "POST",
      authHeader: "bearer",
    });
    expect(PROVIDER_MEDIA.perplexity.searchConfig).toMatchObject({
      baseUrl: "https://api.perplexity.ai/search",
      method: "POST",
      authHeader: "bearer",
    });
  });

  it("builds provider-specific URL and header mappings", () => {
    const google = buildSearchRequest(
      { id: "google-pse", baseUrl: "https://www.googleapis.com/customsearch/v1", method: "GET" },
      { query: "durindoor", maxResults: 7, token: "g-key", providerSpecificData: { cx: "cx-1" }, searchType: "web" }
    );
    expect(google.url).toContain("key=g-key");
    expect(google.url).toContain("cx=cx-1");
    expect(google.url).toContain("num=7");
    expect(google.init.headers).toEqual({ Accept: "application/json" });

    const searxng = buildSearchRequest(
      { id: "searxng", baseUrl: "https://search.example", method: "GET" },
      { query: "durindoor", maxResults: 5, searchType: "news", timeRange: "week" }
    );
    expect(searxng.url).toBe("https://search.example/search?q=durindoor&format=json&categories=news&time_range=week");

    const ollama = buildSearchRequest(
      PROVIDER_MEDIA.ollama.searchConfig && { id: "ollama", ...PROVIDER_MEDIA.ollama.searchConfig },
      { query: "durindoor", maxResults: 3, token: "ollama-key", searchType: "web" }
    );
    expect(ollama.url).toBe("https://ollama.com/api/web_search");
    expect(ollama.init.headers.Authorization).toBe("Bearer ollama-key");
    expect(JSON.parse(ollama.init.body)).toEqual({ query: "durindoor", max_results: 3 });
  });

  it("normalizes dedicated search provider responses into unified results", () => {
    const ollama = normalizeSearchResponse(
      "ollama",
      { results: [{ title: "DurinDoor", url: "https://durindoor.dev", content: "Gateway" }] },
      "durindoor",
      "web"
    );
    expect(ollama.results[0]).toMatchObject({
      title: "DurinDoor",
      url: "https://durindoor.dev",
      snippet: "Gateway",
      citation: { provider: "ollama", rank: 1 },
    });

    const google = normalizeSearchResponse(
      "google-pse",
      {
        items: [{ title: "Docs", link: "https://docs.example", snippet: "Reference" }],
        searchInformation: { totalResults: "42" },
      },
      "docs",
      "web"
    );
    expect(google.totalResults).toBe(42);
    expect(google.results[0]).toMatchObject({
      title: "Docs",
      url: "https://docs.example",
      snippet: "Reference",
    });
  });
});
