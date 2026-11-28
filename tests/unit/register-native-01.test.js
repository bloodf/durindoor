// Native provider registration batch 1: Agnes image and video, and Vertex AI
// video (Veo), speech (Gemini TTS), transcription (Gemini STT) and music
// (Lyria 2) on the existing `agnes` and `vertex` connections.
//
// Public routes, the real cores, registries and staged adapters run against one
// closed fetch. Account selection and usage storage are synthetic; the account
// health writer is real. Every key and token is synthetic, and an unexpected
// request fails the test. Passing proves the gateway contract only, not live
// provider acceptance.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeAdapterWithin } from "./helpers/closeAdapterWithin.js";

// Fixture storage isolation: src/lib/db/paths.js prefers process.env.DATA_DIR
// over the mocked @/lib/dataDir.js, so an inherited runner DATA_DIR made every
// worker open one shared SQLite file ("database is locked"). Claim a private
// directory before any application import and restore only our own env key.
const isolated = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs");
  const os = process.getBuiltinModule("node:os");
  const path = process.getBuiltinModule("node:path");
  const had = Object.hasOwn(process.env, "DATA_DIR");
  const previous = process.env.DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "register-native-01-data-"));
  process.env.DATA_DIR = dir;
  return { dir, had, previous };
});

const m = vi.hoisted(() => ({
  dir: isolated.dir,
  credentials: null,
  refresh: null,
  save: null,
  rows: new Map(),
  selected: {},
  fallback: [],
  writes: [],
  // Shared fake clock for the poll loops below: waiting advances it instantly.
  clock: 0,
  async wait(ms, signal) {
    signal?.throwIfAborted?.();
    m.clock += ms;
  },
}));

vi.mock("@/dashboardGuard", () => ({
  isOperatorRequest: vi.fn(async () => true),
  canManageAccessConfig: vi.fn(async () => true),
}));
vi.mock("@/lib/localDb", () => {
  const apply = (id, patch) => {
    const row = m.rows.get(id);
    if (!row) return null;
    Object.assign(row, patch);
    return row;
  };
  return {
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
    updateProviderConnection: vi.fn(async (id, patch, options = {}) => {
      m.writes.push({ id, patch });
      const connection = apply(id, patch);
      return options.returnCommitResult ? { applied: true, connection } : connection;
    }),
    recordProviderConnectionFallbackState: vi.fn(async (id, state) => {
      m.fallback.push({ id, ...state });
      const scope = state.model ? `modelLock_${state.model}` : "modelLock___all";
      return { applied: true, connection: apply(id, { [scope]: new Date(state.observedAt + state.cooldownMs).toISOString(), errorCode: state.status }) };
    }),
  };
});
vi.mock("@/shared/services/providerRateLimitEvidence", () => ({
  recordProviderRateLimitEvidence: vi.fn(async () => {}),
  clearProviderRateLimitEvidence: vi.fn(async () => {}),
}));
vi.mock("@/lib/webhooks/index.js", () => ({ notifyWebhookEvent: vi.fn() }));
vi.mock("@/lib/db/repos/mediaJobsRepo.js", () => ({ createMediaJob: vi.fn(), getMediaJob: vi.fn(), finishMediaJob: vi.fn() }));
vi.mock("../../src/sse/services/auth.js", async () => {
  // The real account-health writer, behind substituted credential selection.
  const real = await import("../../src/sse/services/auth/accountErrors.js");
  return {
    getProviderCredentialsWithQuotaPreflight: (...args) => m.credentials(...args),
    getNoAuthProviderCredentials: vi.fn(),
    markAccountUnavailable: vi.fn(real.markAccountUnavailable),
    clearAccountError: vi.fn(async () => {}),
    resolveClientApiKey: vi.fn(async () => ({ apiKey: "caller-key", auth: { ok: true, apiKeyId: "caller-id", billingEpoch: null } })),
    extractApiKey: vi.fn(),
    hasValidCliToken: vi.fn(),
  };
});
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  refreshWithRetry: vi.fn(async () => null),
  checkAndRefreshToken: (...args) => m.refresh(...args),
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

// The real factories with the fake clock and short per-request deadlines. The
// registered dispatchers import exactly these instances.
vi.mock("../../open-sse/services/providerParity/native-agnes-video-image/index.js", async (original) => {
  const actual = await original();
  return {
    ...actual,
    agnesImageAdapter: actual.createAgnesImageAdapter({ timeoutMs: 400, now: () => m.clock }),
    agnesVideoAdapter: actual.createAgnesVideoAdapter({ wait: (ms, signal) => m.wait(ms, signal), now: () => m.clock, submitTimeoutMs: 400, requestTimeoutMs: 400 }),
  };
});
vi.mock("../../open-sse/services/providerParity/native-vertex-video/adapter.js", async (original) => {
  const actual = await original();
  return { ...actual, default: actual.createVertexVideoAdapter({ wait: (ms, signal) => m.wait(ms, signal), now: () => m.clock, submitTimeoutMs: 400, requestTimeoutMs: 400 }) };
});
vi.mock("../../open-sse/services/providerParity/native-vertex-tts-stt/speech.js", async (original) => {
  const actual = await original();
  return { ...actual, default: actual.createVertexTtsAdapter({ requestTimeoutMs: 400 }) };
});
vi.mock("../../open-sse/services/providerParity/native-vertex-tts-stt/transcription.js", async (original) => {
  const actual = await original();
  return { ...actual, transcribeVertex: actual.createVertexSttTranscriber({ requestTimeoutMs: 400 }) };
});
vi.mock("../../open-sse/services/providerParity/native-vertex-music/index.js", async (original) => {
  const actual = await original();
  return { ...actual, handleVertexMusicGeneration: (options) => actual.handleVertexMusicGeneration({ ...options, totalTimeoutMs: 400 }) };
});

