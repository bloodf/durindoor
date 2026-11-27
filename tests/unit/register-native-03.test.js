// Batch 3 public registration: Kie speech and transcription, Haiper and
// Leonardo image and video, Leonardo reference-image edits and Veo AI Free
// video. Real public routes and the registered adapters over a closed network:
// every request is answered below, an unexpected one fails the test, and every
// key and cookie is synthetic. Passing here says nothing about the live services.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fixture storage isolation, as in register-native-02: claim a private
// DATA_DIR before any application import and restore only our own env key.
const isolated = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs");
  const os = process.getBuiltinModule("node:os");
  const path = process.getBuiltinModule("node:path");
  const had = Object.hasOwn(process.env, "DATA_DIR");
  const previous = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "register-native-03-data-"));
  process.env.DATA_DIR = dir;
  return { dir, had, previous };
});

const m = vi.hoisted(() => ({
  dir: isolated.dir,
  credentials: null,
  noAuth: null,
  save: null,
  storage: null,
  rows: new Map(),
  clock: 0,
  async wait(ms, signal) {
    signal?.throwIfAborted?.();
    m.clock += ms;
  },
}));
const clockOptions = vi.hoisted(() => () => ({ now: () => m.clock, wait: (ms, signal) => m.wait(ms, signal), submitTimeoutMs: 100, requestTimeoutMs: 100, timeoutMs: 100_000 }));

vi.mock("@/dashboardGuard", () => ({
  isOperatorRequest: vi.fn(async () => true),
  canManageAccessConfig: vi.fn(async () => true),
}));
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({})),
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
  getNoAuthProviderCredentials: (...args) => m.noAuth(...args),
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
vi.mock("../../src/sse/utils/logger.js", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), request: vi.fn() }));
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

// The registered default instances, rebuilt on the shared fake clock with short
// real per-request deadlines. Nothing else about the adapters changes.
vi.mock("../../open-sse/services/providerParity/native-kie-tts-stt/index.js", async (original) => {
  const a = await original();
  return { ...a, kieTtsAdapter: a.createKieTtsAdapter(clockOptions()), kieSttAdapter: a.createKieSttAdapter(clockOptions()) };
});
vi.mock("../../open-sse/services/providerParity/native-haiper-video-image/index.js", async (original) => {
  const a = await original();
  return { ...a, haiperImageAdapter: a.createHaiperImageAdapter(clockOptions()), haiperVideoAdapter: a.createHaiperVideoAdapter(clockOptions()) };
});
vi.mock("../../open-sse/services/providerParity/native-leonardo-video-image/index.js", async (original) => {
  const a = await original();
  return { ...a, leonardoImageAdapter: a.createLeonardoImageAdapter(clockOptions()), leonardoVideoAdapter: a.createLeonardoVideoAdapter(clockOptions()) };
});
vi.mock("../../open-sse/services/providerParity/native-leonardo-image-edits/index.js", async (original) => {
  const a = await original();
  return {
    ...a,
    leonardoImageEditAdapter: a.createLeonardoImageEditAdapter({
      ...clockOptions(),
      initTimeoutMs: 100,
      // The pinned storage upload runs through injected transport and DNS: no socket is opened.
      storageFetch: (url, init) => m.storage(url, init),
      lookup: async () => [{ address: "52.216.1.2", family: 4 }],
    }),
  };
});
vi.mock("../../open-sse/services/providerParity/native-veoaifree-web-video/index.js", async (original) => {
  const a = await original();
  return { ...a, default: a.createVeoAiFreeVideoAdapter({ pollIntervalMs: 0, requestTimeoutMs: 100 }) };
});

import { POST as images } from "../../src/app/api/v1/images/generations/route.js";
import { POST as edits } from "../../src/app/api/v1/images/edits/route.js";
import { POST as videos } from "../../src/app/api/v1/video/generations/route.js";
import { POST as speech } from "../../src/app/api/v1/audio/speech/route.js";
import { POST as transcriptions } from "../../src/app/api/v1/audio/transcriptions/route.js";
import { GET as typedModels } from "../../src/app/api/v1/models/[...model]/route.js";
import { clearLiveModelLimitsCache } from "../../open-sse/services/liveModelLimits.js";
import { mediaEndpointSupport, mediaTransportSupport } from "../../src/sse/services/mediaTransport.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { getTtsAdapter } from "../../open-sse/handlers/ttsProviders/index.js";
import { getImageEditAdapter } from "../../open-sse/handlers/imageEditCore.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import kie from "../../open-sse/providers/registry/kie.js";
import haiper from "../../open-sse/providers/registry/haiper.js";
import leonardo from "../../open-sse/providers/registry/leonardo.js";
import veo from "../../open-sse/providers/registry/veoaifree-web.js";
import * as auth from "../../src/sse/services/auth.js";

