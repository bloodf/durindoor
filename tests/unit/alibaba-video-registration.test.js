// Closed network integration of the public route, real core, registry and adapter.
// Account storage/selection and usage storage are synthetic; health logic is real.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  dir: "",
  credentials: vi.fn(),
  refresh: vi.fn(),
  save: vi.fn(),
  rows: new Map(),
  fallback: [],
  writes: [],
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
    saveRequestUsage: m.save,
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
    getProviderCredentialsWithQuotaPreflight: m.credentials,
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
  checkAndRefreshToken: m.refresh,
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
vi.mock("@/lib/dataDir.js", () => ({ get DATA_DIR() { return m.dir; } }));

vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));
import { POST } from "../../src/app/api/v1/video/generations/route.js";
import { GET as typedModels } from "../../src/app/api/v1/models/[...model]/route.js";
import { buildModelsList } from "../../src/shared/models/buildModelsList.js";
import { buildModelsResponse } from "../../src/app/api/v1/models/_shared.js";
import { clearLiveModelLimitsCache } from "../../open-sse/services/liveModelLimits.js";
import { handleVideoGenerationCore } from "../../open-sse/handlers/videoGenerationCore.js";
import { mediaEndpointSupport } from "../../src/sse/services/mediaTransport.js";
import adapter from "../../open-sse/handlers/videoProviders/alibaba.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { ALIBABA_VIDEO_MODEL_IDS } from "../../open-sse/services/alibabaVideo/request.js";
import alibaba from "../../open-sse/providers/registry/alibaba.js";
import * as auth from "../../src/sse/services/auth.js";
import { handleVideoCreate } from "../../src/sse/handlers/video.js";
import { ACCEPTED_JOB_HEADER } from "../../open-sse/services/combo.js";

const MODEL = "wan2.7-t2v-2026-06-12";
const KEY = "sk-SYNTHETIC-selected-b";
const TASK = "0385dc79-5ff8-4d82-bcb6-000000000b0b";
const ORIGIN = "https://dashscope-intl.aliyuncs.com";
const SUBMIT = `${ORIGIN}/api/v1/services/aigc/video-generation/video-synthesis`;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let calls;
let steps;
const usage = () => m.save.mock.calls.map(([row]) => row);
function request(model = `ali/${MODEL}`, extra = {}) {
  return new Request("http://localhost/v1/video/generations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, prompt: "synthetic boat", ...extra }) });
}
beforeEach(() => {
  vi.clearAllMocks();
  clearLiveModelLimitsCache();
  m.rows.clear(); m.fallback.length = 0; m.writes.length = 0;
  m.dir = fs.mkdtempSync(path.join(os.tmpdir(), "alibaba-registration-"));
  for (const id of ["a", "b"]) m.rows.set(id, { id, provider: "alibaba", authType: "apikey", isActive: true, apiKey: id === "b" ? KEY : "sk-SYNTHETIC-unselected-a", providerSpecificData: {} });
  const row = m.rows.get("b");
  m.credentials.mockReset().mockResolvedValue({ ...row, connectionId: "b", _connection: { ...row } });
  m.refresh.mockReset().mockImplementation(async (_provider, credentials) => credentials);
  m.save.mockResolvedValue(true);
  calls = []; steps = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    const next = steps.shift();
    if (!next) throw new Error(`Unexpected network request ${url}`);
    return next(String(url), init);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); fs.rmSync(m.dir, { recursive: true, force: true }); });

it("shares the canonical adapter and keeps the chat transport and catalog", () => {
  expect(getVideoGenerationAdapter("alibaba")).toBe(adapter);
  expect(getVideoGenerationAdapter("ali")).toBe(adapter);
  expect(alibaba.transport.baseUrl).toBe(`${ORIGIN}/compatible-mode/v1/chat/completions`);
  expect(alibaba.models.filter((row) => !row.kind)).toHaveLength(13);
  expect(alibaba.models.find((row) => row.id === "qwen-max")).toEqual({ id: "qwen-max", name: "Qwen Max" });
  expect(mediaEndpointSupport("video", "/v1/video/generations", "alibaba").supported).toBe(true);
  expect(mediaEndpointSupport("video", "/v1/videos", "alibaba")).toMatchObject({ supported: false, reason: expect.stringContaining("Use /v1/video/generations") });
});

