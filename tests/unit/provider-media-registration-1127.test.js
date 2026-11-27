// RenderHour and Adobe Firefly Services API, registered for #2034 (1127), driven
// through the public routes: connection create and validate, model discovery,
// /v1/images/generations, /v1/video/generations and /v1/audio/speech. The
// registered adapters, cores, routes, OAuth handler and refresh handler are the
// real ones. Only account storage, the usage ledger rows, caller admission and
// logging are substituted. Closed network: every request is answered below, an
// unexpected URL fails the test, and every credential is synthetic. Passing
// here says nothing about the live services.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  credentials: vi.fn(),
  markUnavailable: vi.fn(),
  save: vi.fn(),
  created: vi.fn(),
  connection: vi.fn(),
  persisted: [],
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
  getProviderConnectionById: m.connection,
  getApiKeyProviderConnectionIds: vi.fn(async () => []),
  getProxyPoolById: vi.fn(async () => null),
  createProviderConnection: m.created,
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
vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: vi.fn(async (model) => {
    const [provider, ...rest] = String(model).split("/");
    return { provider, model: rest.join("/") };
  }),
  getComboModels: vi.fn(async () => null),
  getComboCanonicalName: vi.fn(async () => null),
}));
// Proactive refresh as the shared path does it: an OAuth connection whose token
// is about to expire is refreshed through the registered refresh handler, and
// the result is persisted before dispatch. API-key connections pass unchanged.
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  refreshWithRetry: vi.fn(async () => null),
  checkAndRefreshToken: vi.fn(async (provider, credentials) => {
    if (credentials?.authType !== "oauth" || Date.parse(credentials.expiresAt) - Date.now() > 5 * 60_000) return credentials;
    const { refreshTokenByProvider } = await import("../../open-sse/services/tokenRefresh.js");
    const refreshed = await refreshTokenByProvider(provider, credentials, null);
    if (!refreshed?.accessToken) return credentials;
    m.persisted.push({ connectionId: credentials.connectionId, ...refreshed });
    return { ...credentials, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken ?? credentials.refreshToken };
  }),
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

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { RENDERHOUR_GENERATIONS_URL } from "../../open-sse/providers/registry/renderhour.js";
import {
  ADOBE_FIREFLY_GENERATE_URL,
  ADOBE_FIREFLY_VIDEO_GENERATE_URL,
  ADOBE_IMS_TOKEN_URL,
  adobeFireflyCancelUrl,
  adobeFireflyStatusUrl,
} from "../../open-sse/providers/registry/adobe-firefly-api.js";
import { RENDERHOUR_OAUTH_ENDPOINTS } from "../../open-sse/services/renderhour/oauth.js";
import { defaultAdobeTokenCache } from "../../open-sse/services/adobeFireflyApi/auth.js";
import { __clearRefreshDedupCacheForTesting } from "../../open-sse/services/tokenRefresh/dedup.js";
import { PROVIDER_MODELS_CONFIG } from "../../src/app/api/providers/[id]/models/modelsConfig.js";
import { canDiscoverModels } from "../../src/lib/providerRouteHandlers.js";
import { getProvider, generateAuthData, exchangeTokens } from "../../src/lib/oauth/providers.js";
import { selectRenderHourConnection } from "../../src/lib/oauth/services/renderhour.js";
import { ACCEPTED_JOB_HEADER } from "../../open-sse/services/combo.js";

const { handleImageGeneration } = await import("../../src/sse/handlers/imageGeneration.js");
const { handleVideoGeneration } = await import("../../src/sse/handlers/video.js");
const { handleTts } = await import("../../src/sse/handlers/tts.js");
const { POST: createConnection } = await import("@/app/api/providers/route.js");
const { POST: validateConnection } = await import("@/app/api/providers/validate/route.js");

const RH_KEY_A = "rh_synthetic_1127_account_a";
const RH_KEY_B = "rh_synthetic_1127_account_b";
const RH_CLIENT = "rhc_synthetic1127";
const RH_ACCESS_OLD = "rhat_synthetic_old_0001";
const RH_ACCESS_NEW = "rhat_synthetic_new_0002";
const RH_REFRESH_OLD = "rhrt_synthetic_old_0001";
const RH_REFRESH_NEW = "rhrt_synthetic_new_0002";
const FF_CLIENT_A = "synthclienta0000000000000000000a";
const FF_CLIENT_B = "synthclientb0000000000000000000b";
const FF_SECRET_A = "p8e-SYNTHETIC-1127-secret-a";
const FF_SECRET_B = "p8e-SYNTHETIC-1127-secret-b";
const FF_TOKEN_A = "synthetic-1127-ims-token-a";
const FF_TOKEN_B = "synthetic-1127-ims-token-b";
const SECRETS = [RH_KEY_A, RH_KEY_B, RH_ACCESS_OLD, RH_ACCESS_NEW, RH_REFRESH_OLD, RH_REFRESH_NEW, FF_SECRET_A, FF_SECRET_B, FF_TOKEN_A, FF_TOKEN_B];

