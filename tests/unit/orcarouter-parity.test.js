import { describe, expect, it, vi } from "vitest";
import registry from "../../open-sse/providers/registry/orcarouter.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { discoverOrcaRouterModels, seedCatalog } from "../../open-sse/providers/orcarouterCatalog.js";

const KEY = "sk-orca-test-account-one-abcdef0123456789";

describe("OrcaRouter pinned OmniRoute parity (closed mocks)", () => {
  it("uses the pinned bearer auth, endpoint and attribution headers", () => {
    expect(registry.transport.baseUrl).toBe("https://api.orcarouter.ai/v1/chat/completions");
    const executor = getExecutor("orcarouter");
    const headers = executor.buildHeaders({ apiKey: KEY }, false);
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers["HTTP-Referer"]).toBe("https://endpoint-proxy.local");
    expect(headers["X-Title"]).toBe("Endpoint Proxy");
    expect(seedCatalog().map((model) => model.id)).toContain("orcarouter/auto");
  });

  it("discovers models with the key and rejects invalid keys via upstream status", async () => {
    const fetchImpl = vi.fn(async (_url, init) => ({ ok: init.headers.Authorization === `Bearer ${KEY}`, status: init.headers.Authorization === `Bearer ${KEY}` ? 200 : 401, text: async () => JSON.stringify({ data: [{ id: "openai/gpt-5.5", supported_endpoint_types: ["openai"] }] }) }));
    const valid = await discoverOrcaRouterModels({ apiKey: KEY, fetchImpl });
    const invalid = await discoverOrcaRouterModels({ apiKey: "sk-orca-bad-key-abcdef0123456789", fetchImpl });
    expect(valid.source).toBe("live");
    expect(valid.models.map(({ id }) => id)).toEqual(["openai/gpt-5.5"]);
    expect(invalid.error).toBe("http_401");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([401, 429])("preserves HTTP %s as the discovery failure", async (status) => {
    const result = await discoverOrcaRouterModels({ apiKey: KEY, fetchImpl: async () => ({ ok: false, status }) });
    expect(result.error).toBe(`http_${status}`);
    expect(result.source).toBe("fallback");
  });

  it("keeps credentials account-scoped and supports both chat wire formats", () => {
    const executor = getExecutor("orcarouter");
    const a = executor.buildHeaders({ apiKey: KEY }, false);
    const b = executor.buildHeaders({ apiKey: "sk-orca-test-account-two-abcdef0123456789" }, true);
    expect(a.Authorization).toBe(`Bearer ${KEY}`);
    expect(b.Authorization).toBe("Bearer sk-orca-test-account-two-abcdef0123456789");
    expect(a.Authorization).not.toBe(b.Authorization);
    expect(b.Accept).toBe("text/event-stream");
    expect(executor.buildUrl("openai/gpt-5.5", false, 0, { apiKey: KEY })).toBe(registry.transport.baseUrl);
    // Claude requests are translated to the same upstream OpenAI chat contract.
    expect(registry.transport.format).toBe("openai");
  });
});
