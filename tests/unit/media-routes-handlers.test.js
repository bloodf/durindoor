/**
 * Every media endpoint accepts a request without a model: the handler runs the
 * endpoint's default route (settings.mediaRoutes or the connected catalog),
 * falls through to the next model on a retryable failure, and answers
 * no_provider_for_kind when nothing connected can serve the endpoint.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildModelsList: vi.fn(),
  getSettings: vi.fn(),
  handleTtsCore: vi.fn(),
  handleEmbeddingsCore: vi.fn(),
  handleSttCore: vi.fn(),
  handleMusicGenerationCore: vi.fn(),
  handleImageGenerationCore: vi.fn(),
  handleVideoGenerationCore: vi.fn(),
  handleVideoProxyCore: vi.fn(),
  handleSearchCore: vi.fn(),
  getProviderCredentialsWithQuotaPreflight: vi.fn(),
  getNoAuthProviderCredentials: vi.fn()
}));

vi.mock("@/app/api/v1/models/buildModelsList.js", () => ({ buildModelsList: mocks.buildModelsList }));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getApiKeyByKey: vi.fn(async () => null),
  getComboForModel: vi.fn(async () => null),
  getCombos: vi.fn(async () => []),
  getProviderConnectionById: vi.fn(async () => null),
  getApiKeyProviderConnectionIds: vi.fn(async () => [])
}));
vi.mock("../../src/sse/services/model.js", async () => {
  const { resolveProviderId } = await import("../../src/shared/constants/providers.js");
  return {
    getModelInfo: vi.fn(async (modelStr) => {
      const [prefix, ...rest] = String(modelStr).split("/");
      return rest.length ? { provider: resolveProviderId(prefix), model: rest.join("/") } : { provider: null, model: modelStr };
    }),
    getComboModels: vi.fn(async () => null),
    getComboCanonicalName: vi.fn(async () => null),
    getAutoComboCatalog: vi.fn(async () => ({}))
  };
});
vi.mock("../../src/sse/services/auth.js", () => ({
  clearAccountError: vi.fn(),
  getNoAuthProviderCredentials: mocks.getNoAuthProviderCredentials,
  getProviderCredentialsWithQuotaPreflight: mocks.getProviderCredentialsWithQuotaPreflight,
  markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
  resolveClientApiKey: vi.fn(async () => ({ apiKey: null, auth: { ok: true } }))
}));
vi.mock("../../src/sse/services/apiKeyPolicy.js", () => ({
  enforceApiKeyModelPolicy: vi.fn(async () => null),
  recordApiKeyUsageForResponse: vi.fn(async (_key, response) => response)
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  updateProviderCredentials: vi.fn()
}));
vi.mock("../../src/sse/utils/requestCorrelation.js", () => ({
  withRequestCorrelation: (fn) => (...args) => fn(...args)
}));
vi.mock("../../open-sse/handlers/ttsCore.js", () => ({ handleTtsCore: mocks.handleTtsCore }));
vi.mock("../../open-sse/handlers/embeddingsCore.js", () => ({ handleEmbeddingsCore: mocks.handleEmbeddingsCore }));
vi.mock("../../open-sse/handlers/sttCore.js", async (importOriginal) => ({ ...(await importOriginal()), handleSttCore: mocks.handleSttCore }));
vi.mock("../../open-sse/handlers/musicGenerationCore.js", () => ({ handleMusicGenerationCore: mocks.handleMusicGenerationCore }));
vi.mock("../../open-sse/handlers/imageGenerationCore.js", () => ({ handleImageGenerationCore: mocks.handleImageGenerationCore }));
vi.mock("../../open-sse/handlers/videoGenerationCore.js", async (importOriginal) => ({ ...(await importOriginal()), handleVideoGenerationCore: mocks.handleVideoGenerationCore }));
vi.mock("../../open-sse/handlers/videoCore.js", async (importOriginal) => ({ ...(await importOriginal()), handleVideoProxyCore: mocks.handleVideoProxyCore }));
vi.mock("../../open-sse/handlers/search/index.js", () => ({ handleSearchCore: mocks.handleSearchCore }));

const { handleTts } = await import("../../src/sse/handlers/tts.js");
const { handleEmbeddings } = await import("../../src/sse/handlers/embeddings.js");
const { handleStt } = await import("../../src/sse/handlers/stt.js");
const { handleMusicGeneration } = await import("../../src/sse/handlers/music.js");
const { handleImageGeneration } = await import("../../src/sse/handlers/imageGeneration.js");
const { handleVideoGeneration, handleVideoCreate, handleVideoGet } = await import("../../src/sse/handlers/video.js");
const { handleSearch } = await import("../../src/sse/handlers/search.js");

const entry = (id, extra = {}) => ({ id, object: "model", owned_by: id.split("/")[0], ...extra });
const ok = (body = { ok: true }) => ({ success: true, response: Response.json(body) });
const rateLimited = () => ({ success: false, status: 429, error: "rate limited", response: Response.json({ error: { message: "rate limited" } }, { status: 429 }) });
const post = (path, body) => new Request(`http://localhost${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body)
});
const catalog = (byKind) => mocks.buildModelsList.mockImplementation(async ([kind]) => byKind[kind] || []);
const calledModels = (core) => core.mock.calls.map(([args]) => `${args.provider ?? args.modelInfo?.provider}/${args.model ?? args.modelInfo?.model}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({ requireApiKey: false });
  mocks.getProviderCredentialsWithQuotaPreflight.mockResolvedValue({ connectionId: "c1", connectionName: "c1", apiKey: "k" });
  mocks.getNoAuthProviderCredentials.mockResolvedValue({});
});

describe("media endpoints without a model", () => {
  it("TTS runs the saved route in order and falls through on a retryable failure", async () => {
    catalog({ tts: [entry("openai/tts-1"), entry("elevenlabs/eleven_v3")] });
    mocks.getSettings.mockResolvedValue({ mediaRoutes: { tts: ["elevenlabs/eleven_v3", "openai/tts-1"] } });
    mocks.handleTtsCore.mockResolvedValueOnce(rateLimited()).mockResolvedValueOnce(ok());

    const res = await handleTts(post("/v1/audio/speech", { input: "hello" }));

    expect(res.status).toBe(200);
    expect(calledModels(mocks.handleTtsCore)).toEqual(["elevenlabs/eleven_v3", "openai/tts-1"]);
  });

  it("an explicit model never touches the route", async () => {
    mocks.handleTtsCore.mockResolvedValue(rateLimited());
    const res = await handleTts(post("/v1/audio/speech", { model: "openai/tts-1", input: "hello" }));
    expect(res.status).toBe(429);
    expect(mocks.buildModelsList).not.toHaveBeenCalled();
    expect(mocks.handleTtsCore).toHaveBeenCalledTimes(1);
  });

  it("returns no_provider_for_kind when nothing connected serves the endpoint", async () => {
    catalog({});
    const res = await handleTts(post("/v1/audio/speech", { input: "hello" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("no_provider_for_kind");
    expect(mocks.handleTtsCore).not.toHaveBeenCalled();
  });

  it("embeddings use only the route's first model", async () => {
    catalog({ embedding: [entry("openai/text-embedding-3-small"), entry("gemini/text-embedding-004")] });
    mocks.handleEmbeddingsCore.mockResolvedValue(rateLimited());

    const res = await handleEmbeddings(post("/v1/embeddings", { input: "hi", model: "auto" }));

    expect(res.status).toBe(429);
    expect(calledModels(mocks.handleEmbeddingsCore)).toEqual(["openai/text-embedding-3-small"]);
  });

  it("image generation falls through the route", async () => {
    catalog({ image: [entry("openai/dall-e-3"), entry("xai/grok-imagine-image")] });
    mocks.handleImageGenerationCore.mockResolvedValueOnce(rateLimited()).mockResolvedValueOnce(ok({ data: [] }));

    const res = await handleImageGeneration(post("/v1/images/generations", { prompt: "a cat" }));

    expect(res.status).toBe(200);
    expect(mocks.handleImageGenerationCore).toHaveBeenCalledTimes(2);
  });

  it("music falls through the route", async () => {
    catalog({ music: [entry("suno/chirp-v4"), entry("udio/udio-default")] });
    mocks.handleMusicGenerationCore.mockResolvedValueOnce(rateLimited()).mockResolvedValueOnce(ok());

    const res = await handleMusicGeneration(post("/v1/music/generations", { prompt: "lofi" }));

    expect(res.status).toBe(200);
    expect(calledModels(mocks.handleMusicGenerationCore)).toEqual(["suno/chirp-v4", "udio/udio-default"]);
  });

  it("STT translations skip providers without a translations endpoint", async () => {
    catalog({ stt: [entry("deepgram/nova-3"), entry("openai/whisper-1")] });
    mocks.handleSttCore.mockResolvedValue(ok({ text: "hi" }));
    const form = new FormData();
    form.append("file", new File(["x"], "a.wav", { type: "audio/wav" }));

    const res = await handleStt(new Request("http://localhost/v1/audio/translations", { method: "POST", body: form }), { kind: "translation" });

    expect(res.status).toBe(200);
    expect(calledModels(mocks.handleSttCore)).toEqual(["openai/whisper-1"]);
    expect(mocks.handleSttCore.mock.calls[0][0].kind).toBe("translation");
  });

  it("web search routes to provider search entries", async () => {
    catalog({ webSearch: [entry("tavily/search", { kind: "webSearch" })] });
    mocks.handleSearchCore.mockResolvedValue(ok({ results: [] }));

    const res = await handleSearch(post("/v1/search", { query: "durin" }));

    expect(res.status).toBe(200);
    expect(mocks.handleSearchCore.mock.calls[0][0].provider.name).toBe("Tavily");
  });

  it("video generation only tries providers the endpoint can run", async () => {
    catalog({ video: [entry("xai/grok-imagine-video"), entry("veoaifree-web/veo")] });
    mocks.handleVideoGenerationCore.mockResolvedValue(ok());

    const res = await handleVideoGeneration(post("/v1/video/generations", { prompt: "waves" }));

    expect(res.status).toBe(200);
    expect(calledModels(mocks.handleVideoGenerationCore)).toEqual(["veoaifree-web/veo"]);
  });

  it("async video jobs take the first async-capable route model and put it in the body", async () => {
    catalog({ video: [entry("veoaifree-web/veo"), entry("xai/grok-imagine-video")] });
    mocks.handleVideoProxyCore.mockResolvedValue(ok({ request_id: "r1" }));

    const res = await handleVideoCreate(post("/v1/videos/generations", { prompt: "waves" }), "generations");

    expect(res.status).toBe(200);
    const call = mocks.handleVideoProxyCore.mock.calls[0][0];
    expect(call.provider).toBe("xai");
    expect(JSON.parse(call.rawBody).model).toBe("grok-imagine-video");
  });

  const multipart = (fields) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return new Request("http://localhost/v1/videos/edits", { method: "POST", body: form });
  };

  it("a multipart job goes to the provider its model field names, prefix stripped", async () => {
    catalog({ video: [entry("minimax/MiniMax-H3"), entry("xai/grok-imagine-video")] });
    mocks.handleVideoProxyCore.mockResolvedValue(ok({ request_id: "r2" }));
    const res = await handleVideoCreate(multipart({ model: "xai/grok-imagine-video", prompt: "x", image: new File(["img"], "a.png") }), "edits");
    expect(res.status).toBe(200);
    const call = mocks.handleVideoProxyCore.mock.calls[0][0];
    expect(call.provider).toBe("xai");
    const form = await new Response(call.rawBody, { headers: { "content-type": call.contentType } }).formData();
    expect(form.get("model")).toBe("grok-imagine-video");
    expect(form.get("image")).toBeInstanceOf(File);
  });

  it("a multipart job without a model gets the route's model written in", async () => {
    catalog({ video: [entry("veoaifree-web/veo"), entry("xai/grok-imagine-video-1.5")] });
    mocks.handleVideoProxyCore.mockResolvedValue(ok({ request_id: "r4" }));
    await handleVideoCreate(multipart({ prompt: "x", image: new File(["img"], "a.png") }), "edits");
    const call = mocks.handleVideoProxyCore.mock.calls[0][0];
    expect(call.provider).toBe("xai");
    const form = await new Response(call.rawBody, { headers: { "content-type": call.contentType } }).formData();
    expect(form.get("model")).toBe("grok-imagine-video-1.5");
    expect(form.get("image")).toBeInstanceOf(File);
  });

  it("a multipart job with a bare model forwards the original bytes", async () => {
    catalog({ video: [entry("minimax/MiniMax-H3"), entry("xai/grok-imagine-video")] });
    mocks.handleVideoProxyCore.mockResolvedValue(ok({ request_id: "r3" }));
    const req = multipart({ model: "grok-imagine-video", prompt: "x" });
    const contentType = req.headers.get("content-type");
    await handleVideoCreate(req, "edits");
    const call = mocks.handleVideoProxyCore.mock.calls[0][0];
    expect(call.provider).toBe("xai");
    expect(call.contentType).toBe(contentType);
  });

  it("a bare video id must match exactly and name one provider", async () => {
    catalog({ video: [entry("minimax/MiniMax-H3"), entry("minimax-cn/MiniMax-H3"), entry("xai/grok-imagine-video")] });
    const ambiguous = await handleVideoCreate(post("/v1/videos/generations", { model: "MiniMax-H3", prompt: "x" }), "generations");
    expect(ambiguous.status).toBe(400);
    expect((await ambiguous.json()).error.message).toContain("use a provider/model id");
    const partial = await handleVideoCreate(post("/v1/videos/generations", { model: "video", prompt: "x" }), "generations");
    expect(partial.status).toBe(400);
    expect(mocks.handleVideoProxyCore).not.toHaveBeenCalled();
  });

  it("an unpinned poll asks for x-connection-id when more than one job provider is connected", async () => {
    catalog({ video: [entry("xai/grok-imagine-video"), entry("minimax/MiniMax-H3")] });
    const res = await handleVideoGet(new Request("http://localhost/v1/videos/r1"), "r1");
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("x-connection-id");
    expect(mocks.handleVideoProxyCore).not.toHaveBeenCalled();
  });

  it("an unpinned poll goes to the only connected job provider", async () => {
    catalog({ video: [entry("veoaifree-web/veo"), entry("xai/grok-imagine-video")] });
    mocks.handleVideoProxyCore.mockResolvedValue(ok({ status: "done" }));
    const res = await handleVideoGet(new Request("http://localhost/v1/videos/r1"), "r1");
    expect(res.status).toBe(200);
    expect(mocks.handleVideoProxyCore.mock.calls[0][0].provider).toBe("xai");
  });

  it("async video jobs without a connected video provider fail with no_provider_for_kind", async () => {
    catalog({});
    const res = await handleVideoCreate(post("/v1/videos/generations", { prompt: "waves" }), "generations");
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("no_provider_for_kind");
    expect(mocks.handleVideoProxyCore).not.toHaveBeenCalled();
  });
});