const IMAGE = "https://renderhour.com/files/1127-image.png";
const VIDEO = "https://renderhour.com/files/1127-video.mp4";
const AUDIO = "https://files.renderhour.com/1127-speech.mp3";
const AUDIO_BYTES = new Uint8Array(1024).map((_, index) => index % 251);
const FF_JOB = "urn:ff:jobs:eso851211:86ffe2ea-d765-4bd3-b2fd-568ca8fc36ac";
const FF_IMAGE = "https://pre-signed-firefly-prod.s3-accelerate.amazonaws.com/images/1127";
const FF_VIDEO = "https://pre-signed-firefly-prod.s3-accelerate.amazonaws.com/videos/1127.mp4";
const ELSEWHERE = "https://collector.invalid/steal";

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const rhQueued = (id = "job-1") => json({ id, status: "queued", outputs: [] }, 201);
const rhRunning = (id = "job-1") => json({ id, status: "running", outputs: [] });
const rhDone = (contentType, url, id = "job-1") => json({ id, status: "succeeded", outputs: [{ content_type: contentType, url }] });
const ims = (token = FF_TOKEN_A) => json({ access_token: token, token_type: "bearer", expires_in: 86_399 });
const ffAccepted = () => json({ jobId: FF_JOB, statusUrl: `${ELSEWHERE}/status`, cancelUrl: `${ELSEWHERE}/cancel` }, 202);
const ffRunning = () => json({ status: "running", jobId: FF_JOB });
const ffImage = () => json({ status: "succeeded", jobId: FF_JOB, result: { outputs: [{ seed: 1, image: { url: FF_IMAGE } }] } });
const ffVideo = () => json({ status: "succeeded", jobId: FF_JOB, result: { outputs: [{ seed: 1, video: { url: FF_VIDEO } }] } });

const rhKey = (connectionId, apiKey) => ({ connectionId, provider: "renderhour", authType: "apikey", apiKey });
const rhOAuth = (connectionId, extra = {}) => ({
  connectionId, provider: "renderhour", authType: "oauth", accessToken: RH_ACCESS_OLD, refreshToken: RH_REFRESH_OLD,
  expiresAt: new Date(Date.now() + 60_000).toISOString(), providerSpecificData: { accountId: "rh-sub-1" }, ...extra,
});
const ffS2s = (connectionId, clientId = FF_CLIENT_A, apiKey = FF_SECRET_A) => ({
  connectionId, provider: "adobe-firefly-api", authType: "apikey", apiKey, providerSpecificData: { clientId },
});

const originalFetch = global.fetch;
let calls;

// Answers by URL and method. An unknown request fails the test.
function network(handler) {
  global.fetch = vi.fn(async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? "GET", init };
    calls.push(call);
    const answer = await handler(call);
    if (!answer) throw new Error(`Unexpected request: ${call.method} ${call.url}`);
    return answer;
  });
}

// Answers in order; each step is a Response or a function of the call.
function sequence(...steps) {
  network((call) => {
    const step = steps.shift();
    return typeof step === "function" ? step(call) : step;
  });
}

const header = (call, name) => {
  const headers = call.init?.headers;
  if (!headers) return undefined;
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
};
const posts = (url) => calls.filter((call) => call.method === "POST" && call.url === url);
const usage = () => m.save.mock.calls.map(([event]) => event);

// Poll waits use timers; advance them until the route answers.
async function settle(promise) {
  let done = false;
  let value;
  let error;
  promise.then((result) => { done = true; value = result; }, (failure) => { done = true; error = failure; });
  const deadline = performance.now() + 15_000;
  while (!done && performance.now() < deadline) {
    await vi.advanceTimersByTimeAsync(250);
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (!done) throw new Error(`route did not answer; calls: ${JSON.stringify(calls.map((call) => [call.method, call.url]))}`);
  if (error) throw error;
  return value;
}

const post = (url, body, init = {}) => new Request(`http://localhost${url}`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), ...init,
});
const image = (body, url = "/v1/images/generations") => settle(handleImageGeneration(post(url, { prompt: "a fox in the snow", ...body })));
const video = (body, init) => settle(handleVideoGeneration(post("/v1/video/generations", { prompt: "waves at dusk", ...body }, init)));
const speech = (body, query = "") => settle(handleTts(post(`/v1/audio/speech${query}`, { input: "Hello there", ...body })));

async function expectNoSecrets(response) {
  const text = await response.clone().text();
  for (const secret of SECRETS) expect(text).not.toContain(secret);
  expect(text).not.toContain("collector.invalid");
}