const KIE = "https://api.kie.ai";
const HAIPER = "https://api.haiper.ai/v1/jobs";
const LEO = "https://cloud.leonardo.ai/api/rest/v1";
const VEO = "https://veoaifree.com";
const AJAX = `${VEO}/wp-admin/admin-ajax.php`;
const PHOENIX = "de7d3faf-762f-48e0-b3b7-9d0ac3a3fcf3";
const ARTIFACT = "https://cdn.example.com/output.mp4";
const PICTURE = "https://cdn.example.com/output.png";
// A public IP literal, so the credential-free audio download needs no DNS lookup.
const AUDIO = "https://93.184.216.34/kie/speech.mp3";
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 7)]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(32).fill(7)]);
const STORAGE = "https://synthetic-bucket.s3-accelerate.amazonaws.com/";
const SIGNATURE = "SYNTHETIC-SIGNATURE-c0ffee";
const WP = "wordpress_logged_in_04e805bfa8c7064a04c2e480966a748b";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const text = (value, headers = {}) => new Response(value, { status: 200, headers });
let calls, steps;
const usage = () => m.save.mock.calls.map(([row]) => row);
const request = (body, { signal, headers = {} } = {}) => new Request("http://localhost/v1/route", {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal,
});
const multipart = (fields, file, { signal, name = "file" } = {}) => {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  if (file) form.append(name, file.blob, file.filename);
  return new Request("http://localhost/v1/route", { method: "POST", body: form, signal });
};
const hang = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
const authHeader = (init) => {
  const headers = new Headers(init?.headers);
  return headers.get("authorization") ?? headers.get("haiper_key");
};
const credentialsFor = (provider) => provider === "kie" || provider === "leonardo" ? `Bearer ${provider}-selected` : `${provider}-selected`;

