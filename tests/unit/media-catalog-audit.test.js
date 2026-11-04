// #1136: /v1/models/{kind} and the media route pickers must list only models a
// media endpoint can dispatch, under ids that route back to the vendor model.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getProviderConnections: vi.fn() }));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => []),
}));
vi.mock("@/lib/enabledModelsDb", () => ({ getEnabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/db/repos/settingsRepo", () => ({ getSettings: vi.fn(async () => ({})) }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => null) }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));
// Live catalogs are offline here; the static registry is the fixture.
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: vi.fn(async () => { throw new Error("offline"); }) }));

const { buildModelsList } = await import("../../src/app/api/v1/models/buildModelsList.js");
const { default: REGISTRY } = await import("../../open-sse/providers/registry/index.js");
const { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } = await import("../../src/shared/constants/models.js");
const { AI_PROVIDERS, resolveProviderId } = await import("../../src/shared/constants/providers.js");
const { getImageAdapter } = await import("../../open-sse/handlers/imageProviders/index.js");
const { getEmbeddingAdapter } = await import("../../open-sse/handlers/embeddingProviders/index.js");
const { getTtsAdapter } = await import("../../open-sse/handlers/ttsProviders/index.js");
const { FORMAT_HANDLERS } = await import("../../open-sse/handlers/ttsProviders/genericFormats.js");
const { getVideoConfig } = await import("../../open-sse/handlers/videoCore.js");
const { supportsVideoGeneration } = await import("../../open-sse/handlers/videoGenerationCore.js");

// What each media endpoint calls for a provider (see the *Core handlers).
const DISPATCHERS = {
  image: (p) => !!getImageAdapter(p),
  embedding: (p) => !!getEmbeddingAdapter(p),
  tts: (p) => !!getTtsAdapter(p) || !!FORMAT_HANDLERS[AI_PROVIDERS[p]?.ttsConfig?.format],
  stt: (p) => !!AI_PROVIDERS[p]?.sttConfig,
  video: (p) => !!getVideoConfig(p) || supportsVideoGeneration(p),
};
const CONFIG_KEYS = { tts: "ttsConfig", stt: "sttConfig", embedding: "embeddingConfig" };

const catalogRows = (entry) => PROVIDER_MODELS[PROVIDER_ID_TO_ALIAS[entry.id] || entry.id] || [];
const rowKind = (m) => m.kind || m.type || "llm";
const advertises = (entry, kind) => (entry.serviceKinds || ["llm"]).includes(kind);

function connect(providers) {
  mocks.getProviderConnections.mockResolvedValue(providers.map((provider) => ({
    id: `conn-${provider}`, provider, authType: "apikey", apiKey: "test-key", isActive: true, providerSpecificData: {},
  })));
}

// Split a published id the way request routing does: first segment is the provider.
function routeOf(id) {
  const slash = id.indexOf("/");
  return { provider: resolveProviderId(id.slice(0, slash)), model: id.slice(slash + 1) };
}

describe("media catalog audit (registry)", () => {
  it.each(Object.keys(DISPATCHERS))("every routable %s row has a dispatcher", (kind) => {
    const broken = [];
    for (const entry of REGISTRY) {
      if (!advertises(entry, kind) || DISPATCHERS[kind](entry.id)) continue;
      for (const m of catalogRows(entry)) {
        if (rowKind(m) === kind && !m.routingUnavailableReason) broken.push(`${entry.id}/${m.id}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it.each(Object.keys(CONFIG_KEYS))("every %s config model is a catalog row", (kind) => {
    const missing = [];
    for (const entry of REGISTRY) {
      if (!advertises(entry, kind)) continue;
      const ids = new Set(catalogRows(entry).map((m) => m.id));
      for (const m of entry[CONFIG_KEYS[kind]]?.models || []) if (!ids.has(m.id)) missing.push(`${entry.id}/${m.id}`);
    }
    expect(missing).toEqual([]);
  });
});

describe("/v1/models/{kind} for connected media providers", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["tts", ["elevenlabs", "cartesia", "playht", "fish-audio", "inworld", "nvidia"]],
    ["stt", ["nvidia", "deepgram"]],
    ["embedding", ["jina-ai", "nvidia", "venice"]],
    ["image", ["fal-ai", "gemini", "minimax-cn", "venice"]],
  ])("lists %s models for %j", async (kind, providers) => {
    connect(providers);
    const listed = await buildModelsList([kind], null, { exposeComboOnly: false });
    const byProvider = new Set(listed.map((m) => routeOf(m.id).provider));
    expect(providers.filter((p) => !byProvider.has(p))).toEqual([]);
  });

  it.each(["image", "tts", "stt", "embedding"])("publishes %s ids that route to registry model ids", async (kind) => {
    const providers = REGISTRY.filter((e) => advertises(e, kind) && DISPATCHERS[kind](e.id)).map((e) => e.id);
    connect(providers);
    const listed = await buildModelsList([kind], null, { exposeComboOnly: false });
    const unroutable = listed.map((m) => m.id).filter((id) => {
      const { provider, model } = routeOf(id);
      const entry = REGISTRY.find((e) => e.id === provider);
      return entry && !catalogRows(entry).some((m) => m.id === model);
    });
    expect(unroutable).toEqual([]);
  });

  it("keeps the vendor prefix on fal-ai ids so the queue URL names the real model", async () => {
    connect(["fal-ai"]);
    const listed = await buildModelsList(["image"], null, { exposeComboOnly: false });
    const id = listed.find((m) => m.id.endsWith("flux/schnell"))?.id;
    expect(routeOf(id)).toEqual({ provider: "fal-ai", model: "fal-ai/flux/schnell" });
    expect(getImageAdapter("fal-ai").buildUrl(routeOf(id).model)).toBe("https://queue.fal.run/fal-ai/flux/schnell");
  });

  it("does not list AWS Polly, which has no synthesis handler", async () => {
    connect(["aws-polly"]);
    const listed = await buildModelsList(["tts"], null, { exposeComboOnly: false });
    expect(listed.filter((m) => routeOf(m.id).provider === "aws-polly")).toEqual([]);
  });

  it("lists no video models for chat-only Agnes and Pollinations", async () => {
    connect(["agnes", "pollinations"]);
    const listed = await buildModelsList(["video"], null, { exposeComboOnly: false });
    expect(listed.filter((m) => ["agnes", "pollinations"].includes(routeOf(m.id).provider))).toEqual([]);
  });
});

describe("per-vendor request fixtures", () => {
  it("sends MiniMax China image requests to the China host", () => {
    const adapter = getImageAdapter("minimax-cn");
    expect(adapter.buildUrl("image-01")).toBe("https://api.minimax.cn/v1/image_generation");
    expect(adapter.buildBody("image-01", { prompt: "a cat", size: "16:9" })).toMatchObject({ model: "image-01", aspect_ratio: "16:9" });
  });

  it("sends Venice image and embedding requests to its OpenAI-compatible endpoints", () => {
    expect(getImageAdapter("venice").buildUrl("flux-2-pro")).toBe("https://api.venice.ai/api/v1/images/generations");
    expect(getImageAdapter("venice").buildBody("flux-2-pro", { prompt: "a cat" })).toMatchObject({ model: "flux-2-pro", prompt: "a cat" });
    expect(getEmbeddingAdapter("venice").buildUrl()).toBe("https://api.venice.ai/api/v1/embeddings");
  });

  it("builds Google AI Studio image URLs from the listed Gemini image ids", () => {
    const url = getImageAdapter("gemini").buildUrl("gemini-2.5-flash-image", { apiKey: "k" });
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=k");
  });
});
