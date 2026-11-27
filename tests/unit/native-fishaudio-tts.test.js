// Fish Audio native speech (TTS) adapter and voice discovery, staged and
// unregistered (#2034). Closed mocks only: every request goes to an injected
// transport (or a stubbed global fetch for the existing local handler), an
// unexpected request fails the test, and every key is synthetic. Wire shapes
// follow OmniRoute c71f0065 (executors/fishAudioTts.ts, config/audioRegistry.ts
// `fishaudio` speech row, src/app/api/v1/_shared/fishAudioProxy.ts,
// tests/unit/audio-speech-fishaudio.test.ts). Passing here says nothing about
// the live service.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-fishaudio-tts/index.js";
import {
  FISH_AUDIO_ADDED_TTS_MODELS,
  FISH_AUDIO_TTS_CONFIG,
  FISH_AUDIO_TTS_MODELS,
  FISH_AUDIO_TTS_PROVIDER_ADDITIONS,
  buildFishAudioSpeechRequest,
  buildFishAudioVoicesUrl,
  createFishAudioTtsAdapter,
  createFishAudioVoiceLister,
  fishAudioTtsAdapter,
} from "../../open-sse/services/providerParity/native-fishaudio-tts/index.js";
import { TTS_ADAPTERS } from "../../open-sse/handlers/ttsProviders/index.js";
import { FORMAT_HANDLERS } from "../../open-sse/handlers/ttsProviders/genericFormats.js";
import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";
import fishRegistry from "../../open-sse/providers/registry/fish-audio.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const SPEECH_URL = "https://api.fish.audio/v1/tts";
const VOICES_URL = "https://api.fish.audio/model";
const KEY_A = "fish-SYNTHETIC-a-0001";
const KEY_B = "fish-SYNTHETIC-b-0002";
const CRED_A = { apiKey: KEY_A, connectionId: "conn-a" };
const CRED_B = { apiKey: KEY_B, connectionId: "conn-b" };
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 7)]);
const MP3_FRAME = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(100, 1)]);
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(200, 1)]);
const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(200, 2)]);
const PCM = Buffer.alloc(320, 3);
const STAGE_DIR = "../../open-sse/services/providerParity/native-fishaudio-tts/";
const REGISTRATION = JSON.parse(readFileSync(new URL(`${STAGE_DIR}registration.json`, import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const audio = (bytes = MP3, type = "audio/mpeg") => new Response(bytes, { status: 200, headers: { "content-type": type } });
const leaky = (status, headers = {}) => json({ message: `upstream echo ${KEY_A} at /srv/app/index.js:44` }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });
/** A fetch that never settles and ignores its signal. */
const hang = () => new Promise(() => {});
/** A 200 whose body never finishes. */
const stalledBody = (type = "audio/mpeg") => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0x49, 0x44, 0x33])); } }), { status: 200, headers: { "content-type": type } });

/** A transport that answers each request with the next step (a Response, an Error, or a function). */
function transport(...steps) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init, proxyOptions) => {
    calls.push({ url: String(url), init, proxyOptions });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    const value = isFunction(step) ? await step(url, init) : step;
    if (value instanceof Error) throw value;
    return value;
  });
  return { fetchImpl, calls };
}