// One case per provider and route. `submit` is the native submit URL; `success`
// queues every answer of a successful run; `invoke` posts the public request.
const audioFile = () => ({ blob: new Blob([Buffer.from("RIFF-synthetic-audio")], { type: "audio/wav" }), filename: "clip.wav" });
const imageFile = () => ({ blob: new Blob([PNG], { type: "image/png" }), filename: "boat.png" });
const cases = [
  {
    name: "haiper image", provider: "haiper", kind: "image", models: ["haiper/gen2", "hp/gen2"], submit: `${HAIPER}/gen2/text2image`,
    invoke: (model, extra = {}, signal) => images(request({ model, prompt: "forest", ...extra }, { signal })),
    success: () => steps.push(() => json({ job_id: "job-1" }), () => json({ status: "completed", creation_url: PICTURE })),
    native: { prompt: "forest", aspect_ratio: "16:9" },
    output: (payload) => expect(payload.data).toEqual([{ url: PICTURE }]),
    unsupported: [{ stream: true }, { response_format: "b64_json" }, { n: 2 }, { negative_prompt: "blur" }],
  },
  {
    name: "haiper video", provider: "haiper", kind: "video", models: ["haiper/gen2", "hp/gen2"], submit: `${HAIPER}/gen2/text2video`,
    invoke: (model, extra = {}, signal) => videos(request({ model, prompt: "forest", ...extra }, { signal })),
    success: () => steps.push(() => json({ job_id: "job-1" }), () => json({ status: "completed", creation_url: ARTIFACT })),
    native: { prompt: "forest", duration: 4, aspect_ratio: "16:9" },
    output: (payload) => expect(payload.data).toEqual([{ url: ARTIFACT, format: "mp4" }]),
    unsupported: [{ stream: true }, { response_format: "b64_json" }, { n: 2 }, { duration: 8 }],
  },
  {
    name: "leonardo image", provider: "leonardo", kind: "image", models: ["leonardo/phoenix", "leo/phoenix"], submit: `${LEO}/generations`,
    invoke: (model, extra = {}, signal) => images(request({ model, prompt: "forest", ...extra }, { signal })),
    success: () => steps.push(() => json({ sdGenerationJob: { generationId: "gen-1" } }), () => json({ generations_by_pk: { id: "gen-1", status: "COMPLETE", generated_images: [{ url: PICTURE }] } })),
    native: { modelId: PHOENIX, prompt: "forest", width: 1024, height: 1024, num_images: 1 },
    output: (payload) => expect(payload.data).toEqual([{ url: PICTURE }]),
    unsupported: [{ stream: true }, { response_format: "b64_json" }, { n: 2 }, { style: "vivid" }],
  },
  {
    name: "leonardo video", provider: "leonardo", kind: "video", models: ["leonardo/motion-2.0-fast", "leo/motion-2.0-fast"], submit: `${LEO}/generations-text-to-video`,
    invoke: (model, extra = {}, signal) => videos(request({ model, prompt: "forest", ...extra }, { signal })),
    success: () => steps.push(() => json({ motionVideoGenerationJob: { generationId: "vid-1" } }), () => json({ generations_by_pk: { id: "vid-1", status: "COMPLETE", generated_images: [{ url: PICTURE, motionMP4URL: ARTIFACT }] } })),
    native: { model: "MOTION2FAST", prompt: "forest", isPublic: false },
    output: (payload) => expect(payload.data[0]).toMatchObject({ url: ARTIFACT }),
    unsupported: [{ stream: true }, { response_format: "b64_json" }, { n: 2 }, { duration: 8 }],
  },
  {
    name: "kie speech", provider: "kie", kind: "tts", models: ["kie/elevenlabs/text-to-speech-multilingual-v2"], submit: `${KIE}/api/v1/jobs/createTask`,
    invoke: (model, extra = {}, signal) => speech(request({ model, input: "hello there", voice: "nova", ...extra }, { signal })),
    success: () => steps.push(
      () => json({ code: 200, data: { taskId: "task-1" } }),
      () => json({ code: 200, data: { taskId: "task-1", state: "success", resultJson: JSON.stringify({ resultUrls: [AUDIO] }) } }),
      (url, init) => {
        expect(url).toBe(AUDIO);
        expect(authHeader(init)).toBeNull();
        return new Response(MP3, { status: 200, headers: { "content-type": "audio/mpeg" } });
      },
    ),
    native: { model: "elevenlabs/text-to-speech-multilingual-v2", input: { text: "hello there", voice: "Bella" } },
    output: async (_payload, response) => {
      expect(response.headers.get("content-type")).toBe("audio/mp3");
      expect(Buffer.from(await response.arrayBuffer()).equals(MP3)).toBe(true);
    },
    binary: true,
    unsupported: [{ stream: true }, { response_format: "wav" }, { timestamps: true }, { callBackUrl: "https://example.com/hook" }],
  },
  {
    name: "kie transcription", provider: "kie", kind: "stt", models: ["kie/elevenlabs/speech-to-text"], submit: `${KIE}/api/v1/jobs/createTask`,
    invoke: (model, extra = {}, signal) => transcriptions(multipart({ model, ...extra }, audioFile(), { signal })),
    success: () => steps.push(
      () => json({ code: 200, data: { taskId: "stt-1" } }),
      () => json({ code: 200, data: { taskId: "stt-1", state: "success", response: { text: "hello world" } } }),
    ),
    native: { model: "elevenlabs/speech-to-text", input: { file_name: "clip.wav", file_base64: Buffer.from("RIFF-synthetic-audio").toString("base64") } },
    output: (payload) => expect(payload).toEqual({ text: "hello world" }),
    unsupported: [{ stream: "true" }, { response_format: "verbose_json" }, { "timestamp_granularities[]": "word" }],
  },
  {
    name: "leonardo edit", provider: "leonardo", kind: "imageEdit", models: ["leonardo/phoenix", "leo/phoenix"], submit: `${LEO}/init-image`,
    invoke: (model, extra = {}, signal) => edits(multipart({ model, prompt: "make it red", ...extra }, imageFile(), { signal, name: "image" })),
    success: () => {
      steps.push(
        () => json({ uploadInitImage: { id: "init-1", url: STORAGE, fields: JSON.stringify({ key: "u/init-1.png", "x-amz-signature": SIGNATURE }) } }),
        () => json({ sdGenerationJob: { generationId: "gen-1" } }),
        () => json({ generations_by_pk: { id: "gen-1", status: "COMPLETE", generated_images: [{ url: PICTURE }] } }),
      );
    },
    native: { extension: "png" },
    output: (payload) => {
      expect(payload.data).toEqual([{ url: PICTURE }]);
      // The pre-encoded form goes to the presigned storage URL without the Leonardo key.
      expect(m.storage).toHaveBeenCalledTimes(1);
      const [url, init] = m.storage.mock.calls[0];
      expect(url).toBe(STORAGE);
      expect(Object.keys(init.headers)).toEqual(["Content-Type"]);
      expect(Buffer.from(init.body).toString("latin1")).not.toContain("leonardo-selected");
      expect(calls[1].url).toBe(`${LEO}/generations`);
      expect(JSON.parse(calls[1].init.body)).toMatchObject({ modelId: PHOENIX, prompt: "make it red", init_image_id: "init-1", init_strength: 0.3 });
    },
    unsupported: [{ stream: "true" }, { response_format: "b64_json" }, { n: "2" }, { mask: "x" }],
  },
];

