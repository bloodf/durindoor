// AI Horde native images registered on the existing `aihorde` provider.
// Public routes, the real account selector, registry, core and adapter run
// against one closed fetch: the Horde catalog, the Horde job API, the image
// download host (a public IP literal, so no DNS lookup) and the chat facade are
// all answered here. Nothing reaches a live service; passing proves the
// gateway contract only, not live AI Horde acceptance.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const state = {
    rows: [],
    routes: {},
    calls: [],
    save: null,
    markUnavailable: null,
  };
  // Replaced before any module captures `fetch`, so every outbound call lands here.
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input?.url ?? input);
    const method = init.method || input?.method || "GET";
    state.calls.push({ url, method, headers: { ...(init.headers || {}) }, body: init.body });
    for (const [pattern, answer] of Object.entries(state.routes)) {
      const [verb, prefix] = pattern.split(" ");
      if (verb === method && url.startsWith(prefix)) return answer({ url, init, calls: state.calls });
    }
    throw new Error(`closed network: ${method} ${url}`);
  };
  return state;
});

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({})),
  getApiKeyByKey: vi.fn(async () => null),
  getApiKeyById: vi.fn(async () => null),
  getApiKeyUsageTotals: vi.fn(async () => ({})),
  getApiKeyUsageLimitStatus: vi.fn(async () => ({ enforced: false, exceeded: false })),
  getComboForModel: vi.fn(async () => null),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getSyncedModelCatalog: vi.fn(async () => null),
  getSyncedModelCatalogs: vi.fn(async () => m.synced),
  getProviderNodes: vi.fn(async () => []),
  getProviderNodeById: vi.fn(async () => null),
  getProviderConnections: vi.fn(async (filter = {}) => m.rows.filter((row) =>
    (!filter.provider || row.provider === filter.provider) && (filter.isActive === undefined || row.isActive === filter.isActive))),
  getProviderConnectionById: vi.fn(async (id) => m.rows.find((row) => row.id === id) ?? null),
  getApiKeyProviderConnectionIds: vi.fn(async () => []),
  getQuotaReservationPressure: vi.fn(async () => null),
  getProxyPools: vi.fn(async () => []),
  getProxyPoolById: vi.fn(async () => null),
  validateApiKey: vi.fn(async () => true),
  createProviderConnection: vi.fn(async (data) => { const row = { ...data, id: `conn-${m.rows.length + 1}` }; m.rows.push(row); return row; }),
  updateProviderConnection: vi.fn(async (id, patch) => Object.assign(m.rows.find((row) => row.id === id) ?? {}, patch)),
  deleteProviderConnection: vi.fn(),
  saveRequestUsage: vi.fn(async (event) => m.save(event)),
}));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn(async () => m.settings) }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})), pickProxyPoolId: vi.fn(() => null) }));
vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: vi.fn(async () => true), canManageAccessConfig: vi.fn(async () => true) }));
vi.mock("../../src/sse/services/auth.js", async (original) => ({
  ...await original(),
  // Account health is recorded, not persisted.
  markAccountUnavailable: vi.fn((...args) => m.markUnavailable(...args)),
  clearAccountError: vi.fn(async () => {}),
  resolveClientApiKey: vi.fn(async () => ({ apiKey: "caller-key", auth: { ok: true, apiKeyId: "caller-id", billingEpoch: null } })),
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  refreshWithRetry: vi.fn(async () => null),
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
}));
vi.mock("../../src/sse/utils/logger.js", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), request: vi.fn() }));
vi.mock("../../src/sse/services/mediaRoutes.js", () => ({
  wantsDefaultRoute: () => false,
  resolveMediaRoute: vi.fn(),
  defaultRouteComboOptions: () => ({}),
  listMediaRouteCandidates: vi.fn(),
  providerOfModelId: vi.fn(),
  supportsVideoJobs: () => false,
}));
vi.mock("../../open-sse/services/comboRoutingPolicy.js", () => ({ getComboRoutingPolicy: vi.fn(async () => null) }));
vi.mock("@/sse/services/modelAccess.js", () => ({
  filterModelsForRequest: vi.fn(async (_request, models) => models),
  getRequestModelDiscoveryOptions: vi.fn(async () => ({})),
}));
// The real factory with millisecond polling; transports and downloads use the closed fetch.
vi.mock("../../open-sse/handlers/imageProviders/aihorde.js", async (original) => {
  const actual = await original();
  return {
    ...actual,
    default: actual.createAiHordeImageAdapter({
      pollMinMs: 1,
      pollMaxMs: 5,
      downloadFetch: (...args) => globalThis.fetch(...args),
    }),
  };
});

