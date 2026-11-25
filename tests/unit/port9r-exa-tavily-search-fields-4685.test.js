import { afterEach, describe, expect, it, vi } from "vitest";
import { buildSearchRequest } from "../../open-sse/handlers/search/callers.js";
import { normalizeSearchResponse } from "../../open-sse/handlers/search/normalizers.js";
import tavily from "../../open-sse/providers/registry/tavily.js";
import exa from "../../open-sse/providers/registry/exa.js";

const body = (provider, extra = {}) => JSON.parse(buildSearchRequest(
  { id: provider.id, ...provider.searchConfig },
  { query: "gateway api", searchType: "web", maxResults: 5, token: "test-key", ...extra },
).init.body);

describe("upstream PR #4685: Exa and Tavily request and response fields", () => {
  afterEach(() => vi.useRealTimers());

  const freeze = () => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-25T12:00:00Z")); };

  it("sends Exa content options under contents", () => {
    const sent = body(exa);

    expect(sent.contents).toEqual({ text: true, highlights: true });
    expect(sent).not.toHaveProperty("text");
    expect(sent).not.toHaveProperty("highlights");
  });

  it("forwards allow-listed Exa options and keeps the normalized fields", () => {
    const sent = body(exa, {
      searchType: "news",
      domainFilter: ["arxiv.org", "-example.com"],
      providerOptions: { exa: {
        type: "deep", userLocation: "US", stream: true, outputSchema: {}, query: "other", numResults: 99, includeDomains: ["other.example"],
        contents: { text: { maxCharacters: 500 }, maxAgeHours: 48, unknown: 1 },
      } },
    });

    expect(sent).toEqual({
      query: "gateway api", numResults: 5, type: "deep", userLocation: "US", category: "news",
      includeDomains: ["arxiv.org"], excludeDomains: ["example.com"],
      contents: { text: { maxCharacters: 500 }, highlights: true, maxAgeHours: 48 },
    });
  });

  it("forwards allow-listed Tavily options and keeps the normalized fields", () => {
    const sent = body(tavily, {
      country: "US",
      domainFilter: ["sec.gov"],
      providerOptions: { tavily: { search_depth: "advanced", include_raw_content: true, query: "other", max_results: 99, country: "DE", include_domains: ["other.example"] } },
    });

    expect(sent).toEqual({
      query: "gateway api", max_results: 5, topic: "general", country: "US", include_domains: ["sec.gov"],
      search_depth: "advanced", include_raw_content: true,
    });
  });

  it("accepts only documented Tavily topics", () => {
    expect(tavily.searchConfig.searchTypes).toContain("finance");
    expect(body(tavily).topic).toBe("general");
    expect(body(tavily, { searchType: "finance" }).topic).toBe("finance");
    expect(body(tavily, { providerOptions: { tavily: { topic: "news" } } }).topic).toBe("news");
    expect(body(tavily, { providerOptions: { tavily: { topic: "web" } } }).topic).toBe("general");
  });

  it("maps time_range onto each provider's start date", () => {
    freeze();

    expect(body(exa, { timeRange: "week" }).startPublishedDate).toBe("2026-11-18T00:00:00.000Z");
    expect(body(tavily, { timeRange: "month" }).start_date).toBe("2026-10-25");
    expect(body(tavily, { timeRange: "century" })).not.toHaveProperty("start_date");
  });

  it("lets a caller date window replace time_range", () => {
    freeze();
    const exaSent = body(exa, { timeRange: "week", providerOptions: { exa: { endPublishedDate: "2026-02-28" } } });
    const tavilySent = body(tavily, { timeRange: "week", providerOptions: { tavily: { end_date: "2026-02-28" } } });

    expect(exaSent).not.toHaveProperty("startPublishedDate");
    expect(exaSent.endPublishedDate).toBe("2026-02-28");
    expect(tavilySent).not.toHaveProperty("start_date");
    expect(tavilySent.end_date).toBe("2026-02-28");
  });

  it("keeps extra result fields in provider_raw", () => {
    const item = { title: "T", url: "https://example.com" };

    expect(normalizeSearchResponse("exa", { results: [{ ...item, id: "r1", highlightScores: [0.9], summary: "s" }] }).results[0].provider_raw)
      .toEqual({ id: "r1", highlight_scores: [0.9], summary: "s" });
    expect(normalizeSearchResponse("tavily", { results: [{ ...item, images: ["i.png"], favicon: "f.ico" }] }).results[0].provider_raw)
      .toEqual({ images: ["i.png"], favicon: "f.ico" });
    expect(normalizeSearchResponse("tavily", { results: [item] }).results[0].provider_raw).toBeNull();
  });
});
