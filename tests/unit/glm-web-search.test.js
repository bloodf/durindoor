// GLM coding-plan search shares chat credentials and unwraps the MCP tool response.
import http from "node:http";
import { describe, expect, it } from "vitest";
import { buildSearchRequest } from "../../open-sse/handlers/search/callers.js";
import { normalizeSearchResponse } from "../../open-sse/handlers/search/normalizers.js";
import { handleSearchCore } from "../../open-sse/handlers/search/index.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";

const item = { title: "DurinDoor", link: "https://example.com/docs", content: "Gateway", publish_date: "2026-09-10", icon: "https://example.com/icon.png", media: "web" };
const envelope = (payload) => ({ result: { content: [{ text: JSON.stringify(payload) }] } });
const params = { query: "durindoor", maxResults: 3, token: "fixture-key", searchType: "web" };

describe("GLM MCP web search", () => {
  it("builds the MCP tool call and validates client URL overrides", () => {
    const config = { id: "glm", ...PROVIDER_MEDIA.glm.searchConfig };
    const { url, init } = buildSearchRequest(config, params);
    expect(url).toBe("https://api.z.ai/api/mcp/web_search_prime/mcp");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer fixture-key");
    expect(JSON.parse(init.body)).toEqual({ jsonrpc: "2.0", id: expect.stringMatching(/^dd-\d+$/), method: "tools/call", params: { name: "web_search_prime", arguments: { search_query: "durindoor", count: 3 } } });
    expect(buildSearchRequest(config, { ...params, token: undefined }).init.headers).not.toHaveProperty("Authorization");
    expect(buildSearchRequest(config, { ...params, providerOptions: { baseUrl: "https://example.com/mcp/" } }).url).toBe("https://example.com/mcp");
    expect(() => buildSearchRequest(config, { ...params, providerOptions: { baseUrl: "http://127.0.0.1/mcp" } })).toThrow(/Blocked/);
  });

  it.each([{ payload: { results: [item] } }, { payload: { news: [item] } }, { payload: [item] }])("unwraps supported MCP response shapes: %j", ({ payload }) => {
    const normalized = normalizeSearchResponse("glm", envelope(payload), "durindoor", "web");
    expect(normalized.totalResults).toBe(1);
    expect(normalized.results).toEqual([expect.objectContaining({ title: item.title, url: item.link, snippet: item.content, published_at: item.publish_date, favicon_url: item.icon, metadata: expect.objectContaining({ source_type: "web" }), position: 1, citation: { provider: "glm", rank: 1, retrieved_at: expect.any(String) } })]);
  });

  it("supports unwrapped fallback fields and empty malformed envelopes", () => {
    expect(normalizeSearchResponse("glm", { results: [{ title: "Fallback", url: item.link, published_at: item.publish_date }] }).results[0]).toEqual(expect.objectContaining({ url: item.link, published_at: item.publish_date }));
    for (const payload of [{ result: { content: [{ text: "invalid" }] } }, {}]) {
      expect(normalizeSearchResponse("glm", payload)).toEqual({ results: [], totalResults: 0 });
    }
  });

  it("dispatches registry-backed search and preserves outer versus inner JSON errors", async () => {
    const requests = [];
    let responseBody = JSON.stringify(envelope({ results: [item, { ...item, title: "Second" }] }));
    const server = http.createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      requests.push({ url: req.url, method: req.method, authorization: req.headers.authorization, body: JSON.parse(body) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(responseBody);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      // Reading registry config is intentional: absent media projection must fail dispatch.
      const config = PROVIDER_MEDIA.glm.searchConfig;
      expect(config).toBeDefined();
      const options = { provider: { id: "glm" }, providerConfig: { ...config, baseUrl: `http://127.0.0.1:${server.address().port}/mcp` }, credentials: { apiKey: "fixture-key", providerSpecificData: { oauthProxy: { mode: "direct" } } }, body: { query: "  durindoor  ", max_results: 1 } };
      const result = await handleSearchCore(options);
      expect(result.response.status).toBe(200);
      const data = await result.response.json();
      expect(data).toEqual(expect.objectContaining({ provider: "glm", results: [expect.objectContaining({ title: item.title })], usage: { queries_used: 1, search_cost_usd: 0 }, metrics: expect.objectContaining({ total_results_available: 2 }) }));
      expect(requests[0]).toEqual({ url: "/mcp", method: "POST", authorization: "Bearer fixture-key", body: { jsonrpc: "2.0", id: expect.stringMatching(/^dd-\d+$/), method: "tools/call", params: { name: "web_search_prime", arguments: { search_query: "durindoor", count: 1 } } } });
      expect((await handleSearchCore({ ...options, credentials: null })).status).toBe(401);
      expect((await handleSearchCore({ ...options, body: { query: "test", provider_options: { baseUrl: "http://127.0.0.1/mcp" } } })).status).toBe(400);
      expect(requests).toHaveLength(1);
      responseBody = "invalid outer JSON";
      expect((await handleSearchCore(options)).status).toBe(502);
      responseBody = JSON.stringify({ result: { content: [{ text: "invalid inner JSON" }] } });
      const innerMalformed = await handleSearchCore(options);
      expect(innerMalformed.response.status).toBe(200);
      expect(innerMalformed.data.results).toEqual([]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
