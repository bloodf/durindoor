import { afterEach, beforeEach, expect, it, vi } from "vitest";
const transport = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: transport.fetch }));
vi.mock("open-sse/utils/kimchiUserAgent.js", () => ({ getKimchiUserAgent: () => "offline", updateKimchiUserAgent: vi.fn() }));
import provider from "../../open-sse/providers/registry/trustedrouter.js";
import { probeRegistryProvider } from "../../src/app/api/providers/providerProbe.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { handleEmbeddingsCore } from "../../open-sse/handlers/embeddingsCore.js";
import { getModelInfoCore } from "../../open-sse/services/model.js";
import { getProviderModels } from "../../open-sse/config/providerModels.js";
import { normalizeSyncedModels, mergeSyncedCatalog, materializeSyncedModel } from "../../src/lib/modelAutoSync/catalog.js";
import { parseTrustedRouterChatModels, parseTrustedRouterModels } from "../../open-sse/providers/trustedrouterCatalog.js";
const api = "https://api.trustedrouter.com/v1";
const apiKey = "offline-synthetic-key";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  transport.fetch.mockReset();
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network access"); }));
});
afterEach(() => vi.unstubAllGlobals());

it("registers fallback metadata and preserves provider/vendor identity", async () => {
  expect(provider.category).toBe("apikey");
  expect(provider.transport.responsesBaseUrl).toBe(`${api}/responses`);
  expect(provider.models).toHaveLength(12);
  expect(provider.embeddingConfig.models).toHaveLength(9);
  expect(getProviderModels("trustedrouter").find((m) => m.id === "openai/text-embedding-3-small")).toMatchObject({ kind: "embedding", dimensions: 1536 });
  expect(await getModelInfoCore("trustedrouter/anthropic/claude-sonnet-4.6")).toEqual({ provider: "trustedrouter", model: "anthropic/claude-sonnet-4.6" });
  expect(await getModelInfoCore("anthropic/claude-sonnet-4.6")).toEqual({ provider: "anthropic", model: "claude-sonnet-4.6" });
  expect(await getModelInfoCore("trustedrouter/trustedrouter/auto")).toEqual({ provider: "trustedrouter", model: "trustedrouter/auto" });
});

it.each([200, 401, 403, 302, 503])("checks /key instead of the public catalog (HTTP %s)", async (status) => {
  const fetcher = vi.fn().mockResolvedValue(json({}, status));
  const result = await probeRegistryProvider("trustedrouter", apiKey, fetcher, { baseUrl: "http://attacker.invalid" });
  expect(result.valid).toBe(status === 200);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe(`${api}/key`);
  expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { Authorization: `Bearer ${apiKey}` }, redirect: "manual" });
});

it("filters mixed catalogs and retains limits, capabilities and vendor IDs", async () => {
  const row = { id: "anthropic/claude-sonnet-4.6", context_length: 1000000, top_provider: { max_completion_tokens: 128000 }, architecture: { input_modalities: ["text", "image"] }, supported_parameters: ["tools", "reasoning"], trustedrouter: { supports_chat: true } };
  const rows = [row, null, {}, { id: "embedding", trustedrouter: { supports_embeddings: true } }, ...["configuration_hidden", "internal_only", "synthetic_monitor"].map((flag) => ({ ...row, trustedrouter: { supports_chat: true, [flag]: true } }))];
  const expected = [{ id: row.id, name: row.id, contextLength: 1000000, outputTokenLimit: 128000, vision: true, tools: true, reasoning: true }];
  expect(parseTrustedRouterChatModels({ data: rows })).toEqual(expected);
  expect(parseTrustedRouterChatModels(null)).toEqual([]);
  expect(parseTrustedRouterModels(null)).toEqual([]);
  const complete = [...expected, ...provider.embeddingConfig.models.map((model) => ({ ...model, kind: "embedding" }))];
  const staticModels = getProviderModels("trustedrouter");
  const normalized = normalizeSyncedModels(complete, staticModels, { format: "generic" });
  const synced = mergeSyncedCatalog(null, normalized, { now: 0, staticModels });
  expect(synced.models.find((model) => model.id === "openai/text-embedding-3-small").kind).toBe("embedding");
  expect(synced.removedModelIds).not.toContain("openai/text-embedding-3-small");
  transport.fetch.mockResolvedValueOnce(json({ data: rows }));
  expect(await fetchConnectionModels({ provider: "trustedrouter", apiKey, providerSpecificData: { baseUrl: "file:///etc/passwd" } })).toEqual({ models: complete });
  expect(transport.fetch.mock.calls[0][0]).toBe(`${api}/models`);
  expect(transport.fetch.mock.calls[0][1]).toMatchObject({ headers: { Authorization: `Bearer ${apiKey}` }, redirect: "manual" });
  transport.fetch.mockResolvedValueOnce(json({}, 302));
  expect((await fetchConnectionModels({ provider: "trustedrouter", apiKey })).status).toBe(302);
});

