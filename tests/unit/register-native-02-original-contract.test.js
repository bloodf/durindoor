// Native provider registration batch 2: fal.ai video and ACE-Step music on the
// existing `fal-ai` connection (alias fal), and KIE.AI image and video on the
// existing `kie` connection. Google Flow (googleflow / flow) stays
// unregistered: the pinned source marks it unsupported and answers 501 before
// any network call, so no route, catalog row or credential lookup exists.
//
// Public routes, the real cores, registries and staged adapters run against one
// closed fetch. Account selection and usage storage are synthetic; the account
// health writer is real. Every key is synthetic, and an unexpected request
// fails the test. Passing proves the gateway contract only, not live provider
// acceptance.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "register-native-02-original-contract-data-"));
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

// The real factories with the fake clock and the default per-request deadlines. The
// registered dispatchers import exactly these instances.
vi.mock("../../open-sse/services/providerParity/native-fal-ai-video/adapter.js", async (original) => {
  const actual = await original();
  return { ...actual, default: actual.createFalVideoAdapter({ wait: (ms, signal) => m.wait(ms, signal), now: () => m.clock, pollIntervalMs: 1_000, timeoutMs: 10_000 }) };
});
vi.mock("../../open-sse/services/providerParity/native-fal-ai-music/adapter.js", async (original) => {
  const actual = await original();
  return { ...actual, default: actual.createFalMusicAdapter({ wait: (ms, signal) => m.wait(ms, signal), now: () => m.clock, pollIntervalMs: 1_000, timeoutMs: 10_000 }) };
});
vi.mock("../../open-sse/services/providerParity/native-kie-video-image/index.js", async (original) => {
  const actual = await original();
  const options = { wait: (ms, signal) => m.wait(ms, signal), now: () => m.clock, pollIntervalMs: 1_000, timeoutMs: 10_000 };
  return { ...actual, kieImageAdapter: actual.createKieImageAdapter(options), kieVideoAdapter: actual.createKieVideoAdapter(options) };
});

import { POST as images } from "../../src/app/api/v1/images/generations/route.js";
import { POST as videos } from "../../src/app/api/v1/video/generations/route.js";
import { POST as music } from "../../src/app/api/v1/music/generations/route.js";
import { GET as typedModels } from "../../src/app/api/v1/models/[...model]/route.js";
import { clearLiveModelLimitsCache } from "../../open-sse/services/liveModelLimits.js";
import { ACCEPTED_JOB_HEADER } from "../../open-sse/services/combo.js";
import { mediaEndpointSupport, mediaTransportSupport } from "../../src/sse/services/mediaTransport.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { MUSIC_ADAPTERS } from "../../open-sse/handlers/musicGenerationCore.js";
import { getImageEditConfig } from "../../open-sse/handlers/imageEditCore.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import falRegistry from "../../open-sse/providers/registry/fal-ai.js";
import kieRegistry from "../../open-sse/providers/registry/kie.js";
import falImageAdapter from "../../open-sse/handlers/imageProviders/falAi.js";
import falVideoAdapter from "../../open-sse/services/providerParity/native-fal-ai-video/adapter.js";
import { FAL_VIDEO_MODELS } from "../../open-sse/services/providerParity/native-fal-ai-video/config.js";
import { FAL_MUSIC_MODELS, FAL_MUSIC_PROVIDER_METADATA } from "../../open-sse/services/providerParity/native-fal-ai-music/config.js";
import * as kie from "../../open-sse/services/providerParity/native-kie-video-image/index.js";
import * as auth from "../../src/sse/services/auth.js";

// ── Synthetic accounts ────────────────────────────────────────────────────────
const QUEUE = "https://queue.fal.run";
const KIE = "https://api.kie.ai";
const FAL_KEY_A = "fal-SYNTHETIC-unselected-a:0001";
const FAL_KEY_B = "fal-SYNTHETIC-selected-b:0002";
const KIE_KEY_A = "kie-SYNTHETIC-unselected-a";
const KIE_KEY_B = "kie-SYNTHETIC-selected-b";
const SECRETS = [FAL_KEY_A, FAL_KEY_B, KIE_KEY_A, KIE_KEY_B];