beforeEach(() => {
  calls = [];
  m.persisted.length = 0;
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) vi.stubEnv(key, undefined);
  vi.stubEnv("RENDERHOUR_OAUTH_CLIENT_ID", RH_CLIENT);
  m.save.mockResolvedValue(true);
  // As the shared account policy: only auth, quota and server failures move to another account.
  m.markUnavailable.mockReset().mockImplementation(async (_id, status) => ({
    shouldFallback: [401, 403, 429].includes(Number(status)) || Number(status) >= 500,
  }));
  // Nothing queued means no account is left, so a fallback loop always ends.
  m.credentials.mockReset().mockResolvedValue({ allRateLimited: true, lastError: "exhausted" });
  m.created.mockImplementation(async (data) => ({ id: "conn-new", ...data }));
  defaultAdobeTokenCache.clear();
  __clearRefreshDedupCacheForTesting();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  global.fetch = originalFetch;
});

describe("registration", () => {
  it("lists both providers with media service kinds and no chat transport", () => {
    const rh = REGISTRY.find((entry) => entry.id === "renderhour");
    const ff = REGISTRY.find((entry) => entry.id === "adobe-firefly-api");
    expect(rh).toMatchObject({ transport: null, authModes: ["apikey", "oauth"], serviceKinds: ["image", "video", "tts"] });
    expect(ff).toMatchObject({ transport: null, serviceKinds: ["image", "video"] });
    expect(ff).not.toHaveProperty("authModes");
    for (const id of ["adobe-firefly", "firefly"]) {
      expect(REGISTRY.some((entry) => [entry.id, entry.alias, entry.uiAlias, ...(entry.aliases ?? [])].includes(id))).toBe(false);
    }
  });

  it("refuses chat on both providers instead of falling back", async () => {
    network(() => null);
    m.credentials.mockResolvedValueOnce(rhKey("rh-a", RH_KEY_A)).mockResolvedValueOnce(ffS2s("ff-a"));
    for (const model of ["renderhour/kling-3.0", "adobe-firefly-api/video1_standard"]) {
      const response = await video({ model, messages: [{ role: "user", content: "hi" }] });
      expect(response.status).toBe(400);
    }
    expect(calls).toEqual([]);
  });
});

describe("connection create and validate", () => {
  it("stores a well-formed rh_ key and refuses any other key before storage", async () => {
    const ok = await createConnection(post("/api/providers", { provider: "renderhour", apiKey: RH_KEY_A, name: "rh-a" }));
    expect(ok.status).toBeLessThan(300);
    expect(m.created).toHaveBeenCalledTimes(1);
    expect(m.created.mock.calls[0][0]).toMatchObject({ provider: "renderhour", authType: "apikey", apiKey: RH_KEY_A });

    const bad = await createConnection(post("/api/providers", { provider: "renderhour", apiKey: "sk-not-renderhour", name: "rh-b" }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "RenderHour needs an rh_ API key" });
    expect(m.created).toHaveBeenCalledTimes(1);
  });

  it("stores an Adobe S2S credential with its client ID and refuses Adobe web-app client IDs", async () => {
    const ok = await createConnection(post("/api/providers", {
      provider: "adobe-firefly-api", apiKey: FF_SECRET_A, name: "ff-a", providerSpecificData: { clientId: FF_CLIENT_A },
    }));
    expect(ok.status).toBeLessThan(300);
    expect(m.created.mock.calls[0][0]).toMatchObject({ provider: "adobe-firefly-api", apiKey: FF_SECRET_A, providerSpecificData: { clientId: FF_CLIENT_A } });

    for (const providerSpecificData of [{}, { clientId: "clio-playground-web" }]) {
      const bad = await createConnection(post("/api/providers", { provider: "adobe-firefly-api", apiKey: FF_SECRET_A, name: "ff-x", providerSpecificData }));
      expect(bad.status).toBe(400);
      await expectNoSecrets(bad);
    }
    expect(m.created).toHaveBeenCalledTimes(1);
  });

  it("validates a RenderHour key locally without sending it anywhere", async () => {
    network(() => null);
    const good = await (await validateConnection(post("/api/providers/validate", { provider: "renderhour", apiKey: RH_KEY_A }))).json();
    expect(good).toMatchObject({ valid: true, skipped: true });
    const bad = await (await validateConnection(post("/api/providers/validate", { provider: "renderhour", apiKey: "rhat_token" }))).json();
    expect(bad).toMatchObject({ valid: false, error: "RenderHour needs an rh_ API key" });
    expect(calls).toEqual([]);
  });

  it("validates an Adobe credential with one IMS token request and nothing else", async () => {
    sequence(ims(), json({ error: "invalid_client", error_description: `bad ${FF_SECRET_B}` }, 401));
    const good = await validateConnection(post("/api/providers/validate", { provider: "adobe-firefly-api", apiKey: FF_SECRET_A, providerSpecificData: { clientId: FF_CLIENT_A } }));
    expect(await good.json()).toMatchObject({ valid: true });
    const bad = await validateConnection(post("/api/providers/validate", { provider: "adobe-firefly-api", apiKey: FF_SECRET_B, providerSpecificData: { clientId: FF_CLIENT_B } }));
    expect(await bad.clone().json()).toMatchObject({ valid: false });
    await expectNoSecrets(bad);
    expect(calls.map((call) => [call.method, call.url])).toEqual([["POST", ADOBE_IMS_TOKEN_URL], ["POST", ADOBE_IMS_TOKEN_URL]]);
    expect(String(calls[0].init.body)).toContain("grant_type=client_credentials");
  });
});