it("synced discovery keeps canonical vision, tools and reasoning without overriding static metadata", async () => {
  const flagship = { id: "vendor/omni-1", name: "Omni 1", context_length: 400000, top_provider: { max_completion_tokens: 64000 }, architecture: { input_modalities: ["text", "image"] }, supported_parameters: ["temperature", "tools", "reasoning"], trustedrouter: { supports_chat: true } };
  const textOnly = { id: "vendor/plain-1", context_length: 32000, architecture: { input_modalities: ["text"] }, supported_parameters: ["temperature", "tool_choice", "reasoning_effort"], trustedrouter: { supports_chat: true } };
  const curated = { id: "deepseek/deepseek-v4-flash", architecture: { input_modalities: ["text"] }, supported_parameters: [], trustedrouter: { supports_chat: true } };
  const hidden = { ...flagship, id: "vendor/hidden-1", trustedrouter: { supports_chat: true, configuration_hidden: true } };
  const embeddingRow = { id: "vendor/embed-1", architecture: { input_modalities: ["text"] }, trustedrouter: { supports_embeddings: true } };
  transport.fetch.mockResolvedValueOnce(json({ data: [embeddingRow, hidden, flagship, textOnly, curated] }));
  const { models } = await fetchConnectionModels({ provider: "trustedrouter", apiKey });
  const staticModels = getProviderModels("trustedrouter");
  const normalized = normalizeSyncedModels(models, staticModels, { format: "generic" });
  const byId = (id) => normalized.find((model) => model.id === id);
  expect(byId("vendor/hidden-1")).toBeUndefined();
  expect(byId("vendor/embed-1")).toBeUndefined();
  expect(byId("vendor/omni-1")).toMatchObject({ name: "Omni 1", kind: "llm", capabilities: { vision: true, tools: true, reasoning: true, contextWindow: 400000, maxOutput: 64000 } });
  // Unadvertised support stays unknown rather than an explicit false.
  for (const id of ["vendor/plain-1", "deepseek/deepseek-v4-flash"]) {
    for (const key of ["vision", "tools", "reasoning"]) expect(byId(id).capabilities?.[key]).toBeUndefined();
  }
  expect(byId("vendor/plain-1").capabilities).toMatchObject({ contextWindow: 32000 });
  expect(byId("openai/text-embedding-3-small")).toMatchObject({ kind: "embedding" });
  const synced = mergeSyncedCatalog(null, normalized, { now: 0, staticModels });
  const materialize = (id) => materializeSyncedModel("trustedrouter", synced.models.find((model) => model.id === id)).capabilities;
  expect(materialize("vendor/omni-1")).toMatchObject({ vision: true, tools: true, reasoning: true });
  const plain = materialize("vendor/plain-1");
  for (const key of ["vision", "tools", "reasoning"]) expect(plain[key]).not.toBe(true);
  const staticCaps = materializeSyncedModel("trustedrouter", { id: "deepseek/deepseek-v4-flash", kind: "llm" }).capabilities;
  expect(staticCaps.reasoning).toBe(true);
  const syncedStatic = materialize("deepseek/deepseek-v4-flash");
  for (const key of ["vision", "tools", "reasoning"]) expect(syncedStatic[key]).toBe(staticCaps[key]);
});

it.each(["http://attacker.invalid", "file:///etc/passwd", "https://attacker.invalid", "https://api.trustedrouter.com@attacker.invalid"])("pins credential destinations despite override %s", async (baseUrl) => {
  const credentials = { apiKey, providerSpecificData: { baseUrl }, runtimeTransport: { baseUrl } };
  const model = "anthropic/claude-sonnet-4.6";
  transport.fetch.mockResolvedValueOnce(json({ choices: [] }));
  await getExecutor("trustedrouter").execute({ model, body: { model, messages: [{ role: "user", content: "Hi" }] }, stream: false, credentials });
  const [url, init] = transport.fetch.mock.calls[0];
  expect(url).toBe(`${api}/chat/completions`);
  expect(init).toMatchObject({ headers: { Authorization: `Bearer ${apiKey}` }, redirect: "error" });
  expect(JSON.parse(init.body).model).toBe(model);
  transport.fetch.mockResolvedValueOnce(json({ data: [{ embedding: [0.1, 0.2], index: 0 }], usage: { prompt_tokens: 1, total_tokens: 1 } }));
  const result = await handleEmbeddingsCore({ body: { input: "Hi" }, modelInfo: { provider: "trustedrouter", model: "openai/text-embedding-3-small" }, credentials });
  expect(result.success).toBe(true);
  const [embeddingUrl, embeddingInit] = transport.fetch.mock.calls[1];
  expect(embeddingUrl).toBe(`${api}/embeddings`);
  expect(embeddingInit).toMatchObject({ headers: { Authorization: `Bearer ${apiKey}` }, redirect: "error" });
  expect(JSON.parse(embeddingInit.body).model).toBe("openai/text-embedding-3-small");
});