const ROWS = [
  { id: "fal-a", provider: "fal-ai", apiKey: FAL_KEY_A, providerSpecificData: {} },
  // A stored base URL must never redirect the key.
  { id: "fal-b", provider: "fal-ai", apiKey: FAL_KEY_B, providerSpecificData: { baseUrl: "https://attacker.example/v1" } },
  { id: "kie-a", provider: "kie", apiKey: KIE_KEY_A, providerSpecificData: {} },
  { id: "kie-b", provider: "kie", apiKey: KIE_KEY_B, providerSpecificData: { baseUrl: "https://attacker.example/v1" } },
];

// ── Fixtures ──────────────────────────────────────────────────────────────────
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const leaky = (status, headers = {}) => json({ detail: `upstream echo ${FAL_KEY_B} ${KIE_KEY_B}` }, status, headers);
const kieEnvelope = (code) => json({ code, msg: `upstream echo ${KIE_KEY_B}` });
const REQ = "4b0e1a5c-77d2-4f3c-9a51-0c2d6e8f1a2b";
const VEO_SUBMIT = `${QUEUE}/fal-ai/veo3.1/lite`;
const VEO_STATUS = `${QUEUE}/fal-ai/veo3.1/requests/${REQ}/status`;
const VEO_RESULT = `${QUEUE}/fal-ai/veo3.1/requests/${REQ}`;
const ACE_SUBMIT = `${QUEUE}/fal-ai/ace-step`;
const ACE_STATUS = `${ACE_SUBMIT}/requests/${REQ}/status`;
const ACE_RESULT = `${ACE_SUBMIT}/requests/${REQ}`;
const FAL_VIDEO = "https://v3.fal.media/files/synthetic/out.mp4";
const FAL_AUDIO = "https://v3.fal.media/files/synthetic/out.wav";
const KIE_CREATE = `${KIE}/api/v1/jobs/createTask`;
const KIE_RECORD = `${KIE}/api/v1/jobs/recordInfo`;
const KIE_VIDEO = "https://tempfile.aiquickdraw.com/v/video-a.mp4";
const KIE_IMAGE = "https://tempfile.aiquickdraw.com/i/image-a.png";
const kieCreated = (taskId = "task-1") => json({ code: 200, msg: "success", data: { taskId } });
const kieDone = (urls, taskId = "task-1") => json({ code: 200, msg: "success", data: { taskId, state: "success", resultJson: JSON.stringify({ resultUrls: urls }) } });
const kieRunning = (taskId = "task-1") => json({ code: 200, msg: "success", data: { taskId, state: "generating" } });

// ── Closed network ────────────────────────────────────────────────────────────
let calls;
let steps;
let routes;
const usage = () => m.save.mock.calls.map(([row]) => row);
const bodyOf = (call) => JSON.parse(call.init.body);
// A request that never answers until the fetch signal fires.
const hang = (_url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason ?? Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true }));
const posts = () => calls.filter((call) => call.init.method === "POST");