describe("account-scoped discovery", () => {
  it("answers each provider's pinned list for the selected connection only, without a request", async () => {
    network(() => null);
    const rh = await PROVIDER_MODELS_CONFIG.renderhour.customResolver(rhKey("a", RH_KEY_A));
    expect(rh.source).toBe("local_catalog");
    expect(rh.models).toHaveLength(11 + 16 + 3);
    expect(new Set(rh.models.map((model) => model.kind))).toEqual(new Set(["image", "video", "tts"]));
    const oauth = await PROVIDER_MODELS_CONFIG.renderhour.customResolver(rhOAuth("b"));
    expect(oauth.models).toEqual(rh.models);
    expect(await PROVIDER_MODELS_CONFIG.renderhour.customResolver({ apiKey: "sk-other" })).toMatchObject({ status: 401 });

    const ff = await PROVIDER_MODELS_CONFIG["adobe-firefly-api"].customResolver(ffS2s("c"));
    expect(ff.models.map(({ id, kind }) => [id, kind])).toEqual([
      ["image3", "image"], ["image4_standard", "image"], ["image4_ultra", "image"], ["video1_standard", "video"],
    ]);
    expect(await PROVIDER_MODELS_CONFIG["adobe-firefly-api"].customResolver({ apiKey: FF_SECRET_A })).toMatchObject({ status: 401 });
    expect(canDiscoverModels({ provider: "renderhour", apiKey: RH_KEY_A })).toBe(true);
    expect(canDiscoverModels({ provider: "adobe-firefly-api", apiKey: FF_SECRET_A })).toBe(false);
    expect(canDiscoverModels({ provider: "adobe-firefly-api", ...ffS2s("c") })).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe("RenderHour through the public routes", () => {
  it("image: submits once, polls and returns URLs with returned-image usage on the selected account", async () => {
    m.credentials.mockResolvedValueOnce(rhKey("rh-a", RH_KEY_A));
    sequence(rhQueued(), rhRunning(), rhDone("image/png", IMAGE));
    const response = await image({ model: "renderhour/z-image", response_format: "url" });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([{ url: IMAGE }]);
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ["POST", RENDERHOUR_GENERATIONS_URL], ["GET", `${RENDERHOUR_GENERATIONS_URL}/job-1`], ["GET", `${RENDERHOUR_GENERATIONS_URL}/job-1`],
    ]);
    expect(calls.every((call) => header(call, "Authorization") === `Bearer ${RH_KEY_A}`)).toBe(true);
    expect(header(calls[0], "Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: "renderhour", model: "z-image", connectionId: "rh-a", nativeUnits: { images: 1 }, cost: null, costStatus: "unknown" });
  });

  it("image: refuses b64_json and binary output before anything is sent", async () => {
    network(() => null);
    m.credentials.mockResolvedValue(rhKey("rh-a", RH_KEY_A));
    const b64 = await image({ model: "renderhour/z-image", response_format: "b64_json" });
    expect(b64.status).toBe(400);
    expect((await b64.json()).error.message).toMatch(/response_format url only/);
    const binary = await image({ model: "renderhour/z-image" }, "/v1/images/generations?response_format=binary");
    expect(binary.status).toBe(400);
    expect(calls).toEqual([]);
    expect(usage()).toEqual([]);
  });

  it("video: submits once, polls and returns the file URL; b64_json and image input are refused before submit", async () => {
    m.credentials.mockResolvedValue(rhKey("rh-a", RH_KEY_A));
    network(() => null);
    expect((await video({ model: "renderhour/kling-3.0", response_format: "b64_json" })).status).toBe(400);
    expect((await video({ model: "renderhour/kling-3.0", image_url: "https://example.com/a.png" })).status).toBe(400);
    expect(calls).toEqual([]);

    sequence(rhQueued(), rhRunning(), rhDone("video/mp4", VIDEO));
    const response = await video({ model: "renderhour/kling-3.0", size: "1280x720", duration: 5 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: [{ url: VIDEO, format: "mp4" }] });
    expect(JSON.parse(String(posts(RENDERHOUR_GENERATIONS_URL)[0].init.body))).toEqual({
      model: "kling-3.0", prompt: "waves at dusk", duration_s: 5, aspect_ratio: "16:9",
    });
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ provider: "renderhour", connectionId: "rh-a", endpoint: "/v1/video/generations", modality: "video", nativeUnits: { videos: 1 }, cost: null });
  });

  it("speech: polls, downloads the file without the key and returns its real container; named containers are refused first", async () => {
    m.credentials.mockResolvedValue(rhKey("rh-a", RH_KEY_A));
    network(() => null);
    const wav = await speech({ model: "renderhour/eleven-v4" }, "?response_format=wav");
    expect(wav.status).toBe(400);
    expect(calls).toEqual([]);

    sequence(rhQueued(), rhDone("audio/mpeg", AUDIO), new Response(AUDIO_BYTES, { headers: { "content-type": "audio/mpeg" } }));
    const response = await speech({ model: "renderhour/eleven-v4" });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("audio/mp3");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(AUDIO_BYTES);
    const download = calls.find((call) => call.url === AUDIO);
    expect(header(download, "Authorization")).toBeUndefined();
    expect(JSON.stringify(download.init)).not.toContain(RH_KEY_A);
    expect(usage()[0]).toMatchObject({ provider: "renderhour", endpoint: "/v1/audio/speech", modality: "tts", connectionId: "rh-a", nativeUnits: { characters: 11 } });

    sequence(rhQueued(), rhDone("audio/mpeg", AUDIO), new Response(AUDIO_BYTES, { headers: { "content-type": "audio/mpeg" } }));
    const wrapped = await speech({ model: "renderhour/eleven-v4" }, "?response_format=json");
    expect(await wrapped.json()).toMatchObject({ format: "mp3" });
  });

  it("OAuth: refreshes an expiring plan token through the registered handler, persists the rotation and submits with the new token", async () => {
    m.credentials.mockResolvedValueOnce(rhOAuth("rh-oauth"));
    sequence(
      json({ access_token: RH_ACCESS_NEW, refresh_token: RH_REFRESH_NEW, token_type: "Bearer", expires_in: 3600 }),
      rhQueued(), rhDone("image/png", IMAGE),
    );
    const response = await image({ model: "renderhour/z-image" });
    expect(response.status).toBe(200);
    const [refresh, submit, poll] = calls;
    expect([refresh.method, refresh.url]).toEqual(["POST", RENDERHOUR_OAUTH_ENDPOINTS.token]);
    // Redirects are refused on every OAuth request.
    expect(refresh.init.redirect).toBe("error");
    const form = new URLSearchParams(String(refresh.init.body));
    expect(Object.fromEntries(form)).toEqual({ grant_type: "refresh_token", refresh_token: RH_REFRESH_OLD, client_id: RH_CLIENT });
    expect(m.persisted).toEqual([expect.objectContaining({ connectionId: "rh-oauth", accessToken: RH_ACCESS_NEW, refreshToken: RH_REFRESH_NEW })]);
    expect(header(submit, "Authorization")).toBe(`Bearer ${RH_ACCESS_NEW}`);
    expect(header(poll, "Authorization")).toBe(`Bearer ${RH_ACCESS_NEW}`);
    await expectNoSecrets(response);
  });

  it("OAuth: a spent refresh token is not retried and the request is never submitted with an API-key path", async () => {
    m.credentials.mockResolvedValueOnce(rhOAuth("rh-oauth", { accessToken: undefined }));
    m.credentials.mockResolvedValue({ allRateLimited: true, lastError: "exhausted" });
    sequence(json({ error: "invalid_grant" }, 400));
    const response = await image({ model: "renderhour/z-image" });
    expect(response.status).toBe(401);
    expect(posts(RENDERHOUR_OAUTH_ENDPOINTS.token)).toHaveLength(1);
    expect(posts(RENDERHOUR_GENERATIONS_URL)).toHaveLength(0);
    expect(m.persisted).toEqual([]);
    await expectNoSecrets(response);
  });

  it("OAuth sign-in: refuses to start without an operator client id, then exchanges with PKCE and keeps two accounts apart", async () => {
    vi.stubEnv("RENDERHOUR_OAUTH_CLIENT_ID", "");
    await expect(generateAuthData("renderhour", "http://localhost:20128/callback")).rejects.toThrow(/RENDERHOUR_OAUTH_CLIENT_ID|client id/i);
    vi.stubEnv("RENDERHOUR_OAUTH_CLIENT_ID", RH_CLIENT);
    expect(getProvider("renderhour").flowType).toBe("authorization_code_pkce");
    const auth = await generateAuthData("renderhour", "http://localhost:20128/callback");
    const authorize = new URL(auth.authUrl);
    expect(authorize.origin + authorize.pathname).toBe(RENDERHOUR_OAUTH_ENDPOINTS.authorize);
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({ client_id: RH_CLIENT, code_challenge_method: "S256", state: auth.state });

    sequence(
      json({ access_token: RH_ACCESS_NEW, refresh_token: RH_REFRESH_NEW, token_type: "Bearer", expires_in: 3600 }),
      json({ sub: "rh-sub-2", email: "shared@example.invalid", name: "B" }),
    );
    const mapped = await exchangeTokens("renderhour", "the-code", auth.redirectUri, auth.codeVerifier, auth.state, {});
    expect(mapped).toMatchObject({ accessToken: RH_ACCESS_NEW, refreshToken: RH_REFRESH_NEW, providerSpecificData: { accountId: "rh-sub-2" } });
    expect(calls.map((call) => call.init.redirect)).toEqual(["error", "error"]);
    const stored = [
      { id: "one", provider: "renderhour", authType: "oauth", email: "shared@example.invalid", providerSpecificData: { accountId: "rh-sub-1" } },
    ];
    // Same email, different account id: a new connection, never an overwrite.
    expect(selectRenderHourConnection(stored, mapped)).toBeNull();
    expect(selectRenderHourConnection([...stored, { ...stored[0], id: "two", providerSpecificData: { accountId: "rh-sub-2" } }], mapped)?.id).toBe("two");
  });

  it("429 with Retry-After: no job, the reset reaches account cooldown and the client sees Retry-After", async () => {
    m.credentials.mockResolvedValueOnce(rhKey("rh-a", RH_KEY_A)).mockResolvedValue({ allRateLimited: true, lastError: "limited", retryAfter: null });
    m.markUnavailable.mockResolvedValue({ shouldFallback: false });
    sequence(json({ error: { message: `slow down ${RH_KEY_A}` } }, 429, { "retry-after": "120" }));
    const response = await image({ model: "renderhour/z-image" });
    expect(response.status).toBe(429);
    const resetAt = m.markUnavailable.mock.calls[0][5];
    expect(resetAt).toBeGreaterThanOrEqual(Date.now() + 119_000);
    expect(posts(RENDERHOUR_GENERATIONS_URL)).toHaveLength(1);
    expect(usage()).toEqual([]);
    await expectNoSecrets(response);
  });

  it("refuses a redirected submit without following it or sending the key elsewhere, and lets the next account try", async () => {
    m.credentials.mockResolvedValueOnce(rhKey("rh-a", RH_KEY_A)).mockResolvedValueOnce(rhKey("rh-b", RH_KEY_B))
      .mockResolvedValue({ allRateLimited: true, lastError: "exhausted" });
    sequence(new Response(null, { status: 307, headers: { location: ELSEWHERE } }), rhQueued(), rhDone("image/png", IMAGE));
    const response = await image({ model: "renderhour/z-image" });
    expect(response.status).toBe(200);
    expect(calls.some((call) => call.url.startsWith("https://collector.invalid"))).toBe(false);
    expect(posts(RENDERHOUR_GENERATIONS_URL).map((call) => call.init.redirect)).toEqual(["manual", "manual"]);
    expect(posts(RENDERHOUR_GENERATIONS_URL).map((call) => header(call, "Authorization"))).toEqual([`Bearer ${RH_KEY_A}`, `Bearer ${RH_KEY_B}`]);
    expect(usage()).toHaveLength(1);
    expect(usage()[0].connectionId).toBe("rh-b");
  });

  it("does not resubmit a submit whose outcome is unknown to another account and records it once on the sender", async () => {
    m.credentials.mockResolvedValueOnce(rhKey("rh-a", RH_KEY_A)).mockResolvedValueOnce(rhKey("rh-b", RH_KEY_B));
    sequence(() => { throw Object.assign(new TypeError("socket hang up"), { cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }) }); });
    const response = await video({ model: "renderhour/kling-3.0" });
    expect(response.status).toBe(502);
    expect(posts(RENDERHOUR_GENERATIONS_URL)).toHaveLength(1);
    expect(usage()).toHaveLength(1);
    expect(usage()[0]).toMatchObject({ connectionId: "rh-a", status: "accepted", costSource: "accepted-job", meta: { jobState: "submit-unknown" } });

    m.save.mockClear();
    calls = [];
    m.credentials.mockReset().mockResolvedValueOnce(rhKey("rh-a", RH_KEY_A)).mockResolvedValueOnce(rhKey("rh-b", RH_KEY_B));
    sequence(() => { throw Object.assign(new TypeError("socket hang up"), { cause: Object.assign(new Error("reset"), { code: "ECONNRESET" }) }); });
    const tts = await speech({ model: "renderhour/eleven-v4" });
    expect(tts.status).toBe(502);
    expect(posts(RENDERHOUR_GENERATIONS_URL)).toHaveLength(1);
    expect(usage()).toEqual([expect.objectContaining({ connectionId: "rh-a", status: "accepted", modality: "tts", meta: { jobState: "submit-unknown" } })]);
  });

  it("expiry and cancel: a job past its deadline and a client disconnect are recorded as accepted jobs, never resubmitted", async () => {
    m.credentials.mockResolvedValueOnce(rhKey("rh-a", RH_KEY_A)).mockResolvedValueOnce(rhKey("rh-b", RH_KEY_B));
    network((call) => (call.method === "POST" ? rhQueued() : rhRunning()));
    const expired = await image({ model: "renderhour/z-image" });
    expect(expired.status).toBe(504);
    expect(expired.headers.get(ACCEPTED_JOB_HEADER)).toBe("1");
    expect(posts(RENDERHOUR_GENERATIONS_URL)).toHaveLength(1);
    expect(usage()).toEqual([expect.objectContaining({ connectionId: "rh-a", status: "accepted", meta: { jobState: "accepted" } })]);

    m.save.mockClear();
    calls = [];
    m.credentials.mockReset().mockResolvedValueOnce(rhKey("rh-a", RH_KEY_A)).mockResolvedValueOnce(rhKey("rh-b", RH_KEY_B));
    const controller = new AbortController();
    network((call) => {
      if (call.method === "POST") return rhQueued();
      controller.abort();
      return rhRunning();
    });
    const cancelled = await video({ model: "renderhour/kling-3.0" }, { signal: controller.signal });
    expect(cancelled.status).toBe(499);
    expect(posts(RENDERHOUR_GENERATIONS_URL)).toHaveLength(1);
    expect(usage()).toEqual([expect.objectContaining({ connectionId: "rh-a", status: "accepted", modality: "video" })]);
  });

  it("keeps two accounts apart under concurrency", async () => {
    m.credentials.mockResolvedValueOnce(rhKey("rh-a", RH_KEY_A)).mockResolvedValueOnce(rhKey("rh-b", RH_KEY_B));
    network((call) => {
      const key = header(call, "Authorization");
      const id = key === `Bearer ${RH_KEY_A}` ? "job-a" : "job-b";
      if (call.method === "POST") return rhQueued(id);
      expect(call.url).toBe(`${RENDERHOUR_GENERATIONS_URL}/${id}`);
      return rhDone("image/png", id === "job-a" ? IMAGE : `${IMAGE}?b`, id);
    });
    const [a, b] = await Promise.all([image({ model: "renderhour/z-image" }), image({ model: "renderhour/z-image" })]);
    expect((await a.json()).data[0].url).toBe(IMAGE);
    expect((await b.json()).data[0].url).toBe(`${IMAGE}?b`);
    expect(usage().map((event) => event.connectionId).sort()).toEqual(["rh-a", "rh-b"]);
  });
});

