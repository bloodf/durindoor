import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { handleSttCore } from "../../open-sse/handlers/sttCore.js";

const originalFetch = global.fetch;
const config = { baseUrl: "https://generativelanguage.googleapis.com/v1beta/models", authType: "apikey", authHeader: "key", format: "gemini-stt" };

function formData(fields = {}) {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array([1, 2, 3])], { type: "audio/wav" }), "speech.wav");
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
}

describe("Gemini native STT", () => {
  beforeEach(() => { global.fetch = vi.fn(); });
  afterEach(() => { global.fetch = originalFetch; vi.restoreAllMocks(); });

  it("uploads then sends documented Transcribe interaction", async () => {
    global.fetch
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { "x-goog-upload-url": "https://upload.example/session" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ file: { uri: "gs://files/audio", mime_type: "audio/wav" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: "hello" }), { status: 200 }));
    const result = await handleSttCore({ provider: "gemini", model: "gemini-3.5-transcribe", formData: formData({ language: "en-US", diarization_mode: "speaker", timestamp_granularities: "word" }), credentials: { apiKey: "test-key" }, sttConfig: config });
    expect(await result.response.json()).toEqual({ text: "hello" });
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch.mock.calls[0][0]).toBe("https://generativelanguage.googleapis.com/upload/v1beta/files");
    expect(global.fetch.mock.calls[1][0]).toBe("https://upload.example/session");
    expect(global.fetch.mock.calls[2][0]).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(JSON.parse(global.fetch.mock.calls[2][1].body)).toMatchObject({ model: "gemini-3.5-transcribe", input: [{ type: "audio", uri: "gs://files/audio", mime_type: "audio/wav" }], generation_config: { transcription_config: { language_codes: ["en-US"], mode: { type: "verbatim", diarization_mode: "speaker", timestamp_granularities: ["word"] } } } });
  });

  it("preserves custom vocabulary phrases", async () => {
    global.fetch
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { "x-goog-upload-url": "https://upload.example/session" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ file: { uri: "gs://files/audio", mime_type: "audio/wav" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: "hello" }), { status: 200 }));
    await handleSttCore({ provider: "gemini", model: "gemini-3.5-transcribe", formData: formData({ custom_vocabulary: "[\"ACME, Inc.\"]" }), credentials: { apiKey: "test-key" }, sttConfig: config });
    expect(JSON.parse(global.fetch.mock.calls[2][1].body).generation_config.transcription_config.custom_vocabulary).toEqual(["ACME, Inc."]);
  });

  it("rejects incompatible native transcription options before upload", async () => {
    const result = await handleSttCore({ provider: "gemini", model: "gemini-3.5-transcribe", formData: formData({ mode: "smart", diarization_mode: "speaker" }), credentials: { apiKey: "test-key" }, sttConfig: config });
    expect(result.success).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
