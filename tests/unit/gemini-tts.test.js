import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";
import { buildTtsProviderModels } from "../../open-sse/config/ttsModels.js";
import gemini from "../../open-sse/providers/registry/gemini.js";

const originalFetch = global.fetch;

function mockGeminiAudioResponse() {
  global.fetch.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  inlineData: {
                    mimeType: "audio/pcm",
                    data: Buffer.from([0, 1, 2, 3]).toString("base64"),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  );
}

describe("Gemini TTS", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("uses the default Gemini TTS model when only a voice is provided", async () => {
    mockGeminiAudioResponse();

    const result = await handleTtsCore({
      provider: "gemini",
      model: "Zephyr",
      input: "Hello from Gemini",
      credentials: { apiKey: "test-key" },
      responseFormat: "json",
    });

    // The test was originally hard-coded to `gemini-3.1-flash-tts-preview`,
    // but the registry's `ttsConfig.defaultModel` is the product's chosen
    // default — reading it from the registry keeps the test robust against
    // future default changes (e.g. 2.5 → 3.1 → 4.0) without needing
    // test edits for each.
    const expectedDefault = gemini.ttsConfig.defaultModel;
    expect(global.fetch.mock.calls[0][0]).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${expectedDefault}:generateContent?key=test-key`
    );

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Zephyr");
    const body = await result.response.json();
    expect(body.format).toBe("wav");
    expect(body.audio).toEqual(expect.any(String));
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
      "gemini-3.1-flash-tts-preview",
      "gemini-2.5-flash-preview-tts",
      "gemini-2.5-pro-preview-tts",
    ]);
    expect(entries["gemini-tts-voices"]).toContainEqual(
      expect.objectContaining({ id: "Zephyr", type: "tts" })
    );
  });
});