describe("Adobe Firefly Services API through the public routes", () => {
  it("image: mints, submits once with x-api-key and x-model-version, polls the fixed origin and returns the URL", async () => {
    m.credentials.mockResolvedValueOnce(ffS2s("ff-a"));
    sequence(ims(), ffAccepted(), ffRunning(), ffImage());
    const response = await image({ model: "adobe-firefly-api/image4_standard" });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([{ url: FF_IMAGE }]);
    expect(calls.map((call) => [call.method, call.url])).toEqual([
      ["POST", ADOBE_IMS_TOKEN_URL], ["POST", ADOBE_FIREFLY_GENERATE_URL],
      ["GET", adobeFireflyStatusUrl(FF_JOB)], ["GET", adobeFireflyStatusUrl(FF_JOB)],
    ]);
    expect(header(calls[1], "x-api-key")).toBe(FF_CLIENT_A);
    expect(header(calls[1], "x-model-version")).toBe("image4_standard");
    expect(header(calls[1], "Authorization")).toBe(`Bearer ${FF_TOKEN_A}`);
    expect(usage()[0]).toMatchObject({ provider: "adobe-firefly-api", connectionId: "ff-a", nativeUnits: { images: 1 }, cost: null });
  });

  it("image: b64_json and binary are refused before the token is minted", async () => {
    network(() => null);
    m.credentials.mockResolvedValue(ffS2s("ff-a"));
    expect((await image({ model: "adobe-firefly-api/image3", response_format: "b64_json" })).status).toBe(400);
    expect((await image({ model: "adobe-firefly-api/image3" }, "/v1/images/generations?response_format=binary")).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it("video: Adobe's native model through /v1/video/generations, reusing the cached token; never on /v1/videos", async () => {
    m.credentials.mockResolvedValue(ffS2s("ff-a"));
    sequence(ims(), ffAccepted(), ffVideo(), ffAccepted(), ffVideo());
    const first = await video({ model: "adobe-firefly-api/video1_standard", size: "1280x720" });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ data: [{ url: FF_VIDEO }] });
    const second = await video({ model: "adobe-firefly-api/video1_standard" });
    expect(second.status).toBe(200);
    expect(posts(ADOBE_IMS_TOKEN_URL)).toHaveLength(1);
    expect(posts(ADOBE_FIREFLY_VIDEO_GENERATE_URL)).toHaveLength(2);
    expect(JSON.parse(String(posts(ADOBE_FIREFLY_VIDEO_GENERATE_URL)[0].init.body))).toMatchObject({ sizes: [{ width: 1280, height: 720 }] });
    expect(usage().map((event) => [event.connectionId, event.modality, event.nativeUnits])).toEqual([
      ["ff-a", "video", { videos: 1 }], ["ff-a", "video", { videos: 1 }],
    ]);
    network(() => null);
    expect((await video({ model: "adobe-firefly-api/video1_standard", response_format: "b64_json" })).status).toBe(400);
    expect((await video({ model: "adobe-firefly-api/image3" })).status).toBe(400);
  });

  it("video cancel: a client disconnect during polling cancels on the fixed origin and records the accepted job once", async () => {
    m.credentials.mockResolvedValue(ffS2s("ff-a"));
    const controller = new AbortController();
    network((call) => {
      if (call.url === ADOBE_IMS_TOKEN_URL) return ims();
      if (call.url === ADOBE_FIREFLY_VIDEO_GENERATE_URL) return ffAccepted();
      if (call.url === adobeFireflyStatusUrl(FF_JOB)) { controller.abort(); return ffRunning(); }
      if (call.url === adobeFireflyCancelUrl(FF_JOB)) return new Response(null, { status: 200 });
      return null;
    });
    const response = await video({ model: "adobe-firefly-api/video1_standard" }, { signal: controller.signal });
    expect(response.status).toBe(499);
    expect(posts(ADOBE_FIREFLY_VIDEO_GENERATE_URL)).toHaveLength(1);
    expect(calls.some((call) => call.url.startsWith("https://collector.invalid"))).toBe(false);
    expect(usage()).toEqual([expect.objectContaining({ connectionId: "ff-a", status: "accepted", modality: "video" })]);
  });

  it("quota: a submit 403 or 429 is not retried, keeps Retry-After and never repeats the secret", async () => {
    m.credentials.mockResolvedValueOnce(ffS2s("ff-a")).mockResolvedValue({ allRateLimited: true, lastError: "limited" });
    m.markUnavailable.mockResolvedValue({ shouldFallback: false });
    sequence(ims(), json({ message: `quota ${FF_SECRET_A}` }, 429, { "retry-after": "60" }));
    const response = await image({ model: "adobe-firefly-api/image3" });
    expect(response.status).toBe(429);
    expect(m.markUnavailable.mock.calls[0][5]).toBeGreaterThanOrEqual(Date.now() + 59_000);
    expect(posts(ADOBE_FIREFLY_GENERATE_URL)).toHaveLength(1);
    await expectNoSecrets(response);
  });

  it("an expired pasted token is refused with 401 before anything is sent", async () => {
    network(() => null);
    m.credentials.mockResolvedValueOnce({
      connectionId: "ff-p", provider: "adobe-firefly-api", authType: "apikey", accessToken: "synthetic-pasted-token-0001",
      expiresAt: new Date(Date.now() - 1000).toISOString(), providerSpecificData: { clientId: FF_CLIENT_A },
    }).mockResolvedValue({ allRateLimited: true, lastError: "expired" });
    m.markUnavailable.mockResolvedValue({ shouldFallback: false });
    const response = await video({ model: "adobe-firefly-api/video1_standard" });
    expect(response.status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("keeps two accounts' tokens apart under concurrency", async () => {
    m.credentials.mockResolvedValueOnce(ffS2s("ff-a")).mockResolvedValueOnce(ffS2s("ff-b", FF_CLIENT_B, FF_SECRET_B));
    network((call) => {
      if (call.url === ADOBE_IMS_TOKEN_URL) {
        return ims(new URLSearchParams(String(call.init.body)).get("client_id") === FF_CLIENT_A ? FF_TOKEN_A : FF_TOKEN_B);
      }
      if (call.url === ADOBE_FIREFLY_GENERATE_URL) return ffAccepted();
      if (call.url === adobeFireflyStatusUrl(FF_JOB)) return ffImage();
      return null;
    });
    const [a, b] = await Promise.all([image({ model: "adobe-firefly-api/image3" }), image({ model: "adobe-firefly-api/image3" })]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const pairs = posts(ADOBE_FIREFLY_GENERATE_URL).map((call) => [header(call, "x-api-key"), header(call, "Authorization")]).sort();
    expect(pairs).toEqual([[FF_CLIENT_A, `Bearer ${FF_TOKEN_A}`], [FF_CLIENT_B, `Bearer ${FF_TOKEN_B}`]]);
  });
});
