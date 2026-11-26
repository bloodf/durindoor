// Keenable results are filtered locally. The transport is a stubbed global fetch.
import { afterEach, describe, expect, it, vi } from "vitest";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { handleSearchCore } from "../../open-sse/handlers/search/index.js";

const provider = REGISTRY.find((entry) => entry.id === "keenable");
const URLS = [
  "https://example.com/a",
  "https://Docs.Example.com/b",
  "https://notexample.com/c",
  "https://excluded.org/d",
  "https://www.excluded.org/e",
  "https://other.net/f",
  "javascript:alert(1)",
  "/relative",
];

async function search(domainFilter) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: URLS.map((url) => ({ title: url, url })) }), {
    headers: { "content-type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetchMock);
  const result = await handleSearchCore({
    body: { query: "sqlite wal", max_results: 20, domain_filter: domainFilter },
    provider: { id: "keenable" },
    providerConfig: provider.searchConfig,
    credentials: null,
  });
  return { urls: result.data.results.map((row) => row.url), sent: JSON.parse(fetchMock.mock.calls[0][1].body) };
}

describe("Keenable domain filters (OmniRoute #20634)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts several include domains and keeps only their hosts and subdomains", async () => {
    const { urls, sent } = await search(["Example.com", "other.net"]);

    expect(sent).not.toHaveProperty("site");
    expect(urls).toEqual(["https://example.com/a", "https://Docs.Example.com/b", "https://other.net/f"]);
  });

  it("drops excluded domains and their subdomains even when upstream returns them", async () => {
    const { urls, sent } = await search(["-excluded.org"]);

    expect(sent.exclude_domains).toEqual(["excluded.org"]);
    expect(urls).toEqual(["https://example.com/a", "https://Docs.Example.com/b", "https://notexample.com/c", "https://other.net/f"]);
  });

  it("applies one include together with an excluded subdomain", async () => {
    const { urls, sent } = await search(["example.com", "-docs.example.com"]);

    expect(sent.site).toBe("example.com");
    expect(urls).toEqual(["https://example.com/a"]);
  });

  it("keeps only http(s) results without a filter", async () => {
    const { urls } = await search(undefined);

    expect(urls).toEqual(URLS.slice(0, 6));
  });
});
