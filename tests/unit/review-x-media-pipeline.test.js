// Issue 2282: music, video, search and fetch share the media pipeline.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  const previousDataDir = process.env.DATA_DIR;
  const dataDir = `${process.env.TMPDIR || "/tmp"}/media-pipeline-${process.pid}-${Date.now()}`;
  process.env.DATA_DIR = dataDir;
  return { previousDataDir, dataDir, authOk: true, duringDispatch: null };
});

const auth = vi.hoisted(() => ({
  resolveClientApiKey: vi.fn(),
  getProviderCredentialsWithQuotaPreflight: vi.fn(),
  getNoAuthProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  projectProviderCredentials: vi.fn(),
}));
const cores = vi.hoisted(() => ({ music: vi.fn(), videoProxy: vi.fn(), videoSync: vi.fn(), search: vi.fn(), fetch: vi.fn() }));
const refresh = vi.hoisted(() => vi.fn(async (_provider, credentials) => credentials));

vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: true }),
  getApiKeyByKey: async () => null,
  getCombos: async () => [],
  getComboForModel: async () => null,
  getProviderConnectionById: async (id) => ({ id, provider: id.startsWith("music") ? "suno" : "xai" }),
  getApiKeyProviderConnectionIds: async () => [],
  getProviderConnections: async () => [],
}));
vi.mock("@/lib/db/repos/usageRepo.js", () => ({ getBillingEpoch: async () => null, assertBillingEpochSync: vi.fn(), retractAcceptedUsage: vi.fn() }));
vi.mock("@/lib/db/repos/mediaJobsRepo.js", () => ({
  createMediaJob: vi.fn(),
  getMediaJob: async ({ provider, resourceId, connectionId }) => ({ provider, model: "job-model", resourceId, connectionId }),
  finishMediaJob: vi.fn(),
}));
vi.mock("@/lib/db/driver.js", () => ({ getAdapter: async () => ({ transaction: (run) => run() }) }));
vi.mock("@/sse/services/auth.js", () => auth);
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: async (value) => { const [provider, ...model] = String(value).split("/"); return { provider, model: model.join("/") }; },
  getAutoComboCatalog: async () => null,
  filterDisabledComboModels: async (models) => models,
}));
vi.mock("@/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: async () => null,
  recordAcceptedJobUsage: vi.fn(),
  recordApiKeyUsage: vi.fn(),
  recordApiKeyUsageForResponse: async (_key, response) => response,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: refresh, updateProviderCredentials: vi.fn() }));
vi.mock("@/sse/handlers/modelKind.js", () => ({ modelKindError: async () => null }));
vi.mock("@/sse/handlers/imageModelKind.js", () => ({ imageModelKindError: async () => null }));
vi.mock("@/shared/utils/ssrfGuard.js", async (original) => ({ ...await original(), assertPublicUrlResolved: async () => {} }));
vi.mock("open-sse/handlers/musicGenerationCore.js", () => ({ handleMusicGenerationCore: cores.music }));
vi.mock("open-sse/handlers/videoGenerationCore.js", () => ({ handleVideoGenerationCore: cores.videoSync, supportsVideoGeneration: (provider) => provider === "veoaifree-web" }));
vi.mock("open-sse/handlers/videoCore.js", async (original) => ({ ...await original(), handleVideoProxyCore: cores.videoProxy }));
vi.mock("open-sse/handlers/search/index.js", () => ({ handleSearchCore: cores.search }));
vi.mock("open-sse/handlers/fetch/index.js", () => ({ handleFetchCore: cores.fetch }));

const { handleMusicGeneration, handleMusicGet } = await import("@/sse/handlers/music.js");
const { handleVideoGeneration, handleVideoCreate, handleVideoGet } = await import("@/sse/handlers/video.js");
const { handleSearch } = await import("@/sse/handlers/search.js");
const { handleFetch } = await import("@/sse/handlers/fetch.js");

