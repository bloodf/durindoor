import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => []), getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []), getModelAliases: vi.fn(async () => ({})),
  getSyncedModelCatalogs: vi.fn(async () => []),
}));
import { getProviderConnections, getCustomModels } from "@/lib/localDb";
import { buildModelsList, resolveCompatibleCatalog } from "../../src/app/api/v1/models/buildModelsList.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { POST as validateNode } from "../../src/app/api/provider-nodes/validate/route.js";
import { probeConnectionHealth } from "../../src/lib/providerHealthProbe.js";
import embedding from "../../open-sse/handlers/embeddingProviders/openaiCompatNode.js";

let server, baseUrl, requests = [], fail = false;
beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    res.writeHead(fail ? 503 : 200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "lan-model" }] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

describe("LAN compatible discovery", () => {
  it("discovers without credentials, caches, and keeps the last good catalog", async () => {
    const conn = { id: "lan", provider: "openai-compatible-lan", providerSpecificData: { baseUrl } };
    const first = await resolveCompatibleCatalog(conn, "none");
    expect(first.models).toEqual([{ id: "lan-model" }]);
    // The catalog fetch is followed by a keyless LM Studio loaded-window probe (/api/v0/models, #5808).
    expect(requests.map((r) => r.url)).toEqual(["/v1/models", "/api/v0/models"]);
    expect(requests.every((r) => r.headers.authorization === undefined)).toBe(true);
    const count = requests.length;
    await resolveCompatibleCatalog(conn, "none");
    expect(requests).toHaveLength(count);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 301000);
    fail = true;
    expect(await resolveCompatibleCatalog(conn, "none")).toEqual(first);
    fail = false;
    vi.useRealTimers();
  });
  it.each([["openai-compatible-lan", "authorization"], ["anthropic-compatible-lan", "x-api-key"]])("fetches %s models with optional credentials", async (provider, header) => {
    const conn = { provider, providerSpecificData: { baseUrl } };
    expect((await fetchConnectionModels(conn)).models).toEqual([{ id: "lan-model" }]);
    expect(requests.at(-1).headers.authorization).toBeUndefined();
    expect(requests.at(-1).headers["x-api-key"]).toBeUndefined();
    await fetchConnectionModels({ ...conn, apiKey: "secret" });
    expect(requests.at(-1).headers[header]).toBe(header === "authorization" ? "Bearer secret" : "secret");
  });
  it.each(["openai-compatible", "anthropic-compatible", "custom-embedding"])("validates %s without auth headers", async (type) => {
    const response = await validateNode(new Request("http://localhost/api/provider-nodes/validate", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, baseUrl, modelId: "lan-model" }),
    }));
    expect((await response.json()).valid).toBe(true);
    expect(requests.at(-1).headers.authorization).toBeUndefined();
    expect(requests.at(-1).headers["x-api-key"]).toBeUndefined();
  });
  it.each(["openai-compatible-lan", "anthropic-compatible-lan"])("health probes %s without auth headers", async (provider) => {
    expect((await probeConnectionHealth({ provider, providerSpecificData: { baseUrl } })).valid).toBe(true);
    expect(requests.at(-1).headers.authorization).toBeUndefined();
    expect(requests.at(-1).headers["x-api-key"]).toBeUndefined();
  });
  it("merges discovered IDs with saved models without duplicates", async () => {
    getProviderConnections.mockResolvedValue([{ id: "merge", provider: "openai-compatible-lan", isActive: true, providerSpecificData: { baseUrl } }]);
    getCustomModels.mockResolvedValue([{ id: "saved", providerAlias: "openai-compatible-lan" }, { id: "lan-model", providerAlias: "openai-compatible-lan" }]);
    const models = await buildModelsList(["llm"], "none");
    const ids = models.map((model) => model.id);
    expect(ids.filter((id) => id.endsWith("/lan-model"))).toHaveLength(1);
    expect(ids.some((id) => id.endsWith("/saved"))).toBe(true);
  });
  it("omits embedding authorization without a key", () => {
    expect(embedding.buildHeaders({})).not.toHaveProperty("Authorization");
    expect(embedding.buildHeaders({ apiKey: "secret" }).Authorization).toBe("Bearer secret");
  });
});