import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import registeredAdapter from "../../open-sse/handlers/imageProviders/aihorde.js";
import { PROVIDERS } from "../../open-sse/providers/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { getModelInfo } from "../../src/sse/services/model.js";
import { AI_HORDE_CATALOG_URL, AI_HORDE_CLIENT_AGENT, aiHordeImageCatalog } from "../../open-sse/services/catalogs/aihordeImageCatalog.js";
import { clearLiveModelLimitsCache } from "../../open-sse/services/liveModelLimits.js";
import { ACCEPTED_JOB_HEADER } from "../../open-sse/services/combo.js";

const { POST: images } = await import("@/app/api/v1/images/generations/route.js");
const { GET: listModels } = await import("@/app/api/v1/models/route.js");
const { GET: listKind } = await import("@/app/api/v1/models/[...model]/route.js");
const { POST: createConnection } = await import("@/app/api/providers/route.js");
const { POST: validateConnection } = await import("@/app/api/providers/validate/route.js");
const { fetchConnectionModels } = await import("@/app/api/providers/[id]/models/fetchConnectionModels.js");

const API = "https://aihorde.net/api";
const FACADE_MODELS = "https://oai.aihorde.net/v1/models";
const JOB = "0a1b2c3d-4e5f-4789-9abc-def012345678";
const KEY_A = "hordekey-account-a-111111";
const KEY_B = "hordekey-account-b-222222";
const CHAT_ID = "koboldcpp/Llama-3.2-3B";
const IMAGE_MODEL = "AlbedoBase XL (SDXL)";
const IMG_URL = "https://1.1.1.1/r2/result.png?X-Amz-Signature=SIGNEDSECRET";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 1)]);
const SECRETS = [KEY_A, KEY_B, "SIGNEDSECRET", "1.1.1.1", "X-Amz"];

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
const catalogRows = [{ name: IMAGE_MODEL, count: 3, type: "image" }, { name: "Idle Model", count: 0, type: "image" }];

function routes(overrides = {}) {
  return {
    [`GET ${AI_HORDE_CATALOG_URL}`]: () => json(catalogRows),
    [`GET ${FACADE_MODELS}`]: () => json({ data: [{ id: CHAT_ID, object: "model" }] }),
    [`POST ${API}/v2/generate/async`]: () => json({ id: JOB, kudos: 12 }, 202),
    [`GET ${API}/v2/generate/check/`]: () => json({ done: true, faulted: false, is_possible: true }),
    [`GET ${API}/v2/generate/status/`]: () => json({ done: true, faulted: false, kudos: 11, generations: [{ img: IMG_URL, censored: false }] }),
    [`DELETE ${API}/v2/generate/status/`]: () => json({}),
    "GET https://1.1.1.1/": () => new Response(PNG, { status: 200, headers: { "Content-Type": "image/png" } }),
    ...overrides,
  };
}

const connection = (id, apiKey, extra = {}) => ({ id, provider: "aihorde", authType: "apikey", apiKey, isActive: true, priority: 1, name: id, ...extra });
const usage = () => m.saveCalls;
const hordeCalls = (suffix) => m.calls.filter((call) => call.url.startsWith(`${API}${suffix}`));
const submits = () => hordeCalls("/v2/generate/async");
const post = (extra = {}, init = {}) => images(new Request("http://localhost/v1/images/generations", {
  method: "POST",
  headers: { "content-type": "application/json", ...init.headers },
  body: JSON.stringify({ model: `horde/${IMAGE_MODEL}`, prompt: "a stone gate in a silver forest", ...extra }),
  ...(init.signal ? { signal: init.signal } : {}),
}));
const noSecrets = (text) => { for (const secret of SECRETS) expect(text).not.toContain(secret); };

beforeEach(() => {
  vi.clearAllMocks();
  clearLiveModelLimitsCache();
  aiHordeImageCatalog.clear();
  m.rows = [];
  m.synced = {};
  m.settings = {};
  m.calls.length = 0;
  m.routes = routes();
  m.saveCalls = [];
  m.save = (event) => { m.saveCalls.push(event); return true; };
  m.markUnavailable = async () => ({ shouldFallback: false });
});
afterEach(() => { aiHordeImageCatalog.clear(); });

