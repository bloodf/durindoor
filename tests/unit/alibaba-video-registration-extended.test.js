// Original f089f2c6e1 case mapping (28 expanded cases):
// 1-7 registration/discovery: extended tests below; typed/mixed listings also in registration.
// 8-9 successful alias submits: extended checks payload/polls; registration checks public POST.
// 10 I2V: extended. 11-12 unknown/chat model: registration unsupported-options table.
// 13-21 CN, n, b64, ratio, unsupported image, private URL, resolution, raw parameters,
// chat body: extended refusal table. 22 async endpoint: registration async creation.
// 23-25 401, quota, 429: registration public refusal table checks real health writes.
// 26 5xx: registration uncertain acceptance. 27 timeout and 28 concurrency: extended.
// Alibaba DashScope native video, registered on the existing `alibaba` (ali)
// provider for #2034. Driven through the public /v1/video/generations and
// /v1/videos handlers with the real typed model resolution, endpoint support,
// video core and registered adapter, plus the real connection model discovery
// and the real chat executor. Only account storage, credential selection, the
// usage ledger rows, caller admission and logging are substituted. Closed
// network: every request is answered below, an unexpected request fails the
// test, and every key is synthetic. Passing here says nothing about the live
// service.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  credentials: vi.fn(),
  markUnavailable: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@/dashboardGuard", () => ({ isOperatorRequest: vi.fn(async () => true) }));
vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({})),
  getApiKeyByKey: vi.fn(async () => null),
  getApiKeyById: vi.fn(async () => null),
  getApiKeyUsageTotals: vi.fn(async () => ({})),
  getComboForModel: vi.fn(async () => null),
  getCustomModels: vi.fn(async () => []),
  getSyncedModelCatalog: vi.fn(async () => null),
  getProviderNodes: vi.fn(async () => []),
  getProviderNodeById: vi.fn(async () => null),
  getProviderConnections: vi.fn(async () => []),
  getProviderConnectionById: vi.fn(async () => null),
  getApiKeyProviderConnectionIds: vi.fn(async () => []),
  getProxyPoolById: vi.fn(async () => null),
  updateProviderConnection: vi.fn(async () => null),
  saveRequestUsage: m.save,
}));
vi.mock("@/lib/db/repos/mediaJobsRepo.js", () => ({ createMediaJob: vi.fn(), getMediaJob: vi.fn(), finishMediaJob: vi.fn() }));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentialsWithQuotaPreflight: m.credentials,
  getNoAuthProviderCredentials: vi.fn(),
  markAccountUnavailable: m.markUnavailable,
  clearAccountError: vi.fn(async () => {}),
  resolveClientApiKey: vi.fn(async () => ({ apiKey: "caller-key", auth: { ok: true, apiKeyId: "caller-id", billingEpoch: null } })),
  extractApiKey: vi.fn(),
  hasValidCliToken: vi.fn(),
}));
vi.mock("../../src/sse/utils/logger.js", () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), request: vi.fn() }));
vi.mock("../../src/sse/services/mediaRoutes.js", () => ({
  wantsDefaultRoute: () => false,
  resolveMediaRoute: vi.fn(),
  defaultRouteComboOptions: () => ({}),
  listMediaRouteCandidates: vi.fn(async () => []),
  providerOfModelId: vi.fn(),
}));
vi.mock("../../open-sse/services/comboRoutingPolicy.js", () => ({ getComboRoutingPolicy: vi.fn(async () => null) }));

import REGISTRY from "../../open-sse/providers/registry/index.js";
import alibabaEntry from "../../open-sse/providers/registry/alibaba.js";
import alibabaVideoAdapter from "../../open-sse/handlers/videoProviders/alibaba.js";
import { getVideoGenerationAdapter } from "../../open-sse/handlers/videoProviders/index.js";
import { supportsVideoGeneration } from "../../open-sse/handlers/videoGenerationCore.js";
import { ALIBABA_VIDEO_MODEL_IDS } from "../../open-sse/services/alibabaVideo/request.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { ACCEPTED_JOB_HEADER } from "../../open-sse/services/combo.js";
import { mediaEndpointSupport, mediaTransportSupport } from "../../src/sse/services/mediaTransport.js";
import { modelKindError } from "../../src/sse/handlers/modelKind.js";
import { getProviderModels } from "../../open-sse/config/providerModels.js";
import { fetchConnectionModels } from "../../src/app/api/providers/[id]/models/fetchConnectionModels.js";

