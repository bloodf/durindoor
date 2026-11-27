// Batch 5 public registration: the new deAPI provider (image, video, speech,
// transcription and embeddings) and Novita video on the existing novita
// connection. Real public routes and the registered adapters over a closed
// network: every request is answered below, an unexpected one fails the test,
// and every key is synthetic. Passing here says nothing about the live services.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fixture storage isolation, as in register-native-04: claim a private
// DATA_DIR before any application import and restore only our own env key.
const isolated = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs");
  const os = process.getBuiltinModule("node:os");
  const path = process.getBuiltinModule("node:path");
  const had = Object.hasOwn(process.env, "DATA_DIR");
  const previous = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "register-native-05-data-"));
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

// The registered default instances, rebuilt with short real deadlines and no
// poll wait. Nothing else about the adapters changes.
vi.mock("../../open-sse/services/providerParity/native-deapi-video-image/index.js", async (original) => {
  const a = await original();
  const bounds = { timeoutMs: 300, submitTimeoutMs: 300, requestTimeoutMs: 300, contentTimeoutMs: 300, pollIntervalMs: 0, wait: async () => {} };
  return { ...a, deapiImageAdapter: a.createDeapiImageAdapter({ timeoutMs: 300 }), deapiVideoAdapter: a.createDeapiVideoAdapter(bounds) };
});
vi.mock("../../open-sse/services/providerParity/native-deapi-tts-stt/index.js", async (original) => {
  const a = await original();
  return { ...a, deapiTtsAdapter: a.createDeapiTtsAdapter({ timeoutMs: 300 }), deapiSttAdapter: a.createDeapiSttAdapter({ timeoutMs: 300 }) };
});
vi.mock("../../open-sse/services/providerParity/native-deapi-embedding/index.js", async (original) => {
  const a = await original();
  return { ...a, deapiEmbeddingAdapter: a.createDeapiEmbeddingAdapter({ timeoutMs: 300 }) };
});
vi.mock("../../open-sse/services/providerParity/native-novita-video/index.js", async (original) => {
  const a = await original();
  return { ...a, novitaVideoAdapter: a.createNovitaVideoAdapter({ timeoutMs: 300, submitTimeoutMs: 300, requestTimeoutMs: 300, pollIntervalMs: 0, wait: async () => {} }) };
});

import { POST as images } from "../../src/app/api/v1/images/generations/route.js";
import { POST as edits } from "../../src/app/api/v1/images/edits/route.js";
import { POST as videos } from "../../src/app/api/v1/video/generations/route.js";
import { POST as videoJobsRoute } from "../../src/app/api/v1/videos/[[...path]]/route.js";
import { POST as speech } from "../../src/app/api/v1/audio/speech/route.js";
import { POST as transcriptions } from "../../src/app/api/v1/audio/transcriptions/route.js";
import { POST as translations } from "../../src/app/api/v1/audio/translations/route.js";
import { POST as embeddings } from "../../src/app/api/v1/embeddings/route.js";
import { GET as typedModels } from "../../src/app/api/v1/models/[...model]/route.js";
import { clearLiveModelLimitsCache } from "../../open-sse/services/liveModelLimits.js";
import { mediaEndpointSupport, mediaTransportSupport } from "../../src/sse/services/mediaTransport.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { getTtsAdapter } from "../../open-sse/handlers/ttsProviders/index.js";
import { getEmbeddingAdapter } from "../../open-sse/handlers/embeddingProviders/index.js";
import { getImageEditConfig } from "../../open-sse/handlers/imageEditCore.js";
import { PROVIDERS, PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import { AI_PROVIDERS, APIKEY_PROVIDERS } from "../../src/shared/constants/providers.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import deapi from "../../open-sse/providers/registry/deapi.js";
import novita from "../../open-sse/providers/registry/novita.js";
import * as auth from "../../src/sse/services/auth.js";
import { ACCEPTED_JOB_HEADER } from "../../open-sse/services/combo.js";

const videoJobs = (req) => videoJobsRoute(req, { params: Promise.resolve({ path: [] }) });
const DEAPI = "https://oai.deapi.ai/v1";
const NOVITA = "https://api.novita.ai";
const PICTURE = "https://cdn.deapi.ai/out/img-1.png";
const ARTIFACT = "https://faas-output-video.example.com/out-a.mp4?sig=1";
const ACCEPTED = "x-durindoor-accepted-job";
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 7)]);
const MP4 = Buffer.from([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]);
const AUDIO_IN = Buffer.from("RIFF-synthetic-audio");

