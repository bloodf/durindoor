// Batch 2 public registration: closed transports, real routes and adapters.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  dir: "",
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


vi.mock("../../open-sse/services/providerParity/native-fal-ai-video/adapter.js", async (original) => {
  const a = await original();
  return { ...a, default: a.createFalVideoAdapter({ now: () => m.clock, wait: (ms, signal) => m.wait(ms, signal), submitTimeoutMs: 100, requestTimeoutMs: 100, timeoutMs: 10000 }) };
});
vi.mock("../../open-sse/services/providerParity/native-fal-ai-music/adapter.js", async (original) => {
  const a = await original();
  return { ...a, default: a.createFalMusicAdapter({ now: () => m.clock, wait: (ms, signal) => m.wait(ms, signal), submitTimeoutMs: 100, requestTimeoutMs: 100, timeoutMs: 10000 }) };
});
vi.mock("../../open-sse/services/providerParity/native-kie-video-image/index.js", async (original) => {
  const a = await original();
  const options = { now: () => m.clock, wait: (ms, signal) => m.wait(ms, signal), submitTimeoutMs: 100, requestTimeoutMs: 100, timeoutMs: 10000 };
  return { ...a, kieImageAdapter: a.createKieImageAdapter(options), kieVideoAdapter: a.createKieVideoAdapter(options) };
});
import { POST as images } from "../../src/app/api/v1/images/generations/route.js";
import { POST as videos } from "../../src/app/api/v1/video/generations/route.js";
import { POST as music } from "../../src/app/api/v1/music/generations/route.js";
import { GET as typedModels } from "../../src/app/api/v1/models/[...model]/route.js";
import { clearLiveModelLimitsCache } from "../../open-sse/services/liveModelLimits.js";
import { mediaEndpointSupport, mediaTransportSupport } from "../../src/sse/services/mediaTransport.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import fal from "../../open-sse/providers/registry/fal-ai.js";
import kie from "../../open-sse/providers/registry/kie.js";
import * as auth from "../../src/sse/services/auth.js";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const ID = "4b0e1a5c-77d2-4f3c-9a51-0c2d6e8f1a2b";
const ARTIFACT = "https://cdn.example.com/output.mp4";
const AUDIO = "https://cdn.example.com/output.wav";
let calls, steps;
const usage = () => m.save.mock.calls.map(([row]) => row);
const post = (route, body, signal) => route(new Request("http://localhost/v1/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal }));
const hang = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
const cases = [
  { name: "fal video", provider: "fal-ai", route: videos, model: "fal/veo3.1/lite", kind: "video", url: "https://queue.fal.run/fal-ai/veo3.1/lite", token: "Key fal-ai-selected", body: { prompt: "forest" }, native: { prompt: "forest" } },
  { name: "fal music", provider: "fal-ai", route: music, model: "fal/ace-step", kind: "music", url: "https://queue.fal.run/fal-ai/ace-step", token: "Key fal-ai-selected", body: { prompt: "forest" }, native: { tags: "forest" } },
  { name: "kie video", provider: "kie", route: videos, model: "kie/veo/veo-3-1", kind: "video", url: "https://api.kie.ai/api/v1/jobs/createTask", token: "Bearer kie-selected", body: { prompt: "forest" }, native: { model: "veo/veo-3-1", input: { prompt: "forest", duration: "5", aspect_ratio: "16:9", sound: false } } },
  { name: "kie image", provider: "kie", route: images, model: "kie/gpt4o-image", kind: "image", url: "https://api.kie.ai/api/v1/gpt4o-image/generate", token: "Bearer kie-selected", body: { prompt: "forest", response_format: "url" }, native: { prompt: "forest", size: "1:1", nVariants: 1 } },
];
function queueSuccess(c) {
  if (c.provider === "kie") {
    steps.push(() => json({ code: 200, data: { taskId: ID } }), (url) => {
      expect(url).toBe(`${c.kind === "image" ? "https://api.kie.ai/api/v1/gpt4o-image/record-info" : "https://api.kie.ai/api/v1/jobs/recordInfo"}?taskId=${ID}`);
      return json({ code: 200, data: { taskId: ID, status: "success", resultJson: JSON.stringify({ resultUrls: [ARTIFACT] }) } });
    });
  } else {
    steps.push(() => json({ request_id: ID }), () => json({ status: "COMPLETED" }), () => json(c.kind === "music" ? { audio: { url: AUDIO, content_type: "audio/wav" } } : { video: { url: ARTIFACT, content_type: "video/mp4" } }));
  }
}
beforeEach(() => {
  vi.clearAllMocks(); clearLiveModelLimitsCache();
  m.rows.clear(); m.fallback.length = 0; m.writes.length = 0; m.clock = 1_000_000;
  m.dir = fs.mkdtempSync(path.join(os.tmpdir(), "register-native-02-"));
  for (const provider of ["fal-ai", "kie"]) for (const suffix of ["selected", "other"]) {
    const id = `${provider}-${suffix}`;
    m.rows.set(id, { id, connectionId: id, provider, apiKey: id, isActive: true, authType: "apikey", providerSpecificData: { baseUrl: "https://attacker.example" } });
  }
  m.credentials = vi.fn(async (provider, excluded) => {
    const row = m.rows.get(`${provider}-selected`);
    return row && !excluded?.has(row.id) ? { ...row, _connection: { ...row } } : null;
  });
  m.refresh = vi.fn(async (_provider, row) => row); m.save = vi.fn(async () => true);
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

describe("batch identity and discovery", () => {
  it("preserves existing connections and advertises only supported kinds", () => {
    expect(fal.serviceKinds).toEqual(["image", "video", "music"]);
    expect(fal.aliases).toContain("fal");
    expect(getVideoGenerationAdapter("fal")).toBe(getVideoGenerationAdapter("fal-ai"));
    expect(getImageAdapter("kie")).toBeTruthy();
    expect(kie.transport.baseUrl).toBe("https://api.kie.ai/v1/chat/completions");
    expect(kie.models.filter(r => r.kind === "image")).toHaveLength(35);
    expect(kie.models.filter(r => r.kind === "video")).toHaveLength(10);
    for (const provider of ["googleflow", "flow"]) expect(getVideoGenerationAdapter(provider)).toBeNull();
    for (const c of cases) {
      expect(mediaTransportSupport(c.kind, c.provider)).toBe("supported");
      if (c.kind === "video") expect(mediaEndpointSupport("video", "/v1/videos", c.provider).supported).toBe(false);
    }
  });
  it.each([["video", "fal", 3], ["music", "fal", 1], ["image", "kie", 35], ["video", "kie", 10]])("discovers %s %s models on the public route", async (kind, provider, count) => {
    const response = await typedModels(new Request(`http://localhost/v1/models/${kind}`), { params: Promise.resolve({ model: [kind] }) });
    expect(response.status).toBe(200);
    const data = await response.json();
    const rows = data.data.filter(row => row.owned_by === provider);
    expect(rows).toHaveLength(count);
    expect(rows.every(row => row.kind === kind)).toBe(true);
    expect(calls.map(call => call.url)).toEqual(kind === "image" ? ["https://aihorde.net/api/v2/status/models?type=image"] : []);
  });
});
for (const c of cases) describe(c.name, () => {
  const body = extra => ({ model: c.model, ...c.body, ...extra });
  it.each(["canonical", "alias"])("uses the %s identity, selected credential, native body, artifact and one receipt", async identity => {
    queueSuccess(c);
    const response = await post(c.route, body({ model: identity === "canonical" ? c.model.replace(/^fal\//, "fal-ai/") : c.model }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data).toEqual(expect.arrayContaining([expect.objectContaining(c.kind === "music" ? { audio_url: AUDIO, format: "wav" } : c.kind === "video" ? { url: ARTIFACT, format: "mp4" } : { url: ARTIFACT })]));
    expect(calls[0].url).toBe(c.url);
    expect(JSON.parse(calls[0].init.body)).toMatchObject(c.native);
    for (const call of calls) {
      expect(call.init.headers.Authorization).toBe(c.token);
      expect(JSON.stringify(call)).not.toContain("other");
      expect(call.url).not.toContain("attacker");
    }
    expect(steps).toHaveLength(0);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: c.provider, connectionId: `${c.provider}-selected`, modality: c.kind, costStatus: "unknown" });
  });
  it.each([401, 402, 429])("handles refusal %s without leaking accounts or charging", async status => {
    steps.push(() => json({ error: `echo ${c.provider}-selected`, code: status, msg: "secret" }, status));
    const response = await post(c.route, body());
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain(`${c.provider}-selected`);
    expect(calls).toHaveLength(1);
    expect(usage()).toEqual([]);
    expect(auth.markAccountUnavailable.mock.calls.every(args => args[0] === `${c.provider}-selected`)).toBe(true);
  });
  it("never replays an uncertain submit and records it once", async () => {
    steps.push(() => json({ error: "unknown" }, 500));
    const response = await post(c.route, body());
    expect(response.status).toBe(502);
    expect(response.headers.get("x-durindoor-accepted-job")).toBe("1");
    expect(calls).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ costSource: "accepted-job", connectionId: `${c.provider}-selected` });
  });
  it("records an accepted job once if polling loses the result", async () => {
    steps.push(() => json(c.provider === "kie" ? { code: 200, data: { taskId: ID } } : { request_id: ID }), () => json({ error: "lost" }, 500));
    const response = await post(c.route, body());
    expect(response.status).toBe(502);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0].costSource).toBe("accepted-job");
  });
  it("bounds a stuck submission and records the uncertain outcome once", async () => {
    steps.push(hang);
    const response = await post(c.route, body());
    expect(response.status).toBe(504);
    expect(calls[0].init.signal.aborted).toBe(true);
    expect(usage()).toHaveLength(1);
    expect(usage()[0].costSource).toBe("accepted-job");
  });
  it("cancels without replay and records the uncertain submission once", async () => {
    steps.push(hang);
    const controller = new AbortController();
    const pending = post(c.route, body(), controller.signal);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    controller.abort();
    expect((await pending).status).toBe(499);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0].costSource).toBe("accepted-job");
  });
  it.each([{ stream: true }, { response_format: "b64_json" }, { n: 7 }])("rejects unsupported input %j before network", async extra => {
    const response = await post(c.route, body(extra));
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(usage()).toEqual([]);
  });
});