import { POST as images } from "../../src/app/api/v1/images/generations/route.js";
import { POST as videos } from "../../src/app/api/v1/video/generations/route.js";
import { POST as speech } from "../../src/app/api/v1/audio/speech/route.js";
import { POST as transcriptions } from "../../src/app/api/v1/audio/transcriptions/route.js";
import { POST as music } from "../../src/app/api/v1/music/generations/route.js";
import { GET as typedModels } from "../../src/app/api/v1/models/[...model]/route.js";
import { clearLiveModelLimitsCache } from "../../open-sse/services/liveModelLimits.js";
import { ACCEPTED_JOB_HEADER } from "../../open-sse/services/combo.js";
import { mediaEndpointSupport, mediaTransportSupport } from "../../src/sse/services/mediaTransport.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { getTtsAdapter, VOICE_FETCHERS } from "../../open-sse/handlers/ttsProviders/index.js";
import { listTtsVoices } from "../../src/lib/ttsVoices.js";
import { getImageEditConfig } from "../../open-sse/handlers/imageEditCore.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import agnesRegistry from "../../open-sse/providers/registry/agnes.js";
import agnesCnRegistry from "../../open-sse/providers/registry/agnes-cn.js";
import vertexRegistry from "../../open-sse/providers/registry/vertex.js";
import * as agnes from "../../open-sse/services/providerParity/native-agnes-video-image/index.js";
import vertexVideoAdapter from "../../open-sse/services/providerParity/native-vertex-video/adapter.js";
import { VERTEX_VIDEO_MODELS } from "../../open-sse/services/providerParity/native-vertex-video/config.js";
import vertexSpeechAdapter from "../../open-sse/services/providerParity/native-vertex-tts-stt/speech.js";
import { VERTEX_STT_CONFIG, VERTEX_TTS_CONFIG } from "../../open-sse/services/providerParity/native-vertex-tts-stt/config.js";
import { VERTEX_MUSIC_CONFIG } from "../../open-sse/services/providerParity/native-vertex-music/index.js";
import * as auth from "../../src/sse/services/auth.js";

// ── Synthetic accounts ────────────────────────────────────────────────────────
const AGNES = "https://apihub.agnes-ai.com";
const AGNES_KEY_A = "agnes-SYNTHETIC-unselected-a";
const AGNES_KEY_B = "agnes-SYNTHETIC-selected-b";
const PROJECT_A = "proj-alpha-unselected";
const PROJECT_B = "proj-bravo-selected";
const TOKEN_A = "ya29.SYNTHETIC-unselected-a";
const TOKEN_B = "ya29.SYNTHETIC-selected-b";
const EXPRESS_KEY = "AQ.SYNTHETIC-express-c";
const SECRETS = [AGNES_KEY_A, AGNES_KEY_B, TOKEN_A, TOKEN_B, EXPRESS_KEY, PROJECT_A];
const REGION = `https://us-central1-aiplatform.googleapis.com/v1/projects/${PROJECT_B}/locations/us-central1/publishers/google/models`;
const EXPRESS = "https://aiplatform.googleapis.com/v1/publishers/google/models";

const ROWS = [
  { id: "agnes-a", provider: "agnes", apiKey: AGNES_KEY_A, providerSpecificData: {} },
  // A stored base URL must never redirect the key.
  { id: "agnes-b", provider: "agnes", apiKey: AGNES_KEY_B, providerSpecificData: { baseUrl: "https://attacker.example/v1" } },
  { id: "vertex-a", provider: "vertex", apiKey: "", accessToken: TOKEN_A, providerSpecificData: { projectId: PROJECT_A, location: "europe-west4" } },
  { id: "vertex-b", provider: "vertex", apiKey: "", accessToken: TOKEN_B, providerSpecificData: { projectId: PROJECT_B, location: "us-central1" } },
  { id: "vertex-x", provider: "vertex", apiKey: EXPRESS_KEY, providerSpecificData: {} },
];