const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
let calls, steps;
const usage = () => m.save.mock.calls.map(([row]) => row);
const request = (body, { signal, headers = {} } = {}) => new Request("http://localhost/v1/route", {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal,
});
const multipart = (fields, { signal, file = true, name = "file" } = {}) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (file) form.append(name, new Blob([AUDIO_IN], { type: "audio/wav" }), "clip.wav");
  return new Request("http://localhost/v1/route", { method: "POST", body: form, signal });
};
const hang = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
const sentCredential = (init) => new Headers(init?.headers).get("authorization");
const sentBody = async (init) => {
  if (init.body instanceof FormData) return Object.fromEntries([...init.body.entries()].map(([key, value]) => [key, typeof value === "string" ? value : `file:${value.name}`]));
  return JSON.parse(init.body);
};

// One case per provider and route. `submit` is the native submit URL; `success`
// queues every answer of a successful run; `invoke` posts the public request.
const cases = [
  {
    name: "deapi image", provider: "deapi", kind: "image", models: ["deapi/ZImageTurbo_INT8", "deapi/Flux1schnell"], submit: `${DEAPI}/images/generations`,
    invoke: (model, extra = {}, signal) => images(request({ model, prompt: "forest", ...extra }, { signal })),
    success: () => steps.push(() => json({ created: 1, data: [{ url: PICTURE }] })),
    native: (model) => ({ model: model.split("/")[1], prompt: "forest" }),
    output: async (response) => expect((await response.json()).data).toEqual([{ url: PICTURE }]),
    unsupported: [{ stream: true }, { n: 2 }, { size: "1536x1024" }, { image: "https://images.example.com/a.png" }, { output_format: "jpeg" }, { response_format: "base64" }],
    usageRow: { modality: "image", endpoint: "/v1/images/generations" },
  },
  {
    name: "deapi video", provider: "deapi", kind: "video", models: ["deapi/Ltx2_5_22B_Dist_INT8"], submit: `${DEAPI}/videos`,
    invoke: (model, extra = {}, signal) => videos(request({ model, prompt: "forest", ...extra }, { signal })),
    success: () => steps.push(
      () => json({ id: "vid-1", status: "queued" }),
      () => json({ id: "vid-1", status: "completed" }),
      (url) => {
        expect(url).toBe(`${DEAPI}/videos/vid-1/content`);
        return new Response(MP4, { status: 200, headers: { "content-type": "video/mp4" } });
      },
    ),
    native: () => ({ model: "Ltx2_5_22B_Dist_INT8", prompt: "forest" }),
    output: async (response) => expect((await response.json()).data).toEqual([expect.objectContaining({ b64_json: MP4.toString("base64"), format: "mp4" })]),
    unsupported: [{ stream: true }, { response_format: "url" }, { n: 2 }, { image: "https://images.example.com/a.png" }, { seconds: 1.5 }, { size: "wide" }],
    usageRow: { modality: "video", endpoint: "/v1/video/generations", costStatus: "unknown" },
  },
  {
    name: "deapi speech", provider: "deapi", kind: "tts", models: ["deapi/Kokoro"], submit: `${DEAPI}/audio/speech`,
    invoke: (model, extra = {}, signal) => speech(request({ model, input: "hello there", voice: "nova", ...extra }, { signal })),
    success: () => steps.push(() => new Response(MP3, { status: 200, headers: { "content-type": "audio/mpeg" } })),
    native: () => ({ model: "Kokoro", input: "hello there", voice: "nova", response_format: "mp3", speed: 1 }),
    output: async (response) => {
      expect(response.headers.get("content-type")).toMatch(/^audio\/mp(3|eg)/);
      expect(Buffer.from(await response.arrayBuffer()).equals(MP3)).toBe(true);
    },
    unsupported: [{ stream: true }, { response_format: "wav" }, { speed: 9 }, { voice: 7 }],
    usageRow: { modality: "tts", endpoint: "/v1/audio/speech" },
  },
  {
    name: "deapi transcription", provider: "deapi", kind: "stt", models: ["deapi/WhisperLargeV3Ct2"], submit: `${DEAPI}/audio/transcriptions`,
    invoke: (model, extra = {}, signal) => transcriptions(multipart({ model, ...extra }, { signal })),
    success: () => steps.push(() => json({ text: "hello world" })),
    native: () => ({ model: "WhisperLargeV3Ct2", file: "file:clip.wav" }),
    output: async (response) => expect(await response.json()).toEqual({ text: "hello world" }),
    unsupported: [{ stream: "true" }, { response_format: "srt" }, { "timestamp_granularities[]": "word" }, { temperature: "3" }],
    usageRow: { modality: "stt", endpoint: "/v1/audio/transcriptions" },
  },
  {
    name: "deapi embeddings", provider: "deapi", kind: "embedding", models: ["deapi/Bge_M3_FP16"], submit: `${DEAPI}/embeddings`,
    invoke: (model, extra = {}, signal) => embeddings(request({ model, input: "hello", ...extra }, { signal })),
    success: () => steps.push(() => json({ data: [{ index: 0, embedding: Array(1024).fill(0.5) }], usage: { prompt_tokens: 3, total_tokens: 3 } })),
    native: () => ({ model: "Bge_M3_FP16", input: "hello", encoding_format: "float" }),
    output: async (response) => {
      const payload = await response.json();
      expect(payload).toMatchObject({ object: "list", data: [{ object: "embedding", index: 0 }], usage: { prompt_tokens: 3, total_tokens: 3 } });
      expect(payload.data[0].embedding).toHaveLength(1024);
    },
    unsupported: [{ input: [[1, 2, 3]] }, { dimensions: 512 }, { input_type: "query" }, { encoding_format: "int8" }, { input: "x".repeat(20_001) }],
    usageRow: { modality: "embedding", endpoint: "/v1/embeddings" },
  },
  {
    name: "novita video", provider: "novita", kind: "video", models: ["novita/wan-t2v", "novita/kling-v1.6-t2v"], submit: `${NOVITA}/v3/async/wan-t2v`,
    invoke: (model, extra = {}, signal) => videos(request({ model, prompt: "forest", ...extra }, { signal })),
    success: () => steps.push(
      () => json({ task_id: "t-1" }),
      (url) => {
        expect(url).toBe(`${NOVITA}/v3/async/task-result?task_id=t-1`);
        return json({ task: { task_id: "t-1", status: "TASK_STATUS_SUCCEED" }, videos: [{ video_url: ARTIFACT, video_type: "mp4" }] });
      },
    ),
    native: () => ({ prompt: "forest" }),
    output: async (response) => expect((await response.json()).data).toEqual([{ url: ARTIFACT, format: "mp4" }]),
    unsupported: [{ stream: true }, { response_format: "b64_json" }, { n: 2 }, { image: "https://images.example.com/a.png" }, { size: "10x10" }, { duration: 61 }],
    usageRow: { modality: "video", endpoint: "/v1/video/generations", costStatus: "unknown", nativeUnits: { videos: 1 } },
  },
];