function select(provider, id) {
  m.selected[provider] = id;
}
async function expectNoLeak(response) {
  const text = await response.clone().text();
  for (const secret of SECRETS) expect(text).not.toContain(secret);
  expect(text).not.toContain("upstream echo");
}
// Only the selected account's credential ever leaves the gateway, and only to the fixed origins.
function expectOnlySelected(secret, origins) {
  for (const call of calls) {
    expect(origins.some((origin) => call.url.startsWith(`${origin}/`))).toBe(true);
    const wire = `${call.url} ${JSON.stringify(call.init?.headers ?? {})} ${typeof call.init?.body === "string" ? call.init.body : ""}`;
    for (const other of SECRETS.filter((value) => value !== secret)) expect(wire).not.toContain(other);
    expect(wire).toContain(secret);
    expect(wire).not.toContain("attacker.example");
  }
}
const PATHS = new Map();
const jsonPost = (route, body) => route(new Request(`http://localhost${PATHS.get(route)}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}));
function abortablePost(route, body) {
  const controller = new AbortController();
  const request = new Request(`http://localhost${PATHS.get(route)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
  return { controller, response: route(request) };
}
PATHS.set(images, "/v1/images/generations").set(videos, "/v1/video/generations").set(music, "/v1/music/generations");

beforeEach(() => {
  vi.clearAllMocks();
  clearLiveModelLimitsCache();
  m.rows.clear(); m.fallback.length = 0; m.writes.length = 0; m.selected = {}; m.clock = 1_000_000;
  m.dir = fs.mkdtempSync(path.join(os.tmpdir(), "register-native-02-"));
  process.env.DATA_DIR = m.dir;
  for (const row of ROWS) m.rows.set(row.id, { ...row, authType: "apikey", isActive: true, providerSpecificData: { ...row.providerSpecificData } });
  select("fal-ai", "fal-b");
  select("kie", "kie-b");
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
afterEach(() => { vi.unstubAllGlobals(); fs.rmSync(m.dir, { recursive: true, force: true }); });
afterAll(async () => {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  // The driver keeps its handle on globalThis, which outlives this file in a
  // reused fork worker; close it only when it points at our private storage.
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

// ── Registration identity, catalog and discovery ──────────────────────────────
describe("registration identity", () => {
  it("registers the canonical adapters on the existing providers and aliases", () => {
    expect(getVideoGenerationAdapter("fal-ai")).toBe(falVideoAdapter);
    expect(getVideoGenerationAdapter("fal")).toBe(falVideoAdapter);
    expect(getImageAdapter("fal-ai")).toBe(falImageAdapter);
    expect(getImageAdapter("kie")).toBe(kie.kieImageAdapter);
    expect(getVideoGenerationAdapter("kie")).toBe(kie.kieVideoAdapter);
    // ACE-Step is dispatched ahead of the cookie music adapters, not through them.
    expect(Object.keys(MUSIC_ADAPTERS)).toEqual(["suno", "udio"]);
  });

  it("keeps Google Flow unregistered: no adapter, provider, alias or catalog row", () => {
    for (const id of ["googleflow", "flow"]) {
      expect(getVideoGenerationAdapter(id)).toBeNull();
      expect(PROVIDER_MEDIA[id]).toBeUndefined();
      expect(mediaTransportSupport("video", id)).not.toBe("supported");
    }
    expect(REGISTRY.find((entry) => entry.id === "googleflow" || entry.alias === "flow" || entry.aliases?.includes("flow"))).toBeUndefined();
  });

  it("keeps fal-ai auth, image config and image models, and adds typed video and music rows", () => {
    expect(falRegistry).toMatchObject({ id: "fal-ai", alias: "fal-ai", aliases: ["fal"], authType: "apikey", transport: null, serviceKinds: ["image", "video", "music"] });
    expect(falRegistry.imageConfig).toEqual({ baseUrl: QUEUE });
    expect(falRegistry.models.filter((row) => row.kind === "image").map((row) => row.id)).toEqual([
      "fal-ai/flux/schnell", "fal-ai/flux/dev", "fal-ai/flux-pro/v1.1", "fal-ai/flux-pro/v1.1-ultra", "fal-ai/recraft-v3", "fal-ai/ideogram/v2", "fal-ai/stable-diffusion-v35-large",
    ]);
    expect(falRegistry.models.filter((row) => row.kind === "video").map(({ id, name }) => ({ id, name }))).toEqual(FAL_VIDEO_MODELS.map(({ id, name }) => ({ id, name })));
    expect(falRegistry.models.filter((row) => row.kind === "music").map(({ id, name }) => ({ id, name }))).toEqual(FAL_MUSIC_MODELS.map(({ id, name }) => ({ id, name })));
    // Architecture change since 800ccf5d5b: the registered row carries the staged
    // contract's musicConfig { baseUrl } (registration.json) without a `format`
    // field. No runtime code reads musicConfig.format; the music core dispatches
    // fal-ai and fal to ACE-Step by provider id (asserted by the public music
    // route cases below). The source format name stays on the staged metadata.
    expect(falRegistry.musicConfig).toEqual({ baseUrl: QUEUE });
    expect(falRegistry.musicConfig).toEqual(FAL_MUSIC_PROVIDER_METADATA.musicConfig);
    expect(FAL_MUSIC_PROVIDER_METADATA.format).toBe("fal-ai-music");
    // No async /v1/videos job proxy: video runs on /v1/video/generations only.
    expect(falRegistry.videoConfig).toBeUndefined();
  });

  it("keeps kie auth, chat transport and chat models, and lists only the servable media rows", () => {
    expect(kieRegistry).toMatchObject({ id: "kie", alias: "kie", authType: "apikey", serviceKinds: ["llm", "image", "video"] });
    expect(kieRegistry.transport).toEqual({ baseUrl: `${KIE}/v1/chat/completions`, validateUrl: `${KIE}/v1/models`, authHeader: "bearer" });
    expect(kieRegistry.models.filter((row) => !row.kind).map((row) => row.id)).toEqual([
      "claude-opus-4-8", "claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5", "gpt-5-5", "gpt-5-4", "gpt-5-2",
      "gemini-3-1-pro", "gemini-2-5-pro", "gemini-3-flash", "gemini-3-5-flash",
    ]);
    expect(kieRegistry.models.filter((row) => row.kind === "image").map(({ id, name }) => ({ id, name }))).toEqual(kie.KIE_IMAGE_MODELS.map(({ id, name }) => ({ id, name })));
    const video = kieRegistry.models.filter((row) => row.kind === "video").map((row) => row.id);
    expect(video).toEqual(kie.KIE_VIDEO_MODELS.map((row) => row.id).filter((id) => !kie.KIE_VIDEO_UNSUPPORTED_MODELS.includes(id)));
    expect(video).toHaveLength(10);
    // No passthrough edits endpoint and no async /v1/videos job proxy.
    expect(kieRegistry.imageConfig).toBeUndefined();
    expect(getImageEditConfig(PROVIDER_MEDIA.kie)).toBeNull();
    expect(kieRegistry.videoConfig).toBeUndefined();
  });

  it("reports transport support per endpoint", () => {
    for (const id of ["fal-ai", "kie"]) {
      expect(mediaTransportSupport("image", id)).toBe("supported");
      expect(mediaEndpointSupport("video", "/v1/video/generations", id).supported).toBe(true);
      expect(mediaEndpointSupport("video", "/v1/videos", id)).toMatchObject({ supported: false, reason: expect.stringContaining("Use /v1/video/generations") });
    }
    expect(mediaTransportSupport("music", "fal-ai")).toBe("supported");
    expect(mediaTransportSupport("music", "kie")).not.toBe("supported");
  });

  it.each([
    ["video", "fal", FAL_VIDEO_MODELS.map((row) => row.id)],
    ["music", "fal", ["ace-step"]],
    ["image", "kie", kie.KIE_IMAGE_MODELS.map((row) => row.id)],
    ["video", "kie", kie.KIE_VIDEO_MODELS.map((row) => row.id).filter((id) => !kie.KIE_VIDEO_UNSUPPORTED_MODELS.includes(id))],
  ])("actual typed listing /v1/models/%s shows the static %s rows", async (kind, owner, ids) => {
    // kie chat discovery may run for the saved connection; answer it with chat rows only.
    routes.push({ match: (url) => url === `${KIE}/v1/models`, answer: () => json({ data: [{ id: "kie-live-chat" }] }) });
    const response = await typedModels(new Request(`http://localhost/v1/models/${kind}`), { params: Promise.resolve({ model: [kind] }) });
    expect(response.status).toBe(200);
    const rows = (await response.json()).data.filter((row) => row.owned_by === owner);
    expect(rows.map((row) => row.id).sort()).toEqual(ids.map((id) => `${owner}/${id}`).sort());
    expect(rows.every((row) => row.kind === kind)).toBe(true);
    // Static discovery: no media list call reaches fal or KIE.
    expect(calls.filter((call) => /fal\.(ai|run)|kie\.ai/.test(call.url) && call.url !== `${KIE}/v1/models`)).toEqual([]);
  });
});

// ── fal.ai video ──────────────────────────────────────────────────────────────
describe("POST /v1/video/generations fal-ai", () => {
  const body = (extra = {}) => ({ model: "fal/veo3.1/lite", prompt: "synthetic lantern", ...extra });
  const queued = () => json({ request_id: REQ, status_url: VEO_STATUS, response_url: VEO_RESULT });

  it.each(["fal", "fal-ai"])("%s submits once with the selected key, polls the pinned queue URLs and records one video", async (prefix) => {
    steps.push((url, init) => {
      expect(url).toBe(VEO_SUBMIT);
      expect(init.headers.Authorization).toBe(`Key ${FAL_KEY_B}`);
      expect(bodyOf({ init })).toEqual({ prompt: "synthetic lantern", aspect_ratio: "9:16", duration: "6s", resolution: "720p", generate_audio: true });
      return queued();
    }, (url) => {
      expect(url).toBe(VEO_STATUS);
      return json({ status: "IN_PROGRESS" }, 202);
    }, () => json({ status: "COMPLETED" }), (url) => {
      expect(url).toBe(VEO_RESULT);
      return json({ video: { url: FAL_VIDEO, content_type: "video/mp4" } });
    });
    const response = await jsonPost(videos, body({ model: `${prefix}/veo3.1/lite`, aspect_ratio: "9:16", duration: 6 }));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([{ url: FAL_VIDEO, format: "mp4" }]);
    expect(calls).toHaveLength(4);
    expect(posts()).toHaveLength(1);
    expectOnlySelected(FAL_KEY_B, [QUEUE]);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: "fal-ai", model: "veo3.1/lite", connectionId: "fal-b", modality: "video", nativeUnits: { videos: 1 }, costStatus: "unknown" });
  });

  it("discovers a schema for another fal video endpoint with the same key before submitting", async () => {
    const KLING = "fal-ai/kling-video/v2.1/pro/text-to-video";
    const definition = {
      endpoint_id: KLING,
      metadata: { category: "text-to-video" },
      openapi: {
        openapi: "3.0.4",
        paths: {
          [`/${KLING}`]: { post: { requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Input" } } } } } },
          [`/${KLING}/requests/{request_id}/status`]: { get: {} },
          [`/${KLING}/requests/{request_id}`]: { get: {} },
        },
        components: { schemas: { Input: { type: "object", required: ["prompt"], properties: { prompt: { type: "string" }, duration: { type: "string", enum: ["5", "10"] } } } } },
      },
    };
    steps.push((url, init) => {
      expect(url).toBe(`https://api.fal.ai/v1/models?endpoint_id=${encodeURIComponent(KLING)}&expand=openapi-3.0`);
      expect(init.headers.Authorization).toBe(`Key ${FAL_KEY_B}`);
      return json({ models: [definition], has_more: false });
    }, (url, init) => {
      expect(url).toBe(`${QUEUE}/${KLING}`);
      expect(bodyOf({ init })).toEqual({ prompt: "synthetic lantern", duration: "5" });
      return json({ video: { url: FAL_VIDEO } });
    });
    const response = await jsonPost(videos, body({ model: `fal/${KLING}`, fal_input: { duration: "5" } }));
    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
    expectOnlySelected(FAL_KEY_B, [QUEUE, "https://api.fal.ai"]);
    expect(usage()).toHaveLength(1);
  });

  it("an exhausted balance is a quota refusal on the selected account only, with nothing recorded", async () => {
    steps.push(() => json({ detail: `User is locked. Reason: Exhausted balance. ${FAL_KEY_B}` }, 403));
    const response = await jsonPost(videos, body());
    expect(response.status).toBe(402);
    await expectNoLeak(response);
    expect(calls).toHaveLength(1);
    expect(auth.markAccountUnavailable.mock.calls.map((args) => args[0])).toEqual(["fal-b"]);
    expect(usage()).toEqual([]);
    expect(m.writes.filter((row) => row.id === "fal-a")).toEqual([]);
  });

  it.each([[401, 401], [429, 429]])("submit refusal %s updates only the selected account and records nothing", async (status, expected) => {
    steps.push(() => leaky(status));
    const response = await jsonPost(videos, body());
    expect(response.status).toBe(expected);
    await expectNoLeak(response);
    expect(calls).toHaveLength(1);
    expect(auth.markAccountUnavailable.mock.calls.map((args) => args[0])).toEqual(["fal-b"]);
    expect(usage()).toEqual([]);
  });

  it("an uncertain 5xx submit is recorded once as accepted and never replayed on another account", async () => {
    steps.push(() => leaky(500));
    const response = await jsonPost(videos, body());
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
    await expectNoLeak(response);
    expect(posts()).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: "fal-ai", connectionId: "fal-b", modality: "video", costSource: "accepted-job", status: "accepted" });
  });

  it("an exhausted job deadline is a 504 recorded once as accepted, never resubmitted", async () => {
    steps.push(() => queued());
    routes.push({ match: (url) => url === VEO_STATUS, answer: () => json({ status: "IN_QUEUE" }, 202) });
    const response = await jsonPost(videos, body());
    expect(response.status).toBe(504);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
    expect(posts()).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ connectionId: "fal-b", costSource: "accepted-job" });
  });

  it("caller cancellation while polling stops the loop and is recorded once as accepted", async () => {
    steps.push(() => queued(), hang);
    const { controller, response } = abortablePost(videos, body());
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    controller.abort();
    expect((await response).status).toBe(499);
    expect(posts()).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ costSource: "accepted-job" });
  });

  it.each([
    ["n > 1", { n: 2 }],
    ["stream", { stream: true }],
    ["b64_json", { response_format: "b64_json" }],
    ["an image for Veo 3.1 Lite", { image_url: "https://example.com/a.png" }],
    ["an out-of-range duration", { duration: 5 }],
    ["a private image URL", { model: "fal/google/gemini-omni-flash", image_url: "https://127.0.0.1/a.png" }],
  ])("refuses %s before any network call", async (_name, extra) => {
    const response = await jsonPost(videos, body(extra));
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(usage()).toEqual([]);
  });

  it("refuses an image model for video generation before credential selection", async () => {
    const response = await jsonPost(videos, body({ model: "fal/fal-ai/flux/dev" }));
    expect(response.status).toBe(400);
    expect(m.credentials).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

// ── fal.ai music ──────────────────────────────────────────────────────────────
describe("POST /v1/music/generations fal-ai", () => {
  const body = (extra = {}) => ({ model: "fal/ace-step", prompt: "synthetic forest drums", ...extra });
  const accepted = () => json({ request_id: REQ, status_url: ACE_STATUS, response_url: ACE_RESULT });

  it.each([
    ["fal/ace-step", "ace-step"],
    ["fal-ai/ace-step", "ace-step"],
    ["fal/fal-ai/ace-step", "fal-ai/ace-step"],
  ])("%s submits once with the selected key and returns the track URL", async (model, recorded) => {
    steps.push((url, init) => {
      expect(url).toBe(ACE_SUBMIT);
      expect(init.headers.Authorization).toBe(`Key ${FAL_KEY_B}`);
      expect(bodyOf({ init })).toEqual({ tags: "synthetic forest drums", duration: 30 });
      return accepted();
    }, (url) => {
      expect(url).toBe(ACE_STATUS);
      return json({ status: "COMPLETED", request_id: REQ });
    }, (url) => {
      expect(url).toBe(ACE_RESULT);
      return json({ audio: { url: FAL_AUDIO, content_type: "audio/wav" }, seed: 4 });
    });
    const response = await jsonPost(music, body({ model, duration: 30 }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ object: "music.generation", provider: "fal-ai", model: "ace-step", status: "completed" });
    expect(payload.data).toEqual([expect.objectContaining({ id: REQ, url: FAL_AUDIO, audio_url: FAL_AUDIO, format: "wav" })]);
    expect(calls).toHaveLength(3);
    expect(posts()).toHaveLength(1);
    expectOnlySelected(FAL_KEY_B, [QUEUE]);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: "fal-ai", model: recorded, connectionId: "fal-b", modality: "music", nativeUnits: { tracks: 1 }, costStatus: "unknown" });
  });

  it.each([[401, 401], [429, 429]])("submit refusal %s updates only the selected account and records nothing", async (status, expected) => {
    steps.push(() => leaky(status));
    const response = await jsonPost(music, body());
    expect(response.status).toBe(expected);
    await expectNoLeak(response);
    expect(calls).toHaveLength(1);
    expect(auth.markAccountUnavailable.mock.calls.map((args) => args[0])).toEqual(["fal-b"]);
    expect(usage()).toEqual([]);
  });

  it("an exhausted balance is a quota refusal on the selected account only", async () => {
    steps.push(() => json({ detail: `User is locked. Reason: Exhausted balance. ${FAL_KEY_B}` }, 403));
    const response = await jsonPost(music, body());
    expect(response.status).toBe(402);
    await expectNoLeak(response);
    expect(auth.markAccountUnavailable.mock.calls.map((args) => args[0])).toEqual(["fal-b"]);
    expect(usage()).toEqual([]);
  });

  it("an uncertain 5xx submit is recorded once as accepted and never sent to another account", async () => {
    steps.push(() => leaky(500));
    const response = await jsonPost(music, body());
    expect(response.status).toBeGreaterThanOrEqual(500);
    await expectNoLeak(response);
    expect(posts()).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: "fal-ai", connectionId: "fal-b", modality: "music", costSource: "accepted-job", status: "accepted" });
  });

  it("an exhausted job deadline is a 504 recorded once as accepted", async () => {
    steps.push(() => accepted());
    routes.push({ match: (url) => url === ACE_STATUS, answer: () => json({ status: "IN_QUEUE", request_id: REQ }, 202) });
    const response = await jsonPost(music, body());
    expect(response.status).toBe(504);
    expect(posts()).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ costSource: "accepted-job" });
  });

  it("caller cancellation while polling is recorded once and stops", async () => {
    steps.push(() => accepted(), hang);
    const { controller, response } = abortablePost(music, body());
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    controller.abort();
    expect((await response).status).toBe(499);
    expect(posts()).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ costSource: "accepted-job" });
  });

  it.each([
    ["n > 1", { n: 2 }],
    ["stream", { stream: true }],
    ["b64_json", { response_format: "b64_json" }],
    ["an out-of-range duration", { duration: 600 }],
    ["an unknown scheduler", { scheduler: "dpm" }],
    ["instrumental", { instrumental: true }],
    ["an audio input", { audio_url: "https://example.com/a.wav" }],
  ])("refuses %s before any network call", async (_name, extra) => {
    const response = await jsonPost(music, body(extra));
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(usage()).toEqual([]);
  });

  it("refuses another fal endpoint for music before any network call", async () => {
    const response = await jsonPost(music, body({ model: "fal/fal-ai/flux/dev" }));
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

// ── KIE.AI image ──────────────────────────────────────────────────────────────
describe("POST /v1/images/generations kie", () => {
  const body = (extra = {}) => ({ model: "kie/google-imagen/nano-banana-2", prompt: "synthetic gate", ...extra });

  it("creates one Market task with the selected key, polls recordInfo and records the image once", async () => {
    steps.push((url, init) => {
      expect(url).toBe(KIE_CREATE);
      expect(init.headers.Authorization).toBe(`Bearer ${KIE_KEY_B}`);
      expect(bodyOf({ init })).toMatchObject({ model: "nano-banana-2", input: expect.objectContaining({ prompt: "synthetic gate" }) });
      return kieCreated("img-1");
    }, (url) => {
      expect(url).toBe(`${KIE_RECORD}?taskId=img-1`);
      return kieRunning("img-1");
    }, () => kieDone([KIE_IMAGE], "img-1"));
    const response = await jsonPost(images, body({ size: "16:9" }));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([{ url: KIE_IMAGE }]);
    expect(calls).toHaveLength(3);
    expectOnlySelected(KIE_KEY_B, [KIE]);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: "kie", model: "google-imagen/nano-banana-2", connectionId: "kie-b", nativeUnits: { images: 1 }, costStatus: "unknown" });
  });

  it("routes Flux Kontext to its own create and status paths", async () => {
    steps.push((url) => {
      expect(url).toBe(`${KIE}/api/v1/flux/kontext/generate`);
      return kieCreated("fk-1");
    }, (url) => {
      expect(url).toBe(`${KIE}/api/v1/flux/kontext/record-info?taskId=fk-1`);
      return json({ code: 200, msg: "success", data: { taskId: "fk-1", successFlag: 1, response: { resultImageUrl: KIE_IMAGE } } });
    });
    const response = await jsonPost(images, body({ model: "kie/flux/kontext", size: "4:3" }));
    expect(response.status).toBe(200);
    expectOnlySelected(KIE_KEY_B, [KIE]);
    expect(usage()).toHaveLength(1);
  });

  it.each([[401, 401], [402, 402], [429, 429]])("envelope refusal %s updates only the selected account and records nothing", async (code, expected) => {
    steps.push(() => kieEnvelope(code));
    const response = await jsonPost(images, body());
    expect(response.status).toBe(expected);
    await expectNoLeak(response);
    expect(calls).toHaveLength(1);
    expect(auth.markAccountUnavailable.mock.calls.map((args) => args[0])).toEqual(["kie-b"]);
    expect(usage()).toEqual([]);
    expect(m.writes.filter((row) => row.id === "kie-a")).toEqual([]);
  });

  it("an uncertain submit is recorded once as accepted and never replayed on another account", async () => {
    steps.push(() => leaky(503));
    const response = await jsonPost(images, body());
    expect(response.status).toBe(502);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
    await expectNoLeak(response);
    expect(posts()).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: "kie", connectionId: "kie-b", costSource: "accepted-job", status: "accepted" });
  });

  it("caller cancellation while polling is recorded once as accepted", async () => {
    steps.push(() => kieCreated(), hang);
    const { controller, response } = abortablePost(images, body());
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    controller.abort();
    expect((await response).status).toBe(499);
    expect(posts()).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ costSource: "accepted-job" });
  });

  it.each([
    ["binary output", { response_format: "b64_json" }],
    ["n > 1 on a Market model", { n: 2 }],
    ["a private input image", { image_url: "https://127.0.0.1/x.png" }],
  ])("refuses %s before any network call", async (_name, extra) => {
    const response = await jsonPost(images, body(extra));
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(usage()).toEqual([]);
  });

  it("refuses a chat model for image generation before credential selection", async () => {
    const response = await jsonPost(images, body({ model: "kie/gpt-5-5" }));
    expect(response.status).toBe(400);
    expect(m.credentials).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

// ── KIE.AI video ──────────────────────────────────────────────────────────────
describe("POST /v1/video/generations kie", () => {
  const body = (extra = {}) => ({ model: "kie/veo/veo-3-1-fast", prompt: "synthetic boat", ...extra });

  it("creates one Market task with the selected key, polls and records one video", async () => {
    steps.push((url, init) => {
      expect(url).toBe(KIE_CREATE);
      expect(init.headers.Authorization).toBe(`Bearer ${KIE_KEY_B}`);
      expect(bodyOf({ init })).toEqual({ model: "veo/veo-3-1-fast", input: { prompt: "synthetic boat", duration: "8", aspect_ratio: "9:16", sound: false } });
      return kieCreated("vid-1");
    }, (url) => {
      expect(url).toBe(`${KIE_RECORD}?taskId=vid-1`);
      return kieRunning("vid-1");
    }, () => kieDone([KIE_VIDEO], "vid-1"));
    const response = await jsonPost(videos, body({ duration: 8, aspect_ratio: "9:16" }));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([{ url: KIE_VIDEO, format: "mp4" }]);
    expect(calls).toHaveLength(3);
    expectOnlySelected(KIE_KEY_B, [KIE]);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: "kie", model: "veo/veo-3-1-fast", connectionId: "kie-b", modality: "video", nativeUnits: { videos: 1 }, costStatus: "unknown" });
  });

  it.each([[401, 401], [402, 402], [429, 429]])("envelope refusal %s updates only the selected account", async (code, expected) => {
    steps.push(() => kieEnvelope(code));
    const response = await jsonPost(videos, body());
    expect(response.status).toBe(expected);
    await expectNoLeak(response);
    expect(calls).toHaveLength(1);
    expect(auth.markAccountUnavailable.mock.calls.map((args) => args[0])).toEqual(["kie-b"]);
    expect(usage()).toEqual([]);
  });

  it("a task without a usable result is recorded once as accepted and never resubmitted", async () => {
    steps.push(() => kieCreated(), () => json({ code: 200, msg: "success", data: { taskId: "task-1", state: "success", resultJson: "{}" } }));
    const response = await jsonPost(videos, body());
    expect(response.status).toBe(502);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
    expect(posts()).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: "kie", connectionId: "kie-b", costSource: "accepted-job" });
  });

  it("an exhausted job deadline is a 504 recorded once as accepted", async () => {
    steps.push(() => kieCreated());
    routes.push({ match: (url) => url.startsWith(KIE_RECORD), answer: () => kieRunning() });
    const response = await jsonPost(videos, body());
    expect(response.status).toBe(504);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
    expect(posts()).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ costSource: "accepted-job" });
  });

  it("caller cancellation while polling stops the loop and never resubmits", async () => {
    steps.push(() => kieCreated(), hang);
    const { controller, response } = abortablePost(videos, body());
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    controller.abort();
    expect((await response).status).toBe(499);
    expect(posts()).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ costSource: "accepted-job" });
  });

  it.each([
    ["an image-to-video model", { model: "kie/sora-2-image-to-video" }],
    ["an input image", { image_url: "https://example.com/a.png" }],
    ["n > 1", { n: 2 }],
    ["stream", { stream: true }],
    ["b64_json", { response_format: "b64_json" }],
    ["an unknown aspect ratio", { aspect_ratio: "wide" }],
  ])("refuses %s before any network call", async (_name, extra) => {
    const response = await jsonPost(videos, body(extra));
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(usage()).toEqual([]);
  });
});

// ── Google Flow stays closed ──────────────────────────────────────────────────
describe("POST /v1/video/generations googleflow", () => {
  it.each(["googleflow/veo-3.1-generate", "flow/veo-3.1-fast-generate"])("%s is refused without a network call or usage", async (model) => {
    const response = await jsonPost(videos, { model, prompt: "synthetic gate" });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(calls).toEqual([]);
    expect(usage()).toEqual([]);
  });
});
