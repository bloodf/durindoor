/**
 * Upstream 9router #5323: custom TTS models added from the dashboard.
 *
 * A custom TTS model id used to be misread as a voice name, so the request
 * went to the provider with the default model and an invalid voice. The
 * dashboard media provider page now keeps its models card for TTS, the Gemini
 * adapter recognizes a `*-tts` model id, OpenRouter talks to the dedicated
 * /audio/speech endpoint, and the dashboard test button probes a TTS model.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
// Imported first: proxyFetch installs its global fetch patch at module load, so
// the test mock stays in place as the "original" transport afterwards.
import { __setOriginalFetchForTesting } from "../../open-sse/utils/proxyFetch.js";

const mocks = vi.hoisted(() => ({ getConsistentMachineId: vi.fn() }));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: mocks.getConsistentMachineId }));

const originalFetch = global.fetch;

function sseAudio(audioBase64) {
  const body = [
    `data: ${JSON.stringify({ id: "gen-1", choices: [{ index: 0, delta: { audio: { data: audioBase64 } } }] })}\n\n`,
    `data: ${JSON.stringify({ id: "gen-1", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { total_tokens: 5 } })}\n\n`,
    "data: [DONE]\n\n",
  ].join("");
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("custom TTS models", () => {
  let restoreOriginalFetch;

  beforeEach(() => {
    mocks.getConsistentMachineId.mockResolvedValue("machine-id-test");
    global.fetch = vi.fn();
    restoreOriginalFetch = __setOriginalFetchForTesting(global.fetch);
  });

  afterEach(() => {
    restoreOriginalFetch?.();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("treats a custom Gemini *-tts id as a model, not a voice", async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/l16", data: Buffer.from([0, 1, 2, 3]).toString("base64") } }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const gemini = (await import("../../open-sse/handlers/ttsProviders/gemini.js")).default;
    const result = await gemini.synthesize("hello", "gemini-9.9-custom-tts", { apiKey: "test-key" }, "json", {});

    expect(result.format).toBe("wav");
    expect(global.fetch.mock.calls[0][0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-9.9-custom-tts:generateContent?key=test-key"
    );
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Kore");
  });

  it("keeps an explicit Gemini model and voice pair", async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: "audio/l16", data: Buffer.from([0, 1, 2, 3]).toString("base64") } }] } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const gemini = (await import("../../open-sse/handlers/ttsProviders/gemini.js")).default;
    await gemini.synthesize("hello", "gemini-9.9-custom-tts/Puck", { apiKey: "test-key" }, "json", {});

    expect(global.fetch.mock.calls[0][0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-9.9-custom-tts:generateContent?key=test-key"
    );
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe("Puck");
  });

  it("sends a custom OpenRouter model as the model instead of treating it as a voice", async () => {
    global.fetch.mockResolvedValueOnce(sseAudio(Buffer.from("audio-bytes").toString("base64")));

    const openrouter = (await import("../../open-sse/handlers/ttsProviders/openrouter.js")).default;
    const result = await openrouter.synthesize("hello", "vendor/custom-tts", { apiKey: "test-key" }, "json", {});

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.model).toBe("vendor/custom-tts");
    expect(sent.audio).toEqual({ voice: "alloy", format: "wav" });
    expect(result.format).toBe("wav");
  });

  it("splits a known trailing voice off an OpenRouter model", async () => {
    global.fetch.mockResolvedValueOnce(sseAudio(Buffer.from("audio-bytes").toString("base64")));

    const openrouter = (await import("../../open-sse/handlers/ttsProviders/openrouter.js")).default;
    await openrouter.synthesize("hello", "vendor/custom-tts/alloy", { apiKey: "test-key" }, "json", {});

    const sent = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(sent.model).toBe("vendor/custom-tts");
    expect(sent.audio).toEqual({ voice: "alloy", format: "wav" });
  });

  it("falls back to /audio/speech for a model OpenRouter refuses on chat completions", async () => {
    global.fetch
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: "vendor/custom-tts is a text-to-speech model and cannot be used with the chat/completions endpoint" },
      }), { status: 400, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(Buffer.from("audio-bytes"), {
        status: 200, headers: { "Content-Type": "audio/mpeg" },
      }));

    const openrouter = (await import("../../open-sse/handlers/ttsProviders/openrouter.js")).default;
    const result = await openrouter.synthesize("hello", "vendor/custom-tts", { apiKey: "test-key" }, "json", {});

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[1][0]).toBe("https://openrouter.ai/api/v1/audio/speech");
    const sent = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(sent.model).toBe("vendor/custom-tts");
    expect(result.format).toBe("mp3");
    expect(Buffer.from(result.base64, "base64").toString()).toBe("audio-bytes");
  });

  it("reports a chat completions failure instead of falling back", async () => {
    global.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "model not allowed" } }), {
      status: 400, headers: { "Content-Type": "application/json" },
    }));

    const openrouter = (await import("../../open-sse/handlers/ttsProviders/openrouter.js")).default;
    await expect(openrouter.synthesize("hello", "vendor/custom-tts", { apiKey: "test-key" }, "json", {}))
      .rejects.toThrow("model not allowed");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("probes a TTS model through /api/v1/audio/speech", async () => {
    const { pingModelByKind } = await import("../../src/app/api/models/test/ping.js");
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new Uint8Array(1024).buffer,
    }));

    const result = await pingModelByKind("openai/gpt-4o-mini-tts", "tts", "http://local.test");

    expect(result.ok).toBe(true);
    expect(global.fetch.mock.calls[0][0]).toBe("http://local.test/api/v1/audio/speech");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ model: "openai/gpt-4o-mini-tts", input: "Test.", response_format: "mp3" });
  });

  it("reports a JSON error body from the TTS endpoint as a failure", async () => {
    const { pingModelByKind } = await import("../../src/app/api/models/test/ping.js");
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify({ error: { message: "unknown model" } })).buffer,
    }));

    const result = await pingModelByKind("openai/gpt-4o-mini-tts", "tts", "http://local.test");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("unknown model");
  });

  it("keeps the models card available on the TTS media provider page", () => {
    const page = readFileSync(
      new URL("../../src/app/(dashboard)/dashboard/media-providers/[kind]/[id]/page.js", import.meta.url),
      "utf8"
    );
    expect(page).toContain('kind !== "webSearch" && kind !== "webFetch"');
    expect(page).not.toContain('kind !== "tts"');
  });
});
