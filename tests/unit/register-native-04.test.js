// Batch 4 public registration: Runway ML video, DeepInfra video, DeepInfra
// embeddings and rerank, and the new Segmind video provider. Real public
// routes and the registered adapters over a closed network: every request is
// answered below, an unexpected one fails the test, and every key is
// synthetic. Passing here says nothing about the live services.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fixture storage isolation, as in register-native-03: claim a private
// DATA_DIR before any application import and restore only our own env key.
const isolated = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs");
  const os = process.getBuiltinModule("node:os");
  const path = process.getBuiltinModule("node:path");
  const had = Object.hasOwn(process.env, "DATA_DIR");
  const previous = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "register-native-04-data-"));
  process.env.DATA_DIR = dir;
  return { dir, had, previous };
});

const m = vi.hoisted(() => ({
  dir: isolated.dir,
  credentials: null,
  save: null,
  settings: {},
  rows: new Map(),
}));

vi.mock("@/dashboardGuard", () => ({
  isOperatorRequest: vi.fn(async () => true),
  canManageAccessConfig: vi.fn(async () => true),
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => m.settings),
  getApiKeyByKey: vi.fn(async () => null),
  getApiKeyById: vi.fn(async () => null),
  getApiKeyUsageTotals: vi.fn(async () => ({})),
  getComboForModel: vi.fn(async () => null),
  getCombos: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getCustomModels: vi.fn(async () => []),
  getSyncedModelCatalog: vi.fn(async () => null),
  getProviderNodes: vi.fn(async () => []),
  getProviderNodeById: vi.fn(async () => null),
  getProviderConnections: vi.fn(async ({ provider } = {}) => [...m.rows.values()].filter((row) => !provider || row.provider === provider).map((row) => ({ ...row }))),
  getProviderConnectionById: vi.fn(async (id) => m.rows.get(id) ?? null),
  getApiKeyProviderConnectionIds: vi.fn(async () => []),
  getProxyPoolById: vi.fn(async () => null),
  saveRequestUsage: (...args) => m.save(...args),
  updateProviderConnection: vi.fn(async (id) => m.rows.get(id) ?? null),
  recordProviderConnectionFallbackState: vi.fn(async () => ({ applied: true, connection: null })),
}));
vi.mock("@/shared/services/providerRateLimitEvidence", () => ({
  recordProviderRateLimitEvidence: vi.fn(async () => {}),
  clearProviderRateLimitEvidence: vi.fn(async () => {}),
}));
vi.mock("@/lib/webhooks/index.js", () => ({ notifyWebhookEvent: vi.fn() }));
vi.mock("@/lib/db/repos/mediaJobsRepo.js", () => ({ createMediaJob: vi.fn(), getMediaJob: vi.fn(), finishMediaJob: vi.fn() }));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentialsWithQuotaPreflight: (...args) => m.credentials(...args),
  getNoAuthProviderCredentials: vi.fn(async () => null),
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
  clearAccountError: vi.fn(async () => {}),
  resolveClientApiKey: vi.fn(async () => ({ apiKey: "caller-key", auth: { ok: true, apiKeyId: "caller-id", billingEpoch: null } })),
  extractApiKey: vi.fn(),
  hasValidCliToken: vi.fn(),
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  refreshWithRetry: vi.fn(async () => null),
  checkAndRefreshToken: vi.fn(async (_provider, row) => row),
}));
vi.mock("../../src/sse/utils/logger.js", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), request: vi.fn(), maskKey: vi.fn(() => "***") }));
vi.mock("../../src/sse/services/mediaRoutes.js", () => ({
  wantsDefaultRoute: () => false,
  resolveMediaRoute: vi.fn(),
  defaultRouteComboOptions: () => ({}),
  listMediaRouteCandidates: vi.fn(),
  providerOfModelId: vi.fn(),
  supportsVideoJobs: () => false,
  supportsTranslation: () => false,
}));
vi.mock("../../open-sse/services/comboRoutingPolicy.js", () => ({ getComboRoutingPolicy: vi.fn(async () => null) }));
vi.mock("@/lib/dataDir.js", () => ({ get DATA_DIR() { return m.dir; } }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));

