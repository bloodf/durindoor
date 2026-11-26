import { afterEach, describe, expect, it, vi } from "vitest";
import { handleEmbeddingsCore } from "../../open-sse/handlers/embeddingsCore.js";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import { handleSttCore } from "../../open-sse/handlers/sttCore.js";
import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";
import { handleVideoProxyCore } from "../../open-sse/handlers/videoCore.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";

const respond = (payload, type = "application/json") => {
  const fetchMock = vi.fn(async () => new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
    headers: { "content-type": type },
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};
const envelope = { error: { message: "quota exceeded" } };
const credentials = { apiKey: "test-key" };

afterEach(() => vi.unstubAllGlobals());

describe("upstream 9router #5864 HTTP 200 media outcomes", () => {
  it.each([
    ["an error envelope", envelope],
    ["an empty vector", { data: [{ embedding: [] }] }],
  ])("fails embeddings with %s before marking the account healthy", async (_name, payload) => {
    respond(payload);
    const onRequestSuccess = vi.fn();
    const result = await handleEmbeddingsCore({
      body: { model: "text-embedding-3-small", input: "hi" },
      modelInfo: { provider: "openai", model: "text-embedding-3-small" }, credentials, onRequestSuccess,
    });
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it.each([["an error envelope", envelope], ["a blank image", { created: 1, data: [{ b64_json: "" }] }]])(
    "fails image generation with %s", async (_name, payload) => {
      respond(payload);
      const onRequestSuccess = vi.fn();
      const result = await handleImageGenerationCore({
        body: { prompt: "a gate" }, modelInfo: { provider: "openai", model: "gpt-image-1" }, credentials, onRequestSuccess,
      });
      expect(result).toMatchObject({ success: false, status: 502 });
      expect(onRequestSuccess).not.toHaveBeenCalled();
    });

  it("fails TTS on a JSON error sent with 200", async () => {
    respond(envelope);
    const result = await handleTtsCore({ provider: "openai", model: "tts-1/alloy", input: "hi", credentials });
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.error).toContain("quota exceeded");
  });

  it("fails TTS on empty audio", async () => {
    respond("", "audio/mpeg");
    const result = await handleTtsCore({ provider: "openai", model: "tts-1/alloy", input: "hi", credentials, responseFormat: "json" });
    expect(result).toMatchObject({ success: false, status: 502 });
  });

  it.each(["openai", "deepgram", "huggingface", "gemini"])("fails %s STT on an error envelope", async (provider) => {
    respond(envelope);
    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(8)], { type: "audio/wav" }), "a.wav");
    const result = await handleSttCore({
      provider, model: provider === "gemini" ? "gemini-2.5-flash" : "whisper-1", formData, credentials,
      sttConfig: PROVIDER_MEDIA[provider].sttConfig,
    });
    expect(result).toMatchObject({ success: false, status: 502 });
  });

  it("stops AssemblyAI at a failed upload instead of polling", async () => {
    const fetchMock = respond(envelope);
    const formData = new FormData();
    formData.append("file", new Blob([new Uint8Array(8)], { type: "audio/wav" }), "a.wav");
    const result = await handleSttCore({
      provider: "assemblyai", model: "universal-3-pro", formData, credentials, sttConfig: PROVIDER_MEDIA.assemblyai.sttConfig,
    });
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  const video = (options) => handleVideoProxyCore({ provider: "xai", action: "generations", rawBody: "{}", contentType: "application/json", credentials, ...options });

  it.each([
    ["non-JSON", "<html/>"],
    ["no job id", { status: "queued" }],
    ["a failed job", { request_id: "v1", status: "failed" }],
  ])("fails a video creation answering %s", async (_name, payload) => {
    respond(payload);
    expect(await video()).toMatchObject({ success: false, status: 502 });
  });

  it("passes a failed job through on a poll", async () => {
    respond({ request_id: "v1", status: "failed" });
    expect((await video({ action: null, requestId: "v1" })).success).toBe(true);
  });

  it("reports a caller abort as 499, not an upstream timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new DOMException("aborted", "AbortError"); }));
    expect((await video({ signal: AbortSignal.abort() })).status).toBe(499);
    expect((await video()).status).toBe(408);
  });
});
