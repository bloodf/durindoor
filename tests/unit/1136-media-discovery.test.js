// #1136: media model discovery.
//
// The slice answers three questions offline:
//   1. which provider can serve a media kind (its transport), and which
//      endpoint of that kind it can serve,
//   2. what the gateway answers when a model cannot run on the endpoint that
//      was asked for, and
//   3. what request/response each vendor actually gets, recorded as offline
//      fixtures with their live verification gaps named.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mocks = vi.hoisted(() => ({
  buildModelsList: vi.fn(async () => []),
  getSettings: vi.fn(async () => ({})),
  getProviderConnections: vi.fn(async () => []),
  getApiKeyProviderConnectionIds: vi.fn(async () => []),
  resolveClientApiKey: vi.fn(async () => ({ apiKey: "caller-key", auth: { ok: true, apiKeyId: "caller-key-id" } })),
  getProviderCredentialsWithQuotaPreflight: vi.fn(async () => ({ connectionId: "c1", connectionName: "c1", apiKey: "provider-key" })),
  getNoAuthProviderCredentials: vi.fn(async () => ({})),
  handleVideoGenerationCore: vi.fn(),
  handleVideoProxyCore: vi.fn(),
  createMediaJob: vi.fn(async (job) => job),
  getMediaJob: vi.fn(async () => null)
}));

vi.mock("@/shared/models/buildModelsList.js", () => ({ buildModelsList: mocks.buildModelsList }));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getProviderConnections: mocks.getProviderConnections,
  getApiKeyProviderConnectionIds: mocks.getApiKeyProviderConnectionIds,
  getProviderConnectionById: vi.fn(async () => null),
  getCombos: vi.fn(async () => []),
  getComboForModel: vi.fn(async () => null),
  getCustomModels: vi.fn(async () => []),
  getSyncedModelCatalog: vi.fn(async () => null),
  getProviderNodes: vi.fn(async () => []),
  getApiKeyByKey: vi.fn(async () => null),
  getApiKeyById: vi.fn(async () => null),
  getApiKeyUsageTotals: vi.fn(async () => ({})),
  getPricingForModel: vi.fn(async () => null),
  saveRequestUsage: vi.fn(async () => true)
}));
// Keyless providers (veoaifree-web, edge-tts…) would be probed over the real
// network here; the slice is offline.
vi.mock("../../src/sse/services/keylessAvailability.js", () => ({ isKeylessProviderWorking: vi.fn(async () => true) }));
vi.mock("../../src/sse/services/auth.js", () => ({
  resolveClientApiKey: mocks.resolveClientApiKey,
  getProviderCredentialsWithQuotaPreflight: mocks.getProviderCredentialsWithQuotaPreflight,
  getNoAuthProviderCredentials: mocks.getNoAuthProviderCredentials,
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
  clearAccountError: vi.fn()
}));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: vi.fn(async () => null),
  recordApiKeyUsage: vi.fn(async () => true),
  recordAcceptedJobUsage: vi.fn(async () => true),
  recordApiKeyUsageForResponse: vi.fn(async (_key, response) => response)
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  updateProviderCredentials: vi.fn()
}));
vi.mock("../../src/sse/services/model.js", async (importOriginal) => {
  const actual = await importOriginal();
  const { resolveProviderId } = await import("../../src/shared/constants/providers.js");
  return {
    ...actual,
    getModelInfo: vi.fn(async (modelStr) => {
      const [prefix, ...rest] = String(modelStr).split("/");
      return rest.length ? { provider: resolveProviderId(prefix), model: rest.join("/") } : { provider: null, model: modelStr };
    })
  };
});
vi.mock("@/lib/db/repos/mediaJobsRepo.js", () => ({
  createMediaJob: mocks.createMediaJob,
  getMediaJob: mocks.getMediaJob,
  finishMediaJob: vi.fn()
}));
vi.mock("open-sse/handlers/videoGenerationCore.js", async (importOriginal) => ({
  ...(await importOriginal()),
  handleVideoGenerationCore: mocks.handleVideoGenerationCore
}));
vi.mock("open-sse/handlers/videoCore.js", async (importOriginal) => ({
  ...(await importOriginal()),
  handleVideoProxyCore: mocks.handleVideoProxyCore
}));