it.each(["ali", "alibaba"])("%s public route uses the selected stored Bearer once and records returned video once", async (prefix) => {
  steps.push((url, init) => {
    expect(url).toBe(SUBMIT);
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(init.body).model).toBe(MODEL);
    return json({ output: { task_id: TASK } });
  }, (url, init) => {
    expect(url).toBe(`${ORIGIN}/api/v1/tasks/${TASK}`);
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`);
    return json({ output: { task_id: TASK, task_status: "SUCCEEDED", video_url: "https://cdn.example.com/out.mp4" } });
  });
  const response = await POST(request(`${prefix}/${MODEL}`));
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual([{ url: "https://cdn.example.com/out.mp4", format: "mp4" }]);
  expect(calls).toHaveLength(2);
  expect(m.credentials).toHaveBeenCalledTimes(1);
  expect(usage()).toHaveLength(1);
  expect(usage()[0]).toMatchObject({ provider: "alibaba", connectionId: "b", modality: "video", nativeUnits: { videos: 1 }, costStatus: "unknown" });
  expect(m.writes.filter((row) => row.id === "a")).toEqual([]);
});

it.each([[401, "InvalidApiKey", 401], [400, "Arrearage", 402], [403, "AccessDenied.Unpurchased", 402], [429, "Throttling.RateQuota", 429]])("public refusal %s/%s updates only selected account", async (status, code, expected) => {
  steps.push(() => json({ code }, status));
  const response = await POST(request());
  expect(response.status).toBe(expected);
  expect(calls).toHaveLength(1);
  expect(auth.markAccountUnavailable).toHaveBeenCalledTimes(1);
  expect(auth.markAccountUnavailable.mock.calls[0]).toMatchObject({ 0: "b", 1: expected, 3: "alibaba", 4: MODEL, 6: { usedCredential: KEY } });
  if (expected === 402) {
    expect(m.writes).toEqual([expect.objectContaining({ id: "b", patch: { quotaLockout: expect.objectContaining({ status: "quota_exhausted", reactivateAt: null }) } })]);
  } else {
    expect(m.fallback).toEqual([expect.objectContaining({ id: "b", status: expected })]);
  }
  expect(usage()).toEqual([]);
  expect(m.writes.filter((row) => row.id === "a")).toEqual([]);
});

it("uncertain acceptance records once without retrying another saved account", async () => {
  steps.push(() => json({ code: "InternalError" }, 500));
  const response = await POST(request());
  expect(response.status).toBe(502);
  expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
  expect(calls).toHaveLength(1);
  expect(m.credentials).toHaveBeenCalledTimes(1);
  expect(usage()).toHaveLength(1);
  expect(usage()[0]).toMatchObject({ connectionId: "b", costSource: "accepted-job" });
});

it.each([[MODEL, { resolution: "480P" }], ["wan2.7-t2v", {}], ["qwen-max", {}]])("refuses unsupported model/options %s before network", async (model, body) => {
  const response = await POST(request(`ali/${model}`, body));
  expect(response.status).toBe(400);
  expect(calls).toEqual([]);
  expect(usage()).toEqual([]);
});
it("real registered core refuses missing authentication before network", async () => {
  const result = await handleVideoGenerationCore({ provider: "alibaba", model: MODEL, body: { prompt: "boat" }, credentials: {} });
  expect(result.status).toBe(401);
  expect(calls).toEqual([]);
});

it("actual typed and mixed public listings expose nine videos while live chat discovery remains intact", async () => {
  const live = (url, init) => {
    expect(url).toBe(`${ORIGIN}/compatible-mode/v1/models`);
    expect(init.headers.Authorization).toBe("Bearer sk-SYNTHETIC-unselected-a");
    return json({ data: [{ id: "private-live-chat" }] });
  };
  steps.push(live, live, live, live);
  const response = await typedModels(new Request("http://localhost/v1/models/video"), { params: Promise.resolve({ model: ["video"] }) });
  expect(response.status).toBe(200);
  const videos = (await response.json()).data.filter((row) => row.owned_by === "ali");
  expect(videos.map((row) => row.id).sort()).toEqual(ALIBABA_VIDEO_MODEL_IDS.map((id) => `ali/${id}`).sort());
  expect(videos.every((row) => row.kind === "video")).toBe(true);
  const mixedResponse = buildModelsResponse(new Request("http://localhost/v1/models"), await buildModelsList(["llm", "video"]));
  const mixed = (await mixedResponse.json()).data.filter((row) => row.owned_by === "ali");
  expect(mixed.filter((row) => row.kind === "video").map((row) => row.id).sort()).toEqual(videos.map((row) => row.id).sort());
  expect(mixed).toContainEqual(expect.objectContaining({ id: "ali/qwen-max", kind: "llm", owned_by: "ali" }));
  expect(mixed).toContainEqual(expect.objectContaining({ id: "ali/private-live-chat", kind: "llm", owned_by: "ali" }));
  expect(calls.length).toBeGreaterThan(0);
});

it("actual async creation explicitly refuses Alibaba before credential selection or network", async () => {
  const response = await handleVideoCreate(request(), "generations");
  expect(response.status).toBe(400);
  expect((await response.json()).error.message).toContain("Use /v1/video/generations");
  expect(m.credentials).not.toHaveBeenCalled();
  expect(calls).toEqual([]);
});
