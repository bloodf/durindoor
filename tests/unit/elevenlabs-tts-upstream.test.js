import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import elevenLabsTts from "../../open-sse/handlers/ttsProviders/elevenlabs.js";
import { TTS_MODELS_CONFIG } from "../../open-sse/config/ttsModels.js";

const originalFetch = global.fetch;
const AUDIO = Buffer.alloc(2048, 1);

beforeEach(() => { global.fetch = vi.fn().mockResolvedValue(new Response(AUDIO)); });
afterEach(() => { global.fetch = originalFetch; });

describe("ElevenLabs TTS options", () => {
  it("offers current models and omits deprecated choices", () => {
    const ids = TTS_MODELS_CONFIG.elevenlabs.models.map(({ id }) => id);
    expect(ids).toEqual(expect.arrayContaining(["eleven_v4", "eleven_v4_turbo", "eleven_flash_v2", "eleven_v3"]));
    expect(ids).not.toContain("eleven_turbo_v2_5");
    expect(ids).not.toContain("eleven_monolingual_v1");
  });

  it("preserves stored voice settings and passes supported native options", async () => {
    await elevenLabsTts.synthesize("Hello", "eleven_v4/voice123", { apiKey: "test" }, "mp3", {
      voice_settings: { stability: 0.3 }, seed: 7, language: "ja", previous_text: "Before",
      ignored: "not forwarded",
    });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toContain("/v1/text-to-speech/voice123?output_format=mp3_44100_128");
    expect(JSON.parse(init.body)).toEqual({
      text: "Hello", model_id: "eleven_v4", language_code: "ja",
      voice_settings: { stability: 0.3 }, seed: 7, previous_text: "Before",
    });
  });

  it("loads only account-enabled text-to-speech models", async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify([
      { model_id: "eleven_v4", name: "Eleven v4", can_do_text_to_speech: true },
      { model_id: "voice", name: "Voice", can_do_text_to_speech: false },
      { model_id: "alpha", can_do_text_to_speech: true, requires_alpha_access: true },
    ])));
    await expect((await import("../../open-sse/handlers/ttsProviders/elevenlabs.js")).fetchElevenLabsModels("models-key"))
      .resolves.toEqual([{ id: "eleven_v4", name: "Eleven v4", type: "tts" }]);
  });


  it.each([["opus", "opus_48000_128", "opus"], ["wav", "wav_24000", "wav"], ["pcm", "pcm_24000", "pcm"]])(
    "maps %s to the matching provider output format", async (requested, upstream, returned) => {
      const result = await elevenLabsTts.synthesize("Hello", "voice123", { apiKey: "test" }, requested);
      expect(global.fetch.mock.calls[0][0]).toContain(`output_format=${upstream}`);
      expect(result.format).toBe(returned);
    },
  );
});