beforeEach(() => {
  vi.clearAllMocks(); clearLiveModelLimitsCache();
  m.rows.clear(); m.settings = {};
  m.dir = fs.mkdtempSync(path.join(os.tmpdir(), "register-native-05-"));
  process.env.DATA_DIR = m.dir;
  for (const provider of ["deapi", "novita"]) for (const suffix of ["selected", "other"]) {
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

  it("registers deAPI as one new API-key media identity and keeps Novita's chat identity", () => {
    expect(REGISTRY.filter((entry) => entry.id === "deapi")).toHaveLength(1);
    expect(REGISTRY.filter((entry) => entry.id === "novita")).toHaveLength(1);
    expect(REGISTRY.some((entry) => entry.id !== "deapi" && (entry.alias === "deapi" || entry.aliases?.includes("deapi")))).toBe(false);
    expect(getImageAdapter("deapi")).toBeTruthy();
    expect(getVideoGenerationAdapter("deapi")).toBeTruthy();
    expect(getTtsAdapter("deapi")).toBeTruthy();
    expect(getEmbeddingAdapter("deapi")).toBeTruthy();
    expect(getVideoGenerationAdapter("novita")).toBeTruthy();

    expect(deapi).toMatchObject({ id: "deapi", alias: "deapi", category: "apikey", authType: "apikey", transport: null });
    expect(deapi.serviceKinds).toEqual(["image", "video", "tts", "stt", "embedding"]);
    expect(deapi.oauth).toBeUndefined();
    // No chat transport and no generic media configs that would bypass the adapters.
    expect(PROVIDERS.deapi).toBeUndefined();
    for (const key of ["imageConfig", "imageEditConfig", "ttsConfig", "videoConfig", "embeddingConfig"]) expect(deapi[key], key).toBeUndefined();
    expect(getImageEditConfig(PROVIDER_MEDIA.deapi)).toBeNull();
    expect(deapi.sttConfig).toEqual({ baseUrl: `${DEAPI}/audio/transcriptions`, authType: "apikey", authHeader: "bearer", format: "openai", translationModels: [] });
    expect(APIKEY_PROVIDERS.deapi).toMatchObject({ id: "deapi", alias: "deapi", name: "deAPI", serviceKinds: deapi.serviceKinds });
    expect(AI_PROVIDERS.deapi.serviceKinds).toEqual(deapi.serviceKinds);

    // Novita keeps its API key, Bearer chat transport and chat discovery.
    expect(novita).toMatchObject({ id: "novita", alias: "novita", authType: "apikey", serviceKinds: ["llm", "video"] });
    expect(novita.transport).toEqual({ baseUrl: `${NOVITA}/openai/v1/chat/completions`, validateUrl: `${NOVITA}/openai/v1/models` });
    expect(novita.videoConfig).toBeUndefined();
    expect(PROVIDERS.novita).toBeTruthy();
    expect(AI_PROVIDERS.novita.serviceKinds).toEqual(["llm", "video"]);

    for (const kind of ["image", "video", "tts", "stt", "embedding"]) expect(mediaTransportSupport(kind, "deapi"), kind).toBe("supported");
    expect(mediaTransportSupport("video", "novita")).toBe("supported");
    for (const provider of ["deapi", "novita"]) {
      expect(mediaEndpointSupport("video", "/v1/video/generations", provider).supported).toBe(true);
      expect(mediaEndpointSupport("video", "/v1/videos", provider).supported).toBe(false);
    }
    expect(mediaEndpointSupport("stt", "/v1/audio/translations", "deapi").supported).toBe(false);
    expect(mediaTransportSupport("embedding", "novita")).toBe("unsupported");
  });

  it.each([
    ["image", "deapi", ["ZImageTurbo_INT8", "Flux_2_Klein_4B_BF16", "Flux1schnell", "ZAnimeDistill_8Step_INT8"]],
    ["video", "deapi", ["Ltx2_5_22B_Dist_INT8", "MiniMaxH3_33B_Turbo_INT8", "Ltx2_3_22B_Dist_INT8", "Ltxv_13B_0_9_8_Distilled_FP8"]],
    ["tts", "deapi", ["Kokoro", "Chatterbox", "Qwen3_TTS_12Hz_1_7B_CustomVoice", "Qwen3_TTS_12Hz_1_7B_VoiceDesign"]],
    ["stt", "deapi", ["WhisperLargeV3Ct2", "WhisperLargeV3"]],
    ["embedding", "deapi", ["Bge_M3_FP16"]],
    ["video", "novita", ["wan-t2v", "kling-v1.6-t2v"]],
  ])("discovers %s models for %s on the public route without calling the provider", async (kind, owner, ids) => {
    // Novita's existing chat validation list may run; it must not feed video.
    steps.push(...Array.from({ length: 4 }, () => () => json({ data: [{ id: "meta-llama/chat-model" }] })));
    const response = await typedModels(new Request(`http://localhost/v1/models/${kind}`), { params: Promise.resolve({ model: [kind] }) });
    expect(response.status).toBe(200);
    const rows = (await response.json()).data.filter((row) => row.owned_by === owner);
    expect(rows.map((row) => row.id.split("/").slice(1).join("/")).sort()).toEqual([...ids].sort());
    expect(rows.every((row) => row.kind === kind)).toBe(true);
    expect(calls.filter((call) => call.url.startsWith("https://oai.deapi.ai") || call.url.startsWith(`${NOVITA}/v3`))).toEqual([]);
  });

  it.each([
    ["deapi video model on images", () => images(request({ model: "deapi/Ltx2_5_22B_Dist_INT8", prompt: "forest" }))],
    ["deapi image model on video", () => videos(request({ model: "deapi/Flux1schnell", prompt: "forest" }))],
    ["deapi speech model on embeddings", () => embeddings(request({ model: "deapi/Kokoro", input: "hello" }))],
    ["deapi embedding model on speech", () => speech(request({ model: "deapi/Bge_M3_FP16", input: "hello" }))],
    ["deapi speech model on transcriptions", () => transcriptions(multipart({ model: "deapi/Kokoro" }))],
    ["novita chat model on video", () => videos(request({ model: "novita/deepseek/deepseek-v4-pro", prompt: "forest" }))],
    ["novita video model on embeddings", () => embeddings(request({ model: "novita/wan-t2v", input: "hello" }))],
    ["deapi through the /v1/videos job proxy", () => videoJobs(request({ model: "deapi/Ltx2_5_22B_Dist_INT8", prompt: "forest" }))],
    ["novita through the /v1/videos job proxy", () => videoJobs(request({ model: "novita/wan-t2v", prompt: "forest" }))],
    ["deapi translations", () => translations(multipart({ model: "deapi/WhisperLargeV3Ct2" }))],
    ["deapi image edits", () => edits(multipart({ model: "deapi/Flux1schnell", prompt: "red" }, { name: "image" }))],
  ])("refuses %s before any provider call", async (_name, invoke) => {
    const response = await invoke();
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(calls).toEqual([]);
    expect(usage()).toEqual([]);
  });
});

for (const c of cases) describe(c.name, () => {
  it.each(c.models)("dispatches %s with the selected credential, native body, artifact and one receipt", async (model) => {
    c.success();
    const response = await c.invoke(model);
    expect(response.status).toBe(200);
    await c.output(response.clone());
    const expectedSubmit = c.provider === "novita" ? `${NOVITA}/v3/async/${model.split("/")[1]}` : c.submit;
    expect(calls[0].url).toBe(expectedSubmit);
    expect(calls[0].init.method).toBe("POST");
    expect(await sentBody(calls[0].init)).toMatchObject(c.native(model));
    for (const call of calls) {
      expect(sentCredential(call.init)).toBe(`Bearer ${c.provider}-selected`);
      expect(JSON.stringify(call.init.headers)).not.toContain("other");
      expect(call.url).not.toContain("attacker");
      expect(call.init.redirect).toBe("manual");
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
    expect(await response.text()).not.toContain(`${c.provider}-selected`);
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
  it.each(cases.filter((c) => c.models.length))("marks a spent %# connection as quota exhausted on that connection only", async (c) => {
    steps.push(() => json({ error: { code: "insufficient_quota" } }, 402));
    const response = await c.invoke(c.models[0]);
    expect(response.status).toBe(402);
    expect(auth.markAccountUnavailable).toHaveBeenCalledTimes(1);
    const [connectionId, status, , provider] = auth.markAccountUnavailable.mock.calls[0];
    expect([connectionId, status, provider]).toEqual([`${c.provider}-selected`, 402, c.provider]);
    expect(usage()).toEqual([]);
  });

  it("falls back to another account after a quota refusal, never after an uncertain submit", async () => {
    auth.markAccountUnavailable.mockResolvedValue({ shouldFallback: true });
    m.credentials = vi.fn(async (provider, excluded) => {
      const id = excluded?.has?.(`${provider}-selected`) ? `${provider}-other` : `${provider}-selected`;
      const row = m.rows.get(id);
      return excluded?.has?.(id) ? null : { ...row, _connection: { ...row } };
    });
    steps.push(() => json({ error: { code: "insufficient_quota" } }, 402), () => json({ data: [{ index: 0, embedding: Array(1024).fill(1) }] }));
    const ok = await embeddings(request({ model: "deapi/Bge_M3_FP16", input: "hello" }));
    expect(ok.status).toBe(200);
    expect(calls.map((call) => sentCredential(call.init))).toEqual(["Bearer deapi-selected", "Bearer deapi-other"]);
    expect(usage().map((row) => row.connectionId)).toEqual(["deapi-other"]);

    calls = [];
    steps.push(() => json({ error: "busy" }, 503));
    const uncertain = await embeddings(request({ model: "deapi/Bge_M3_FP16", input: "hello" }));
    expect(uncertain.status).toBeGreaterThanOrEqual(500);
    expect(uncertain.headers.get(ACCEPTED)).toBe("1");
    expect(calls).toHaveLength(1);
    expect(usage().filter((row) => row.costSource === "accepted-job")).toHaveLength(1);
  });

  it("does not replay an uncertain Novita task on a configured fallback model", async () => {
    m.settings = { modelFallbacks: { "novita/wan-t2v": { fallbacks: ["novita/kling-v1.6-t2v"] } } };
    steps.push(() => json({ error: "busy" }, 500));
    const response = await videos(request({ model: "novita/wan-t2v", prompt: "forest" }));
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(response.headers.get(ACCEPTED)).toBe("1");
    expect(calls).toHaveLength(1);
    expect(usage()).toHaveLength(1);
  });

  it("does not refresh, resend or rewrite a refused deAPI key", async () => {
    const { updateProviderCredentials } = await import("../../src/sse/services/tokenRefresh.js");
    steps.push(() => json({ error: "denied" }, 401));
    const response = await embeddings(request({ model: "deapi/Bge_M3_FP16", input: "hello" }));
    expect(response.status).toBe(401);
    expect(calls).toHaveLength(1);
    expect(updateProviderCredentials).not.toHaveBeenCalled();
  });

  it("uses each request's selected key and shares nothing between connections", async () => {
    const order = ["deapi-other", "deapi-selected"];
    m.credentials = vi.fn(async () => {
      const row = m.rows.get(order.shift());
      return { ...row, _connection: { ...row } };
    });
    for (let i = 0; i < 2; i += 1) {
      steps.push(() => json({ data: [{ url: PICTURE }] }));
      expect((await images(request({ model: "deapi/Flux1schnell", prompt: "forest" }))).status).toBe(200);
    }
    expect(calls.map((call) => sentCredential(call.init))).toEqual(["Bearer deapi-other", "Bearer deapi-selected"]);
    expect(usage().map((row) => row.connectionId)).toEqual(["deapi-other", "deapi-selected"]);
  });

  it("records a Novita task that fails after acceptance once, with no second submit", async () => {
    steps.push(() => json({ task_id: "t-9" }), () => json({ task: { task_id: "t-9", status: "UNKNOWN_ERROR" } }));
    const response = await videos(request({ model: "novita/wan-t2v", prompt: "forest" }));
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(response.headers.get(ACCEPTED)).toBe("1");
    expect(calls.filter((call) => call.init.method === "POST")).toHaveLength(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ costSource: "accepted-job", connectionId: "novita-selected" });
  });

  it("requires instructions for the deAPI voice-design model before any network call", async () => {
    const refused = await speech(request({ model: "deapi/Qwen3_TTS_12Hz_1_7B_VoiceDesign", input: "hello" }));
    expect(refused.status).toBe(400);
    expect(calls).toEqual([]);
    steps.push(() => new Response(MP3, { status: 200, headers: { "content-type": "audio/mpeg" } }));
    const ok = await speech(request({ model: "deapi/Qwen3_TTS_12Hz_1_7B_VoiceDesign", input: "hello", instructions: "a calm low voice" }));
    expect(ok.status).toBe(200);
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ instructions: "a calm low voice" });
  });
});