// The registered default instances, rebuilt with short real deadlines. Nothing
// else about the adapters or the native service changes.
vi.mock("../../open-sse/services/providerParity/native-runwayml-video/index.js", async (original) => {
  const a = await original();
  return { ...a, default: a.createRunwayVideoAdapter({ timeoutMs: 300, requestTimeoutMs: 5000, pollIntervalMs: 1 }) };
});
vi.mock("../../open-sse/services/providerParity/native-deepinfra-video/index.js", async (original) => {
  const a = await original();
  return { ...a, deepinfraVideoAdapter: a.createDeepinfraVideoAdapter({ timeoutMs: 300 }) };
});
vi.mock("../../open-sse/services/providerParity/native-segmind-video/adapter.js", async (original) => {
  const a = await original();
  return { ...a, default: a.createSegmindVideoAdapter({ timeoutMs: 300 }) };
});
vi.mock("../../open-sse/services/providerParity/native-deepinfra-embedding-rerank/index.js", async (original) => {
  const a = await original();
  return { ...a, handleDeepinfraNative: (options) => a.handleDeepinfraNative({ ...options, timeoutMs: 300 }) };
});

import { POST as videos } from "../../src/app/api/v1/video/generations/route.js";
import { POST as embeddings } from "../../src/app/api/v1/embeddings/route.js";
import { POST as rerank } from "../../src/app/api/v1/rerank/route.js";
import { GET as typedModels } from "../../src/app/api/v1/models/[...model]/route.js";
import { clearLiveModelLimitsCache } from "../../open-sse/services/liveModelLimits.js";
import { mediaEndpointSupport, mediaTransportSupport } from "../../src/sse/services/mediaTransport.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { getEmbeddingAdapter } from "../../open-sse/handlers/embeddingProviders/index.js";
import { PROVIDERS, PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import { AI_PROVIDERS, APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import runwayml from "../../open-sse/providers/registry/runwayml.js";
import deepinfra from "../../open-sse/providers/registry/deepinfra.js";
import segmind from "../../open-sse/providers/registry/segmind.js";
import * as auth from "../../src/sse/services/auth.js";
import { ACCEPTED_JOB_HEADER } from "../../open-sse/services/combo.js";

const RUNWAY = "https://api.dev.runwayml.com/v1";
const DEEPINFRA = "https://api.deepinfra.com";
const SEGMIND = "https://api.segmind.com/v1";
const ARTIFACT = "https://cdn.example.com/output.mp4";
const ACCEPTED = "x-durindoor-accepted-job";
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom", "latin1"), Buffer.alloc(12), Buffer.from("video-bytes", "latin1")]);

const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
let calls, steps;
const usage = () => m.save.mock.calls.map(([row]) => row);
const request = (body, { signal, headers = {} } = {}) => new Request("http://localhost/v1/route", {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal,
});
const hang = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
const sentCredential = (init) => {
  const headers = new Headers(init?.headers);
  return headers.get("authorization") ?? headers.get("x-api-key");
};

// One case per provider and route. `submit` is the native submit URL; `success`
// queues every answer of a successful run; `invoke` posts the public request.
const cases = [
  {
    name: "runway video", provider: "runwayml", models: ["runwayml/gen4.5", "runway/gen4.5"], submit: `${RUNWAY}/text_to_video`,
    credential: "Bearer runwayml-selected",
    invoke: (model, extra = {}, signal) => videos(request({ model, prompt: "forest", ...extra }, { signal })),
    success: () => steps.push(() => json({ id: "task-1" }), () => json({ status: "SUCCEEDED", output: [ARTIFACT] })),
    native: { model: "gen4.5", promptText: "forest", ratio: "1280:720", duration: 5 },
    output: (payload) => expect(payload.data).toEqual([{ url: ARTIFACT, format: "mp4" }]),
    unsupported: [{ stream: true }, { response_format: "b64_json" }, { n: 2 }, { duration: "5" }, { image: "http://127.0.0.1/x.png" }, { video: "x" }],
    usageRow: { modality: "video", endpoint: "/v1/video/generations", costStatus: "unknown", nativeUnits: { videos: 1 } },
  },
  {
    name: "deepinfra video", provider: "deepinfra", models: ["deepinfra/Wan-AI/Wan2.2-T2V-A14B"], submit: `${DEEPINFRA}/v1/inference/Wan-AI/Wan2.2-T2V-A14B`,
    credential: "Bearer deepinfra-selected",
    invoke: (model, extra = {}, signal) => videos(request({ model, prompt: "forest", ...extra }, { signal })),
    success: () => steps.push(() => json({ video_url: ARTIFACT, request_id: "req-1", inference_status: { status: "succeeded" } })),
    native: { prompt: "forest" },
    output: (payload) => expect(payload.data).toEqual([expect.objectContaining({ url: ARTIFACT })]),
    unsupported: [{ stream: true }, { response_format: "b64_json" }, { n: 2 }, { duration: 5 }, { image: "https://images.example.com/a.png" }],
    usageRow: { modality: "video", endpoint: "/v1/video/generations", costStatus: "unknown" },
  },
  {
    name: "segmind video", provider: "segmind", models: ["segmind/wan2.1-t2v", "segmind/kling-video-t2v"], submit: `${SEGMIND}/wan2.1-t2v`,
    credential: "segmind-selected",
    invoke: (model, extra = {}, signal) => videos(request({ model, prompt: "forest", ...extra }, { signal })),
    success: () => steps.push(() => new Response(MP4, { status: 200, headers: { "content-type": "video/mp4" } })),
    native: { prompt: "forest" },
    output: (payload) => expect(payload.data).toEqual([{ b64_json: MP4.toString("base64"), format: "mp4" }]),
    unsupported: [{ stream: true }, { response_format: "url" }, { n: 2 }, { image: "https://images.example.com/a.png" }, { size: "1280x720" }, { seconds: 5 }],
    usageRow: { modality: "video", endpoint: "/v1/video/generations", costStatus: "unknown", nativeUnits: { videos: 1 } },
  },
  {
    name: "deepinfra embeddings", provider: "deepinfra", models: ["deepinfra/Qwen/Qwen3-Embedding-8B"], submit: `${DEEPINFRA}/v1/openai/embeddings`,
    credential: "Bearer deepinfra-selected",
    invoke: (model, extra = {}, signal) => embeddings(request({ model, input: "hello", ...extra }, { signal })),
    success: () => steps.push(() => json({ data: [{ index: 0, embedding: [0.5, -0.25] }], usage: { prompt_tokens: 3, total_tokens: 3 } })),
    native: { model: "Qwen/Qwen3-Embedding-8B", input: "hello" },
    output: (payload) => expect(payload).toMatchObject({ object: "list", model: "Qwen/Qwen3-Embedding-8B", data: [{ object: "embedding", index: 0, embedding: [0.5, -0.25] }] }),
    unsupported: [{ encoding_format: "base64" }, { input: [[1, 2, 3]] }, { user: "someone" }, { dimensions: 0 }, { input_type: "query" }],
    usageRow: { modality: "embedding", endpoint: "/v1/embeddings" },
  },
  {
    name: "deepinfra rerank", provider: "deepinfra", models: ["deepinfra/Qwen/Qwen3-Reranker-8B"], submit: `${DEEPINFRA}/v1/inference/Qwen/Qwen3-Reranker-8B`,
    credential: "Bearer deepinfra-selected",
    invoke: (model, extra = {}, signal) => rerank(request({ model, query: "boat", documents: ["lake", { text: "sea" }], ...extra }, { signal })),
    success: () => steps.push(() => json({ scores: [0.2, 0.9] })),
    native: { queries: ["boat"], documents: ["lake", "sea"] },
    output: (payload) => expect(payload.results).toEqual([
      { index: 1, relevance_score: 0.9, document: { text: "sea" } },
      { index: 0, relevance_score: 0.2, document: { text: "lake" } },
    ]),
    unsupported: [{ top_n: 3 }, { return_documents: "yes" }, { documents: [{ image: "https://images.example.com/a.png" }] }, { rank_fields: ["text"] }],
    usageRow: { modality: "rerank", endpoint: "/v1/route" },
  },
];

beforeEach(() => {
  vi.clearAllMocks(); clearLiveModelLimitsCache();
  m.rows.clear(); m.settings = {};
  m.dir = fs.mkdtempSync(path.join(os.tmpdir(), "register-native-04-"));
  process.env.DATA_DIR = m.dir;
  for (const provider of ["runwayml", "deepinfra", "segmind"]) for (const suffix of ["selected", "other"]) {
    const id = `${provider}-${suffix}`;
    m.rows.set(id, { id, connectionId: id, provider, apiKey: id, isActive: true, authType: "apikey", providerSpecificData: { baseUrl: "https://attacker.example" } });
  }
  m.credentials = vi.fn(async (provider, excluded) => {
    const row = m.rows.get(`${provider}-selected`);
    return row && !excluded?.has?.(row.id) ? { ...row, _connection: { ...row } } : null;
  });
  m.save = vi.fn(async () => true);
  calls = []; steps = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const step = steps.shift();
    if (!step) throw new Error(`closed network: ${url}`);
    return step(String(url), init);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); fs.rmSync(m.dir, { recursive: true, force: true }); });
afterAll(async () => {
  const db = globalThis._dbAdapter;
  const owned = [isolated.dir, m.dir].filter(Boolean).map((dir) => dir + path.sep);
  if (db?.file && owned.some((prefix) => db.file.startsWith(prefix))) {
    try { await db.instance?.close?.(); } catch { /* already closed */ }
    Object.assign(db, { instance: null, initPromise: null, file: null, cacheKey: null });
  }
  if (isolated.had) process.env.DATA_DIR = isolated.previous;
  else delete process.env.DATA_DIR;
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

describe("batch identity and discovery", () => {
  it("marks accepted work with the header every combo and fallback stop honors", () => {
    expect(ACCEPTED).toBe(ACCEPTED_JOB_HEADER);
  });

  it("registers every adapter on one identity per provider, with no duplicate", () => {
    expect(getVideoGenerationAdapter("runway")).toBe(getVideoGenerationAdapter("runwayml"));
    expect(getVideoGenerationAdapter("deepinfra")).toBeTruthy();
    expect(getVideoGenerationAdapter("segmind")).toBeTruthy();
    expect(getEmbeddingAdapter("deepinfra")).toBeTruthy();
    for (const id of ["runwayml", "deepinfra", "segmind"]) expect(REGISTRY.filter((entry) => entry.id === id)).toHaveLength(1);
    expect(REGISTRY.some((entry) => entry.id === "runway" || entry.alias === "runway")).toBe(false);
    // Existing identities keep their auth, transport and discovery.
    expect(runwayml).toMatchObject({ alias: "runwayml", aliases: ["runway"], uiAlias: "runway", authType: "apikey", transport: null });
    expect(runwayml.imageConfig).toEqual({ baseUrl: RUNWAY });
    expect(deepinfra.transport).toMatchObject({ baseUrl: `${DEEPINFRA}/v1/openai/chat/completions`, authHeader: "bearer" });
    expect(deepinfra.passthroughModels).toBe(true);
    expect(PROVIDERS.deepinfra).toBeTruthy();
    // The new Segmind identity is an API-key media provider, never a chat model source.
    expect(APIKEY_PROVIDERS.segmind).toMatchObject({ id: "segmind", alias: "segmind", name: "Segmind", serviceKinds: ["video"] });
    expect(AI_PROVIDERS.segmind.serviceKinds).toEqual(["video"]);
    expect(PROVIDER_MEDIA.segmind.serviceKinds).toEqual(["video"]);
    expect(segmind.oauth).toBeUndefined();
    for (const entry of [runwayml, deepinfra, segmind]) expect(entry.videoConfig).toBeUndefined();
    for (const provider of ["runwayml", "deepinfra", "segmind"]) {
      expect(mediaTransportSupport("video", provider), provider).toBe("supported");
      expect(mediaEndpointSupport("video", "/v1/video/generations", provider).supported).toBe(true);
      expect(mediaEndpointSupport("video", "/v1/videos", provider).supported).toBe(false);
    }
    expect(mediaTransportSupport("embedding", "deepinfra")).toBe("supported");
    expect(mediaTransportSupport("embedding", "segmind")).toBe("unsupported");
  });

  it.each([
    // Listed under the provider's public alias, the prefix callers use.
    ["video", "runway", ["gen4.5", "gen4_turbo", "gen3a_turbo", "veo3.1", "veo3.1_fast"]],
    ["image", "runway", ["gen4_image", "gen4_image_turbo"]],
    ["video", "deepinfra", ["Wan-AI/Wan2.2-T2V-A14B", "Wan-AI/Wan2.2-TI2V-5B", "Wan-AI/Wan2.7-T2V", "Lightricks/LTX-2.3-Distilled"]],
    ["embedding", "deepinfra", ["Qwen/Qwen3-Embedding-8B", "Qwen/Qwen3-Embedding-4B", "Qwen/Qwen3-Embedding-0.6B", "BAAI/bge-large-en-v1.5", "BAAI/bge-base-en-v1.5", "BAAI/bge-m3", "intfloat/e5-large-v2", "thenlper/gte-large"]],
    ["rerank", "deepinfra", ["Qwen/Qwen3-Reranker-8B", "Qwen/Qwen3-Reranker-4B", "Qwen/Qwen3-Reranker-0.6B"]],
    ["video", "segmind", ["wan2.1-t2v", "hunyuan-video-t2v", "ltx-video-t2v", "kling-video-t2v"]],
  ])("discovers %s models for %s on the public route", async (kind, owner, ids) => {
    // DeepInfra's existing chat fetcher may run; it must not feed the media kinds.
    steps.push(...Array.from({ length: 4 }, () => () => json({ data: [{ id: "meta-llama/Chat-Model" }] })));
    const response = await typedModels(new Request(`http://localhost/v1/models/${kind}`), { params: Promise.resolve({ model: [kind] }) });
    expect(response.status).toBe(200);
    const rows = (await response.json()).data.filter((row) => row.owned_by === owner);
    expect(rows.map((row) => row.id.split("/").slice(1).join("/")).sort()).toEqual([...ids].sort());
    expect(rows.every((row) => row.kind === kind)).toBe(true);
    // Static source catalogs: no batch provider is called except DeepInfra's
    // existing chat list (other providers' public catalogs are not ours).
    const batch = calls.filter((call) => [RUNWAY, DEEPINFRA, SEGMIND].some((origin) => call.url.startsWith(new URL(origin).origin)));
    expect(batch.filter((call) => call.url !== `${DEEPINFRA}/v1/openai/models`)).toEqual([]);
  });

  it.each([
    ["embeddings", () => embeddings(request({ model: "deepinfra/Wan-AI/Wan2.2-T2V-A14B", input: "hello" }))],
    ["rerank", () => rerank(request({ model: "deepinfra/Qwen/Qwen3-Embedding-8B", query: "q", documents: ["a"] }))],
    ["video", () => videos(request({ model: "deepinfra/Qwen/Qwen3-Reranker-8B", prompt: "forest" }))],
    ["segmind embeddings", () => embeddings(request({ model: "segmind/wan2.1-t2v", input: "hello" }))],
  ])("keeps a model of another kind off the %s route", async (_name, invoke) => {
    const response = await invoke();
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(usage()).toEqual([]);
  });
});

for (const c of cases) describe(c.name, () => {
  it.each(c.models)("dispatches %s with the selected credential, native body, artifact and one receipt", async (model) => {
    c.success();
    const response = await c.invoke(model);
    expect(response.status).toBe(200);
    await c.output(await response.clone().json());
    const slug = model.split("/").slice(1).join("/");
    expect(calls[0].url).toBe(c.provider === "segmind" ? `${SEGMIND}/${slug}` : c.submit);
    expect(calls[0].init.method).toBe("POST");
    expect(JSON.parse(calls[0].init.body)).toMatchObject(c.native);
    for (const call of calls) {
      expect(sentCredential(call.init)).toBe(c.credential);
      expect(JSON.stringify(call.init.headers)).not.toContain("other");
      expect(call.url).not.toContain("attacker");
    }
    expect(steps).toHaveLength(0);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: c.provider, connectionId: `${c.provider}-selected`, ...c.usageRow });
    expect(usage()[0].costSource).not.toBe("accepted-job");
  });

  it.each([401, 402, 429])("returns a refusal %s at submit without leaking the key or charging", async (status) => {
    steps.push(() => json({ error: { code: "denied", message: `echo ${c.provider}-selected` }, detail: `echo ${c.provider}-selected` }, status, status === 429 ? { "retry-after": "30" } : {}));
    const response = await c.invoke(c.models[0]);
    expect(response.status).toBe(status);
    const body = await response.text();
    expect(body).not.toContain(`${c.provider}-selected`);
    expect(calls).toHaveLength(1);
    expect(usage()).toEqual([]);
    expect(response.headers.get(ACCEPTED)).toBeNull();
    expect(auth.markAccountUnavailable.mock.calls.every((args) => args[0] === `${c.provider}-selected`)).toBe(true);
  });

  it.each(c.unsupported)("refuses unsupported input %j before any network call", async (extra) => {
    const response = await c.invoke(c.models[0], extra);
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(usage()).toEqual([]);
    expect(m.save).not.toHaveBeenCalled();
  });

  it("never replays an uncertain submit and records it once", async () => {
    steps.push(() => json({ error: `echo ${c.provider}-selected` }, 500));
    const response = await c.invoke(c.models[0]);
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(response.headers.get(ACCEPTED)).toBe("1");
    expect(await response.text()).not.toContain(`${c.provider}-selected`);
    expect(calls).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ costSource: "accepted-job", connectionId: `${c.provider}-selected`, provider: c.provider, modality: c.usageRow.modality });
  });

  it("bounds a stuck submission and records the uncertain outcome once", async () => {
    steps.push(hang);
    const response = await c.invoke(c.models[0]);
    expect(response.status).toBe(504);
    expect(response.headers.get(ACCEPTED)).toBe("1");
    expect(calls[0].init.signal.aborted).toBe(true);
    expect(calls).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0].costSource).toBe("accepted-job");
  });

  it("cancels without replay and records the uncertain submission once", async () => {
    steps.push(hang);
    const controller = new AbortController();
    const pending = c.invoke(c.models[0], {}, controller.signal);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    controller.abort();
    expect((await pending).status).toBe(499);
    expect(calls).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0].costSource).toBe("accepted-job");
  });
});