// ── Fixtures ──────────────────────────────────────────────────────────────────
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const leaky = (status, code, headers = {}) => json({ error: { code: status, status: code, message: `upstream echo ${AGNES_KEY_B} ${TOKEN_B}` } }, status, headers);
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(12, 1)]).toString("base64");
const PCM = Buffer.alloc(480, 7).toString("base64");
const FAST_OP = "projects/123456789/locations/us-central1/publishers/google/models/veo-3.1-fast-generate-001/operations/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7";
const OP = `projects/${PROJECT_B}/locations/us-central1/publishers/google/models/veo-3.1-generate-001/operations/0f1e2d3c-4b5a-6978-8091-a2b3c4d5e6f7`;
function wav(seconds = 1, byteRate = 192000) {
  const size = Math.round(seconds * byteRate);
  const buf = Buffer.alloc(44 + size);
  buf.write("RIFF", 0, "ascii"); buf.writeUInt32LE(36 + size, 4); buf.write("WAVE", 8, "ascii"); buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(48000, 24);
  buf.writeUInt32LE(byteRate, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36, "ascii"); buf.writeUInt32LE(size, 40);
  return buf.toString("base64");
}
const speechAnswer = () => json({
  candidates: [{ content: { role: "model", parts: [{ inlineData: { mimeType: "audio/L16;codec=pcm;rate=24000", data: PCM } }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 120, totalTokenCount: 129 },
});
const transcriptAnswer = () => json({
  candidates: [{ content: { role: "model", parts: [{ text: " the forest gate opens " }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 8, totalTokenCount: 308 },
});

// ── Closed network ────────────────────────────────────────────────────────────
let calls;
let steps;
let routes;
const usage = () => m.save.mock.calls.map(([row]) => row);
const bodyOf = (call) => JSON.parse(call.init.body);
// A request that never answers until the fetch signal fires.
const hang = (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason ?? Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true }));

function select(provider, id) {
  m.selected[provider] = id;
}
async function expectNoLeak(response) {
  const text = await response.clone().text();
  for (const secret of SECRETS) expect(text).not.toContain(secret);
  expect(text).not.toContain("upstream echo");
}
// Only the selected account's credential ever leaves the gateway.
function expectOnlySelected(secret) {
  for (const call of calls) {
    const wire = `${call.url} ${JSON.stringify(call.init?.headers ?? {})} ${typeof call.init?.body === "string" ? call.init.body : ""}`;
    for (const other of SECRETS.filter((value) => value !== secret)) expect(wire).not.toContain(other);
    if (secret) expect(wire).toContain(secret);
  }
}
const jsonPost = (route, body, query = "") => route(new Request(`http://localhost${route === speech ? "/v1/audio/speech" : route === images ? "/v1/images/generations" : route === videos ? "/v1/video/generations" : "/v1/music/generations"}${query}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}));
function abortablePost(route, url, body) {
  const controller = new AbortController();
  const request = new Request(`http://localhost${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
  return { controller, response: route(request) };
}
function sttPost(fields = {}, file = new File([Buffer.from("RIFF....WAVEfmt synthetic-audio")], "clip.wav", { type: "audio/wav" }), signal) {
  const form = new FormData();
  if (file) form.append("file", file);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return transcriptions(new Request("http://localhost/v1/audio/transcriptions", { method: "POST", body: form, signal }));
}

beforeEach(() => {
  vi.clearAllMocks();
  clearLiveModelLimitsCache();
  m.rows.clear(); m.fallback.length = 0; m.writes.length = 0; m.selected = {}; m.clock = 1_000_000;
  m.dir = fs.mkdtempSync(path.join(os.tmpdir(), "register-native-01-"));
  process.env.DATA_DIR = m.dir;
  for (const row of ROWS) m.rows.set(row.id, { ...row, authType: "apikey", isActive: true, providerSpecificData: { ...row.providerSpecificData } });
  select("agnes", "agnes-b");
  select("vertex", "vertex-b");
  m.credentials = vi.fn(async (provider, excluded) => {
    const id = m.selected[provider];
    if (!id || excluded?.has?.(id)) return null;
    const row = m.rows.get(id);
    return { ...row, connectionId: id, connectionName: id, _connection: { ...row } };
  });
  m.refresh = vi.fn(async (_provider, credentials) => credentials);
  m.save = vi.fn(async () => true);
  calls = []; steps = []; routes = [];
  vi.stubGlobal("fetch", vi.fn(async (input, init = {}) => {
    const url = String(input?.url ?? input);
    calls.push({ url, init });
    const route = routes.find((entry) => entry.match(url, init));
    if (route) return route.answer(url, init);
    const next = steps.shift();
    if (!next) throw new Error(`closed network: ${init.method || "GET"} ${url}`);
    return next(url, init);
  }));
});
// The driver keeps its handle on globalThis, which outlives a case and this file
// in a reused fork worker. Close it before deleting the directory that holds its
// file. A failed close fails the hook and keeps the handle and that directory.
async function removeOwnedStorage(dir) {
  await closeAdapterWithin(globalThis._dbAdapter, dir);
  fs.rmSync(dir, { recursive: true, force: true });
}
afterEach(async () => { vi.unstubAllGlobals(); await removeOwnedStorage(m.dir); });
afterAll(async () => {
  try {
    // m.dir is already gone unless the last afterEach could not close it.
    for (const dir of new Set([isolated.dir, m.dir])) await removeOwnedStorage(dir);
  } finally {
    if (isolated.had) process.env.DATA_DIR = isolated.previous;
    else delete process.env.DATA_DIR;
  }
});

// ── Registration identity, catalog and discovery ──────────────────────────────
describe("registration identity", () => {
  it("registers the canonical adapters on the existing providers and aliases", () => {
    expect(getImageAdapter("agnes")).toBe(agnes.agnesImageAdapter);
    expect(getVideoGenerationAdapter("agnes")).toBe(agnes.agnesVideoAdapter);
    expect(getVideoGenerationAdapter("vertex")).toBe(vertexVideoAdapter);
    expect(getVideoGenerationAdapter("vx")).toBe(vertexVideoAdapter);
    expect(getTtsAdapter("vertex")).toBe(vertexSpeechAdapter);
    expect(getTtsAdapter("vx")).toBe(vertexSpeechAdapter);
    for (const unregistered of ["agnes-cn", "vertex-partner"]) {
      expect(getImageAdapter(unregistered)).toBeNull();
      expect(getVideoGenerationAdapter(unregistered)).toBeNull();
      expect(getTtsAdapter(unregistered)).toBeNull();
    }
    expect(agnesCnRegistry.serviceKinds ?? ["llm"]).toEqual(["llm"]);
  });

  it("keeps existing auth, chat transport and chat models, and adds typed media rows only", () => {
    expect(agnesRegistry).toMatchObject({ id: "agnes", alias: "agnes", authType: "apikey", serviceKinds: ["llm", "image", "video"] });
    expect(agnesRegistry.transport.baseUrl).toBe(`${AGNES}/v1/chat/completions`);
    expect(agnesRegistry.modelsFetcher).toEqual({ url: `${AGNES}/v1/models`, type: "openai" });
    expect(agnesRegistry.models.filter((row) => !row.kind).map((row) => row.id)).toEqual(["agnes-2.0-flash", "agnes-2.5-flash", "agnes-3.0-flash", "agnes-3.0-pro"]);
    expect(agnesRegistry.models.filter((row) => row.kind === "image").map(({ id, name }) => ({ id, name }))).toEqual(agnes.AGNES_IMAGE_MODELS.map(({ id, name }) => ({ id, name })));
    expect(agnesRegistry.models.filter((row) => row.kind === "video").map(({ id, name }) => ({ id, name }))).toEqual(agnes.AGNES_VIDEO_MODELS.map(({ id, name }) => ({ id, name })));
    // No passthrough edits endpoint and no async /v1/videos job proxy.
    expect(agnesRegistry.imageConfig).toBeUndefined();
    expect(getImageEditConfig(PROVIDER_MEDIA.agnes)).toBeNull();
    expect(agnesRegistry.videoConfig).toBeUndefined();

    expect(vertexRegistry).toMatchObject({ id: "vertex", alias: "vertex", aliases: ["vx"], transport: { baseUrl: "https://aiplatform.googleapis.com", format: "vertex" } });
    expect(vertexRegistry.serviceKinds).toEqual(["llm", "imageToText", "video", "tts", "stt", "music"]);
    expect(vertexRegistry.models.filter((row) => !row.kind).map((row) => row.id)).toEqual(["gemini-4-argon", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite-preview", "gemini-3-flash-preview", "gemini-2.5-flash"]);
    expect(vertexRegistry.ttsConfig).toMatchObject({ format: VERTEX_TTS_CONFIG.format, defaultModel: VERTEX_TTS_CONFIG.defaultModel, defaultVoice: "Kore", models: VERTEX_TTS_CONFIG.models.map(({ id, name }) => ({ id, name })) });
    expect(vertexRegistry.sttConfig).toMatchObject({ format: VERTEX_STT_CONFIG.format, models: VERTEX_STT_CONFIG.models.map(({ id, name }) => ({ id, name })) });
    expect(vertexRegistry.musicConfig).toMatchObject({ format: VERTEX_MUSIC_CONFIG.format });
    expect(vertexRegistry.models.filter((row) => row.kind === "music").map(({ id, name }) => ({ id, name }))).toEqual(VERTEX_MUSIC_CONFIG.models.map(({ id, name }) => ({ id, name })));
    expect(vertexRegistry.videoConfig).toBeUndefined();
  });

  it("advertises only the current Veo 3.1 models, with the adapter's own duration contract", () => {
    const listed = vertexRegistry.models.filter((row) => row.kind === "video").map((row) => row.id);
    expect(listed).toEqual(["veo-3.1-generate-001", "veo-3.1-fast-generate-001"]);
    for (const id of listed) expect(VERTEX_VIDEO_MODELS.find((model) => model.id === id).durations).toEqual([4, 6, 8]);
  });

  it("discovers Vertex voices from the Gemini prebuilt list without a network call", async () => {
    expect(VOICE_FETCHERS.vertex).toBeTypeOf("function");
    const [vertex, gemini] = await Promise.all([listTtsVoices("vertex"), listTtsVoices("gemini")]);
    expect(vertex).toEqual(gemini);
    expect(JSON.stringify(vertex)).toContain("Kore");
    expect(calls).toEqual([]);
  });

  it("reports transport support per endpoint", () => {
    expect(mediaTransportSupport("image", "agnes")).toBe("supported");
    expect(mediaEndpointSupport("video", "/v1/video/generations", "agnes").supported).toBe(true);
    expect(mediaEndpointSupport("video", "/v1/videos", "agnes")).toMatchObject({ supported: false, reason: expect.stringContaining("Use /v1/video/generations") });
    expect(mediaEndpointSupport("video", "/v1/video/generations", "vertex").supported).toBe(true);
    expect(mediaEndpointSupport("video", "/v1/videos", "vertex").supported).toBe(false);
    for (const kind of ["tts", "stt", "music"]) expect(mediaTransportSupport(kind, "vertex")).toBe("supported");
    expect(mediaEndpointSupport("stt", "/v1/audio/translations", "vertex").supported).toBe(false);
  });

  it.each([
    ["image", "agnes", ["agnes-image-2.0-flash", "agnes-image-2.1-flash", "agnes-image-2.5-flash"]],
    ["video", "agnes", ["agnes-video-v2.0", "agnes-video-2.5-flash", "agnes-video-2.5"]],
    ["video", "vx", ["veo-3.1-generate-001", "veo-3.1-fast-generate-001"]],
    ["tts", "vx", VERTEX_TTS_CONFIG.models.map((model) => model.id)],
    ["stt", "vx", ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"]],
    ["music", "vx", ["lyria-002"]],
  ])("actual typed listing /v1/models/%s shows the static %s rows", async (kind, owner, ids) => {
    // Agnes chat discovery may run for the saved connection; answer it with chat rows only.
    routes.push({ match: (url) => url === `${AGNES}/v1/models`, answer: () => json({ data: [{ id: "agnes-live-chat" }] }) });
    const response = await typedModels(new Request(`http://localhost/v1/models/${kind}`), { params: Promise.resolve({ model: [kind] }) });
    expect(response.status).toBe(200);
    const rows = (await response.json()).data.filter((row) => row.owned_by === owner);
    expect(rows.map((row) => row.id).sort()).toEqual(ids.map((id) => `${owner}/${id}`).sort());
    expect(rows.every((row) => row.kind === kind)).toBe(true);
    // Static discovery: no media list call reaches Agnes or Google.
    expect(calls.filter((call) => /agnes-ai|googleapis/.test(call.url) && call.url !== `${AGNES}/v1/models`)).toEqual([]);
  });
});

// ── Agnes image ───────────────────────────────────────────────────────────────
describe("POST /v1/images/generations agnes", () => {
  const IMAGE = "agnes/agnes-image-2.1-flash";
  const body = (extra = {}) => ({ model: IMAGE, prompt: "synthetic gate", size: "2K", ...extra });

  it("sends the selected key once to the fixed origin and records the returned image once", async () => {
    steps.push((url, init) => {
      expect(url).toBe(`${AGNES}/v1/images/generations`);
      expect(init.headers.Authorization).toBe(`Bearer ${AGNES_KEY_B}`);
      expect(bodyOf({ init })).toMatchObject({ model: "agnes-image-2.1-flash", prompt: "synthetic gate", size: "2K", extra_body: { response_format: "url" } });
      return json({ created: 7, data: [{ url: "https://platform-outputs.agnes-ai.space/out.png" }], usage: { total_tokens: 3 } });
    });
    const response = await jsonPost(images, body({ response_format: "url" }));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([{ url: "https://platform-outputs.agnes-ai.space/out.png" }]);
    expect(calls).toHaveLength(1);
    expectOnlySelected(AGNES_KEY_B);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: "agnes", model: "agnes-image-2.1-flash", connectionId: "agnes-b", nativeUnits: { images: 1 }, costStatus: "unknown" });
  });

  it.each([[401, "invalid_api_key", 401], [402, "insufficient_balance", 402], [429, "rate_limited", 429]])("refusal %s updates only the selected account and records nothing", async (status, code, expected) => {
    steps.push(() => leaky(status, code));
    const response = await jsonPost(images, body());
    expect(response.status).toBe(expected);
    await expectNoLeak(response);
    expect(calls).toHaveLength(1);
    expect(auth.markAccountUnavailable).toHaveBeenCalledTimes(1);
    expect(auth.markAccountUnavailable.mock.calls[0][0]).toBe("agnes-b");
    expect(usage()).toEqual([]);
    expect(m.writes.filter((row) => row.id === "agnes-a")).toEqual([]);
    expect(m.fallback.filter((row) => row.id === "agnes-a")).toEqual([]);
  });

  it("uncertain acceptance is recorded once and never replayed on another account", async () => {
    steps.push(() => leaky(500, "internal"));
    const response = await jsonPost(images, body());
    expect(response.status).toBe(502);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
    await expectNoLeak(response);
    expect(calls).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: "agnes", connectionId: "agnes-b", costSource: "accepted-job", status: "accepted" });
  });

  it("caller cancellation after the send stops the request and is recorded once as accepted", async () => {
    steps.push(hang);
    const { controller, response } = abortablePost(images, "/v1/images/generations", body());
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    controller.abort();
    const result = await response;
    expect(result.status).toBe(499);
    expect(calls).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ costSource: "accepted-job" });
  });

  it("the per-request deadline tears down the socket and keeps the job as accepted", async () => {
    steps.push(hang);
    const response = await jsonPost(images, body());
    expect(response.status).toBe(504);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
    expect(calls[0].init.signal.aborted).toBe(true);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ connectionId: "agnes-b", costSource: "accepted-job" });
  });

  it.each([
    ["no size", { size: undefined }],
    ["unsupported size", { size: "1024x1024" }],
    ["n > 1", { n: 2 }],
    ["binary output", { response_format: "b64" }],
    ["a mask", { mask: "https://example.com/m.png" }],
    ["a private input image", { image_url: "https://127.0.0.1/x.png" }],
  ])("refuses %s before any network call", async (_name, extra) => {
    const response = await jsonPost(images, body(extra));
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(usage()).toEqual([]);
  });

  it("refuses a chat model for image generation before credential selection", async () => {
    const response = await jsonPost(images, body({ model: "agnes/agnes-3.0-flash" }));
    expect(response.status).toBe(400);
    expect(m.credentials).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

// ── Agnes video ───────────────────────────────────────────────────────────────
describe("POST /v1/video/generations agnes", () => {
  const VIDEO = "agnes/agnes-video-2.5-flash";
  const TASK = "task_SYNTHETIC_0001";

  it("submits once with the selected key, polls the 2.5 status path and records one video", async () => {
    steps.push((url, init) => {
      expect(url).toBe(`${AGNES}/v1/videos`);
      expect(init.headers.Authorization).toBe(`Bearer ${AGNES_KEY_B}`);
      expect(bodyOf({ init })).toEqual({ model: "agnes-video-2.5-flash", prompt: "synthetic boat", seconds: "5" });
      return json({ id: TASK, status: "queued" });
    }, (url) => {
      expect(url).toBe(`${AGNES}/v1/videos/${TASK}`);
      return json({ id: TASK, status: "in_progress" });
    }, () => json({ id: TASK, status: "completed", metadata: { url: "https://platform-outputs.agnes-ai.space/v.mp4" } }));
    const response = await jsonPost(videos, { model: VIDEO, prompt: "synthetic boat", seconds: 5 });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([{ url: "https://platform-outputs.agnes-ai.space/v.mp4", format: "mp4" }]);
    expect(calls).toHaveLength(3);
    expectOnlySelected(AGNES_KEY_B);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: "agnes", connectionId: "agnes-b", modality: "video", nativeUnits: { videos: 1 }, costStatus: "unknown" });
  });

  it("V2.0 polls the agnesapi status path with the model name", async () => {
    steps.push(() => json({ video_id: TASK }), (url) => {
      expect(url).toBe(`${AGNES}/agnesapi?video_id=${TASK}&model_name=agnes-video-v2.0`);
      return json({ status: "success", url: "https://platform-outputs.agnes-ai.space/v2.mp4" });
    });
    const response = await jsonPost(videos, { model: "agnes/agnes-video-v2.0", prompt: "synthetic boat" });
    expect(response.status).toBe(200);
    expect(usage()).toHaveLength(1);
  });

  it.each([[401, 401], [402, 402], [429, 429]])("submit refusal %s updates only the selected account", async (status, expected) => {
    steps.push(() => leaky(status, status === 402 ? "insufficient_quota" : "refused"));
    const response = await jsonPost(videos, { model: VIDEO, prompt: "synthetic boat" });
    expect(response.status).toBe(expected);
    await expectNoLeak(response);
    expect(calls).toHaveLength(1);
    expect(auth.markAccountUnavailable.mock.calls.map((args) => args[0])).toEqual(["agnes-b"]);
    expect(usage()).toEqual([]);
  });

  it("an exhausted poll budget is a 504 recorded once as accepted, never resubmitted", async () => {
    steps.push(() => json({ id: TASK, status: "queued" }));
    routes.push({ match: (url) => url === `${AGNES}/v1/videos/${TASK}`, answer: () => json({ id: TASK, status: "in_progress" }) });
    const response = await jsonPost(videos, { model: VIDEO, prompt: "synthetic boat" });
    expect(response.status).toBe(504);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
    expect(calls.filter((call) => call.url === `${AGNES}/v1/videos`)).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ connectionId: "agnes-b", costSource: "accepted-job" });
  });

  it("caller cancellation during polling stops the loop and never resubmits", async () => {
    steps.push(() => json({ id: TASK, status: "queued" }), hang);
    const { controller, response } = abortablePost(videos, "/v1/video/generations", { model: VIDEO, prompt: "synthetic boat" });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    controller.abort();
    expect((await response).status).toBe(499);
    expect(calls).toHaveLength(2);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ costSource: "accepted-job" });
  });

  it.each([
    ["duration", { duration: 5 }],
    ["n > 1", { n: 2 }],
    ["stream", { stream: true }],
    ["b64_json", { response_format: "b64_json" }],
  ])("refuses %s before any network call", async (_name, extra) => {
    const response = await jsonPost(videos, { model: VIDEO, prompt: "synthetic boat", ...extra });
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(usage()).toEqual([]);
  });
});