describe("guarded public input and KIE image routing", () => {
  it.each(["googleflow/veo-3.1-generate", "flow/veo-3.1-generate", "kie/wan/2-7-image-to-video", "fal/ace-step"])("refuses unsupported video %s without network", async model => {
    const response = await post(videos, { model, prompt: "forest" });
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(usage()).toEqual([]);
  });
  it.each([
    ["seedream/4.5-text-to-image", "/api/v1/jobs/createTask", "/api/v1/jobs/recordInfo", { model: "seedream/4.5-text-to-image", input: { prompt: "forest", aspect_ratio: "1:1" } }],
    ["flux/kontext", "/api/v1/flux/kontext/generate", "/api/v1/flux/kontext/record-info", { prompt: "forest", aspectRatio: "1:1", model: "flux-kontext-pro" }],
  ])("dispatches KIE %s through its source route", async (model, submit, status, native) => {
    steps.push((url, init) => {
      expect(url).toBe(`https://api.kie.ai${submit}`);
      expect(JSON.parse(init.body)).toEqual(native);
      return json({ code: 200, data: { taskId: ID } });
    }, url => {
      expect(url).toBe(`https://api.kie.ai${status}?taskId=${ID}`);
      return json({ code: 200, data: { taskId: ID, status: "success", resultJson: JSON.stringify({ resultUrls: [ARTIFACT] }) } });
    });
    const response = await post(images, { model: `kie/${model}`, prompt: "forest", response_format: "url" });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([{ url: ARTIFACT }]);
    expect(steps).toHaveLength(0);
    expect(usage()).toHaveLength(1);
  });
});

