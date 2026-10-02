import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleSttCore } from "../../open-sse/handlers/sttCore.js";
import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("native speech adapters", () => {
  it("does not let client TTS settings redirect selected provider credentials", async () => {
    global.fetch.mockImplementation(async (url, init) => {
      if (new URL(String(url)).origin !== "https://api.minimax.io" ||
          new Headers(init.headers).get("authorization") !== "Bearer selected-credential") {
        throw new Error("Untrusted destination or credential");
      }
      return new Response(JSON.stringify({ data: { audio: "00010203" }, base_resp: { status_code: 0 } }), {
        headers: { "Content-Type": "application/json" },
      });
    });
    const result = await handleTtsCore({
      provider: "minimax", model: "speech-2.8-hd", input: "hello",
      credentials: { apiKey: "selected-credential", providerSpecificData: { disableEnvProxy: true } },
      baseUrl: "https://attacker.invalid/tts", apiKey: "client-credential",
      proxyOptions: { enabled: true, url: "http://attacker.invalid", strictProxy: true },
    });
    expect(result.success).toBe(true);
    expect(new Uint8Array(await result.response.arrayBuffer())).toEqual(new Uint8Array([0, 1, 2, 3]));
  });

  it("orders xAI STT options before file and passes SSE through", async () => {
    global.fetch.mockResolvedValueOnce(new Response("data: {\"text\":\"hello\"}\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    }));
    const formData = new FormData();
    formData.append("model", "grok-voice-transcribe-2.0");
    formData.append("stream", "true");
    formData.append("language", "en");
    formData.append("file", new File(["audio"], "clip.wav", { type: "audio/wav" }));

    const result = await handleSttCore({
      provider: "xai",
      model: "grok-voice-transcribe-2.0",
      formData,
      credentials: { apiKey: "test-key" },
      sttConfig: { baseUrl: "https://api.x.ai/v1/stt", authType: "apikey", authHeader: "bearer", format: "xai-stt" },
    });

    const entries = [...global.fetch.mock.calls[0][1].body.entries()];
    expect(entries.map(([key]) => key)).toEqual(["stream", "language", "model", "file"]);
    expect(result.response.headers.get("content-type")).toBe("text/event-stream");
    expect(await result.response.text()).toBe("data: {\"text\":\"hello\"}\n\n");
  });

  it("uses xAI STT default model for gateway route label", async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ text: "hello" }), {
      headers: { "Content-Type": "application/json" },
    }));
    const formData = new FormData();
    formData.append("model", "stt");
    formData.append("file", new File(["audio"], "clip.wav", { type: "audio/wav" }));

    await handleSttCore({
      provider: "xai", model: "stt", formData, credentials: { apiKey: "test-key" },
      sttConfig: { baseUrl: "https://api.x.ai/v1/stt", authType: "apikey", authHeader: "bearer", format: "xai-stt" },
    });

    expect([...global.fetch.mock.calls[0][1].body.keys()]).toEqual(["file"]);
  });

  it("sends MiniMax language header instead of duplicate multipart field", async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ text: "hello" }), {
      headers: { "Content-Type": "application/json" },
    }));
    const formData = new FormData();
    formData.append("model", "asr-1.0");
    formData.append("language", "en");
    formData.append("response_format", "verbose_json");
    formData.append("file", new File(["audio"], "clip.wav", { type: "audio/wav" }));

    await handleSttCore({
      provider: "minimax",
      model: "asr-1.0",
      formData,
      credentials: { apiKey: "test-key" },
      sttConfig: { baseUrl: "https://api.minimax.io/v1/speech_to_text", authType: "apikey", authHeader: "bearer", format: "minimax-stt" },
    });

    const init = global.fetch.mock.calls[0][1];
    expect(init.headers).toMatchObject({ Authorization: "Bearer test-key", language: "en" });
    expect([...init.body.keys()]).toEqual(["response_format", "model", "file"]);
  });

  it("redacts credential echoes from native STT errors", async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Bearer test-key rejected" } }), {
      status: 401, headers: { "Content-Type": "application/json" },
    }));
    const formData = new FormData();
    formData.append("model", "asr-1.0");
    formData.append("file", new File(["audio"], "clip.wav", { type: "audio/wav" }));

    const result = await handleSttCore({
      provider: "minimax", model: "asr-1.0", formData, credentials: { apiKey: "test-key" },
      sttConfig: { baseUrl: "https://api.minimax.io/v1/speech_to_text", authType: "apikey", authHeader: "bearer", format: "minimax-stt" },
    });

    expect(result.status).toBe(401);
    expect(result.error).not.toContain("test-key");
  });
});