describe("AI Horde image registration on the existing provider", () => {
  it("registers the real adapter under the canonical id and alias, beside the unchanged chat transport", () => {
    expect(getImageAdapter("aihorde")).toBe(registeredAdapter);
    expect(getImageAdapter("horde")).toBe(registeredAdapter);
    expect(registeredAdapter).toMatchObject({ async: true, defaultResponseFormat: "b64_json", responseFormats: ["b64_json"] });
    expect(PROVIDERS.aihorde).toMatchObject({ baseUrl: "https://oai.aihorde.net/v1/chat/completions", headers: { Authorization: "Bearer 0000000000" } });
    // The chat executor still targets the facade with the Bearer header.
    const executor = new DefaultExecutor("aihorde");
    expect(executor.buildHeaders({ apiKey: KEY_A }, false).Authorization).toBe(`Bearer ${KEY_A}`);
    expect(executor.buildHeaders({ apiKey: KEY_A }, false).apikey).toBeUndefined();
  });

  it("resolves the image id with spaces through the registry alias without a chat fallback", async () => {
    expect(await getModelInfo(`horde/${IMAGE_MODEL}`)).toMatchObject({ provider: "aihorde", model: IMAGE_MODEL });
    expect(await getModelInfo(`aihorde/${IMAGE_MODEL}`)).toMatchObject({ provider: "aihorde", model: IMAGE_MODEL });
    // A chat id is not an image route: the worker catalog refuses it before any submit.
    const response = await post({ model: `horde/${CHAT_ID}` });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("No AI Horde workers are currently serving");
    expect(submits()).toHaveLength(0);
    expect(m.calls.some((call) => call.url.includes("oai.aihorde.net/v1/chat"))).toBe(false);
  });
});

describe("AI Horde image discovery", () => {
  it("lists served catalog models in /v1/models/image and keeps /v1/models chat-only", async () => {
    const typed = await (await listKind(new Request("http://localhost/v1/models/image"), { params: Promise.resolve({ model: ["image"] }) })).json();
    const horde = typed.data.filter((model) => model.owned_by === "horde");
    expect(horde.map((model) => model.id)).toEqual([`horde/${IMAGE_MODEL}`]);
    expect(horde[0]).toMatchObject({ kind: "image", capabilities: { imageOutput: true, tools: false } });
    // The worker catalog is public: no credential is sent to it.
    const catalogCall = m.calls.find((call) => call.url === AI_HORDE_CATALOG_URL);
    expect(catalogCall.headers).toEqual({ Accept: "application/json", "Client-Agent": AI_HORDE_CLIENT_AGENT });
    expect(m.calls.some((call) => call.url === FACADE_MODELS)).toBe(false);

    const chat = await (await listModels(new Request("http://localhost/v1/models"))).json();
    expect(chat.data.filter((model) => model.owned_by === "horde").map((model) => model.id)).toEqual([`horde/${CHAT_ID}`]);
  });

  it("lists nothing from a failed refresh rather than stale or zero-worker models", async () => {
    await aiHordeImageCatalog.ensureFresh();
    m.routes[`GET ${AI_HORDE_CATALOG_URL}`] = () => json({ message: "down" }, 503);
    await aiHordeImageCatalog.refresh();
    expect(aiHordeImageCatalog.stale).toBe(true);
    const typed = await (await listKind(new Request("http://localhost/v1/models/image"), { params: Promise.resolve({ model: ["image"] }) })).json();
    expect(typed.data.filter((model) => model.owned_by === "horde")).toEqual([]);
  });

  it("a saved connection lists chat and image rows in the dashboard and in /v1/models/image", async () => {
    m.rows = [connection("conn-a", KEY_A)];
    const found = await fetchConnectionModels(m.rows[0]);
    expect(found.models).toEqual([
      { id: CHAT_ID, object: "model" },
      { id: IMAGE_MODEL, name: IMAGE_MODEL, kind: "image", owned_by: "aihorde" },
    ]);
    // Chat discovery keeps its Bearer key; the catalog gets no key at all.
    expect(m.calls.find((call) => call.url === FACADE_MODELS).headers.Authorization).toBe(`Bearer ${KEY_A}`);
    for (const call of m.calls.filter((entry) => entry.url === AI_HORDE_CATALOG_URL)) expect(JSON.stringify(call.headers)).not.toContain(KEY_A);

    const typed = await (await listKind(new Request("http://localhost/v1/models/image"), { params: Promise.resolve({ model: ["image"] }) })).json();
    expect(typed.data.filter((model) => model.owned_by === "horde").map((model) => model.id)).toEqual([`horde/${IMAGE_MODEL}`]);
    const chat = await (await listModels(new Request("http://localhost/v1/models"))).json();
    expect(chat.data.filter((model) => model.owned_by === "horde").map((model) => model.id)).toEqual([`horde/${CHAT_ID}`]);
  });

  it("a synced catalog publishes an image row only while the worker catalog serves it", async () => {
    m.rows = [connection("conn-a", KEY_A)];
    m.settings = { modelAutoSyncProviders: { aihorde: true } };
    m.synced = { aihorde: { syncedAt: "2026-11-27T00:00:00.000Z", models: [
      { id: CHAT_ID, name: CHAT_ID, kind: "llm" },
      { id: "koboldcpp/Qwen-Image-2", name: "koboldcpp/Qwen-Image-2", kind: "image" },
      { id: IMAGE_MODEL, name: IMAGE_MODEL, kind: "image" },
      { id: "Idle Model", name: "Idle Model", kind: "image" },
    ] } };
    const typed = await (await listKind(new Request("http://localhost/v1/models/image"), { params: Promise.resolve({ model: ["image"] }) })).json();
    expect(typed.data.filter((model) => model.owned_by === "horde").map((model) => model.id)).toEqual([`horde/${IMAGE_MODEL}`]);
    const chat = await (await listModels(new Request("http://localhost/v1/models"))).json();
    expect(chat.data.filter((model) => model.owned_by === "horde").map((model) => model.id)).toEqual([`horde/${CHAT_ID}`]);
  });

  it("a chat discovery failure stays the dashboard answer, never an image-only catalog", async () => {
    m.rows = [connection("conn-a", KEY_A)];
    m.routes[`GET ${FACADE_MODELS}`] = () => json({ error: "nope" }, 500);
    expect(await fetchConnectionModels(m.rows[0])).toMatchObject({ status: 500 });
  });

  it("creates and validates a keyed connection without any Horde image job or catalog call", async () => {
    const created = await createConnection(new Request("http://localhost/api/providers", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "aihorde", name: "Horde A", apiKey: KEY_A }),
    }));
    expect(created.status).toBe(201);
    noSecrets(await created.text());
    expect(m.rows[0]).toMatchObject({ provider: "aihorde", apiKey: KEY_A });
    const keyless = await validateConnection(new Request("http://localhost/api/providers/validate", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "aihorde" }),
    }));
    expect(await keyless.json()).toMatchObject({ valid: true });
    expect(m.calls.filter((call) => call.url.startsWith(API))).toEqual([]);
  });
});

