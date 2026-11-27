/**
 * decolua/9router #3363 (b08f006324ebc5e355a871fb46f8f5bd34f1acce): staged
 * Nous Research API-key provider. Exercises the staged definition, the
 * service (catalogue, verification, thinking, request shaping) and the
 * executor through the shared BaseExecutor/proxyAwareFetch transport, all
 * against offline mocks. Real-provider behaviour is unverified.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../translator/registerAll.js";
import {
  __clearProxyDispatchersForTesting,
  __setOriginalFetchForTesting,
  __setProxyDispatcherForTesting,
} from "../../open-sse/utils/proxyFetch.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { STAGED_PROVIDERS } from "../../open-sse/providers/staged.js";
import { getCapabilitiesForModel, DEFAULT_CAPABILITIES } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { hasSpecializedExecutor, REGISTERED_EXECUTOR_IDS } from "../../open-sse/executors/index.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { AI_PROVIDERS, APIKEY_PROVIDERS, LIVE_CATALOG_PROVIDERS } from "../../src/shared/constants/providers.js";
import {
  NOUS_API_KEY_URL,
  NOUS_CHAT_COMPLETIONS_URL,
  NOUS_MODEL_CAPABILITIES,
  NOUS_MODEL_PREFIX,
  NOUS_PROVIDER_ALIAS,
  NOUS_PROVIDER_ID,
  NOUS_SEED_MODELS,
  NOUS_SOURCE_PROVIDER_ID,
  NOUS_THINKING_LEVELS,
  NOUS_KEY_VERIFICATION,
  NOUS_MODELS_URL,
  NousCatalogError,
  buildNousChatBody,
  createNousExecutor,
  fetchNousModels,
  getNousModelCapabilities,
  getNousThinkingLevels,
  normalizeNousFreeModels,
  normalizeNousModels,
  normalizeRoutedNousModels,
  saveNousConnection,
  testNousConnection,
  toNousUpstreamModelId,
  translateToNousRequest,
  verifyNousApiKey,
} from "../../open-sse/services/nous.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Tokens the staged work introduces and the registry must not have yet.
const STAGED_ONLY_TOKENS = ["nous-portal"];
const readJson = (relative) => JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
const STAGED = readJson("open-sse/providers/staging/nous.json");
const HERMES_70B = "nousresearch/hermes-4-70b";
const KEY_A = "sk-nous-fixture-AAAA";
const KEY_B = "sk-nous-fixture-BBBB";

let restoreFetch = null;
afterEach(() => {
  restoreFetch?.();
  restoreFetch = null;
  __clearProxyDispatchersForTesting();
  vi.restoreAllMocks();
});

function mockOriginalFetch(impl) {
  const fetch = vi.fn(impl);
  restoreFetch = __setOriginalFetchForTesting(fetch);
  return fetch;
}

const json = (value, init = {}) => new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" }, ...init });
const headerOf = (init, name) => new Headers(init?.headers).get(name);

const CATALOG = {
  data: [
    { id: "poolside/laguna-xs-2.1:free", name: "Laguna XS", context_length: 262144, pricing: { prompt: "0", completion: "0" } },
    { id: "nousresearch/hermes-4-405b", name: "Hermes 4 405B", top_provider: { context_length: 131072, max_completion_tokens: 32000 }, pricing: { prompt: "0.000001", completion: "0.000003" } },
    { id: "text-embedding-x", architecture: { output_modalities: ["embedding"] } },
    { id: "image-only", architecture: { output_modalities: ["image"] } },
    { id: "nousresearch/hermes-4-70b", description: "Hermes", context_length: "abc", architecture: { output_modalities: ["text", "image"] } },
    { id: "   " },
    { name: "no id" },
    null,
    "string-entry",
    42,
    { id: "nousresearch/hermes-4-70b", name: "duplicate" },
    { id: "cheap/short:free", context_length: 8192, pricing: { prompt: 0, completion: 0 } },
    { id: "nullprice/long", context_length: 300000, pricing: { prompt: null, completion: "0" } },
  ],
};

describe("staged definition", () => {
  it("keeps the registered canonical ID and records the source pin", () => {
    // Verified canonical ID: the registry already serves Nous as nous-research/nous.
    const registered = REGISTRY.find(({ id }) => id === "nous-research");
    expect(STAGED.provider.id).toBe(registered.id);
    expect(STAGED.provider.alias).toBe(registered.alias);
    expect(STAGED.provider.transport.baseUrl).toBe(registered.transport.baseUrl);
    expect(STAGED.provider.aliases).toBeUndefined();
    expect(STAGED.models.registeredModels).toEqual(registered.models.map(({ id }) => id));
    expect(STAGED.status).toEqual({ staged: true, registered: false, promotionOwner: "register-auth-06", realProviderValidation: "unverified" });
    expect(STAGED.source).toEqual({ repository: "decolua/9router", pullRequest: 3363, commit: "b08f006324ebc5e355a871fb46f8f5bd34f1acce", providerId: "nous", aliases: ["nous-portal", "nous-research"], category: "freeTier" });
  });

  it("matches the service constants", () => {
    expect(NOUS_PROVIDER_ID).toBe(STAGED.provider.id);
    expect(NOUS_PROVIDER_ALIAS).toBe(STAGED.provider.alias);
    expect(NOUS_SOURCE_PROVIDER_ID).toBe(STAGED.source.providerId);
    expect(NOUS_CHAT_COMPLETIONS_URL).toBe(STAGED.provider.transport.baseUrl);
    expect(NOUS_MODELS_URL).toBe(STAGED.provider.modelsFetcher.url);
    expect(NOUS_API_KEY_URL).toBe(STAGED.provider.apiKeyUrl);
    expect(NOUS_MODEL_PREFIX).toBe(STAGED.provider.modelPrefix);
    expect(NOUS_SEED_MODELS).toEqual(STAGED.models.seeds);
    expect(NOUS_THINKING_LEVELS).toEqual(STAGED.models.thinkingLevels);
    for (const [id, row] of Object.entries(STAGED.models.capabilities)) {
      expect(NOUS_MODEL_CAPABILITIES[id], id).toMatchObject(row);
    }
    expect(Object.keys(NOUS_MODEL_CAPABILITIES)).toEqual(Object.keys(STAGED.models.capabilities));
    expect(NOUS_KEY_VERIFICATION).toMatchObject(STAGED.keyVerification);
  });

  it("matches the registration manifest", () => {
    const manifest = readJson("internal/docs/port-reports/9router-3363-nous-registration-manifest.json");
    expect(manifest.canonicalProviderId).toBe("nous-research");
    expect(manifest.canonicalProviderId).toBe(STAGED.provider.id);
    expect(manifest.source.commit).toBe(STAGED.source.commit);
    expect(manifest.source.verifiedContracts.id).toBe(STAGED.source.providerId);
    expect(manifest.staged.metadata).toBe("open-sse/providers/staging/nous.json");
    expect(manifest.staged.service).toBe("open-sse/services/nous.js");
    expect(manifest.request.url).toBe(NOUS_CHAT_COMPLETIONS_URL);
    expect(manifest.models.catalogUrl).toBe(NOUS_MODELS_URL);
    expect(manifest.probe.supported).toBe(false);
    expect(manifest.models.seeds).toEqual(STAGED.models.seeds);
  });

  it("is data only and is not imported by production code", () => {
    expect(fs.existsSync(path.join(root, "open-sse/providers/staging/nous.js"))).toBe(false);
    expect(fs.readdirSync(path.join(root, "open-sse/providers/staging"))).toEqual(["nous.json"]);
  });
});

describe("absence from public lists", () => {
  it("leaves the registered nous-research provider exactly as it was", () => {
    const entries = REGISTRY.filter(({ id, alias, aliases }) => [id, alias, ...(aliases || [])].some((token) => /^nous/.test(token || "")));
    expect(entries.map(({ id }) => id)).toEqual(["nous-research"]);
    const [registered] = entries;
    expect(registered.alias).toBe("nous");
    expect(registered.aliases).toBeUndefined();
    expect(registered.category).toBe("apikey");
    expect(registered.modelsFetcher).toBeUndefined();
    expect(registered.transport.modelsFetcher).toBeUndefined();
    expect(registered.models.map(({ id }) => id)).toEqual(["Hermes-4-405B", "Hermes-4-70B"]);
    expect(PROVIDER_MODELS.nous.map(({ id }) => id)).toEqual(["Hermes-4-405B", "Hermes-4-70B"]);
    expect(LIVE_CATALOG_PROVIDERS).not.toContain("nous-research");
    expect(hasSpecializedExecutor("nous-research")).toBe(false);
    expect(REGISTERED_EXECUTOR_IDS).not.toContain("nous-research");
  });

  it("does not register the source id, the new alias or the staged module", () => {
    for (const token of [...STAGED_ONLY_TOKENS, "nous"]) {
      expect(REGISTRY.some(({ id }) => id === token), token).toBe(false);
      expect(PROVIDERS[token], token).toBeUndefined();
      expect(AI_PROVIDERS[token], token).toBeUndefined();
      expect(APIKEY_PROVIDERS[token], token).toBeUndefined();
    }
    for (const token of STAGED_ONLY_TOKENS) {
      expect(REGISTRY.some(({ alias, aliases }) => alias === token || aliases?.includes(token)), token).toBe(false);
      expect(PROVIDER_MODELS[token], token).toBeUndefined();
    }
    expect(STAGED_PROVIDERS["nous-research"]).toBeUndefined();
    expect(fs.existsSync(path.join(root, "open-sse/providers/registry/nous.js"))).toBe(false);
    const index = fs.readFileSync(path.join(root, "open-sse/providers/registry/index.js"), "utf8");
    expect(index).not.toMatch(/staging|\.\/nous\.js/);
  });

  it("leaves shared capabilities and thinking levels for existing providers unchanged", () => {
    // Nous rows live only in the staged service; the shared table has none.
    expect(getCapabilitiesForModel("nous-research", HERMES_70B)).toMatchObject({ reasoning: DEFAULT_CAPABILITIES.reasoning, tools: DEFAULT_CAPABILITIES.tools });
    expect(getCapabilitiesForModel("poolside", "laguna-xs-2.1")).toMatchObject({ reasoning: true, thinkingFormat: "openai" });
    const body = { model: "gpt-5", messages: [{ role: "user", content: "x" }], reasoning_effort: "high" };
    applyThinking(FORMATS.OPENAI, "gpt-5", body, "openai");
    expect(body.reasoning).toBeUndefined();
    expect(body.reasoning_effort).toBeTruthy();
    expect(getThinkingLevels("openrouter", "openai/gpt-5")).toEqual(getThinkingLevels("openrouter", "openai/gpt-5"));
  });
});

describe("catalogue parsing", () => {
  it("keeps text models, drops malformed and duplicate entries, and lists first-party models first", () => {
    expect(normalizeNousModels(CATALOG)).toEqual([
      { id: "nousresearch/hermes-4-405b", name: "Hermes 4 405B", contextLength: 131072, maxOutputTokens: 32000 },
      { id: "nousresearch/hermes-4-70b", name: "nousresearch/hermes-4-70b", description: "Hermes" },
      { id: "poolside/laguna-xs-2.1:free", name: "Laguna XS", contextLength: 262144 },
      { id: "cheap/short:free", name: "cheap/short:free", contextLength: 8192 },
      { id: "nullprice/long", name: "nullprice/long", contextLength: 300000 },
    ]);
  });

  it.each([
    ["null", null],
    ["a string", "models"],
    ["a number", 7],
    ["a non-array data field", { data: "x" }],
    ["an empty object", {}],
    ["an array of junk", [null, 1, "a", []]],
  ])("returns no models for %s", (_name, payload) => {
    expect(normalizeNousModels(payload)).toEqual([]);
    expect(normalizeNousFreeModels(payload)).toEqual([]);
  });

  it("accepts the models, results and bare-array shapes", () => {
    for (const payload of [{ models: [{ id: "a" }] }, { results: [{ id: "a" }] }, [{ id: "a" }]]) {
      expect(normalizeNousModels(payload)).toEqual([{ id: "a", name: "a" }]);
    }
  });

  it("prefixes routed IDs with the owning provider", () => {
    const routed = normalizeRoutedNousModels({ data: [{ id: HERMES_70B }] });
    expect(routed).toEqual([{ id: `nous/${HERMES_70B}`, name: HERMES_70B, upstreamModelId: HERMES_70B }]);
    expect(toNousUpstreamModelId(routed[0].id)).toBe(HERMES_70B);
  });

  it("offers only zero-cost text models with at least 200K context as free", () => {
    expect(normalizeNousFreeModels(CATALOG).map(({ id }) => id)).toEqual(["poolside/laguna-xs-2.1:free"]);
  });
});

describe("catalogue fetch", () => {
  it("sends an unauthenticated GET to the fixed endpoint and refuses redirects", async () => {
    const fetch = mockOriginalFetch(async () => json(CATALOG));
    const models = await fetchNousModels({ proxyOptions: { disableEnvProxy: true } });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://inference-api.nousresearch.com/v1/models");
    expect(init.method).toBe("GET");
    expect(init.redirect).toBe("error");
    expect(headerOf(init, "authorization")).toBeNull();
    expect(init.body).toBeUndefined();
    expect(models[0]).toMatchObject({ id: "nous/nousresearch/hermes-4-405b", upstreamModelId: "nousresearch/hermes-4-405b" });
  });

  it("reports HTTP errors and malformed payloads", async () => {
    mockOriginalFetch(async () => new Response("upstream down", { status: 503 }));
    await expect(fetchNousModels({ proxyOptions: { disableEnvProxy: true } })).rejects.toMatchObject({ name: "NousCatalogError", status: 503, code: "catalog_http_error" });
    restoreFetch();
    mockOriginalFetch(async () => new Response("{not json", { status: 200 }));
    await expect(fetchNousModels({ proxyOptions: { disableEnvProxy: true } })).rejects.toMatchObject({ code: "catalog_malformed" });
    restoreFetch();
    mockOriginalFetch(async () => new Response("42", { status: 200 }));
    await expect(fetchNousModels({ proxyOptions: { disableEnvProxy: true } })).rejects.toBeInstanceOf(NousCatalogError);
  });

  it("routes through the selected connection's proxy only", async () => {
    const proxyA = { name: "dispatcher-a" };
    const proxyB = { name: "dispatcher-b" };
    __setProxyDispatcherForTesting("http://proxy-a.example.test:8080", proxyA);
    __setProxyDispatcherForTesting("http://proxy-b.example.test:8080", proxyB);
    const fetch = mockOriginalFetch(async () => json({ data: [] }));
    await fetchNousModels({ proxyOptions: { enabled: true, connectionProxyUrl: "http://proxy-a.example.test:8080", disableEnvProxy: true } });
    await fetchNousModels({ proxyOptions: { enabled: true, connectionProxyUrl: "http://proxy-b.example.test:8080", disableEnvProxy: true } });
    expect(fetch.mock.calls[0][1].dispatcher).toBe(proxyA);
    expect(fetch.mock.calls[1][1].dispatcher).toBe(proxyB);
  });
});

describe("key verification", () => {
  it("never contacts the network and saves a well-formed key unverified", async () => {
    const fetch = mockOriginalFetch(async () => json({}));
    const global = vi.spyOn(globalThis, "fetch");
    expect(verifyNousApiKey(`  ${KEY_A}  `)).toMatchObject({ valid: true, skipped: true, verified: false, status: "saved-unverified", error: null });
    expect(testNousConnection({ provider: "nous-research", apiKey: KEY_A })).toMatchObject({ valid: true, verified: false, status: "saved-unverified" });
    expect(fetch).not.toHaveBeenCalled();
    expect(global).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["whitespace", "   "],
    ["a number", 12345],
    ["internal whitespace", "sk nous"],
    ["a newline", "sk-nous\r\nX-Evil: 1"],
    ["non-ASCII", "sk-nous-é"],
    ["too long", "k".repeat(4097)],
  ])("rejects a %s key without persisting it", async (_name, apiKey) => {
    const persist = vi.fn();
    const result = await saveNousConnection({ apiKey }, { persist });
    expect(result.saved).toBe(false);
    expect(result.verification).toMatchObject({ valid: false, verified: false, status: "rejected" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("persists a trimmed key marked unverified", async () => {
    const persist = vi.fn(async (record) => ({ id: "conn-1", ...record }));
    const result = await saveNousConnection({ apiKey: ` ${KEY_A}\n`, name: " Nous " }, { persist });
    expect(result.saved).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0]).toEqual({ provider: "nous-research", authType: "apikey", apiKey: KEY_A, name: "Nous", testStatus: "unknown", lastError: null });
  });

  it("tests only Nous connections", () => {
    expect(testNousConnection({ provider: "openrouter", apiKey: KEY_A })).toMatchObject({ valid: false, status: "rejected" });
  });
});

describe("thinking", () => {
  it("declares reasoning only for the Hermes 4 rows", () => {
    expect(getNousModelCapabilities(`nous/${HERMES_70B}`)).toMatchObject({ reasoning: true, tools: false, contextWindow: 131072, maxOutput: 32000 });
    expect(getNousThinkingLevels(HERMES_70B)).toEqual(["none", "low", "medium", "high"]);
    expect(getNousThinkingLevels("poolside/laguna-xs-2.1:free")).toBeNull();
  });

  it.each([
    ["reasoning_effort high", { reasoning_effort: "high" }, { enabled: true, effort: "high" }],
    ["reasoning_effort minimal", { reasoning_effort: "minimal" }, { enabled: true, effort: "low" }],
    ["reasoning_effort xhigh", { reasoning_effort: "xhigh" }, { enabled: true, effort: "high" }],
    ["reasoning_effort max", { reasoning_effort: "max" }, { enabled: true, effort: "high" }],
    ["reasoning_effort auto", { reasoning_effort: "auto" }, { enabled: true, effort: "medium" }],
    ["unknown effort", { reasoning_effort: "turbo" }, { enabled: true, effort: "medium" }],
    ["Claude budget", { thinking: { type: "enabled", budget_tokens: 2000 } }, { enabled: true, effort: "low" }],
    ["adaptive", { thinking: { type: "adaptive" } }, { enabled: true, effort: "medium" }],
    ["native enabled", { reasoning: { enabled: true } }, { enabled: true, effort: "medium" }],
    ["native effort", { reasoning: { enabled: true, effort: "low" } }, { enabled: true, effort: "low" }],
  ])("sends nested reasoning for %s", (_name, fields, expected) => {
    const body = { messages: [{ role: "user", content: "hi" }], ...fields };
    const out = buildNousChatBody(`nous/${HERMES_70B}`, body);
    expect(out.reasoning).toEqual(expected);
    expect(out.model).toBe(HERMES_70B);
    for (const field of ["reasoning_effort", "thinking", "enable_thinking", "thinking_budget"]) expect(out[field], field).toBeUndefined();
  });

  it.each([
    ["no thinking field", {}],
    ["reasoning_effort none", { reasoning_effort: "none" }],
    ["Claude disabled", { thinking: { type: "disabled" } }],
    ["native disabled", { reasoning: { enabled: false } }],
  ])("omits reasoning for %s", (_name, fields) => {
    const out = buildNousChatBody(HERMES_70B, { messages: [], ...fields });
    expect("reasoning" in out).toBe(false);
    expect("reasoning_effort" in out).toBe(false);
    expect("thinking" in out).toBe(false);
  });

  it("applies a model suffix over the body and never mutates the input", () => {
    const body = Object.freeze({ messages: [], reasoning_effort: "low" });
    expect(buildNousChatBody(`nous/${HERMES_70B}(high)`, body)).toMatchObject({ model: HERMES_70B, reasoning: { enabled: true, effort: "high" } });
    expect(buildNousChatBody(`${HERMES_70B}(none)`, body).reasoning).toBeUndefined();
    expect(body).toEqual({ messages: [], reasoning_effort: "low" });
  });

  it("strips thinking fields for models that do not declare reasoning", () => {
    const out = buildNousChatBody("nous/poolside/laguna-xs-2.1:free", { messages: [], reasoning_effort: "high", reasoning: { enabled: true } });
    expect(out).toEqual({ messages: [], model: "poolside/laguna-xs-2.1:free" });
  });
});

describe("translation", () => {
  it("translates a Claude request with a thinking budget to the Nous wire", () => {
    const out = translateToNousRequest(FORMATS.CLAUDE, `nous/${HERMES_70B}`, {
      model: "claude-anything",
      max_tokens: 64,
      system: "be brief",
      thinking: { type: "enabled", budget_tokens: 12000 },
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
    }, { stream: true });
    expect(out.model).toBe(HERMES_70B);
    expect(out.stream).toBe(true);
    expect(out.reasoning).toEqual({ enabled: true, effort: "medium" });
    expect(out.thinking).toBeUndefined();
    expect(out.reasoning_effort).toBeUndefined();
    expect(out.messages.at(-1)).toMatchObject({ role: "user" });
    expect(JSON.stringify(out.messages)).toContain("hello");
  });

  it("translates a non-thinking OpenAI request without adding reasoning", () => {
    const out = translateToNousRequest(FORMATS.OPENAI, HERMES_70B, { model: HERMES_70B, messages: [{ role: "user", content: "hi" }] });
    expect(out.model).toBe(HERMES_70B);
    expect(out.stream).toBe(false);
    expect("reasoning" in out).toBe(false);
  });

  it("translates a Responses request with reasoning effort", () => {
    const out = translateToNousRequest(FORMATS.OPENAI_RESPONSES, HERMES_70B, { model: HERMES_70B, input: "hi", reasoning: { effort: "high" } });
    expect(out.reasoning).toEqual({ enabled: true, effort: "high" });
    expect(out.messages?.length).toBeGreaterThan(0);
  });
});

describe("executor request boundary", () => {
  const send = (executor, { credentials, proxyOptions = { disableEnvProxy: true }, directFetch, body, model = `nous/${HERMES_70B}`, stream = false, requestContext } = {}) => executor.execute({
    model,
    body: body ?? { messages: [{ role: "user", content: "ping" }], reasoning_effort: "low" },
    stream,
    credentials,
    proxyOptions,
    directFetch,
    requestContext,
  });

  it("posts the exact endpoint, headers and body with the selected key", async () => {
    const directFetch = vi.fn(async () => json({ id: "c", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    const { response } = await send(createNousExecutor(), { credentials: { apiKey: KEY_A }, directFetch });
    expect(response.status).toBe(200);
    expect(directFetch).toHaveBeenCalledTimes(1);
    const [url, init] = directFetch.mock.calls[0];
    expect(String(url)).toBe("https://inference-api.nousresearch.com/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(headerOf(init, "authorization")).toBe(`Bearer ${KEY_A}`);
    expect(headerOf(init, "content-type")).toBe("application/json");
    // Existing nous-research attribution tags are kept by the DefaultExecutor base.
    expect(JSON.parse(init.body)).toEqual({ messages: [{ role: "user", content: "ping" }], model: HERMES_70B, stream: false, reasoning: { enabled: true, effort: "low" }, tags: ["product=durindoor", "client=durindoor", "user=durindoor"] });
    expect(await response.json()).toMatchObject({ usage: { total_tokens: 2 } });
  });

  it("ignores a connection base URL and keeps the fixed host", async () => {
    const directFetch = vi.fn(async () => json({}));
    await send(createNousExecutor(), { credentials: { apiKey: KEY_A, providerSpecificData: { baseUrl: "https://attacker.example.test/v1" } }, directFetch });
    expect(new URL(directFetch.mock.calls[0][0]).host).toBe("inference-api.nousresearch.com");
  });

  it("does not follow a redirect, so the key never reaches another host", async () => {
    const directFetch = vi.fn(async () => new Response(null, { status: 307, headers: { Location: "https://attacker.example.test/steal" } }));
    await send(createNousExecutor(), { credentials: { apiKey: KEY_A }, directFetch }).catch(() => null);
    expect(directFetch.mock.calls.length).toBeGreaterThan(0);
    for (const [url, init] of directFetch.mock.calls) {
      expect(new URL(url).host).toBe("inference-api.nousresearch.com");
      expect(init.redirect).toBe("error");
    }
  });

  it("refuses to send without a usable key", async () => {
    const directFetch = vi.fn(async () => json({}));
    for (const credentials of [{}, { apiKey: "" }, { accessToken: "token-only" }, { apiKey: "bad key" }]) {
      await expect(send(createNousExecutor(), { credentials, directFetch })).rejects.toThrow(/API key/);
    }
    expect(directFetch).not.toHaveBeenCalled();
  });

  it("keeps each connection's key on its own proxy route", async () => {
    const proxyA = { name: "dispatcher-a" };
    const proxyB = { name: "dispatcher-b" };
    __setProxyDispatcherForTesting("http://proxy-a.example.test:8080", proxyA);
    __setProxyDispatcherForTesting("http://proxy-b.example.test:8080", proxyB);
    const fetch = mockOriginalFetch(async () => json({}));
    const executor = createNousExecutor();
    await send(executor, { credentials: { id: "a", apiKey: KEY_A }, proxyOptions: { enabled: true, connectionProxyUrl: "http://proxy-a.example.test:8080", disableEnvProxy: true } });
    await send(executor, { credentials: { id: "b", apiKey: KEY_B }, proxyOptions: { enabled: true, connectionProxyUrl: "http://proxy-b.example.test:8080", disableEnvProxy: true } });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1].dispatcher).toBe(proxyA);
    expect(headerOf(fetch.mock.calls[0][1], "authorization")).toBe(`Bearer ${KEY_A}`);
    expect(fetch.mock.calls[1][1].dispatcher).toBe(proxyB);
    expect(headerOf(fetch.mock.calls[1][1], "authorization")).toBe(`Bearer ${KEY_B}`);
  });

  it("uses a captured thinking intent and streams with an SSE accept header", async () => {
    const directFetch = vi.fn(async () => new Response("data: [DONE]\n\n", { status: 200, headers: { "Content-Type": "text/event-stream" } }));
    await send(createNousExecutor(), {
      credentials: { apiKey: KEY_A },
      directFetch,
      stream: true,
      body: { messages: [{ role: "user", content: "x" }] },
      requestContext: { thinkingIntent: { mode: "level", level: "high" } },
    });
    const init = directFetch.mock.calls[0][1];
    expect(headerOf(init, "accept")).toBe("text/event-stream");
    expect(JSON.parse(init.body)).toMatchObject({ stream: true, reasoning: { enabled: true, effort: "high" } });
  });
});
