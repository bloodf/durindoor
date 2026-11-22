import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => []), getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []), getModelAliases: vi.fn(async () => ({})),
  getSyncedModelCatalogs: vi.fn(async () => []),
}));
import { getProviderConnections } from "@/lib/localDb";
import { buildModelsList, resolveCompatibleCatalog, readCompatibleContextLength } from "../../src/app/api/v1/models/buildModelsList.js";

let server, baseUrl, requests = [], v1Rows = [], nativeRows = null;
beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push(req.url);
    if (req.url === "/api/v0/models") {
      if (!nativeRows) { res.writeHead(404); return res.end("{}"); }
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ data: nativeRows }));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: v1Rows }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => { requests = []; v1Rows = []; nativeRows = null; });

const conn = (id) => ({ id, provider: "openai-compatible-lms", isActive: true, providerSpecificData: { baseUrl } });

describe("port9r #5808 compatible node runtime context window", () => {
  it("reads only runtime window fields, never the trained maximum", () => {
    expect(readCompatibleContextLength({ max_model_len: 32768 })).toBe(32768);
    expect(readCompatibleContextLength({ limit: { context: 65536 } })).toBe(65536);
    expect(readCompatibleContextLength({ max_context_length: 1048576, n_ctx_train: 1048576 })).toBeNull();
  });

  it("publishes the LM Studio loaded window and leaves unloaded models on the fallback", async () => {
    v1Rows = [{ id: "loaded-model" }, { id: "idle-model" }];
    nativeRows = [{ id: "loaded-model", loaded_context_length: 131072, max_context_length: 1048576 }, { id: "idle-model", max_context_length: 1048576 }];
    const catalog = await resolveCompatibleCatalog(conn("lms-1"), "none");
    const byId = Object.fromEntries(catalog.models.map((m) => [m.id, m]));
    expect(byId["loaded-model"].capabilities.contextWindow).toBe(131072);
    expect(byId["idle-model"].capabilities).toBeUndefined();
  });

  it("uses vLLM max_model_len without probing LM Studio", async () => {
    v1Rows = [{ id: "vllm-model", max_model_len: 32768 }];
    const catalog = await resolveCompatibleCatalog(conn("vllm-1"), "none");
    expect(catalog.models[0].capabilities.contextWindow).toBe(32768);
    expect(requests).not.toContain("/api/v0/models");
  });

  it("skips the LM Studio probe for a connection after a miss", async () => {
    v1Rows = [{ id: "plain-model" }];
    const c = conn("miss-1");
    await resolveCompatibleCatalog(c, "none");
    expect(requests.filter((u) => u === "/api/v0/models")).toHaveLength(1);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 301000); // catalog cache expired, miss cache (10 min) still valid
    await resolveCompatibleCatalog(c, "none");
    vi.useRealTimers();
    expect(requests.filter((u) => u === "/api/v0/models")).toHaveLength(1);
  });

  it("surfaces the loaded window as context_length in /v1/models", async () => {
    v1Rows = [{ id: "e2e-model" }];
    nativeRows = [{ id: "e2e-model", loaded_context_length: 131072 }];
    getProviderConnections.mockResolvedValue([conn("e2e-1")]);
    const models = await buildModelsList(["llm"], "none");
    const model = models.find((m) => m.id.endsWith("/e2e-model"));
    expect(model.context_length).toBe(131072);
    expect(model.capabilities.contextWindow).toBe(131072);
  });
});
