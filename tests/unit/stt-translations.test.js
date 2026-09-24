/**
 * /v1/audio/translations must reach the provider's translations endpoint, not
 * its transcription endpoint, and providers with no translation analog are
 * rejected instead of silently transcribing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSttCore } from "../../open-sse/handlers/sttCore.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";

const originalFetch = global.fetch;
const sttConfig = (id) => REGISTRY.find((entry) => entry.id === id).sttConfig;

function formDataWithAudio() {
  const fd = new FormData();
  fd.append("file", new File(["fake-audio"], "clip.wav", { type: "audio/wav" }));
  return fd;
}

const run = (provider, extra = {}) => handleSttCore({
  provider,
  model: "whisper-1",
  formData: formDataWithAudio(),
  credentials: { apiKey: "sk-test" },
  sttConfig: sttConfig(provider),
  ...extra,
});

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: "hello" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("STT translations", () => {
  it("sends OpenAI-format translations to /audio/translations", async () => {
    const result = await run("openai", { kind: "translation" });
    expect(result.success).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/audio/translations");
  });

  it("keeps transcriptions on /audio/transcriptions", async () => {
    await run("groq");
    expect(global.fetch.mock.calls[0][0]).toBe("https://api.groq.com/openai/v1/audio/transcriptions");
  });

  it("rejects translation for providers without a translations endpoint", async () => {
    const result = await run("deepgram", { kind: "translation" });
    expect(result.success).toBeFalsy();
    expect(result.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