// ── Vertex video ──────────────────────────────────────────────────────────────
describe("POST /v1/video/generations vertex", () => {
  const VEO = "veo-3.1-generate-001";

  it.each(["vx", "vertex"])("%s submits once with the selected project and token and returns the MP4 as b64_json", async (prefix) => {
    steps.push((url, init) => {
      expect(url).toBe(`${REGION}/${VEO}:predictLongRunning`);
      expect(init.headers.Authorization).toBe(`Bearer ${TOKEN_B}`);
      expect(bodyOf({ init })).toEqual({ instances: [{ prompt: "synthetic gate" }], parameters: { sampleCount: 1, aspectRatio: "9:16", durationSeconds: 6 } });
      return json({ name: OP });
    }, (url, init) => {
      expect(url).toBe(`${REGION}/${VEO}:fetchPredictOperation`);
      expect(bodyOf({ init })).toEqual({ operationName: OP });
      return json({ name: OP, done: false });
    }, () => json({ name: OP, done: true, response: { videos: [{ bytesBase64Encoded: MP4, mimeType: "video/mp4" }] } }));
    const response = await jsonPost(videos, { model: `${prefix}/${VEO}`, prompt: "synthetic gate", aspect_ratio: "9:16", duration: 6 });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([{ b64_json: MP4, format: "mp4" }]);
    expect(calls).toHaveLength(3);
    expectOnlySelected(TOKEN_B);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: "vertex", connectionId: "vertex-b", modality: "video", nativeUnits: { videos: 1 }, costStatus: "unknown" });
  });

  it("an Express key goes as ?key= to the project-less publisher endpoint", async () => {
    select("vertex", "vertex-x");
    steps.push((url, init) => {
      expect(url).toBe(`${EXPRESS}/veo-3.1-fast-generate-001:predictLongRunning?key=${EXPRESS_KEY}`);
      expect(init.headers.Authorization).toBeUndefined();
      return json({ name: FAST_OP });
    }, () => json({ name: FAST_OP, done: true, response: { videos: [{ bytesBase64Encoded: MP4, mimeType: "video/mp4" }] } }));
    const response = await jsonPost(videos, { model: "vx/veo-3.1-fast-generate-001", prompt: "synthetic gate" });
    expect(response.status).toBe(200);
    expectOnlySelected(EXPRESS_KEY);
    expect(usage()).toHaveLength(1);
  });

  it.each([[401, "UNAUTHENTICATED", 401], [403, "PERMISSION_DENIED", 403], [429, "RESOURCE_EXHAUSTED", 429]])("submit refusal %s updates only the selected account", async (status, code, expected) => {
    steps.push(() => leaky(status, code));
    const response = await jsonPost(videos, { model: `vx/${VEO}`, prompt: "synthetic gate" });
    expect(response.status).toBe(expected);
    await expectNoLeak(response);
    expect(calls).toHaveLength(1);
    expect(auth.markAccountUnavailable.mock.calls.map((args) => args[0])).toEqual(["vertex-b"]);
    expect(usage()).toEqual([]);
    expect(m.writes.filter((row) => row.id !== "vertex-b")).toEqual([]);
  });

  it("an operation past the job deadline is a 504 recorded once as accepted", async () => {
    steps.push(() => json({ name: OP }));
    routes.push({ match: (url) => url.endsWith(":fetchPredictOperation"), answer: () => { m.clock += 400_000; return json({ name: OP, done: false }); } });
    const response = await jsonPost(videos, { model: `vx/${VEO}`, prompt: "synthetic gate" });
    expect(response.status).toBe(504);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
    expect(calls.filter((call) => call.url.endsWith(":predictLongRunning"))).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ connectionId: "vertex-b", costSource: "accepted-job" });
  });

  it("caller cancellation while polling stops the loop without resubmitting", async () => {
    steps.push(() => json({ name: OP }), hang);
    const { controller, response } = abortablePost(videos, "/v1/video/generations", { model: `vx/${VEO}`, prompt: "synthetic gate" });
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    controller.abort();
    expect((await response).status).toBe(499);
    expect(calls).toHaveLength(2);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ costSource: "accepted-job" });
  });

  it.each([
    ["response_format url", { response_format: "url" }],
    ["an image input", { image: "https://example.com/a.png" }],
    ["n > 1", { n: 2 }],
    ["an unsupported duration", { duration: 5 }],
    ["an unsupported aspect ratio", { aspect_ratio: "1:1" }],
  ])("refuses %s before any network call", async (_name, extra) => {
    const response = await jsonPost(videos, { model: `vx/${VEO}`, prompt: "synthetic gate", ...extra });
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(usage()).toEqual([]);
  });

  it("refuses a Bearer connection without a project before any network call", async () => {
    m.rows.get("vertex-b").providerSpecificData = {};
    const response = await jsonPost(videos, { model: `vx/${VEO}`, prompt: "synthetic gate" });
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

// ── Vertex speech ─────────────────────────────────────────────────────────────
describe("POST /v1/audio/speech vertex", () => {
  const TTS = "gemini-2.5-flash-preview-tts";

  it("sends one generateContent call with the selected token and returns WAV audio", async () => {
    steps.push((url, init) => {
      expect(url).toBe(`${REGION}/${TTS}:generateContent`);
      expect(init.headers.Authorization).toBe(`Bearer ${TOKEN_B}`);
      expect(bodyOf({ init }).generationConfig).toMatchObject({ responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } } });
      return speechAnswer();
    });
    const response = await jsonPost(speech, { model: `vx/${TTS}`, input: "the forest gate", voice: "Puck" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/wav");
    const audio = Buffer.from(await response.arrayBuffer());
    expect(audio.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(calls).toHaveLength(1);
    expectOnlySelected(TOKEN_B);
    await vi.waitFor(() => expect(usage()).toHaveLength(1));
    expect(usage()[0]).toMatchObject({ provider: "vertex", model: TTS, connectionId: "vertex-b", modality: "tts", costStatus: "unknown" });
  });

  it("takes the voice from the model path", async () => {
    steps.push((_url, init) => {
      expect(bodyOf({ init }).generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Puck");
      return speechAnswer();
    });
    const response = await jsonPost(speech, { model: `vx/${TTS}/Puck`, input: "the forest gate" });
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(1);
  });

  it("returns JSON audio when the query names json", async () => {
    steps.push(() => speechAnswer());
    const response = await jsonPost(speech, { model: `vx/${TTS}`, input: "the forest gate" }, "?response_format=json");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ format: "wav", audio: expect.any(String) });
  });

  it.each([[401, "UNAUTHENTICATED", 401], [429, "RESOURCE_EXHAUSTED", 429]])("refusal %s updates only the selected account", async (status, code, expected) => {
    steps.push(() => leaky(status, code));
    const response = await jsonPost(speech, { model: `vx/${TTS}`, input: "the forest gate" });
    expect(response.status).toBe(expected);
    await expectNoLeak(response);
    expect(calls).toHaveLength(1);
    expect(auth.markAccountUnavailable.mock.calls.map((args) => args[0])).toEqual(["vertex-b"]);
    expect(usage()).toEqual([]);
  });

  it("inactive billing is a 402 that cools down only the selected account", async () => {
    steps.push(() => json({ error: { code: 403, status: "PERMISSION_DENIED", details: [{ reason: "BILLING_DISABLED" }] } }, 403));
    const response = await jsonPost(speech, { model: `vx/${TTS}`, input: "the forest gate" });
    expect(response.status).toBe(402);
    expect(m.fallback).toEqual([expect.objectContaining({ id: "vertex-b", status: 402 })]);
    expect(m.writes.filter((row) => row.id !== "vertex-b")).toEqual([]);
    // A refused (unbilled) call may move on to another account; here none is left.
    expect(calls).toHaveLength(1);
    expect(usage()).toEqual([]);
  });

  it("a 5xx is recorded once as accepted and not retried on another account", async () => {
    steps.push(() => leaky(500, "INTERNAL"));
    const response = await jsonPost(speech, { model: `vx/${TTS}`, input: "the forest gate" });
    expect(response.status).toBe(502);
    expect(calls).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ connectionId: "vertex-b", costSource: "accepted-job", modality: "tts" });
  });

  it("the request deadline is a 504 recorded once as accepted", async () => {
    steps.push(hang);
    const response = await jsonPost(speech, { model: `vx/${TTS}`, input: "the forest gate" });
    expect(response.status).toBe(504);
    expect(calls[0].init.signal.aborted).toBe(true);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ costSource: "accepted-job" });
  });

  it("caller cancellation after the send is recorded once and stops", async () => {
    steps.push(hang);
    const { controller, response } = abortablePost(speech, "/v1/audio/speech", { model: `vx/${TTS}`, input: "the forest gate" });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    controller.abort();
    expect((await response).status).toBe(499);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ costSource: "accepted-job" });
  });

  it.each([
    ["an explicit mp3", { response_format: "mp3" }],
    ["streaming", { stream: true }],
    ["an unknown voice", { voice: "alloy" }],
    ["a language", { language: "en" }],
  ])("refuses %s before any network call", async (_name, extra) => {
    const response = await jsonPost(speech, { model: `vx/${TTS}`, input: "the forest gate", ...extra });
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(usage()).toEqual([]);
  });
});