describe("/v1/images/generations through the selected AI Horde connection", () => {
  it("anonymous: the public selector credential sends the sentinel apikey and records success once", async () => {
    const response = await post({ n: 1, size: "512x512" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([{ b64_json: PNG.toString("base64"), mime_type: "image/png", output_format: "png" }]);
    const submit = submits()[0];
    expect(submit.headers).toEqual({ apikey: "0000000000", "Client-Agent": AI_HORDE_CLIENT_AGENT, Accept: "application/json", "Content-Type": "application/json" });
    expect(JSON.parse(submit.body)).toMatchObject({ models: [IMAGE_MODEL], params: { n: 1, width: 512, height: 512 } });
    // The download carries no Horde credential.
    const download = m.calls.find((call) => call.url.startsWith("https://1.1.1.1/"));
    expect(JSON.stringify(download.headers)).not.toMatch(/apikey|0000000000/);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: "aihorde", model: IMAGE_MODEL, connectionId: "noauth", endpoint: "/v1/images/generations" });
    expect(usage()[0].nativeUnits).toMatchObject({ images: 1 });
    expect(usage()[0].costStatus).not.toBe("known");
    expect(usage()[0].cost ?? null).toBeNull();
    expect(usage()[0].meta.providerKudos).toEqual({ path: "status.kudos", value: 11 });
  });

  it("keyed: the selected connection's key is the apikey header and usage counts actual artifacts", async () => {
    m.rows = [connection("conn-a", KEY_A)];
    m.routes[`GET ${API}/v2/generate/status/`] = () => json({ done: true, kudos: 20, generations: [{ img: IMG_URL }, { img: IMG_URL, censored: true }] });
    const response = await post({ n: 2 });
    expect(response.status).toBe(200);
    const text = await response.text();
    noSecrets(text);
    expect(JSON.parse(text).data).toHaveLength(1);
    expect(submits()[0].headers.apikey).toBe(KEY_A);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ connectionId: "conn-a", nativeUnits: { images: 1 } });
    expect(usage()[0].meta.partial).toEqual({ requested: 2, returned: 1 });
  });

  it.each([
    ["url output", { response_format: "url" }],
    ["binary output", {}, "?response_format=binary"],
    ["a reference image", { image: "data:image/png;base64,AAAA" }],
    ["img2img source", { image_url: "https://example.com/a.png" }],
    ["an unsupported size", { size: "1000x1000" }],
    ["too many images", { n: 5 }],
  ])("refuses %s before the catalog or a submit", async (_label, extra, query = "") => {
    const response = await images(new Request(`http://localhost/v1/images/generations${query}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: `horde/${IMAGE_MODEL}`, prompt: "p", ...extra }),
    }));
    expect(response.status).toBe(400);
    expect(m.calls).toEqual([]);
    expect(usage()).toEqual([]);
  });

  it("refuses streaming and a model with no workers before any submit", async () => {
    const stream = await post({}, { headers: { accept: "text/event-stream" } });
    expect(stream.status).toBe(400);
    const idle = await post({ model: "horde/Idle Model" });
    expect(idle.status).toBe(400);
    expect(await idle.text()).toContain("No AI Horde workers are currently serving Idle Model");
    expect(submits()).toHaveLength(0);
    expect(usage()).toEqual([]);
  });

  it("a definitive submit refusal moves to the healthy sibling, and only the refused account is marked", async () => {
    m.rows = [connection("conn-a", KEY_A), connection("conn-b", KEY_B, { priority: 2 })];
    m.routes[`POST ${API}/v2/generate/async`] = ({ init }) => init.headers.apikey === KEY_A
      ? json({ message: `invalid key ${KEY_A}` }, 401)
      : json({ id: JOB }, 202);
    m.markUnavailable = async (connectionId, status) => ({ shouldFallback: connectionId === "conn-a" && status === 401 });
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const response = await post();
    expect(response.status).toBe(200);
    noSecrets(await response.text());
    expect(submits().map((call) => call.headers.apikey)).toEqual([KEY_A, KEY_B]);
    expect(markAccountUnavailable.mock.calls.map(([id, status]) => [id, status])).toEqual([["conn-a", 401]]);
    expect(usage().map((event) => event.connectionId)).toEqual(["conn-b"]);
  });

  it("an uncertain submit is recorded once as unknown cost and never replayed on a sibling", async () => {
    m.rows = [connection("conn-a", KEY_A), connection("conn-b", KEY_B, { priority: 2 })];
    m.routes[`POST ${API}/v2/generate/async`] = () => json({ message: KEY_A }, 500);
    m.markUnavailable = async () => ({ shouldFallback: true });
    const response = await post();
    expect(response.status).toBe(502);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
    const text = await response.text();
    expect(text).toContain("outcome unknown");
    noSecrets(text);
    expect(submits()).toHaveLength(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ connectionId: "conn-a", status: "accepted", costSource: "accepted-job" });
    expect(usage()[0].nativeUnits?.images).toBeUndefined();
  });

  it("a queue wait past the deadline is a 504 accepted job, cancelled once, never resubmitted", async () => {
    m.routes[`GET ${API}/v2/generate/check/`] = () => json({ done: false, is_possible: true, wait_time: 5_000 });
    const response = await post();
    expect(response.status).toBe(504);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
    expect(submits()).toHaveLength(1);
    expect(hordeCalls("/v2/generate/status/").filter((call) => call.method === "DELETE")).toHaveLength(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ status: "accepted", costSource: "accepted-job" });
    expect(usage()[0].meta).toMatchObject({ jobState: "outcome_unknown", jobId: JOB, cancel: "requested" });
  });

  it("a caller abort after acceptance cancels the job, records unknown cost once and stops", async () => {
    m.rows = [connection("conn-a", KEY_A), connection("conn-b", KEY_B, { priority: 2 })];
    const controller = new AbortController();
    m.routes[`GET ${API}/v2/generate/check/`] = () => { controller.abort(); return json({ done: false, wait_time: 1 }); };
    const response = await post({}, { signal: controller.signal });
    expect(response.status).toBe(499);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
    expect(submits()).toHaveLength(1);
    expect(hordeCalls("/v2/generate/status/").filter((call) => call.method === "DELETE").map((call) => call.headers.apikey)).toEqual([KEY_A]);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ connectionId: "conn-a", status: "accepted", costSource: "accepted-job" });
  });

  it("two accounts keep their own keys, usage and job state", async () => {
    m.rows = [connection("conn-a", KEY_A)];
    expect((await post()).status).toBe(200);
    m.rows = [connection("conn-b", KEY_B)];
    expect((await post()).status).toBe(200);
    expect(submits().map((call) => call.headers.apikey)).toEqual([KEY_A, KEY_B]);
    expect(usage().map((event) => event.connectionId)).toEqual(["conn-a", "conn-b"]);
    for (const event of usage()) noSecrets(JSON.stringify(event));
  });
});
