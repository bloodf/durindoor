import { afterEach, expect, it, vi } from "vitest";
import adapter from "../../open-sse/handlers/ttsProviders/elevenlabs.js";

afterEach(() => vi.unstubAllGlobals());
it("uses a live ElevenLabs model with the OpenAI voice field", async () => {
  const fetch = vi.fn(async () => new Response(new Uint8Array(1024)));
  vi.stubGlobal("fetch", fetch);
  await adapter.synthesize("hello", "eleven_future", { apiKey: "test" }, "mp3", { voice: "voice-id" });
  expect(fetch.mock.calls[0][0]).toContain("/text-to-speech/voice-id?");
  expect(JSON.parse(fetch.mock.calls[0][1].body).model_id).toBe("eleven_future");
});