const headersOf = (call) => Object.fromEntries(Object.entries(call.init.headers));
const bodyOf = (call) => JSON.parse(call.init.body);
const expectNoLeak = (result) => {
  const text = JSON.stringify(result);
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
  expect(text).not.toContain("/srv/app");
};
const synth = (adapter, options = {}, model = "s2.1-pro-free", cred = CRED_A, queryFormat = "mp3") =>
  adapter.synthesize("Hello there.", model, cred, queryFormat, options);

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Staging block: the only assertions about registration state ──────────
describe("Fish Audio tts staging state (promote at registration)", () => {
  it("is not registered: no TTS adapter under fish-audio, fish or fishaudio; legacy rows and alias absent", () => {
    for (const name of ["fish-audio", "fish", "fishaudio"]) expect(Object.hasOwn(TTS_ADAPTERS, name), name).toBe(false);
    expect(fishRegistry.ttsConfig.models.map((m) => m.id)).toEqual(["s2.1-pro-free", "s2.1-pro", "s2-pro", "s1"]);
    expect(fishRegistry.aliases ?? []).not.toContain("fishaudio");
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });

  it("documents the existing local handler as the same endpoint, auth and model header with a narrower body", async () => {
    // FORMAT_HANDLERS["fish-audio"] serves fish-audio today through ttsConfig.format.
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return audio();
    }));
    const result = await FORMAT_HANDLERS["fish-audio"]({ baseUrl: fishRegistry.ttsConfig.baseUrl, apiKey: KEY_A, text: "Hi", modelId: "s1", voiceId: "ref1" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(SPEECH_URL);
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}`, model: "s1" });
    expect(calls[0].init.body).toBe(JSON.stringify({ text: "Hi", format: "mp3", reference_id: "ref1" }));
    expect(result).toEqual({ base64: MP3.toString("base64"), format: "mp3" });
  });
});

describe("Fish Audio staged metadata", () => {
  it("pins the source registry fields and models; the STT row has no source entry", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryFields.tts).toEqual({
      id: "fishaudio", baseUrl: SPEECH_URL, authType: "apikey", authHeader: "bearer", format: "fishaudio",
      models: ["s2.1-pro-free", "s2.1-pro", "s2-pro", "s1", "speech-1.6", "speech-1.5"],
    });
    expect(FISH_AUDIO_TTS_MODELS.map((m) => m.id)).toEqual(REGISTRATION.models.tts);
    expect(FISH_AUDIO_ADDED_TTS_MODELS.map((m) => m.id)).toEqual(["speech-1.6", "speech-1.5"]);
    expect(REGISTRATION.source.sttRow).toMatch(/no fishaudio entry/);
    expect(REGISTRATION.provider).toMatchObject({ canonicalId: "fish-audio", aliases: ["fish"], addAliases: ["fishaudio"], authModes: ["apikey"] });
  });

  it("stages config and additions that keep the existing identity, endpoint, format and auth mode", () => {
    expect(FISH_AUDIO_TTS_CONFIG).toMatchObject({ baseUrl: SPEECH_URL, authType: "apikey", authHeader: "bearer", format: "fish-audio" });
    expect(FISH_AUDIO_TTS_PROVIDER_ADDITIONS).toMatchObject({ id: "fish-audio", aliases: ["fish"], addAliases: ["fishaudio"], authType: "apikey" });
    expect(fishRegistry.id).toBe(FISH_AUDIO_TTS_PROVIDER_ADDITIONS.id);
    expect(fishRegistry.alias).toBe(FISH_AUDIO_TTS_PROVIDER_ADDITIONS.aliases[0]);
    expect(fishRegistry.authType).toBe(FISH_AUDIO_TTS_PROVIDER_ADDITIONS.authType);
    expect(fishRegistry.serviceKinds).toEqual([...FISH_AUDIO_TTS_PROVIDER_ADDITIONS.serviceKinds]);
    const { models: _m, ...existing } = fishRegistry.ttsConfig;
    const { models: _s, ...stagedConfig } = FISH_AUDIO_TTS_CONFIG;
    expect(stagedConfig).toEqual(existing);
    // Every existing model id is kept.
    for (const row of fishRegistry.ttsConfig.models) expect(FISH_AUDIO_TTS_MODELS.some((m) => m.id === row.id), row.id).toBe(true);
  });

  it("exports every name registration.json lists", () => {
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(fishAudioTtsAdapter.provider).toBe("fish-audio");
    expect(isFunction(staged.listFishAudioVoices)).toBe(true);
  });
});

describe("Fish Audio speech wire contract", () => {
  it("posts the source body with Bearer auth and the model header, and returns mp3", async () => {
    const { fetchImpl, calls } = transport(audio());
    const result = await synth(createFishAudioTtsAdapter({ fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(SPEECH_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(headersOf(calls[0])).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}`, model: "s2.1-pro-free" });
    expect(calls[0].init.body).toBe(JSON.stringify({ text: "Hello there.", format: "mp3" }));
    expect(result.format).toBe("mp3");
    expect(Buffer.from(result.base64, "base64").equals(MP3)).toBe(true);
    expect(result.accounting).toMatchObject({ modality: "tts", cost: null, costStatus: "unknown", costSource: "unavailable", meta: { model: "s2.1-pro-free", container: "mp3" } });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("maps every source provider option exactly as the source test does", async () => {
    // Mirrors audio-speech-fishaudio.test.ts "maps Fish S2.1 free model and validated provider options".
    const { fetchImpl, calls } = transport(audio());
    await createFishAudioTtsAdapter({ fetchImpl }).synthesize("Привіт", "s2.1-pro-free", CRED_A, "mp3", {
      voice: "ref-123",
      response_format: "mp3",
      speed: 1.2,
      provider_options: {
        fishaudio: {
          temperature: 0.8, top_p: 0.6, chunk_length: 240, normalize: true, sample_rate: 44100, mp3_bitrate: 192,
          latency: "normal", max_new_tokens: 1024, repetition_penalty: 1.2, min_chunk_length: 50,
          condition_on_previous_chunks: true, early_stop_threshold: 0.9, features: ["quality-guard"],
          prosody: { volume: 3, normalize_loudness: true },
        },
      },
    });
    expect(headersOf(calls[0]).model).toBe("s2.1-pro-free");
    expect(calls[0].init.body).toBe(JSON.stringify({
      text: "Привіт", format: "mp3", reference_id: "ref-123", temperature: 0.8, top_p: 0.6, chunk_length: 240,
      normalize: true, sample_rate: 44100, mp3_bitrate: 192, latency: "normal", max_new_tokens: 1024,
      repetition_penalty: 1.2, min_chunk_length: 50, condition_on_previous_chunks: true, early_stop_threshold: 0.9,
      features: ["quality-guard"], prosody: { speed: 1.2, volume: 3, normalize_loudness: true },
    }));
  });

  it.each([
    ["wav", { response_format: "wav" }, WAV, "audio/wav"],
    ["pcm", { response_format: "pcm" }, PCM, "application/octet-stream"],
    ["opus", { response_format: "opus", provider_options: { fishaudio: { opus_bitrate: 32000 } } }, OGG, "audio/ogg"],
    ["opus", { response_format: "OGG" }, OGG, "audio/opus"],
    ["wav", { requestedResponseFormat: "wav" }, WAV, ""],
    ["mp3", { response_format: "mp3" }, MP3_FRAME, "audio/mpeg"],
  ])("asks Fish for %s and checks the returned container", async (container, options, bytes, type) => {
    const { fetchImpl, calls } = transport(audio(bytes, type));
    const result = await synth(createFishAudioTtsAdapter({ fetchImpl }), options);
    expect(bodyOf(calls[0]).format).toBe(container);
    expect(result.format).toBe(container);
    expect(Buffer.from(result.base64, "base64").equals(bytes)).toBe(true);
  });

  it("reads a query-string container from the positional format, but not the default mp3 or json", () => {
    expect(buildFishAudioSpeechRequest("s1", "Hi", {}, "wav").container).toBe("wav");
    expect(buildFishAudioSpeechRequest("s1", "Hi", { response_format: "pcm" }, "mp3").container).toBe("pcm");
    expect(buildFishAudioSpeechRequest("s1", "Hi", { response_format: "opus" }, "json").container).toBe("opus");
  });

  it("selects voices from reference_id, voice or a model/voice suffix, and keeps reference arrays", () => {
    expect(buildFishAudioSpeechRequest("s1/abc_123", "Hi").payload).toEqual({ text: "Hi", format: "mp3", reference_id: "abc_123" });
    expect(buildFishAudioSpeechRequest("s1", "Hi", { voice: " v-1 " }).payload.reference_id).toBe("v-1");
    expect(buildFishAudioSpeechRequest("s1", "Hi", { voice: "v1", provider_options: { fishaudio: { reference_id: ["a", " b "] } } }).payload.reference_id).toEqual(["a", "b"]);
    expect(buildFishAudioSpeechRequest("speech-1.5/v1", "Hi", { voice: "v1" })).toMatchObject({ modelId: "speech-1.5", payload: { reference_id: "v1" } });
    expect(buildFishAudioSpeechRequest("", "Hi").modelId).toBe("s2.1-pro-free");
  });

  it("ignores any connection base URL and forwards the connection egress policy", async () => {
    const { fetchImpl, calls } = transport(audio());
    const proxied = { ...CRED_A, baseUrl: "https://evil.invalid", providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.invalid:8080" } };
    await synth(createFishAudioTtsAdapter({ fetchImpl }), {}, "s1", proxied);
    expect(calls[0].url).toBe(SPEECH_URL);
    expect(calls[0].proxyOptions).toBeTypeOf("object");
  });

  it("keeps each selected connection's key on its own request", async () => {
    const { fetchImpl, calls } = transport(audio(), audio());
    const adapter = createFishAudioTtsAdapter({ fetchImpl });
    await synth(adapter, {}, "s1", CRED_A);
    await synth(adapter, {}, "s1", CRED_B);
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${KEY_A}`);
    expect(headersOf(calls[1]).Authorization).toBe(`Bearer ${KEY_B}`);
  });

  it("uses an accessToken when the connection has no apiKey", async () => {
    const { fetchImpl, calls } = transport(audio());
    await synth(createFishAudioTtsAdapter({ fetchImpl }), {}, "s1", { accessToken: KEY_B });
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${KEY_B}`);
  });

  it.each([
    ["an unknown model", "tts-1", {}],
    ["an unknown container", "s1", { response_format: "flac" }],
    ["a gateway json body format", "s1", { response_format: "json" }],
    ["a body/query container conflict", "s1", { response_format: "wav", requestedResponseFormat: "opus" }],
    ["sse streaming", "s1", { stream_format: "sse" }],
    ["stream: true", "s1", { stream: true }],
    ["instructions", "s1", { instructions: "whisper" }],
    ["a language hint", "s1", { language: "fr" }],
    ["inline references (MessagePack only)", "s1", { provider_options: { fishaudio: { references: [{ audio: "x", text: "hi" }] } } }],
    ["an unknown Fish option", "s1", { provider_options: { fishaudio: { seed: 1 } } }],
    ["a non-object fishaudio block", "s1", { provider_options: { fishaudio: "fast" } }],
    ["temperature above 1", "s1", { provider_options: { fishaudio: { temperature: 1.5 } } }],
    ["a fractional chunk_length", "s1", { provider_options: { fishaudio: { chunk_length: 150.5 } } }],
    ["an unknown sample rate", "s1", { provider_options: { fishaudio: { sample_rate: 22050 } } }],
    ["an unknown latency", "s1", { provider_options: { fishaudio: { latency: "fast" } } }],
    ["a string boolean", "s1", { provider_options: { fishaudio: { normalize: "true" } } }],
    ["empty features", "s1", { provider_options: { fishaudio: { features: [""] } } }],
    ["an mp3 bitrate on wav", "s1", { response_format: "wav", provider_options: { fishaudio: { mp3_bitrate: 128 } } }],
    ["an opus bitrate on mp3", "s1", { provider_options: { fishaudio: { opus_bitrate: 32000 } } }],
    ["speed out of range", "s1", { speed: 3 }],
    ["prosody volume out of range", "s1", { provider_options: { fishaudio: { prosody: { volume: 40 } } } }],
    ["an unknown prosody key", "s1", { provider_options: { fishaudio: { prosody: { pitch: 2 } } } }],
    ["a non-object prosody", "s1", { provider_options: { fishaudio: { prosody: 2 } } }],
    ["an unsafe reference id", "s1", { voice: "../model/x" }],
    ["an empty reference array", "s1", { provider_options: { fishaudio: { reference_id: [] } } }],
    ["too many reference ids", "s1", { provider_options: { fishaudio: { reference_id: Array.from({ length: 17 }, (_, i) => `r${i}`) } } }],
    ["a voice that disagrees with the model suffix", "s1/abc", { voice: "def" }],
    ["a suffix on an unknown model", "tts-1/abc", {}],
  ])("refuses %s before submit", async (_label, model, options) => {
    const { fetchImpl } = transport();
    const result = await synth(createFishAudioTtsAdapter({ fetchImpl }), options, model);
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(result.acceptedJob).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("explains the MessagePack restriction like the source", () => {
    expect(() => buildFishAudioSpeechRequest("s1", "Hi", { provider_options: { fishaudio: { references: [] } } })).toThrow(/MessagePack.*persistent voice/);
  });

  it("refuses empty input, an oversized request and a missing or unsafe key before submit", async () => {
    const { fetchImpl } = transport();
    const adapter = createFishAudioTtsAdapter({ fetchImpl });
    expect(() => buildFishAudioSpeechRequest("s1", "x".repeat(300 * 1024))).toThrow(/too large/);
    expect(await adapter.synthesize("  ", "s1", CRED_A, "mp3", {})).toMatchObject({ success: false, status: 400, local: true });
    expect(await synth(adapter, {}, "s1", { apiKey: "" })).toMatchObject({ success: false, status: 401 });
    expect(await synth(adapter, {}, "s1", { apiKey: "a\r\nX-Evil: 1" })).toMatchObject({ success: false, status: 401 });
    expect(await synth(adapter, {}, "s1", null)).toMatchObject({ success: false, status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Fish Audio speech failures", () => {
  it.each([
    [401, 401],
    [403, 403],
    [400, 400],
    [404, 404],
    [422, 422],
  ])("maps HTTP %i to %i without quoting Fish or accepting a job", async (status, expected) => {
    const { fetchImpl } = transport(leaky(status));
    const result = await synth(createFishAudioTtsAdapter({ fetchImpl }));
    expect(result).toMatchObject({ success: false, status: expected });
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it("marks 402 as quota exhausted on this connection only", async () => {
    const { fetchImpl } = transport(leaky(402));
    const result = await synth(createFishAudioTtsAdapter({ fetchImpl }));
    expect(result).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    expectNoLeak(result);
  });

  it("keeps a bounded Retry-After on 429 and 503", async () => {
    const { fetchImpl } = transport(leaky(429, { "retry-after": "7" }), leaky(503, { "retry-after": "3" }));
    const adapter = createFishAudioTtsAdapter({ fetchImpl });
    const limited = await synth(adapter);
    const unavailable = await synth(adapter);
    expect(limited).toMatchObject({ success: false, status: 429 });
    expect(limited.resetsAtMs).toBeGreaterThan(Date.now());
    expect(unavailable).toMatchObject({ success: false, status: 503 });
    expect(limited.acceptedJob).toBeUndefined();
    expect(unavailable.acceptedJob).toBeUndefined();
    expectNoLeak(limited);
  });

  it("treats other 5xx as an uncertain, never-replayed job with unknown cost", async () => {
    const { fetchImpl, calls } = transport(leaky(500));
    const result = await synth(createFishAudioTtsAdapter({ fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toMatchObject({ modality: "tts", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
    expectNoLeak(result);
  });

  it("refuses a redirect without following it or resending the key", async () => {
    const redirect = new Response(null, { status: 307, headers: { location: "https://evil.invalid/steal" } });
    const { fetchImpl, calls } = transport(redirect);
    const result = await synth(createFishAudioTtsAdapter({ fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeDefined();
  });

  it("distinguishes a provably unsent connect failure from a failure after send", async () => {
    const { fetchImpl, calls } = transport(transportError("ENOTFOUND"), transportError("ECONNRESET"));
    const adapter = createFishAudioTtsAdapter({ fetchImpl });
    const unsent = await synth(adapter);
    const reset = await synth(adapter);
    expect(calls).toHaveLength(2);
    expect(unsent).toMatchObject({ success: false, status: 502 });
    expect(unsent.acceptedJob).toBeUndefined();
    expect(reset).toMatchObject({ success: false, status: 502 });
    expect(reset.acceptedJob.meta.jobState).toBe("submit-unknown");
    expectNoLeak(unsent);
    expectNoLeak(reset);
  });

  it("does not send when the caller already left", async () => {
    const { fetchImpl } = transport();
    const controller = new AbortController();
    controller.abort();
    const result = await synth(createFishAudioTtsAdapter({ fetchImpl }), { signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499, local: true });
    expect(result.acceptedJob).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stops waiting when the caller aborts after send and records the job as uncertain", async () => {
    const controller = new AbortController();
    let seenSignal;
    const { fetchImpl } = transport((_url, init) => {
      seenSignal = init.signal;
      setTimeout(() => controller.abort(), 5);
      return hang();
    });
    const result = await synth(createFishAudioTtsAdapter({ fetchImpl }), { signal: controller.signal });
    expect(seenSignal.aborted).toBe(true);
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("aborts the transport signal and ends at the deadline even when fetch ignores it", async () => {
    let seenSignal;
    const { fetchImpl, calls } = transport((_url, init) => {
      seenSignal = init.signal;
      return hang();
    });
    const result = await synth(createFishAudioTtsAdapter({ fetchImpl, timeoutMs: 20 }));
    expect(calls).toHaveLength(1);
    expect(seenSignal.aborted).toBe(true);
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob).toBeDefined();
  });

  it("bounds a stalled audio body by the same deadline", async () => {
    const { fetchImpl } = transport(stalledBody());
    const result = await synth(createFishAudioTtsAdapter({ fetchImpl, timeoutMs: 30 }));
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("records a caller abort during the body read as accepted work", async () => {
    const controller = new AbortController();
    const { fetchImpl } = transport(() => {
      setTimeout(() => controller.abort(), 5);
      return stalledBody();
    });
    const result = await synth(createFishAudioTtsAdapter({ fetchImpl }), { signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });
});

describe("Fish Audio speech malformed or unsafe answers", () => {
  it.each([
    ["a JSON error envelope on 200", () => leaky(200), {}],
    ["HTML", () => new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }), {}],
    ["plain text", () => new Response(`token ${KEY_A}`, { status: 200, headers: { "content-type": "text/plain" } }), {}],
    ["an empty body", () => audio(Buffer.alloc(0)), {}],
    ["WAV bytes for an mp3 request", () => audio(WAV), {}],
    ["mp3 bytes for a wav request", () => audio(MP3, "audio/wav"), { response_format: "wav" }],
    ["mp3 bytes for an opus request", () => audio(MP3, "audio/ogg"), { response_format: "opus" }],
    ["odd-length pcm", () => audio(Buffer.alloc(321, 1), "application/octet-stream"), { response_format: "pcm" }],
  ])("treats %s as a lost result of billable work", async (_label, answer, options) => {
    const { fetchImpl, calls } = transport(answer());
    const result = await synth(createFishAudioTtsAdapter({ fetchImpl }), options);
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toMatchObject({ costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "accepted" } });
    expectNoLeak(result);
  });

  it("caps the audio size", async () => {
    const { fetchImpl } = transport(audio(Buffer.concat([MP3, Buffer.alloc(4096)])));
    const result = await synth(createFishAudioTtsAdapter({ fetchImpl, maxAudioBytes: 512 }));
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeDefined();
  });
});

describe("Fish Audio voice discovery", () => {
  const listing = {
    total: 3,
    items: [
      { _id: "abc123", title: "Narrator\u0007", type: "tts", languages: ["en"], tags: ["calm"], visibility: "public", state: "trained", cover_image: "https://cdn.invalid/x.png", samples: [{ audio: "https://cdn.invalid/s.mp3" }], author: { _id: "u1", nickname: "n" } },
      { _id: "../etc/passwd", title: "bad" },
      { title: "no id" },
    ],
  };

  it("lists voice models with the selected key and reduces each to plain fields", async () => {
    const { fetchImpl, calls } = transport(json(listing));
    const result = await createFishAudioVoiceLister({ fetchImpl })(CRED_A, { self: true, page_size: 10, language: ["en", "pt-BR"], sort_by: "created_at" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${VOICES_URL}?self=true&page_size=10&language=en&language=pt-BR&sort_by=created_at`);
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.redirect).toBe("manual");
    expect(headersOf(calls[0])).toEqual({ Accept: "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(result).toEqual({
      success: true, total: 3, dropped: 2,
      voices: [{ id: "abc123", name: "Narrator", type: "tts", languages: ["en"], tags: ["calm"], visibility: "public", state: "trained" }],
    });
    expect(JSON.stringify(result)).not.toContain("cdn.invalid");
  });

  it("keeps each connection's key on its own listing", async () => {
    const { fetchImpl, calls } = transport(json({ total: 0, items: [] }), json({ total: 0, items: [] }));
    const list = createFishAudioVoiceLister({ fetchImpl });
    await list(CRED_A);
    await list(CRED_B);
    expect(calls.map((c) => headersOf(c).Authorization)).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
    expect(calls[0].url).toBe(VOICES_URL);
  });

  it.each([
    [{ page: 2 }],
    [{ page_size: 0 }],
    [{ page_size: 101 }],
    [{ self: "true" }],
    [{ author_id: "a/b" }],
    [{ language: "english" }],
    [{ sort_by: "random" }],
    [{ title: "x".repeat(201) }],
    [{ tag: [] }],
    ["self=true"],
  ])("refuses query %j before any request", async (query) => {
    const { fetchImpl } = transport();
    const result = await createFishAudioVoiceLister({ fetchImpl })(CRED_A, query);
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("only ever targets the fixed listing path", () => {
    expect(buildFishAudioVoicesUrl({ title: "a&b=c#d" }).toString()).toBe(`${VOICES_URL}?title=a%26b%3Dc%23d`);
    expect(new URL(buildFishAudioVoicesUrl({ title: "//evil.invalid" })).origin).toBe("https://api.fish.audio");
  });

  it("maps failures without quoting Fish and never records a billable job", async () => {
    const { fetchImpl } = transport(leaky(401), leaky(402), leaky(500), new Response(null, { status: 302, headers: { location: "https://evil.invalid" } }), transportError("ECONNRESET"));
    const list = createFishAudioVoiceLister({ fetchImpl });
    const results = [await list(CRED_A), await list(CRED_A), await list(CRED_A), await list(CRED_A), await list(CRED_A)];
    expect(results.map((r) => r.status)).toEqual([401, 402, 502, 502, 502]);
    expect(results[1].quotaExhausted).toBe(true);
    for (const result of results) {
      expect(result.success).toBe(false);
      expect(result.acceptedJob).toBeUndefined();
      expectNoLeak(result);
    }
  });

  it.each([
    ["HTML", () => new Response("<html/>", { status: 200, headers: { "content-type": "text/html" } })],
    ["invalid JSON", () => new Response(`{"items": ${KEY_A}`, { status: 200, headers: { "content-type": "application/json" } })],
    ["no items array", () => json({ total: 1, items: "x" })],
    ["a JSON array", () => json([])],
  ])("treats %s as a malformed listing", async (_label, answer) => {
    const { fetchImpl } = transport(answer());
    const result = await createFishAudioVoiceLister({ fetchImpl })(CRED_A);
    expect(result).toMatchObject({ success: false, status: 502 });
    expectNoLeak(result);
  });

  it("caps the listing size, honors the deadline and the caller's abort, and needs a key", async () => {
    const big = transport(json({ total: 1, items: [{ _id: "a", title: "x".repeat(4096) }] }));
    expect(await createFishAudioVoiceLister({ fetchImpl: big.fetchImpl, maxBytes: 1024 })(CRED_A)).toMatchObject({ success: false, status: 502 });

    let seen;
    const slow = transport((_url, init) => {
      seen = init.signal;
      return hang();
    });
    expect(await createFishAudioVoiceLister({ fetchImpl: slow.fetchImpl, timeoutMs: 20 })(CRED_A)).toMatchObject({ success: false, status: 504 });
    expect(seen.aborted).toBe(true);

    const controller = new AbortController();
    controller.abort();
    const none = transport();
    expect(await createFishAudioVoiceLister({ fetchImpl: none.fetchImpl })(CRED_A, {}, { signal: controller.signal })).toMatchObject({ status: 499, local: true });
    expect(await createFishAudioVoiceLister({ fetchImpl: none.fetchImpl })({ apiKey: "" })).toMatchObject({ status: 401 });
    expect(none.fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Fish Audio speech through handleTtsCore (test-local wiring)", () => {
  // Wires the adapter into TTS_ADAPTERS only for the duration of this test to
  // check the core contract (usage merge, json wrapper, binary body); the
  // registration state itself is asserted only in the staging block above.
  it("returns audio bytes with character usage, or the json wrapper, and keeps refusals local", async () => {
    const { fetchImpl, calls } = transport(audio(), audio(WAV, "audio/wav"));
    const adapter = createFishAudioTtsAdapter({ fetchImpl });
    const key = "fish-audio-test-wiring";
    TTS_ADAPTERS[key] = { adapter };
    try {
      const binary = await handleTtsCore({ provider: key, model: "s1", input: " Hé llo ", credentials: CRED_A, responseFormat: "mp3" });
      expect(binary.success).toBe(true);
      expect(binary.response.headers.get("content-type")).toBe("audio/mp3");
      expect(Buffer.from(await binary.response.arrayBuffer()).equals(MP3)).toBe(true);
      expect(binary.accounting).toMatchObject({ costStatus: "unknown", nativeUnits: { characters: 6 } });

      const wrapped = await handleTtsCore({ provider: key, model: "s1/ref1", input: "Hi", credentials: CRED_A, responseFormat: "json", response_format: "wav", speed: 1 });
      expect(await wrapped.response.json()).toEqual({ audio: WAV.toString("base64"), format: "wav" });
      expect(bodyOf(calls[1])).toEqual({ text: "Hi", format: "wav", reference_id: "ref1", prosody: { speed: 1 } });

      const refused = await handleTtsCore({ provider: key, model: "s1", input: "Hi", credentials: CRED_A, instructions: "shout" });
      expect(refused).toMatchObject({ success: false, status: 400, local: true });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      delete TTS_ADAPTERS[key];
    }
  });
});