beforeEach(() => {
  vi.clearAllMocks(); clearLiveModelLimitsCache();
  m.rows.clear(); m.clock = 1_000_000;
  m.dir = fs.mkdtempSync(path.join(os.tmpdir(), "register-native-03-"));
  process.env.DATA_DIR = m.dir;
  for (const provider of ["kie", "haiper", "leonardo"]) for (const suffix of ["selected", "other"]) {
    const id = `${provider}-${suffix}`;
    m.rows.set(id, { id, connectionId: id, provider, apiKey: id, isActive: true, authType: "apikey", providerSpecificData: { baseUrl: "https://attacker.example" } });
  }
  m.credentials = vi.fn(async (provider, excluded) => {
    const row = m.rows.get(`${provider}-selected`);
    return row && !excluded?.has?.(row.id) ? { ...row, _connection: { ...row } } : null;
  });
  m.noAuth = vi.fn(async () => ({}));
  m.save = vi.fn(async () => true);
  m.storage = vi.fn(async () => new Response(null, { status: 204 }));
  calls = []; steps = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url) === "https://api.kie.ai/v1/models") return json({ data: [] });
    if (String(url) === "https://aihorde.net/api/v2/status/models?type=image") return json([]);
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
  it("registers every adapter on the existing providers and aliases, with no duplicate identity", () => {
    expect(getTtsAdapter("kie")).toBeTruthy();
    expect(kie.serviceKinds).toEqual(["llm", "image", "video", "tts", "stt"]);
    expect(kie.sttConfig).toMatchObject({ format: "kie-audio", authType: "apikey" });
    expect(kie.transport.baseUrl).toBe(`${KIE}/v1/chat/completions`);
    for (const id of ["haiper", "hp"]) {
      expect(getImageAdapter(id)).toBe(getImageAdapter("haiper"));
      expect(getVideoGenerationAdapter(id)).toBe(getVideoGenerationAdapter("haiper"));
    }
    for (const id of ["leonardo", "leo"]) {
      expect(getImageAdapter(id)).toBe(getImageAdapter("leonardo"));
      expect(getVideoGenerationAdapter(id)).toBe(getVideoGenerationAdapter("leonardo"));
      expect(getImageEditAdapter(id)).toBe(getImageEditAdapter("leonardo"));
    }
    expect(getVideoGenerationAdapter("veo-free")).toBe(getVideoGenerationAdapter("veoaifree-web"));
    expect([haiper.alias, leonardo.alias, veo.alias]).toEqual(["hp", "leo", "veo-free"]);
    expect(veo.noAuth).toBe(true);
    // No new provider cards: no async job proxy and no OpenAI edit passthrough for these providers.
    for (const entry of [haiper, leonardo]) expect(entry.videoConfig).toBeUndefined();
    expect(PROVIDER_MEDIA.leonardo.imageEditConfig).toBeUndefined();
    for (const [kind, provider] of [["image", "haiper"], ["video", "haiper"], ["image", "leonardo"], ["video", "leonardo"], ["video", "veoaifree-web"], ["tts", "kie"], ["stt", "kie"]]) {
      expect(mediaTransportSupport(kind, provider), `${kind} ${provider}`).toBe("supported");
    }
    for (const provider of ["haiper", "leonardo", "veoaifree-web"]) {
      expect(mediaEndpointSupport("video", "/v1/video/generations", provider).supported).toBe(true);
      expect(mediaEndpointSupport("video", "/v1/videos", provider).supported).toBe(false);
    }
  });

  // Listed under the provider's public alias, the prefix callers use.
  it.each([
    ["image", "hp", ["gen2"]], ["video", "hp", ["gen2"]],
    ["image", "leo", ["phoenix", "sdxl"]], ["video", "leo", ["motion-2.0", "motion-2.0-fast"]],
    ["video", "veo-free", ["veo", "seedance"]],
    ["tts", "kie", ["elevenlabs/text-to-speech-multilingual-v2", "elevenlabs/text-to-speech-turbo-2-5"]],
    ["stt", "kie", ["elevenlabs/speech-to-text"]],
  ])("discovers %s models for %s on the public route", async (kind, owner, ids) => {
    const response = await typedModels(new Request(`http://localhost/v1/models/${kind}`), { params: Promise.resolve({ model: [kind] }) });
    expect(response.status).toBe(200);
    const rows = (await response.json()).data.filter((row) => row.owned_by === owner);
    expect(rows.map((row) => row.id.split("/").slice(1).join("/"))).toEqual(ids);
    expect(rows.every((row) => row.kind === kind)).toBe(true);
    // Static source catalogs: discovery never calls a provider.
    expect(calls.filter((call) => !call.url.startsWith("https://aihorde.net"))).toEqual([]);
  });

  it("keeps chat-only model ids off the media routes", async () => {
    const response = await speech(request({ model: "kie/claude-opus-4-8", input: "hello" }));
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

for (const c of cases) describe(c.name, () => {
  it.each(c.models)("dispatches %s with the selected credential, native body, artifact and one receipt", async (model) => {
    c.success();
    const response = await c.invoke(model);
    expect(response.status).toBe(200);
    await c.output(c.binary ? null : await response.clone().json(), response);
    expect(calls[0].url).toBe(c.submit);
    expect(JSON.parse(calls[0].init.body)).toMatchObject(c.native);
    for (const call of calls) {
      if (call.url === AUDIO) continue;
      expect(authHeader(call.init)).toBe(credentialsFor(c.provider));
      expect(JSON.stringify(call.init.headers)).not.toContain("other");
      expect(call.url).not.toContain("attacker");
    }
    expect(steps).toHaveLength(0);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: c.provider, connectionId: `${c.provider}-selected`, costStatus: "unknown" });
    expect(usage()[0].costSource).not.toBe("accepted-job");
  });

  it.each([401, 402, 429])("returns a refusal %s at submit without leaking the key or charging", async (status) => {
    steps.push(() => json({ error: `echo ${c.provider}-selected`, code: status, msg: `echo ${c.provider}-selected` }, status));
    const response = await c.invoke(c.models[0]);
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = await response.text();
    expect(body).not.toContain(`${c.provider}-selected`);
    expect(calls).toHaveLength(1);
    expect(usage()).toEqual([]);
    expect(response.headers.get("x-durindoor-accepted-job")).toBeNull();
    expect(auth.markAccountUnavailable.mock.calls.every((args) => args[0] === `${c.provider}-selected`)).toBe(true);
  });

  it.each(c.unsupported)("refuses unsupported input %j before any network call", async (extra) => {
    const response = await c.invoke(c.models[0], extra);
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(m.storage).not.toHaveBeenCalled();
    expect(usage()).toEqual([]);
  });

  if (c.kind === "imageEdit") {
    it("cancels during the non-billable init-image phase without usage or a second account", async () => {
      steps.push(hang);
      const controller = new AbortController();
      const pending = c.invoke(c.models[0], {}, controller.signal);
      await vi.waitFor(() => expect(calls).toHaveLength(1));
      controller.abort();
      expect((await pending).status).toBe(499);
      expect(m.credentials).toHaveBeenCalledTimes(1);
      expect(usage()).toEqual([]);
    });

    it("never replays a generation whose outcome is unknown and records it once", async () => {
      steps.push(
        () => json({ uploadInitImage: { id: "init-1", url: STORAGE, fields: JSON.stringify({ key: "u/init-1.png" }) } }),
        () => json({ error: "unknown" }, 500),
      );
      const response = await c.invoke(c.models[0]);
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(response.headers.get("x-durindoor-accepted-job")).toBe("1");
      expect(calls.map((call) => call.url)).toEqual([`${LEO}/init-image`, `${LEO}/generations`]);
      expect(m.credentials).toHaveBeenCalledTimes(1);
      expect(usage()).toHaveLength(1);
      expect(usage()[0]).toMatchObject({ costSource: "accepted-job", connectionId: "leonardo-selected", endpoint: "/v1/images/edits" });
    });
    return;
  }

  it("never replays an uncertain submit and records it once", async () => {
    steps.push(() => json({ error: "unknown" }, 500));
    const response = await c.invoke(c.models[0]);
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(response.headers.get("x-durindoor-accepted-job")).toBe("1");
    expect(calls).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ costSource: "accepted-job", connectionId: `${c.provider}-selected` });
  });

  it("bounds a stuck submission and records the uncertain outcome once", async () => {
    steps.push(hang);
    const response = await c.invoke(c.models[0]);
    expect(response.status).toBe(504);
    expect(calls[0].init.signal.aborted).toBe(true);
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
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0].costSource).toBe("accepted-job");
  });
});

