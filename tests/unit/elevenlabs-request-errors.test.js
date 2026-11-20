import { afterEach, describe, expect, it, vi } from "vitest";
import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";

afterEach(() => vi.unstubAllGlobals());

describe("ElevenLabs request errors", () => {
  it("returns provider client faults as 400 responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ detail: { message: "Invalid voice" } }), { status: 400 },
    )));
    const result = await handleTtsCore({ provider: "elevenlabs", model: "voice123", input: "Hello", credentials: { apiKey: "test" } });
    expect(result).toMatchObject({ success: false, status: 400, error: "Invalid voice" });
  });
});