const { default: REGISTRY } = await import("../../open-sse/providers/registry/index.js");
const { AI_PROVIDERS } = await import("../../src/shared/constants/providers.js");
const {
  MEDIA_ROUTE_KINDS,
  MEDIA_KIND_TRANSPORTS,
  MEDIA_ENDPOINT_KINDS,
  mediaKindForEndpoint
} = await import("../../src/shared/constants/mediaRoutes.js");
const {
  MEDIA_ROUTE_ENDPOINTS,
  mediaTransportSupport,
  mediaEndpointSupport
} = await import("../../src/sse/services/mediaTransport.js");
const { describeMediaRoute, listMediaRouteCandidates } = await import("../../src/sse/services/mediaRoutes.js");
const { getImageAdapter } = await import("../../open-sse/handlers/imageProviders/index.js");
const { getEmbeddingAdapter } = await import("../../open-sse/handlers/embeddingProviders/index.js");
const { getTtsAdapter } = await import("../../open-sse/handlers/ttsProviders/index.js");
const { handleSttCore } = await import("../../open-sse/handlers/sttCore.js");
const { handleVideoGeneration, handleVideoCreate } = await import("../../src/sse/handlers/video.js");

const FIXTURE_DIR = fileURLToPath(new URL("../fixtures/media/", import.meta.url));
const fixtureFiles = () => readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".json")).sort();
const fixture = (name) => JSON.parse(readFileSync(path.join(FIXTURE_DIR, name), "utf8"));
const entry = (id, extra = {}) => ({ id, object: "model", owned_by: id.split("/")[0], ...extra });
const post = (target, body) => new Request(`http://localhost${target}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildModelsList.mockResolvedValue([]);
  mocks.getSettings.mockResolvedValue({ requireApiKey: false });
  mocks.resolveClientApiKey.mockResolvedValue({ apiKey: "caller-key", auth: { ok: true, apiKeyId: "caller-key-id" } });
  mocks.getProviderCredentialsWithQuotaPreflight.mockResolvedValue({ connectionId: "c1", connectionName: "c1", apiKey: "provider-key" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("media kind transport metadata", () => {
  it("names the transport and the endpoints of every media kind", () => {
    for (const kind of MEDIA_ROUTE_KINDS.map((k) => k.id)) {
      const transport = MEDIA_KIND_TRANSPORTS[kind];
      expect(transport, kind).toBeTruthy();
      expect(transport.configKey, kind).toMatch(/Config$/);
      expect(transport.endpoints.length, kind).toBeGreaterThan(0);
      for (const endpoint of transport.endpoints) expect(MEDIA_ENDPOINT_KINDS[endpoint], endpoint).toBe(kind);
    }
  });

  it("maps every media endpoint back to its kind, and nothing else", () => {
    for (const [endpoint, kind] of Object.entries(MEDIA_ENDPOINT_KINDS)) expect(mediaKindForEndpoint(endpoint)).toBe(kind);
    expect(mediaKindForEndpoint("/v1/chat/completions")).toBeNull();
    expect(mediaKindForEndpoint(undefined)).toBeNull();
  });

  it("lists an endpoint for every kind in the route table", () => {
    for (const kind of MEDIA_ROUTE_KINDS.map((k) => k.id)) {
      expect(MEDIA_ROUTE_ENDPOINTS[kind].map((e) => e.path)).toEqual([...MEDIA_KIND_TRANSPORTS[kind].endpoints]);
    }
  });
});

describe("transport support per provider", () => {
  it("supports every provider that advertises the kind, except where the catalog says otherwise", () => {
    const unroutable = [];
    for (const provider of REGISTRY) {
      const kinds = Array.isArray(provider.serviceKinds) ? provider.serviceKinds : [];
      for (const kind of kinds) {
        if (!MEDIA_KIND_TRANSPORTS[kind]) continue;
        if (mediaTransportSupport(kind, provider.id) === "supported") continue;
        // A provider without the transport may still publish rows, but then
        // the catalog has to say the row cannot be routed.
        const rows = [
          ...(provider.models || []),
          ...(provider[MEDIA_KIND_TRANSPORTS[kind].configKey]?.models || [])
        ].filter((row) => (row.kind || row.type) === kind);
        for (const row of rows) {
          if (!row.routingUnavailableReason) unroutable.push(`${provider.id}/${row.id} (${kind})`);
        }
      }
    }
    expect(unroutable).toEqual([]);
  });

  it("calls a known provider without the transport unsupported", () => {
    // AWS Polly declares the tts kind and its config, but no synthesis
    // handler exists, so the gateway cannot run it.
    expect(mediaTransportSupport("tts", "aws-polly")).toBe("unsupported");
    expect(mediaTransportSupport("image", "topaz")).toBe("unsupported");
    expect(mediaTransportSupport("embedding", "orcarouter")).toBe("unsupported");
  });

  it("calls a provider the registry does not describe unknown, so custom rows stay dispatchable", () => {
    expect(mediaTransportSupport("tts", "custom-node")).toBe("unknown");
    expect(mediaTransportSupport("image", "custom-node")).toBe("unsupported");
    expect(mediaTransportSupport("video", "custom-node")).toBe("unknown");
  });

  it("supports the providers that carry the kind's transport", () => {
    expect(mediaTransportSupport("tts", "elevenlabs")).toBe("supported");
    expect(mediaTransportSupport("stt", "deepgram")).toBe("supported");
    expect(mediaTransportSupport("embedding", "venice")).toBe("supported");
    expect(mediaTransportSupport("image", "fal-ai")).toBe("supported");
    expect(mediaTransportSupport("video", "xai")).toBe("supported");
    expect(mediaTransportSupport("video", "veoaifree-web")).toBe("supported");
  });
});

describe("discovery against the transport", () => {
  it("leaves out a provider that cannot serve the kind at all", async () => {
    mocks.buildModelsList.mockResolvedValue([
      entry("aws-polly/standard", { kind: "tts" }),
      entry("elevenlabs/eleven_v3", { kind: "tts" })
    ]);
    const candidates = await listMediaRouteCandidates("tts", {});
    expect(candidates.map((m) => m.id)).toEqual(["elevenlabs/eleven_v3"]);
  });

  it("leaves out image rows of a provider without an image adapter", async () => {
    mocks.buildModelsList.mockResolvedValue([
      entry("topaz/upscale", { kind: "image" }),
      entry("fal-ai/fal-ai/flux/schnell", { kind: "image" })
    ]);
    const candidates = await listMediaRouteCandidates("image", {});
    expect(candidates.map((m) => m.id)).toEqual(["fal-ai/fal-ai/flux/schnell"]);
  });

  it("keeps a row of a provider the registry does not describe", async () => {
    mocks.buildModelsList.mockResolvedValue([entry("custom-node/live-voice", { kind: "tts" })]);
    const candidates = await listMediaRouteCandidates("tts", {});
    expect(candidates.map((m) => m.id)).toEqual(["custom-node/live-voice"]);
  });
});

describe("endpoint-specific model selection", () => {
  beforeEach(() => {
    mocks.buildModelsList.mockResolvedValue([
      entry("xai/grok-imagine-video", { kind: "video" }),
      entry("veoaifree-web/veo", { kind: "video" })
    ]);
  });

  it("runs only the models the synchronous video endpoint can run", async () => {
    const route = await describeMediaRoute("video", { settings: {}, endpoint: "/v1/video/generations" });
    expect(route.models).toEqual(["veoaifree-web/veo"]);
  });

  it("runs only the models the async video endpoint can run", async () => {
    const route = await describeMediaRoute("video", { settings: {}, endpoint: "/v1/videos" });
    expect(route.models).toEqual(["xai/grok-imagine-video"]);
  });

  it("keeps the saved order inside the endpoint it can run on", async () => {
    const settings = { mediaRoutes: { video: ["veoaifree-web/veo", "xai/grok-imagine-video"] } };
    const route = await describeMediaRoute("video", { settings, endpoint: "/v1/videos" });
    expect(route.models).toEqual(["xai/grok-imagine-video"]);
  });

  it("answers with the endpoint's own rule when no route model fits", () => {
    const sync = mediaEndpointSupport("video", "/v1/video/generations", "xai", "grok-imagine-video");
    expect(sync.supported).toBe(false);
    expect(sync.reason).toContain("does not support synchronous video generation on /v1/video/generations");
    expect(sync.reason).toContain("/v1/videos");

    const jobs = mediaEndpointSupport("video", "/v1/videos", "veoaifree-web", "veo");
    expect(jobs.supported).toBe(false);
    expect(jobs.reason).toContain("does not support asynchronous video jobs on /v1/videos");
    expect(jobs.reason).toContain("/v1/video/generations");

    expect(mediaEndpointSupport("video", "/v1/videos", "xai", "grok-imagine-video").supported).toBe(true);
    expect(mediaEndpointSupport("video", "/v1/video/generations", "veoaifree-web", "veo").supported).toBe(true);
  });
});

describe("truthful rejections at the video endpoints", () => {
  it("names the endpoint a job-only provider does not serve", async () => {
    const res = await handleVideoGeneration(post("/v1/video/generations", { model: "xai/grok-imagine-video", prompt: "waves" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("Provider 'xai' does not support synchronous video generation on /v1/video/generations");
    expect(body.error.message).toContain("Use /v1/videos for asynchronous video jobs.");
    expect(mocks.handleVideoGenerationCore).not.toHaveBeenCalled();
  });

  it("names the endpoint a sync-only provider does not serve", async () => {
    const res = await handleVideoCreate(post("/v1/videos/generations", { model: "veoaifree-web/veo", prompt: "waves" }), "generations");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("Provider 'veoaifree-web' does not support asynchronous video jobs on /v1/videos");
    expect(body.error.message).toContain("Use /v1/video/generations for synchronous video generation.");
    expect(mocks.handleVideoProxyCore).not.toHaveBeenCalled();
  });

  it("still refuses a chat model as a video model", async () => {
    const res = await handleVideoGeneration(post("/v1/video/generations", { model: "openai/gpt-4o", prompt: "waves" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("cannot be used for video");
  });
});

describe("offline per-vendor request and response fixtures", () => {
  it("records the verification gap of every vendor fixture", () => {
    const files = fixtureFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const data = fixture(file);
      expect(data.vendor, file).toBeTruthy();
      expect(data.kind, file).toBeTruthy();
      expect(data.model, file).toBeTruthy();
      expect(data.source, file).toMatch(/^https:\/\//);
      expect(data.liveGap.length, file).toBeGreaterThan(40);
      expect(data.request.method, file).toBe("POST");
      expect(data.request.url, file).toMatch(/^https:\/\//);
      expect(data.response, file).toBeTruthy();
      // No fixture may claim a live verification it cannot show.
      if (data.verifiedLive === true) expect(data.liveEvidence, file).toBeTruthy();
      else expect(data.verifiedLive, file).toBe(false);
    }
  });

  it("only covers vendors the gateway can dispatch for that kind", () => {
    for (const file of fixtureFiles()) {
      const data = fixture(file);
      expect(mediaTransportSupport(data.kind, data.vendor), `${data.vendor}/${data.kind}`).toBe("supported");
    }
  });

  it("sends the fal-ai queue request and normalizes the finished job", async () => {
    const data = fixture("fal-ai.image.json");
    const adapter = getImageAdapter("fal-ai");
    expect(adapter.buildUrl(data.model)).toBe(data.request.url);
    expect(adapter.buildHeaders({ apiKey: "fixture-key" })).toEqual(data.request.headers);
    expect(adapter.buildBody(data.model, { prompt: "a cat" })).toEqual(data.request.body);

    const poll = new Response(JSON.stringify(data.response.poll.body), { status: data.response.poll.status });
    const result = new Response(JSON.stringify(data.response.result.body), { status: data.response.result.status });
    const fetchMock = vi.fn(async () => (fetchMock.mock.calls.length === 1 ? poll : result));
    vi.stubGlobal("fetch", fetchMock);

    vi.useFakeTimers();
    const submitted = adapter.parseResponse(
      new Response(JSON.stringify(data.response.submit.body), { status: data.response.submit.status }),
      { headers: data.request.headers }
    );
    await vi.advanceTimersByTimeAsync(2000);
    const body = await submitted;
    vi.useRealTimers();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      data.response.submit.body.status_url,
      data.response.submit.body.response_url
    ]);
    expect(adapter.normalize(body)).toMatchObject(data.response.normalized);
  });

  it("sends the MiniMax China image request and reads its nested urls", async () => {
    const data = fixture("minimax-cn.image.json");
    const adapter = getImageAdapter("minimax-cn");
    expect(adapter.buildUrl()).toBe(data.request.url);
    expect(adapter.buildHeaders({ apiKey: "fixture-key" })).toEqual(data.request.headers);
    expect(adapter.buildBody(data.model, { prompt: "a cat", size: "16:9" })).toEqual(data.request.body);

    const parsed = await adapter.parseResponse(new Response(JSON.stringify(data.response.body), { status: data.response.status }));
    expect(adapter.normalize(parsed, "a cat")).toMatchObject(data.response.normalized);
  });

  it("sends the Gemini image request and reads inline image data", async () => {
    const data = fixture("gemini.image.json");
    const adapter = getImageAdapter("gemini");
    expect(adapter.buildUrl(data.model, { apiKey: "fixture-key" })).toBe(data.request.url);
    expect(adapter.buildHeaders()).toEqual(data.request.headers);
    expect(adapter.buildBody(data.model, { prompt: "a cat" })).toEqual(data.request.body);
    expect(adapter.normalize(data.response.body, "a cat")).toMatchObject(data.response.normalized);
  });

  it("sends the Venice embedding request and passes the response through", async () => {
    const data = fixture("venice.embedding.json");
    const adapter = getEmbeddingAdapter("venice");
    expect(adapter.buildUrl()).toBe(data.request.url);
    expect(adapter.buildHeaders({ apiKey: "fixture-key" })).toEqual(data.request.headers);
    expect(adapter.buildBody(data.model, { input: "a cat" })).toEqual(data.request.body);
    expect(adapter.normalize(data.response.body)).toEqual(data.response.normalized);
  });

  it("sends the ElevenLabs speech request and returns the audio", async () => {
    const data = fixture("elevenlabs.tts.json");
    const adapter = getTtsAdapter("elevenlabs");
    const audio = new Uint8Array(data.response.bytes).fill(7);
    const fetchMock = vi.fn(async () => new Response(audio, { status: data.response.status, headers: { "content-type": data.response.contentType } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await adapter.synthesize("a cat", data.model, { apiKey: "fixture-key" }, "mp3");
    expect(result.format).toBe(data.response.normalized.format);
    expect(Buffer.from(result.base64, "base64").byteLength).toBe(data.response.normalized.decodedBytes);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(data.request.url);
    expect(init.method).toBe(data.request.method);
    expect(init.headers["xi-api-key"]).toBe(data.request.headers["xi-api-key"]);
    expect(JSON.parse(init.body)).toEqual(data.request.body);
  });

  it("sends the Deepgram listen request and returns the transcript", async () => {
    const data = fixture("deepgram.stt.json");
    const audio = new Uint8Array(data.request.body.bytes).fill(9);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(data.response.body), {
      status: data.response.status,
      headers: { "content-type": "application/json" }
    }));
    vi.stubGlobal("fetch", fetchMock);

    const form = new FormData();
    form.set("file", new Blob([audio], { type: "audio/wav" }), "audio.wav");
    const result = await handleSttCore({
      provider: data.vendor,
      model: data.model,
      formData: form,
      credentials: { apiKey: "fixture-key" },
      sttConfig: AI_PROVIDERS[data.vendor].sttConfig
    });

    expect(result.success).toBe(true);
    expect(await result.response.json()).toMatchObject(data.response.normalized);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(data.request.url);
    expect(init.method).toBe(data.request.method);
    expect(init.headers.Authorization).toBe(data.request.headers.Authorization);
    expect(init.headers["Content-Type"]).toBe(data.request.headers["Content-Type"]);
  });
});