describe("fal schema discovery through public video dispatch", () => {
  it.each([false, true])("validates dynamic input before submit (invalid=%s)", async invalid => {
    const endpoint = "fal-ai/synthetic-video/text-to-video";
    steps.push((url, init) => {
      expect(url).toBe(`https://api.fal.ai/v1/models?endpoint_id=${encodeURIComponent(endpoint)}&expand=openapi-3.0`);
      expect(init.headers.Authorization).toBe("Key fal-ai-selected");
      return json({ models: [{ endpoint_id: endpoint, metadata: { category: "text-to-video" }, openapi: { openapi: "3.0.0", paths: { [`/${endpoint}`]: { post: { requestBody: { content: { "application/json": { schema: { type: "object", required: ["prompt"], properties: { prompt: { type: "string" }, seed: { type: "integer" } } } } } } } }, [`/${endpoint}/requests/{request_id}/status`]: { get: {} } } } }], has_more: false, next_cursor: null });
    });
    if (!invalid) queueSuccess(cases[0]);
    const response = await post(videos, { model: `fal/${endpoint}`, prompt: "forest", fal_input: { seed: invalid ? "bad" : 42 } });
    expect(response.status).toBe(invalid ? 400 : 200);
    if (invalid) {
      expect(calls).toHaveLength(1);
      expect(usage()).toEqual([]);
    } else {
      expect(calls[1].url).toBe(`https://queue.fal.run/${endpoint}`);
      expect(JSON.parse(calls[1].init.body)).toEqual({ prompt: "forest", seed: 42 });
      expect((await response.json()).data).toEqual([{ url: ARTIFACT, format: "mp4" }]);
      expect(usage()).toHaveLength(1);
    }
  });
});
