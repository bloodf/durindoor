import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";
import { buildTtsProviderModels } from "../../open-sse/config/ttsModels.js";
import gemini from "../../open-sse/providers/registry/gemini.js";
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";

const originalGlobalFetch = global.fetch;
let restoreOriginalFetch;

function mockGeminiAudioResponse(interactions = false, mimeType = "audio/pcm") {
  const bytes = interactions && mimeType === "audio/wav" ? Buffer.from("RIFFtest") : Buffer.from([0, 1, 2, 3]);
  const data = bytes.toString("base64");
  global.fetch.mockResolvedValueOnce(new Response(JSON.stringify(interactions ? {
    steps: [{ type: "model_output", content: [{ type: "audio", mime_type: mimeType, data }] }],
  } : {
    candidates: [{ content: { parts: [{ inlineData: { mimeType, data } }] } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } }));
}

describe("Gemini TTS", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    restoreOriginalFetch = __setOriginalFetchForTesting(global.fetch);
  });

  afterEach(() => {
    restoreOriginalFetch?.();
    global.fetch = originalGlobalFetch;
  });

  it("uses Gemini 3.8 Interactions TTS when only a voice is provided", async () => {
    mockGeminiAudioResponse(true, "audio/wav");

    const result = await handleTtsCore({
      provider: "gemini",
      model: "Zephyr",
      input: "Hello from Gemini",
      credentials: { apiKey: "test-key" },
      responseFormat: "json",
    });

    expect(global.fetch.mock.calls[0][0]).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent).toMatchObject({ model: gemini.ttsConfig.defaultModel, response_format: { type: "audio" }, generation_config: { speech_config: [{ voice: "Zephyr" }] } });
    expect(sent.input[0].content[0]).toMatchObject({ type: "text", text: "Hello from Gemini" });
    expect(global.fetch.mock.calls[0][1].headers).toMatchObject({ "x-goog-api-key": "test-key" });
    expect(global.fetch.mock.calls[0][1].signal).toBeUndefined();
    const body = await result.response.json();
    expect(body.format).toBe("wav");
    expect(Buffer.from(body.audio, "base64").toString("ascii")).toBe("RIFFtest");
  });

  it("wraps Gemini 3.8 raw PCM output as WAV", async () => {
    mockGeminiAudioResponse(true, "audio/l16");
    const result = await handleTtsCore({ provider: "gemini", model: "gemini-3.8-flash-tts", input: "Hello", credentials: { apiKey: "test-key" }, responseFormat: "json" });
    const body = await result.response.json();
    expect(Buffer.from(body.audio, "base64").subarray(0, 4).toString("ascii")).toBe("RIFF");
  });

  it("preserves an explicit Gemini TTS model and voice pair", async () => {
    mockGeminiAudioResponse();

    const result = await handleTtsCore({
      provider: "gemini",
      model: "gemini-2.5-flash-preview-tts/Puck",
      input: "Hello from Gemini",
      credentials: { apiKey: "test-key" },
      responseFormat: "json",
    });

    expect(result.success).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=test-key"
    );

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Puck");
  });

  it("exposes current Gemini TTS models in the TTS catalog", () => {
    const entries = buildTtsProviderModels();

    expect(entries["gemini-tts-models"].map((model) => model.id)).toEqual([
      "gemini-3.8-flash-tts",
      "gemini-3.8-flash-lite-tts",
      "gemini-3.1-flash-tts-preview",
      "gemini-2.5-flash-preview-tts",
      "gemini-2.5-pro-preview-tts",
    ]);
    expect(entries["gemini-tts-voices"]).toContainEqual(
      expect.objectContaining({ id: "Zephyr", type: "tts" })
    );
  });
});
