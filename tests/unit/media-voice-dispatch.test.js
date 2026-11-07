import { afterEach, describe, expect, it, vi } from "vitest";
import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";

afterEach(() => vi.unstubAllGlobals());

describe("media model voice dispatch", () => {
  it("keeps legacy ElevenLabs voice-only models", async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array(2048), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const result = await handleTtsCore({ provider: "elevenlabs", model: "legacy-voice", input: "Hello", credentials: { apiKey: "test-key" } });
    expect(result.success).toBe(true);
    expect(fetch.mock.calls[0][0]).toContain("/text-to-speech/legacy-voice");
    expect(JSON.parse(fetch.mock.calls[0][1].body).model_id).toBe("eleven_flash_v2_5");
  });

  it.each([
    ["elevenlabs", "eleven_v3", "voice-eleven"],
    ["cartesia", "sonic-3", "voice-cartesia"],
  ])("sends %s model and requested voice", async (provider, model, voice) => {
    const fetch = vi.fn(async () => new Response(new Uint8Array(2048), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const result = await handleTtsCore({ provider, model, voice, input: "Hello", credentials: { apiKey: "test-key" } });
    expect(result.success).toBe(true);
    const [url, request] = fetch.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(body.model_id).toBe(model);
    if (provider === "elevenlabs") expect(url).toContain(`/text-to-speech/${voice}`);
    else expect(body.voice).toEqual({ mode: "id", id: voice });
  });
});
