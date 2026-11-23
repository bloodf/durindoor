import { describe, expect, it, vi } from "vitest";
import geminiEmbeddings from "../../open-sse/handlers/embeddingProviders/gemini.js";
import { FORMAT_HANDLERS } from "../../open-sse/handlers/ttsProviders/genericFormats.js";
import { handleSttCore } from "../../open-sse/handlers/sttCore.js";
import { handleFetchCore } from "../../open-sse/handlers/fetch/index.js";

const routeState = vi.hoisted(() => ({ settings: {}, credentials: vi.fn() }));
vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(async () => routeState.settings) }));
vi.mock("@/sse/services/auth.js", () => ({
  resolveClientApiKey: vi.fn(async () => ({ apiKey: null, auth: { ok: true, apiKeyId: null, billingEpoch: null } })),
  getProviderCredentialsWithQuotaPreflight: routeState.credentials,
  getNoAuthProviderCredentials: vi.fn(), markAccountUnavailable: vi.fn(), clearAccountError: vi.fn(),
}));
vi.mock("@/sse/services/model.js", () => ({ getModelInfo: vi.fn(), getModelInfoSync: vi.fn() }));
vi.mock("@/sse/services/apiKeyPolicy.js", () => ({ enforceApiKeyModelPolicy: vi.fn(async () => null), recordApiKeyUsageForResponse: vi.fn(async (_key, response) => response) }));
vi.mock("@/sse/utils/requestCorrelation.js", () => ({ captureRequestBillingEpoch: vi.fn(), getRequestId: () => "test", withRequestCorrelation: (fn) => fn }));
vi.mock("@/sse/utils/logger.js", () => ({ request: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock("open-sse/services/operationalMetrics.js", () => ({ annotateClientAdmissionFailure: (response) => response }));
vi.mock("open-sse/services/combo.js", () => ({ handleComboChat: vi.fn() }));
vi.mock("open-sse/services/mediaRoutes.js", () => ({ wantsDefaultRoute: () => false, resolveMediaRoute: vi.fn(), defaultRouteComboOptions: () => ({}), supportsTranslation: () => false }));
vi.mock("open-sse/services/modelFallback.js", () => ({ runWithModelFallback: vi.fn() }));

const { handleStt } = await import("../../src/sse/handlers/stt.js");
const { handleImageEdit } = await import("../../src/sse/handlers/imageEdit.js");

describe("#2223 upstream path and upload hardening", () => {
  it("encodes model ids in Gemini embedding and HuggingFace TTS paths", async () => {
    expect(geminiEmbeddings.buildUrl("../cachedContents?x=secret", { apiKey: "key" }))
      .toBe("https://generativelanguage.googleapis.com/v1beta/models/..%2FcachedContents%3Fx%3Dsecret:embedContent?key=key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(128))));
    await FORMAT_HANDLERS["huggingface-tts"]({ baseUrl: "https://router.huggingface.co/tts", apiKey: "key", text: "hi", modelId: "org/model?x=secret" });
    expect(fetch.mock.calls[0][0]).toBe("https://router.huggingface.co/tts/org%2Fmodel%3Fx%3Dsecret");
    vi.unstubAllGlobals();
  });

  it("encodes HuggingFace STT model ids in the upstream path", async () => {
    const fetchMock = vi.fn(async () => Response.json({ text: "ok" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await handleSttCore({
      provider: "huggingface", model: "org/model?x=secret",
      formData: (() => { const f = new FormData(); f.append("file", new File([new Uint8Array([1])], "audio.wav")); return f; })(), credentials: { apiKey: "key" },
      sttConfig: { baseUrl: "https://router.huggingface.co/hf-inference/models", authType: "apikey", authHeader: "bearer", format: "huggingface-asr" }
    });
    expect(result.success).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe("https://router.huggingface.co/hf-inference/models/org%2Fmodel%3Fx%3Dsecret");
    vi.unstubAllGlobals();
  });

  it("resolves custom Firecrawl targets before dispatch", async () => {
    const result = await handleFetchCore({
      url: "http://127.0.0.1.nip.io/", provider: "firecrawl_custom",
      providerConfig: { firecrawlBaseUrl: "http://127.0.0.1:3002" }, credentials: { apiKey: "key" }
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe(403);
  });

  it.each([
    ["STT", handleStt, "http://localhost/v1/audio/transcriptions", 26 * 1024 * 1024 + 1],
    ["image edit", handleImageEdit, "http://localhost/v1/images/edits", 11 * 1024 * 1024 + 1],
  ])("rejects oversized %s uploads with 413 before parsing multipart", async (_name, handler, url, length) => {
    const response = await handler(new Request(url, {
      method: "POST", headers: { "content-length": String(length), "content-type": "multipart/form-data; boundary=unused" }, body: "",
    }));
    expect(response.status).toBe(413);
  });

  it.each([
    ["STT", handleStt, "http://localhost/v1/audio/transcriptions", "file", 25 * 1024 * 1024 + 1],
    ["image edit", handleImageEdit, "http://localhost/v1/images/edits", "image", 10 * 1024 * 1024 + 1],
  ])("rejects multipart %s files over the per-file cap", async (_name, handler, url, field, size) => {
    const form = new FormData();
    form.append(field, new File([new Uint8Array(size)], "upload.bin"));
    const response = await handler(new Request(url, { method: "POST", body: form }));
    expect(response.status).toBe(413);
  });

  it.each([
    ["STT", handleStt, "http://localhost/v1/audio/transcriptions", 26 * 1024 * 1024 + 1],
    ["image edit", handleImageEdit, "http://localhost/v1/images/edits", 11 * 1024 * 1024 + 1],
  ])("bounds unknown-length %s bodies before multipart parsing", async (_name, handler, url, size) => {
    const response = await handler(new Request(url, {
      method: "POST", headers: { "content-type": "multipart/form-data; boundary=unused" }, body: new Uint8Array(size),
    }));
    expect(response.status).toBe(413);
  });
});