// ── Vertex transcription ──────────────────────────────────────────────────────
describe("POST /v1/audio/transcriptions vertex", () => {
  const STT = "gemini-2.5-flash";

  it("sends the audio once with the selected token and records provider tokens once", async () => {
    steps.push((url, init) => {
      expect(url).toBe(`${REGION}/${STT}:generateContent`);
      expect(init.headers.Authorization).toBe(`Bearer ${TOKEN_B}`);
      expect(bodyOf({ init }).contents[0].parts[1].inlineData.mimeType).toBe("audio/wav");
      return transcriptAnswer();
    });
    const response = await sttPost({ model: `vx/${STT}` });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "the forest gate opens" });
    expect(calls).toHaveLength(1);
    expectOnlySelected(TOKEN_B);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: "vertex", model: STT, connectionId: "vertex-b", modality: "stt", costStatus: "unknown" });
  });

  it.each([[401, "UNAUTHENTICATED", 401], [429, "RESOURCE_EXHAUSTED", 429]])("refusal %s updates only the selected account", async (status, code, expected) => {
    steps.push(() => leaky(status, code));
    const response = await sttPost({ model: `vx/${STT}` });
    expect(response.status).toBe(expected);
    await expectNoLeak(response);
    expect(calls).toHaveLength(1);
    expect(auth.markAccountUnavailable.mock.calls.map((args) => args[0])).toEqual(["vertex-b"]);
    expect(usage()).toEqual([]);
  });

  it("an unusable answer is recorded once as accepted and the audio is not sent to another account", async () => {
    steps.push(() => json({ candidates: [{ finishReason: "SAFETY" }], usageMetadata: { promptTokenCount: 300 } }));
    const response = await sttPost({ model: `vx/${STT}` });
    expect(response.status).toBe(502);
    expect(calls).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ connectionId: "vertex-b", costSource: "accepted-job", modality: "stt", status: "accepted" });
  });

  it("the request deadline is a 504 recorded once as accepted", async () => {
    steps.push(hang);
    const response = await sttPost({ model: `vx/${STT}` });
    expect(response.status).toBe(504);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
  });

  it("caller cancellation after the send is recorded once and not retried", async () => {
    steps.push(hang);
    const controller = new AbortController();
    const pending = sttPost({ model: `vx/${STT}` }, undefined, controller.signal);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    controller.abort();
    const response = await pending;
    expect(response.status).toBe(499);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ costSource: "accepted-job" });
  });

  it.each([
    ["a non-audio file", {}, new File([Buffer.from("x")], "notes.txt", { type: "text/plain" })],
    ["an unsupported response format", { response_format: "verbose_json" }, undefined],
  ])("refuses %s before any network call", async (_name, fields, file) => {
    const response = await sttPost({ model: `vx/${STT}`, ...fields }, file);
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(usage()).toEqual([]);
  });
});