const { handleVideoGeneration } = await import("../../src/sse/handlers/video.js");

const ORIGIN = "https://dashscope-intl.aliyuncs.com";
const SUBMIT_URL = `${ORIGIN}/api/v1/services/aigc/video-generation/video-synthesis`;
const taskUrl = (id) => `${ORIGIN}/api/v1/tasks/${id}`;
const CHAT_URL = `${ORIGIN}/compatible-mode/v1/chat/completions`;
const MODELS_URL = `${ORIGIN}/compatible-mode/v1/models`;
const KEY_A = "sk-SYNTHETIC-ali-registration-a-0001";
const KEY_B = "sk-SYNTHETIC-ali-registration-b-0002";
const TASK_A = "0385dc79-5ff8-4d82-bcb6-00000000aa01";
const TASK_B = "0385dc79-5ff8-4d82-bcb6-00000000bb02";
const VIDEO_A = "https://dashscope-result-sgp.oss-accelerate.aliyuncs.com/a/out.mp4?Expires=1";
const VIDEO_B = "https://dashscope-result-sgp.oss-accelerate.aliyuncs.com/b/out.mp4?Expires=1";
const IMAGE = "https://cdn.example.com/frame.png";
const T2V = "wan2.7-t2v-2026-06-12";
const CHAT_MODEL_IDS = [
  "qwen-max", "qwen3.8-max", "qwen-max-2025-01-25", "qwen-plus", "qwen-plus-2025-07-14", "qwen-turbo",
  "qwen-turbo-2025-11-01", "qwen3-coder-plus", "qwen3-coder-flash", "qwq-plus", "qwq-32b", "qwen3-32b", "qwen3-235b-a22b",
];
// Names verbatim from OmniRoute c71f0065a7efe9230ec23b96a12253b050c4d7ad open-sse/config/videoRegistry.ts.
const SOURCE_NAMES = [
  "HappyHorse 1.1 I2V", "HappyHorse 1.1 T2V", "HappyHorse 1.1 R2V", "HappyHorse 1.0 Video Edit",
  "Wan 2.7 I2V (2026-04-25)", "Wan 2.6 I2V Flash", "Wan 2.7 T2V (2026-06-12)", "Wan 2.7 R2V (2026-06-12)", "Wan 2.7 Video Edit",
];

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const accepted = (id = TASK_A) => json({ request_id: "r1", output: { task_id: id, task_status: "PENDING" } });
const task = (status, extra = {}, id = TASK_A) => json({ request_id: "r2", output: { task_id: id, task_status: status, ...extra } });
const succeeded = (url = VIDEO_A, id = TASK_A) => task("SUCCEEDED", { video_url: url }, id);
const account = (connectionId, apiKey) => ({ connectionId, provider: "alibaba", authType: "apikey", apiKey });

const originalFetch = global.fetch;
let calls;

function network(handler) {
  global.fetch = vi.fn(async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? "GET", init };
    calls.push(call);
    const answer = await handler(call);
    if (!answer) throw new Error(`Unexpected request: ${call.method} ${call.url}`);
    return answer;
  });
}
function sequence(...steps) {
  network((call) => {
    const step = steps.shift();
    return typeof step === "function" ? step(call) : step;
  });
}
const header = (call, name) => {
  const headers = call.init?.headers ?? {};
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
};
const submits = () => calls.filter((call) => call.method === "POST" && call.url === SUBMIT_URL);
const usage = () => m.save.mock.calls.map(([event]) => event);