describe("quota and account isolation", () => {
  it.each(cases.filter((c) => c.provider === "deepinfra"))("marks a spent $name connection as quota exhausted on that connection only", async (c) => {
    steps.push(() => json({ error: { code: "insufficient_quota" } }, 402));
    const response = await c.invoke(c.models[0]);
    expect(response.status).toBe(402);
    expect(auth.markAccountUnavailable).toHaveBeenCalledTimes(1);
    const [connectionId, status, , provider, , , context] = auth.markAccountUnavailable.mock.calls[0];
    expect([connectionId, status, provider]).toEqual(["deepinfra-selected", 402, "deepinfra"]);
    expect(context).toMatchObject({ quotaExhausted: true });
    expect(usage()).toEqual([]);
  });

  it("falls back to another account after a quota refusal, never after an uncertain submit", async () => {
    auth.markAccountUnavailable.mockResolvedValue({ shouldFallback: true });
    m.credentials = vi.fn(async (provider, excluded) => {
      const id = excluded?.has?.(`${provider}-selected`) ? `${provider}-other` : `${provider}-selected`;
      const row = m.rows.get(id);
      return excluded?.has?.(id) ? null : { ...row, _connection: { ...row } };
    });
    steps.push(() => json({ error: { code: "insufficient_quota" } }, 402), () => json({ data: [{ index: 0, embedding: [1] }] }));
    const ok = await embeddings(request({ model: "deepinfra/Qwen/Qwen3-Embedding-8B", input: "hello" }));
    expect(ok.status).toBe(200);
    expect(calls.map((call) => sentCredential(call.init))).toEqual(["Bearer deepinfra-selected", "Bearer deepinfra-other"]);

    calls = [];
    steps.push(() => json({ error: "busy" }, 503));
    const uncertain = await embeddings(request({ model: "deepinfra/Qwen/Qwen3-Embedding-8B", input: "hello" }));
    expect(uncertain.status).toBe(502);
    expect(uncertain.headers.get(ACCEPTED)).toBe("1");
    expect(calls).toHaveLength(1);
    expect(usage().filter((row) => row.costSource === "accepted-job")).toHaveLength(1);
  });

  it("does not replay an uncertain rerank on a configured fallback model", async () => {
    m.settings = { modelFallbacks: { "deepinfra/Qwen/Qwen3-Reranker-8B": { fallbacks: ["deepinfra/Qwen/Qwen3-Reranker-4B"] } } };
    steps.push(() => json({ error: "busy" }, 500));
    const response = await rerank(request({ model: "deepinfra/Qwen/Qwen3-Reranker-8B", query: "q", documents: ["a"] }));
    expect(response.status).toBe(502);
    expect(response.headers.get(ACCEPTED)).toBe("1");
    expect(calls).toHaveLength(1);
    expect(usage()).toHaveLength(1);
  });

  it("does not refresh, resend or rewrite a refused DeepInfra rerank credential", async () => {
    const { updateProviderCredentials, checkAndRefreshToken } = await import("../../src/sse/services/tokenRefresh.js");
    steps.push(() => json({ error: "denied" }, 401));
    const response = await rerank(request({ model: "deepinfra/Qwen/Qwen3-Reranker-8B", query: "q", documents: ["a"] }));
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(1);
    expect(checkAndRefreshToken).toHaveBeenCalledTimes(1);
    expect(updateProviderCredentials).not.toHaveBeenCalled();
  });

  it("uses each request's selected key and shares nothing between connections", async () => {
    const order = ["segmind-other", "segmind-selected"];
    m.credentials = vi.fn(async () => {
      const row = m.rows.get(order.shift());
      return { ...row, _connection: { ...row } };
    });
    for (let i = 0; i < 2; i += 1) {
      steps.push(() => new Response(MP4, { status: 200, headers: { "content-type": "video/mp4" } }));
      const response = await videos(request({ model: "segmind/wan2.1-t2v", prompt: "forest" }));
      expect(response.status).toBe(200);
    }
    expect(calls.map((call) => sentCredential(call.init))).toEqual(["segmind-other", "segmind-selected"]);
    expect(usage().map((row) => row.connectionId)).toEqual(["segmind-other", "segmind-selected"]);
  });

  it("routes a custom text-to-video Segmind slug and refuses image-to-video slugs before submit", async () => {
    steps.push(() => new Response(MP4, { status: 200, headers: { "content-type": "video/mp4" } }));
    expect((await videos(request({ model: "segmind/custom-t2v-model", prompt: "forest" }))).status).toBe(200);
    expect(calls.map((call) => call.url)).toEqual([`${SEGMIND}/custom-t2v-model`]);
    calls = [];
    for (const model of ["segmind/wan2.7-i2v", "segmind/some-image-to-video"]) {
      expect((await videos(request({ model, prompt: "forest" }))).status).toBe(400);
    }
    expect(calls).toEqual([]);
  });

  it("sends a DeepInfra image-to-video reference only for the model that accepts one", async () => {
    steps.push(() => json({ video_url: ARTIFACT }));
    const ok = await videos(request({ model: "deepinfra/Wan-AI/Wan2.2-TI2V-5B", prompt: "forest", image_url: "https://images.example.com/a.png" }));
    expect(ok.status).toBe(200);
    expect(JSON.parse(calls[0].init.body)).toEqual({ prompt: "forest", image: "https://images.example.com/a.png" });
  });
});