function post(route, body, signal) {
  return new Request(`http://localhost${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
}

function get(route, connectionId, signal) {
  return new Request(`http://localhost${route}`, { headers: { "x-9router-connection-id": connectionId }, signal });
}

const routes = {
  "music generation": (signal) => handleMusicGeneration(post("/v1/music/generations", { model: "suno/chirp", prompt: "waves" }, signal)),
  "music poll": (signal) => handleMusicGet(get("/v1/music/generations/job-1", "music-1", signal), "job-1"),
  "video generation": (signal) => handleVideoGeneration(post("/v1/video/generations", { model: "veoaifree-web/veo", prompt: "waves" }, signal)),
  "video create": (signal) => handleVideoCreate(post("/v1/videos/generations", { model: "xai/grok-imagine-video", prompt: "waves" }, signal), "generations"),
  "video poll": (signal) => handleVideoGet(get("/v1/videos/job-1", "video-1", signal), "job-1"),
  search: (signal) => handleSearch(post("/v1/search", { provider: "tavily", query: "doors" }, signal)),
  fetch: (signal) => handleFetch(post("/v1/web/fetch", { provider: "tavily", url: "https://example.test/page" }, signal)),
};

// Routes whose failed upstream attempt cools down the account.
const marking = {
  "music generation": cores.music,
  "video create": cores.videoProxy,
  "video poll": cores.videoProxy,
  search: cores.search,
  fetch: cores.fetch,
};

const coreCalls = () => Object.values(cores).reduce((total, core) => total + core.mock.calls.length, 0);
const failure = () => ({ success: false, status: 503, error: "upstream down", response: new Response("{}", { status: 503 }) });

beforeEach(() => {
  vi.clearAllMocks();
  state.authOk = true;
  auth.resolveClientApiKey.mockImplementation(async () => (state.authOk
    ? { apiKey: "caller-secret", auth: { ok: true, apiKeyId: "caller", billingEpoch: null } }
    : { apiKey: null, auth: { ok: false, reason: "missing" } }));
  auth.getProviderCredentialsWithQuotaPreflight.mockImplementation(async (_provider, excluded, _model, options) => (excluded?.size
    ? null
    : { connectionId: options.strictConnectionId || options.preferredConnectionId || "account-a", apiKey: "provider-secret" }));
  auth.markAccountUnavailable.mockResolvedValue({ shouldFallback: true });
  for (const core of Object.values(cores)) core.mockImplementation(async () => failure());
});

afterAll(() => {
  fs.rmSync(state.dataDir, { recursive: true, force: true });
  if (state.previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = state.previousDataDir;
});

describe("music, video, search and fetch on the media pipeline", () => {
  const handlers = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src/sse/handlers");

  it.each(["music.js", "video.js", "search.js", "fetch.js"])("%s enters through runMediaEndpoint", (file) => {
    const source = fs.readFileSync(path.join(handlers, file), "utf8");
    expect(source).toMatch(/return runMediaEndpoint\(request, \{/);
    expect(source).not.toMatch(/\badmit\(/);
  });

  it.each(Object.keys(routes))("%s rejects an unauthenticated caller before dispatch", async (name) => {
    state.authOk = false;
    const response = await routes[name]();
    expect(response.status).toBe(401);
    expect(auth.getProviderCredentialsWithQuotaPreflight).not.toHaveBeenCalled();
    expect(coreCalls()).toBe(0);
  });

  it.each(Object.keys(routes))("%s does not dispatch for a disconnected caller", async (name) => {
    const response = await routes[name](AbortSignal.abort());
    expect(response.status).toBe(499);
    expect(auth.resolveClientApiKey).toHaveBeenCalled();
    expect(auth.getProviderCredentialsWithQuotaPreflight).not.toHaveBeenCalled();
    expect(coreCalls()).toBe(0);
  });

  it.each(Object.keys(marking))("%s does not cool down an account when the caller leaves mid-request", async (name) => {
    const caller = new AbortController();
    marking[name].mockImplementation(async () => {
      caller.abort();
      return failure();
    });
    await routes[name](caller.signal);
    expect(marking[name]).toHaveBeenCalledTimes(1);
    expect(auth.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it.each(Object.keys(marking))("%s still records a failure for a connected caller", async (name) => {
    await routes[name]();
    expect(auth.markAccountUnavailable).toHaveBeenCalled();
  });

  it.each(["music generation", "music poll", "video create", "video poll", "search", "fetch"])("%s refreshes credentials before dispatch", async (name) => {
    await routes[name]();
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps preferred pinning on submits and strict pinning on polls", async () => {
    const pinned = post("/v1/music/generations", { model: "suno/chirp", prompt: "waves" });
    pinned.headers.set("x-connection-id", "music-7");
    await handleMusicGeneration(pinned);
    expect(auth.getProviderCredentialsWithQuotaPreflight.mock.calls[0][3]).toEqual({ preferredConnectionId: "music-7", apiKeyId: "caller" });

    auth.getProviderCredentialsWithQuotaPreflight.mockClear();
    await routes["video poll"]();
    expect(auth.getProviderCredentialsWithQuotaPreflight.mock.calls[0][3]).toEqual({
      preferredConnectionId: "video-1", strictConnectionId: "video-1", apiKeyId: "caller", videoPoll: true,
    });
  });
});