describe("leonardo edit JSON body", () => {
  const dataUri = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;
  it("accepts one data: URI reference and runs the same three-phase flow", async () => {
    cases.find((c) => c.kind === "imageEdit").success();
    const response = await edits(request({ model: "leo/phoenix", prompt: "make it red", image: dataUri }));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([{ url: PICTURE }]);
    expect(calls.map((call) => call.url)).toEqual([`${LEO}/init-image`, `${LEO}/generations`, `${LEO}/generations/gen-1`]);
    expect(m.storage).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
  });
  it.each([
    { image: "https://example.com/remote.png" },
    { images: [dataUri, dataUri] },
    { image: { file_id: "file-1" } },
  ])("refuses %j before any network call", async (extra) => {
    const response = await edits(request({ model: "leo/phoenix", prompt: "make it red", ...extra }));
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(m.storage).not.toHaveBeenCalled();
    expect(usage()).toEqual([]);
  });
});

describe("kie transcription refusals", () => {
  it("refuses translations before any network call", async () => {
    const { POST: translations } = await import("../../src/app/api/v1/audio/translations/route.js");
    const response = await translations(multipart({ model: "kie/elevenlabs/speech-to-text" }, audioFile()));
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(usage()).toEqual([]);
  });
});

describe("veo ai free sessions on the public video route", () => {
  const SESSION_A = `${WP}=session-a`;
  const SESSION_B = `${WP}=session-b`;
  const session = (id, cookie) => ({ id, connectionId: id, provider: "veoaifree-web", apiKey: cookie, authType: "apikey", isActive: true, providerSpecificData: {} });
  const run = (extra = {}, headers = {}, signal) => videos(request({ model: "veoaifree-web/veo", prompt: "rain", ...extra }, { headers, signal }));
  const succeed = (nonce = "abcdef") => steps.push(
    () => text(`window.veo = {"nonce":"${nonce}"}`, { "set-cookie": "site=fresh; Secure" }),
    () => text("scene-1"),
    () => text(ARTIFACT),
  );
  const cookieOf = (call) => new Headers(call.init.headers).get("cookie");

  it("runs anonymously with no saved session and never sends a cookie, key or bearer", async () => {
    succeed();
    const response = await run();
    expect(response.status).toBe(200);
    expect((await response.json()).data[0]).toMatchObject({ url: ARTIFACT });
    expect(m.noAuth).toHaveBeenCalledWith("veoaifree-web", "veo", { apiKeyId: "caller-id" });
    expect(m.credentials).not.toHaveBeenCalled();
    expect(calls.map((call) => call.url)).toEqual([VEO, AJAX, AJAX]);
    expect(cookieOf(calls[0])).toBeNull();
    expect(cookieOf(calls[1])).toBe("site=fresh");
    for (const call of calls) expect(authHeader(call.init)).toBeNull();
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: "veoaifree-web", connectionId: null, costStatus: "unknown" });
  });

  it("sends the selected saved session on its own AJAX calls only, and the alias reaches the same adapter", async () => {
    m.noAuth = vi.fn(async () => session("veo-a", SESSION_A));
    succeed();
    const response = await videos(request({ model: "veo-free/veo", prompt: "rain" }));
    expect(response.status).toBe(200);
    expect(cookieOf(calls[0])).toBeNull();
    expect(cookieOf(calls[1])).toBe(`${SESSION_A}; site=fresh`);
    expect(cookieOf(calls[2])).toBe(`${SESSION_A}; site=fresh`);
    expect(calls.every((call) => call.url.startsWith(VEO))).toBe(true);
    expect(usage()).toHaveLength(1);
    expect(usage()[0].connectionId).toBe("veo-a");
  });

  it("pins a session through x-connection-id and keeps two sessions isolated", async () => {
    m.noAuth = vi.fn(async (_provider, _model, options) => session(options.strictConnectionId, options.strictConnectionId === "veo-b" ? SESSION_B : SESSION_A));
    succeed("aaaaaa");
    expect((await run({}, { "x-connection-id": "veo-b" })).status).toBe(200);
    succeed("bbbbbb");
    expect((await run({}, { "x-connection-id": "veo-a" })).status).toBe(200);
    expect(m.noAuth.mock.calls.map(([, , options]) => options)).toEqual([
      { apiKeyId: "caller-id", preferredConnectionId: "veo-b", strictConnectionId: "veo-b" },
      { apiKeyId: "caller-id", preferredConnectionId: "veo-a", strictConnectionId: "veo-a" },
    ]);
    const ajax = calls.filter((call) => call.url === AJAX).map(cookieOf);
    expect(ajax.slice(0, 2).every((cookie) => cookie.startsWith(SESSION_B) && !cookie.includes("session-a"))).toBe(true);
    expect(ajax.slice(2).every((cookie) => cookie.startsWith(SESSION_A) && !cookie.includes("session-b"))).toBe(true);
    expect(usage().map((row) => row.connectionId)).toEqual(["veo-b", "veo-a"]);
  });

  it("answers no credentials when a pinned session is unavailable, never anonymous", async () => {
    m.noAuth = vi.fn(async () => null);
    const response = await run({}, { "x-connection-id": "veo-missing" });
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(usage()).toEqual([]);
  });

  it.each([{ duration: 8 }, { image: "https://example.com/a.png" }, { stream: true }, { response_format: "b64_json" }, { n: 2 }, { size: "1024x768" }])("refuses unsupported input %j before submit", async (extra) => {
    const response = await run(extra);
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(usage()).toEqual([]);
  });

  it("refuses a malformed saved session before any network call", async () => {
    m.noAuth = vi.fn(async () => session("veo-bad", "[not json"));
    const response = await run();
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("never replays an uncertain submit, keeps the session's account and records it once", async () => {
    m.noAuth = vi.fn(async () => session("veo-a", SESSION_A));
    steps.push(() => text('{"nonce":"abcdef"}'), () => new Response("busy", { status: 500 }));
    const response = await run();
    expect(response.status).toBe(502);
    expect(response.headers.get("x-durindoor-accepted-job")).toBe("1");
    expect(calls).toHaveLength(2);
    expect(m.noAuth).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ costSource: "accepted-job", connectionId: "veo-a" });
    expect(await response.text()).not.toContain("session-a");
  });

  it("does not charge a refusal before submit and leaks nothing", async () => {
    steps.push(() => new Response("denied", { status: 403 }));
    const response = await run();
    expect(response.status).toBe(403);
    expect(usage()).toEqual([]);
    expect(response.headers.get("x-durindoor-accepted-job")).toBeNull();
  });

  it("cancels during polling without replay and records the accepted job once", async () => {
    const controller = new AbortController();
    steps.push(() => text('{"nonce":"abcdef"}'), () => text("scene-1"), hang);
    const pending = run({}, {}, controller.signal);
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    controller.abort();
    expect((await pending).status).toBe(499);
    expect(calls).toHaveLength(3);
    expect(usage()).toHaveLength(1);
    expect(usage()[0].costSource).toBe("accepted-job");
  });
});
