import { describe, expect, it, vi } from "vitest";
import geminiEmbeddings from "../../open-sse/handlers/embeddingProviders/gemini.js";
import { FORMAT_HANDLERS } from "../../open-sse/handlers/ttsProviders/genericFormats.js";
import { handleSttCore } from "../../open-sse/handlers/sttCore.js";
import { handleFetchCore } from "../../open-sse/handlers/fetch/index.js";

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
});