// ── Vertex music ──────────────────────────────────────────────────────────────
describe("POST /v1/music/generations vertex", () => {
  it("predicts once with the selected token and returns WAV clips as b64_json", async () => {
    const clip = wav(2);
    steps.push((url, init) => {
      expect(url).toBe(`${REGION}/lyria-002:predict`);
      expect(init.headers.Authorization).toBe(`Bearer ${TOKEN_B}`);
      expect(bodyOf({ init })).toEqual({ instances: [{ prompt: "synthetic forest drums", negative_prompt: "vocals" }], parameters: {} });
      return json({ predictions: [{ bytesBase64Encoded: clip, mimeType: "audio/wav" }] });
    });
    const response = await jsonPost(music, { model: "vx/lyria-002", prompt: "synthetic forest drums", negative_prompt: "vocals" });
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ object: "music.generation", provider: "vertex", model: "lyria-002", status: "completed" });
    expect(payload.data).toEqual([{ b64_json: clip, format: "wav", mime_type: "audio/wav", duration_seconds: 2 }]);
    expect(calls).toHaveLength(1);
    expectOnlySelected(TOKEN_B);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: "vertex", connectionId: "vertex-b", modality: "music", nativeUnits: { audioSeconds: 2 } });
  });

  it.each([[401, "UNAUTHENTICATED"], [429, "RESOURCE_EXHAUSTED"]])("refusal %s updates only the selected account", async (status, code) => {
    steps.push(() => leaky(status, code));
    const response = await jsonPost(music, { model: "vx/lyria-002", prompt: "synthetic forest drums" });
    expect(response.status).toBe(status);
    await expectNoLeak(response);
    expect(calls).toHaveLength(1);
    expect(auth.markAccountUnavailable.mock.calls.map((args) => args[0])).toEqual(["vertex-b"]);
    expect(usage()).toEqual([]);
  });

  it("an uncertain 5xx is recorded once as accepted and never sent to another account", async () => {
    steps.push(() => leaky(500, "INTERNAL"));
    const response = await jsonPost(music, { model: "vx/lyria-002", prompt: "synthetic forest drums" });
    expect(response.status).toBe(502);
    await expectNoLeak(response);
    expect(calls).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: "vertex", connectionId: "vertex-b", modality: "music", costSource: "accepted-job", status: "accepted" });
  });

  it("the total deadline is a 504 recorded once as accepted", async () => {
    steps.push(hang);
    const response = await jsonPost(music, { model: "vx/lyria-002", prompt: "synthetic forest drums" });
    expect(response.status).toBe(504);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ costSource: "accepted-job" });
  });

  it("caller cancellation after the send is recorded once and stops", async () => {
    steps.push(hang);
    const { controller, response } = abortablePost(music, "/v1/music/generations", { model: "vx/lyria-002", prompt: "synthetic forest drums" });
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    controller.abort();
    expect((await response).status).toBe(499);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ costSource: "accepted-job" });
  });

  it.each([
    ["mp3 output", { output_format: "mp3" }],
    ["lyrics", { lyrics: "la la" }],
    ["a duration", { duration: 30 }],
    ["vocals", { instrumental: false }],
  ])("refuses %s before any network call", async (_name, extra) => {
    const response = await jsonPost(music, { model: "vx/lyria-002", prompt: "synthetic forest drums", ...extra });
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(usage()).toEqual([]);
  });
});