// The adapter's poll waits use timers; advance them until the route answers.
async function settle(promise) {
  let done = false;
  let value;
  let error;
  promise.then((result) => { done = true; value = result; }, (failure) => { done = true; error = failure; });
  const deadline = performance.now() + 15_000;
  while (!done && performance.now() < deadline) {
    await vi.advanceTimersByTimeAsync(500);
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (!done) throw new Error(`route did not answer; calls: ${JSON.stringify(calls.map((call) => [call.method, call.url]))}`);
  if (error) throw error;
  return value;
}

const post = (url, body, init = {}) => new Request(`http://localhost${url}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...init,
});
const video = (body, init) => settle(handleVideoGeneration(post("/v1/video/generations", { prompt: "a paper boat on a rainy street", ...body }, init)));

async function expectNoSecrets(response) {
  const text = await response.clone().text();
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
}

beforeEach(() => {
  calls = [];
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) vi.stubEnv(key, undefined);
  m.save.mockResolvedValue(true);
  // As the shared account policy: only auth, quota and server failures move to another account.
  m.markUnavailable.mockReset().mockImplementation(async (_id, status) => ({
    shouldFallback: [401, 402, 403, 429].includes(Number(status)) || Number(status) >= 500,
  }));
  m.credentials.mockReset().mockResolvedValue({ allRateLimited: true, lastError: "exhausted" });
  network(() => null);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  global.fetch = originalFetch;
});

describe("registration on the existing alibaba identity", () => {
  it("adds the nine pinned video models to alibaba without a second provider, alias or videoConfig", () => {
    const entry = REGISTRY.find((item) => item.id === "alibaba");
    expect(entry).toBe(alibabaEntry);
    expect(entry).toMatchObject({ alias: "ali", uiAlias: "ali", category: "apikey", serviceKinds: ["llm", "video"] });
    expect(entry).not.toHaveProperty("videoConfig");
    const videoRows = entry.models.filter((model) => model.kind === "video");
    expect(videoRows.map(({ id }) => id)).toEqual([...ALIBABA_VIDEO_MODEL_IDS]);
    expect(videoRows.map(({ name }) => name)).toEqual(SOURCE_NAMES);
    for (const row of videoRows) {
      const i2v = /i2v/.test(row.id);
      expect(row.params.includes("aspect_ratio")).toBe(!i2v);
      expect(row.params.includes("size")).toBe(!i2v);
      expect(row.params).toEqual(expect.arrayContaining(["resolution", "duration", "seed"]));
    }
    // No duplicate identity: no other registry entry claims these ids, ali or a video variant of alibaba.
    for (const item of REGISTRY.filter((other) => other !== entry)) {
      expect([item.id, item.alias, item.uiAlias]).not.toContain("ali");
      expect(item.id).not.toMatch(/^alibaba-video/);
    }
    // alibaba-cn stays chat-only: the source has no china video entry.
    const cn = REGISTRY.find((item) => item.id === "alibaba-cn");
    expect(cn.models.some((model) => model.kind === "video")).toBe(false);
    expect(getVideoGenerationAdapter("alibaba-cn")).toBeNull();
  });

  it("registers the staged adapter itself for /v1/video/generations only", () => {
    expect(getVideoGenerationAdapter("alibaba")).toBe(alibabaVideoAdapter);
    expect(getVideoGenerationAdapter("ali")).toBe(alibabaVideoAdapter);
    expect(supportsVideoGeneration("alibaba")).toBe(true);
    expect(mediaTransportSupport("video", "alibaba")).toBe("supported");
    expect(mediaEndpointSupport("video", "/v1/video/generations", "alibaba", T2V)).toEqual({ supported: true, reason: null });
    const jobs = mediaEndpointSupport("video", "/v1/videos", "alibaba", T2V);
    expect(jobs.supported).toBe(false);
    expect(jobs.reason).toContain("Use /v1/video/generations");
  });

  it("keeps the chat models, transport, discovery and kinds as they were", async () => {
    const entry = REGISTRY.find((item) => item.id === "alibaba");
    const chatRows = entry.models.filter((model) => !model.kind);
    expect(chatRows.map(({ id }) => id)).toEqual(CHAT_MODEL_IDS);
    expect(entry.transport).toEqual({
      quirks: { preserveCacheControl: true },
      baseUrl: CHAT_URL,
      modelsUrl: MODELS_URL,
    });
    expect(entry.modelsFetcher).toEqual({ url: MODELS_URL, type: "openai" });
    expect(entry.passthroughModels).toBe(true);
    expect(await modelKindError("alibaba", "qwen-max", {}, "llm")).toBeNull();
    expect(await modelKindError("alibaba", T2V, {}, "video")).toBeNull();
    expect(await modelKindError("alibaba", T2V, {}, "llm")).not.toBeNull();
    expect(await modelKindError("alibaba", "qwen-max", {}, "video")).not.toBeNull();
    expect(getCapabilitiesForModel("alibaba", T2V, "video")).toMatchObject({ videoOutput: true });
    expect(getCapabilitiesForModel("alibaba", "qwen-max")).toMatchObject({ videoOutput: false });
  });

  it("still sends chat to the compatible-mode endpoint with the selected key, never to video synthesis", async () => {
    network((call) => (call.url === CHAT_URL
      ? json({ id: "c1", object: "chat.completion", model: "qwen-max", choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }] })
      : null));
    const result = await getExecutor("alibaba").execute({
      model: "qwen-max",
      body: { model: "qwen-max", messages: [{ role: "user", content: "hi" }], stream: false },
      stream: false,
      credentials: { apiKey: KEY_A },
    });
    expect(result.response.status).toBe(200);
    expect(calls.map((call) => call.url)).toEqual([CHAT_URL]);
    expect(header(calls[0], "Authorization")).toBe(`Bearer ${KEY_A}`);
    expect(submits()).toEqual([]);
  });
});

describe("model discovery for the selected connection", () => {
  it("serves the nine video models from the registry model list with kind video", () => {
    const rows = getProviderModels("alibaba");
    expect(rows.filter((model) => model.kind === "video").map(({ id }) => id)).toEqual([...ALIBABA_VIDEO_MODEL_IDS]);
    expect(rows.filter((model) => !model.kind).map(({ id }) => id)).toEqual(CHAT_MODEL_IDS);
    expect(getProviderModels("alibaba-cn").some((model) => model.kind === "video")).toBe(false);
  });

  it("keeps connection discovery live and credential-scoped: the selected key, no video-synthesis call", async () => {
    network((call) => (call.url === MODELS_URL
      ? json({ object: "list", data: [{ id: "qwen-max", object: "model" }] })
      : null));
    const result = await fetchConnectionModels({ id: "ali-b", provider: "alibaba", authType: "apikey", apiKey: KEY_B, providerSpecificData: {} });
    expect(calls.map((call) => call.url)).toEqual([MODELS_URL]);
    expect(header(calls[0], "Authorization")).toBe(`Bearer ${KEY_B}`);
    expect(result.models.map((model) => model.id)).toEqual(["qwen-max"]);
    expect(JSON.stringify(result)).not.toContain(KEY_B);
  });

  it("returns a discovery failure unchanged", async () => {
    network((call) => (call.url === MODELS_URL ? json({ code: "InvalidApiKey", message: "bad key" }, 401) : null));
    const result = await fetchConnectionModels({ id: "ali-a", provider: "alibaba", authType: "apikey", apiKey: KEY_A, providerSpecificData: {} });
    expect(result).toMatchObject({ status: 401 });
    expect(result.models).toBeUndefined();
  });
});

describe("/v1/video/generations through the registered adapter", () => {
  it.each([["ali", T2V], ["alibaba", "happyhorse-1.1-t2v"]])("%s/%s: one Bearer submit, task polls and the URL, recorded once", async (prefix, model) => {
    m.credentials.mockResolvedValueOnce(account("ali-a", KEY_A));
    sequence(accepted(), task("RUNNING"), succeeded());
    const response = await video({ model: `${prefix}/${model}`, resolution: "720P", aspect_ratio: "16:9", seconds: 5 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: [{ url: VIDEO_A, format: "mp4" }] });
    expect(calls.map((call) => [call.method, call.url])).toEqual([["POST", SUBMIT_URL], ["GET", taskUrl(TASK_A)], ["GET", taskUrl(TASK_A)]]);
    for (const call of calls) expect(header(call, "Authorization")).toBe(`Bearer ${KEY_A}`);
    expect(header(calls[0], "X-DashScope-Async")).toBe("enable");
    expect(JSON.parse(calls[0].init.body)).toEqual({
      model, input: { prompt: "a paper boat on a rainy street" }, parameters: { resolution: "720P", ratio: "16:9", duration: 5 },
    });
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(m.credentials.mock.calls[0][0]).toBe("alibaba");
    expect(m.markUnavailable).not.toHaveBeenCalled();
    expect(usage()).toEqual([expect.objectContaining({
      provider: "alibaba", model, connectionId: "ali-a", endpoint: "/v1/video/generations", nativeUnits: { videos: 1 },
    })]);
  });

  it("image-to-video sends the first frame and no ratio", async () => {
    m.credentials.mockResolvedValueOnce(account("ali-a", KEY_A));
    sequence(accepted(), succeeded());
    const response = await video({ model: "ali/happyhorse-1.1-i2v", image: IMAGE, resolution: "1080P" });
    expect(response.status).toBe(200);
    expect(JSON.parse(submits()[0].init.body)).toEqual({
      model: "happyhorse-1.1-i2v",
      input: { prompt: "a paper boat on a rainy street", media: [{ type: "first_frame", url: IMAGE }] },
      parameters: { resolution: "1080P" },
    });
  });

  it.each([
    ["an alibaba-cn model", { model: "alibaba-cn/wan2.7-t2v-2026-06-12" }],
    ["two videos", { model: `ali/${T2V}`, n: 2 }],
    ["b64_json output", { model: `ali/${T2V}`, response_format: "b64_json" }],
    ["a ratio for image-to-video", { model: "ali/wan2.6-i2v-flash", image: IMAGE, aspect_ratio: "16:9" }],
    ["an image for text-to-video", { model: "ali/happyhorse-1.1-t2v", image: IMAGE }],
    ["a private media host", { model: "ali/happyhorse-1.1-i2v", image: "https://169.254.169.254/latest" }],
    ["an unknown resolution", { model: `ali/${T2V}`, resolution: "4K" }],
    ["a raw parameters object", { model: `ali/${T2V}`, parameters: { duration: 5 } }],
    ["a chat body", { model: `ali/${T2V}`, messages: [{ role: "user", content: "hi" }] }],
  ])("refuses %s with 400 before anything is sent", async (_label, body) => {
    m.credentials.mockResolvedValue(account("ali-a", KEY_A));
    const response = await video(body);
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
    expect(m.markUnavailable).not.toHaveBeenCalled();
    expect(usage()).toEqual([]);
    await expectNoSecrets(response);
  });

});

describe("uncertain acceptance during polling", () => {
  it("a task that never finishes is recorded once as accepted, without a second submit", async () => {
    m.credentials.mockResolvedValueOnce(account("ali-a", KEY_A)).mockResolvedValueOnce(account("ali-b", KEY_B));
    network((call) => (call.method === "POST" ? accepted() : task("RUNNING")));
    const response = await video({ model: `ali/${T2V}` });
    expect(response.status).toBe(504);
    expect(response.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
    expect(submits()).toHaveLength(1);
    expect(m.credentials).toHaveBeenCalledTimes(1);
    expect(usage()).toEqual([expect.objectContaining({ connectionId: "ali-a", status: "accepted", meta: expect.objectContaining({ jobState: "accepted" }) })]);
  });
});

describe("account isolation", () => {
  it("keeps two accounts' keys and tasks apart under concurrency", async () => {
    m.credentials.mockResolvedValueOnce(account("ali-a", KEY_A)).mockResolvedValueOnce(account("ali-b", KEY_B));
    network((call) => {
      const mine = header(call, "Authorization") === `Bearer ${KEY_A}` ? { id: TASK_A, url: VIDEO_A } : { id: TASK_B, url: VIDEO_B };
      if (call.method === "POST") return accepted(mine.id);
      expect(call.url).toBe(taskUrl(mine.id));
      return succeeded(mine.url, mine.id);
    });
    const [a, b] = await Promise.all([video({ model: `ali/${T2V}` }), video({ model: "alibaba/happyhorse-1.1-t2v" })]);
    expect((await a.json()).data[0].url).toBe(VIDEO_A);
    expect((await b.json()).data[0].url).toBe(VIDEO_B);
    expect(submits().map((call) => header(call, "Authorization")).sort()).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
    expect(usage().map((event) => event.connectionId).sort()).toEqual(["ali-a", "ali-b"]);
  });
});
