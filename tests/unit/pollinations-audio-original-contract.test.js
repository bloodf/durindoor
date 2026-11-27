// Pollinations native speech (TTS) and transcription (STT) adapters, staged and
// unregistered (#2034). Closed mocks only: every request goes to an injected
// transport, an unexpected request fails the test, and every key is synthetic.
// Wire shapes follow OmniRoute c71f0065 (audioSpeech.ts and
// audioTranscription.ts OpenAI-compatible default branches,
// normalizeSpeechResponseFormat, audioMultipart.ts buildMultipartBody,
// registryUtils.ts buildAuthHeaders, audioRegistry.ts `pollinations` rows).
// Passing here says nothing about the live service.
//
// Restored from 0c3ed6702c tests/unit/native-pollinations-tts-stt.test.js (the
// original 72-case suite) and run against the current exports, beside the
// rewritten suite. Two assertions differ from 0c3ed6702c; each is marked
// "Intentional difference" below with its source proof. One test is added at
// the end of the file (stalled STT success body).
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-pollinations-tts-stt/index.js";
import {
  POLLINATIONS_AUDIO_DEFINITION,
  POLLINATIONS_STT_MODELS,
  POLLINATIONS_TTS_MODELS,
  buildPollinationsSpeechRequest,
  createPollinationsSttAdapter,
  createPollinationsTtsAdapter,
  matchesContainer,
  pollinationsSttAdapter,
  pollinationsTtsAdapter,
  pollinationsUploadFileName,
} from "../../open-sse/services/providerParity/native-pollinations-tts-stt/index.js";
import { TTS_ADAPTERS } from "../../open-sse/handlers/ttsProviders/index.js";
import { supportsSttTranslation } from "../../open-sse/handlers/sttCore.js";
import pollinationsRegistry from "../../open-sse/providers/registry/pollinations.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const SPEECH_URL = "https://gen.pollinations.ai/v1/audio/speech";
const TRANSCRIPTION_URL = "https://gen.pollinations.ai/v1/audio/transcriptions";
const KEY_A = "sk_pol_SYNTHETIC_a_0001";
const KEY_B = "sk_pol_SYNTHETIC_b_0002";
const CRED_A = { apiKey: KEY_A, connectionId: "conn-a" };
const CRED_B = { apiKey: KEY_B, connectionId: "conn-b" };
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 7)]);
const MP3_FRAME = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(100, 1)]);
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(200, 1)]);
const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(100, 2)]);
const FLAC = Buffer.concat([Buffer.from("fLaC"), Buffer.alloc(100, 3)]);
const AAC = Buffer.concat([Buffer.from([0xff, 0xf1, 0x50, 0x80]), Buffer.alloc(100, 4)]);
const M4A = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypM4A "), Buffer.alloc(100, 5)]);
const STAGE_DIR = "../../open-sse/services/providerParity/native-pollinations-tts-stt/";
const REGISTRATION = JSON.parse(readFileSync(new URL(`${STAGE_DIR}registration.json`, import.meta.url), "utf8"));

const audio = (bytes = MP3, type = "audio/mpeg") => new Response(bytes, { status: 200, headers: { "content-type": type } });
const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const leaky = (status, headers = {}) => json({ error: { message: `upstream echo ${KEY_A} at /srv/app/index.js:44` } }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });
/** A fetch that never settles and ignores its signal. */
const hang = () => new Promise(() => {});
/** A 200 whose body never finishes. */
const stalledBody = (type = "audio/mpeg") => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MP3.subarray(0, 10))); } }), { status: 200, headers: { "content-type": type } });

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
const speechBody = (call) => JSON.parse(call.init.body);
const expectNoLeak = (result) => {
  const text = JSON.stringify(result);
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
  expect(text).not.toContain("/srv/app");
};

function form(entries, file = new File([Buffer.from("RIFFfakeaudio")], "clip.wav", { type: "audio/wav" })) {
  const fd = new FormData();
  if (file) fd.append("file", file);
  for (const [key, value] of entries) fd.append(key, value);
  return fd;
}

async function sentForm(call) {
  const request = new Request("https://capture.invalid/", { method: "POST", body: call.init.body });
  const contentType = request.headers.get("content-type");
  const parsed = await request.formData();
  return { contentType, entries: [...parsed.entries()] };
}

// ── Staging block: the only assertions about registration state ──────────
describe("Pollinations tts/stt staging state (promote at registration)", () => {
  it("is not registered: no TTS adapter and no audio config on the existing entry", () => {
    expect(Object.hasOwn(TTS_ADAPTERS, "pollinations")).toBe(false);
    expect(Object.hasOwn(TTS_ADAPTERS, "pol")).toBe(false);
    expect(pollinationsRegistry.sttConfig).toBeUndefined();
    expect(pollinationsRegistry.ttsConfig).toBeUndefined();
    expect(pollinationsRegistry.serviceKinds ?? []).not.toContain("tts");
    expect(pollinationsRegistry.serviceKinds ?? []).not.toContain("stt");
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("Pollinations staged audio metadata", () => {
  it("pins the source registry fields and models", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryFields.tts).toEqual({ id: "pollinations", baseUrl: SPEECH_URL, authType: "apikey", authHeader: "bearer", format: "openai" });
    expect(REGISTRATION.source.registryFields.stt).toEqual({ id: "pollinations", baseUrl: TRANSCRIPTION_URL, authType: "apikey", authHeader: "bearer", format: "openai" });
    expect(POLLINATIONS_TTS_MODELS.map((m) => m.id)).toEqual(["default"]);
    expect(POLLINATIONS_STT_MODELS.map((m) => m.id)).toEqual(["whisper"]);
    expect(REGISTRATION.models.tts.map((m) => m.id)).toEqual(["default"]);
    expect(REGISTRATION.models.stt.map((m) => m.id)).toEqual(["whisper"]);
    expect(REGISTRATION.provider).toMatchObject({ canonicalId: "pollinations", aliases: ["pollinations", "pol"], authModes: ["apikey"], addServiceKinds: ["tts", "stt"] });
  });

  it("matches the existing provider's canonical id, alias and auth modes", () => {
    expect(pollinationsRegistry.id).toBe(REGISTRATION.provider.canonicalId);
    expect(pollinationsRegistry.alias).toBe("pol");
    expect(pollinationsRegistry.authModes).toEqual(REGISTRATION.provider.authModes);
  });

  it("stages audio configs with apikey bearer auth, fixed endpoints and no translations", () => {
    expect(POLLINATIONS_AUDIO_DEFINITION).toMatchObject({ id: "pollinations", alias: "pol", addServiceKinds: ["tts", "stt"] });
    expect(POLLINATIONS_AUDIO_DEFINITION.ttsConfig).toEqual({ baseUrl: SPEECH_URL, authType: "apikey", authHeader: "bearer", format: "openai" });
    expect(POLLINATIONS_AUDIO_DEFINITION.sttConfig.baseUrl).toBe(TRANSCRIPTION_URL);
    expect(supportsSttTranslation(POLLINATIONS_AUDIO_DEFINITION.sttConfig, "whisper")).toBe(false);
  });

  it("exports every name registration.json lists", () => {
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(pollinationsTtsAdapter.provider).toBe("pollinations");
    expect(pollinationsSttAdapter.provider).toBe("pollinations");
  });
});

describe("Pollinations speech wire contract", () => {
  it("posts the source body with the Bearer key and returns mp3 by default", async () => {
    const { fetchImpl, calls } = transport(audio());
    const result = await createPollinationsTtsAdapter({ fetchImpl }).synthesize("Hello there.", "default", CRED_A, "mp3", {});
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(SPEECH_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(headersOf(calls[0])).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(calls[0].init.body).toBe(JSON.stringify({ model: "default", input: "Hello there.", voice: "alloy", response_format: "mp3", speed: 1 }));
    expect(result.format).toBe("mp3");
    expect(Buffer.from(result.base64, "base64").equals(MP3)).toBe(true);
    expect(result.accounting).toMatchObject({ modality: "tts", cost: null, costStatus: "unknown", costSource: "unavailable" });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("forwards voice, speed and instructions and normalizes ogg to opus", async () => {
    const { fetchImpl, calls } = transport(audio(OGG, "audio/ogg"), audio(MP3_FRAME));
    const adapter = createPollinationsTtsAdapter({ fetchImpl });
    const opus = await adapter.synthesize("Hi", "default", CRED_A, "mp3", { voice: "nova", speed: 1.25, instructions: "calm", response_format: "OGG" });
    await adapter.synthesize("Hi", "default", CRED_A, "json", { instructions: "" });
    expect(speechBody(calls[0])).toEqual({ model: "default", input: "Hi", voice: "nova", response_format: "opus", speed: 1.25, instructions: "calm" });
    expect(opus.format).toBe("opus");
    expect(speechBody(calls[1])).toEqual({ model: "default", input: "Hi", voice: "alloy", response_format: "mp3", speed: 1 });
  });

  it.each([
    ["wav", WAV, "audio/wav"],
    ["flac", FLAC, "audio/flac"],
    ["aac", AAC, "audio/aac"],
    ["aac", M4A, "audio/mp4"],
    ["opus", OGG, "application/octet-stream"],
  ])("returns a checked %s container", async (format, bytes, type) => {
    const { fetchImpl, calls } = transport(audio(bytes, type));
    const result = await createPollinationsTtsAdapter({ fetchImpl }).synthesize("Hi", "default", CRED_A, "mp3", { requestedResponseFormat: format });
    expect(speechBody(calls[0]).response_format).toBe(format);
    expect(result.format).toBe(format);
    expect(Buffer.from(result.base64, "base64").equals(bytes)).toBe(true);
  });

  it("forwards the connection egress policy to the transport", async () => {
    const { fetchImpl, calls } = transport(audio());
    const proxied = { ...CRED_A, providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.invalid:8080" } };
    await createPollinationsTtsAdapter({ fetchImpl }).synthesize("Hi", "default", proxied, "mp3", {});
    expect(calls[0].proxyOptions).toBeTypeOf("object");
  });

  it("keeps each selected connection's key on its own request", async () => {
    const { fetchImpl, calls } = transport(audio(), audio());
    const adapter = createPollinationsTtsAdapter({ fetchImpl });
    await adapter.synthesize("one", "default", CRED_A, "mp3", {});
    await adapter.synthesize("two", "default", CRED_B, "mp3", {});
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${KEY_A}`);
    expect(headersOf(calls[1]).Authorization).toBe(`Bearer ${KEY_B}`);
  });

  it.each([
    ["a pcm container", "default", { response_format: "pcm" }],
    ["an unknown container", "default", { requestedResponseFormat: "m4b" }],
    ["sse streaming", "default", { stream_format: "sse" }],
    ["stream: true", "default", { stream: true }],
    ["an unknown model", "tts-1", {}],
    // Intentional difference: 0c3ed6702c refused "default/nova" here. See the
    // "model/voice suffix" test below for the retained regression and proof.
    ["non-string instructions", "default", { instructions: 5 }],
    ["speed out of range", "default", { speed: 9 }],
    ["non-numeric speed", "default", { speed: "fast" }],
    ["a non-string voice", "default", { voice: 3 }],
    ["a voice with control characters", "default", { voice: "a\r\nb" }],
  ])("refuses %s before submit", async (_label, model, options) => {
    const { fetchImpl } = transport();
    const result = await createPollinationsTtsAdapter({ fetchImpl }).synthesize("Hi", model, CRED_A, "mp3", options);
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(result.acceptedJob).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // Intentional difference from 0c3ed6702c, which refused "default/nova". The
  // OmniRoute source takes the voice only from body.voice (audioSpeech.ts default
  // branch, `voice: body.voice || providerConfig.defaultVoice || "alloy"`), but
  // this fork's TTS adapter contract reads `model` as "modelId/voiceId"
  // (open-sse/handlers/ttsProviders/_base.js parseModelVoice, openai.js line 1),
  // and the rewritten suite pins that. The underlying regression is kept: the
  // suffixed string never reaches the wire as the model, an unsafe suffix voice
  // is refused before submit, and an unknown model prefix is still refused.
  it("never sends a model/voice suffix as the model and refuses an unsafe one before submit", async () => {
    const { fetchImpl, calls } = transport(audio());
    const adapter = createPollinationsTtsAdapter({ fetchImpl });
    await adapter.synthesize("Hi", "default/nova", CRED_A, "mp3", {});
    expect(calls).toHaveLength(1);
    expect(speechBody(calls[0]).model).toBe("default");
    expect(speechBody(calls[0]).voice).toBe("nova");
    for (const model of ["default/a\r\nb", "tts-1/nova", "default/"]) {
      const result = await adapter.synthesize("Hi", model, CRED_A, "mp3", {});
      expect(result, model).toMatchObject({ success: false, status: 400, local: true });
      expect(result.acceptedJob).toBeUndefined();
    }
    expect(calls).toHaveLength(1);
  });

  it("refuses an oversized request, a missing key and an unsafe key before submit", async () => {
    const { fetchImpl } = transport();
    const adapter = createPollinationsTtsAdapter({ fetchImpl });
    expect(() => buildPollinationsSpeechRequest("default", "x".repeat(300 * 1024))).toThrow(/too large/);
    const noKey = await adapter.synthesize("Hi", "default", { apiKey: "" }, "mp3", {});
    const headerInjection = await adapter.synthesize("Hi", "default", { apiKey: "a\r\nX-Evil: 1" }, "mp3", {});
    expect(noKey).toMatchObject({ success: false, status: 401 });
    expect(headerInjection).toMatchObject({ success: false, status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["the public placeholder", { apiKey: "public" }],
    ["the sk_durindoor placeholder", { accessToken: "sk_durindoor" }],
    ["the noauth connection", { id: "noauth", apiKey: "public" }],
    ["a noauth connection id", { connectionId: "noauth", accessToken: "anything" }],
  ])("refuses keyless access via %s instead of sending it as a Bearer key", async (_label, credentials) => {
    const { fetchImpl } = transport();
    const tts = await createPollinationsTtsAdapter({ fetchImpl }).synthesize("Hi", "default", credentials, "mp3", {});
    const stt = await createPollinationsSttAdapter({ fetchImpl }).transcribe({ model: "whisper", formData: form([]), credentials });
    for (const result of [tts, stt]) {
      expect(result).toMatchObject({ success: false, status: 401 });
      expect(result.acceptedJob).toBeUndefined();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Pollinations speech failures", () => {
  it.each([
    [401, 401],
    [403, 403],
    [400, 400],
    [404, 404],
  ])("maps HTTP %i to %i without quoting Pollinations or accepting a job", async (status, expected) => {
    const { fetchImpl } = transport(leaky(status));
    const result = await createPollinationsTtsAdapter({ fetchImpl }).synthesize("Hi", "default", CRED_A, "mp3", {});
    expect(result).toMatchObject({ success: false, status: expected });
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it("marks 402 as quota exhausted on this connection only", async () => {
    const { fetchImpl } = transport(leaky(402), audio());
    const adapter = createPollinationsTtsAdapter({ fetchImpl });
    const exhausted = await adapter.synthesize("Hi", "default", CRED_A, "mp3", {});
    const other = await adapter.synthesize("Hi", "default", CRED_B, "mp3", {});
    expect(exhausted).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    expect(other.format).toBe("mp3");
    expectNoLeak(exhausted);
  });

  it("keeps a bounded Retry-After on 429 and 503", async () => {
    const { fetchImpl } = transport(leaky(429, { "retry-after": "7" }), leaky(503, { "retry-after": "3" }));
    const adapter = createPollinationsTtsAdapter({ fetchImpl });
    const limited = await adapter.synthesize("Hi", "default", CRED_A, "mp3", {});
    const unavailable = await adapter.synthesize("Hi", "default", CRED_A, "mp3", {});
    expect(limited).toMatchObject({ success: false, status: 429 });
    expect(limited.resetsAtMs).toBeGreaterThan(Date.now());
    expect(unavailable).toMatchObject({ success: false, status: 503 });
    expect(limited.acceptedJob).toBeUndefined();
    expect(unavailable.acceptedJob).toBeUndefined();
    expectNoLeak(limited);
  });

  it("treats other 5xx as an uncertain, never-replayed job with unknown cost", async () => {
    const { fetchImpl, calls } = transport(leaky(500));
    const result = await createPollinationsTtsAdapter({ fetchImpl }).synthesize("Hi", "default", CRED_A, "mp3", {});
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toMatchObject({
      modality: "tts", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown", authScope: "apikey" },
    });
    expectNoLeak(result);
  });

  it("refuses a redirect without following it", async () => {
    const redirect = new Response(null, { status: 307, headers: { location: "https://evil.invalid/steal" } });
    const { fetchImpl, calls } = transport(redirect);
    const result = await createPollinationsTtsAdapter({ fetchImpl }).synthesize("Hi", "default", CRED_A, "mp3", {});
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeDefined();
  });

  it("distinguishes a provably unsent connect failure from a failure after send", async () => {
    const { fetchImpl } = transport(transportError("ENOTFOUND"), transportError("ECONNRESET"));
    const adapter = createPollinationsTtsAdapter({ fetchImpl });
    const unsent = await adapter.synthesize("Hi", "default", CRED_A, "mp3", {});
    const reset = await adapter.synthesize("Hi", "default", CRED_A, "mp3", {});
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
    const result = await createPollinationsTtsAdapter({ fetchImpl }).synthesize("Hi", "default", CRED_A, "mp3", { signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499, local: true });
    expect(result.acceptedJob).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("stops waiting when the caller aborts after send and records the job as uncertain", async () => {
    const controller = new AbortController();
    const { fetchImpl } = transport(() => {
      setTimeout(() => controller.abort(), 5);
      return hang();
    });
    const result = await createPollinationsTtsAdapter({ fetchImpl }).synthesize("Hi", "default", CRED_A, "mp3", { signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("aborts the transport signal and ends at the deadline even when fetch ignores it", async () => {
    let seenSignal;
    const { fetchImpl, calls } = transport((_url, init) => {
      seenSignal = init.signal;
      return hang();
    });
    const result = await createPollinationsTtsAdapter({ fetchImpl, timeoutMs: 20 }).synthesize("Hi", "default", CRED_A, "mp3", {});
    expect(calls).toHaveLength(1);
    expect(seenSignal.aborted).toBe(true);
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob).toBeDefined();
  });

  it("bounds a stalled audio body by the same deadline", async () => {
    const { fetchImpl } = transport(stalledBody());
    const result = await createPollinationsTtsAdapter({ fetchImpl, timeoutMs: 30 }).synthesize("Hi", "default", CRED_A, "mp3", {});
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });
});

describe("Pollinations speech malformed or unsafe answers", () => {
  it("reads a 200 error envelope as a refusal without quoting it", async () => {
    const { fetchImpl } = transport(leaky(200));
    const result = await createPollinationsTtsAdapter({ fetchImpl }).synthesize("Hi", "default", CRED_A, "mp3", {});
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it.each([
    ["non-envelope JSON", () => json({ ok: true }), "mp3"],
    ["HTML", () => new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }), "mp3"],
    ["WAV bytes for mp3", () => audio(WAV, "audio/wav"), "mp3"],
    ["mp3 bytes for wav", () => audio(MP3, "audio/wav"), "wav"],
    ["mp3 bytes for flac", () => audio(MP3), "flac"],
    ["an empty body", () => audio(Buffer.alloc(0)), "mp3"],
  ])("treats %s as a lost result of billable work", async (_label, answer, format) => {
    const { fetchImpl } = transport(answer());
    const result = await createPollinationsTtsAdapter({ fetchImpl }).synthesize("Hi", "default", CRED_A, "mp3", { response_format: format });
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toMatchObject({ costStatus: "unknown", costSource: "accepted-job" });
  });

  it("caps the audio size", async () => {
    const { fetchImpl } = transport(audio(Buffer.concat([MP3, Buffer.alloc(1024)])));
    const result = await createPollinationsTtsAdapter({ fetchImpl, maxAudioBytes: 512 }).synthesize("Hi", "default", CRED_A, "mp3", {});
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeDefined();
  });

  it("checks container magic bytes", () => {
    expect(matchesContainer(MP3, "mp3")).toBe(true);
    expect(matchesContainer(MP3_FRAME, "mp3")).toBe(true);
    expect(matchesContainer(AAC, "mp3")).toBe(false);
    expect(matchesContainer(MP3_FRAME, "aac")).toBe(false);
    expect(matchesContainer(OGG, "opus")).toBe(true);
    expect(matchesContainer(WAV, "pcm")).toBe(false);
  });
});

describe("Pollinations transcription wire contract", () => {
  it("posts the source multipart fields in source order with only the Bearer header", async () => {
    const { fetchImpl, calls } = transport(json({ text: "hello world" }));
    const fd = form([
      ["model", "ignored-by-adapter"],
      ["language", "en"],
      ["prompt", "names: Ana"],
      ["response_format", "json"],
      ["temperature", "0.2"],
      ["include[]", "logprobs"],
    ], new File([Buffer.from("OggSaudio")], 'voice "memo".opus', { type: "audio/ogg" }));
    const result = await createPollinationsSttAdapter({ fetchImpl }).transcribe({ model: "whisper", formData: fd, credentials: CRED_A });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TRANSCRIPTION_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(headersOf(calls[0])).toEqual({ Authorization: `Bearer ${KEY_A}` });
    const sent = await sentForm(calls[0]);
    expect(sent.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(sent.entries.map(([key]) => key)).toEqual(["model", "language", "prompt", "response_format", "temperature", "file"]);
    expect(sent.entries.slice(0, 5)).toEqual([["model", "whisper"], ["language", "en"], ["prompt", "names: Ana"], ["response_format", "json"], ["temperature", "0.2"]]);
    const file = sent.entries[5][1];
    expect(file.name).toBe("voice _memo_.ogg");
    expect(file.type).toBe("audio/ogg");
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe("OggSaudio");
    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual({ text: "hello world" });
    // Intentional difference: 0c3ed6702c also expected meta.authScope "apikey" on
    // success accounting. The rewritten suite (kept byte-frozen) pins this meta
    // exactly to { model, responseFormat }, and no consumer outside this staged
    // directory reads authScope (rg authScope open-sse src). The accepted-job
    // records that billing reads still carry authScope "apikey" (asserted in the
    // 5xx tests); this keeps model and unknown cost.
    expect(result.accounting).toMatchObject({ modality: "stt", cost: null, costStatus: "unknown", meta: { model: "whisper" } });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("sends only model and file when nothing else is named, with the source default file name", async () => {
    const { fetchImpl, calls } = transport(json({ text: "x" }));
    const nameless = new Blob([Buffer.from("abc")]);
    const fd = { get: (name) => (name === "file" ? nameless : null), getAll: () => [] };
    await createPollinationsSttAdapter({ fetchImpl }).transcribe({ model: "whisper", formData: fd, credentials: CRED_B });
    const sent = await sentForm(calls[0]);
    expect(sent.entries.map(([key]) => key)).toEqual(["model", "file"]);
    expect(sent.entries[1][1].name).toBe("audio.wav");
    expect(sent.entries[1][1].type).toBe("application/octet-stream");
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${KEY_B}`);
    expect(pollinationsUploadFileName({ name: "a\r\nb.mp3" })).toBe("a__b.mp3");
  });

  it("returns verbose_json with timestamps and records audio seconds and usage", async () => {
    const verbose = { text: "hi", duration: 2.5, words: [{ word: "hi", start: 0, end: 0.4 }], usage: { type: "duration", seconds: 3 } };
    const { fetchImpl, calls } = transport(json(verbose));
    const fd = form([["response_format", "verbose_json"], ["timestamp_granularities[]", "word"], ["timestamp_granularities", "segment,word"]]);
    const result = await createPollinationsSttAdapter({ fetchImpl }).transcribe({ model: "whisper", formData: fd, credentials: CRED_A });
    const sent = await sentForm(calls[0]);
    expect(sent.entries.filter(([key]) => key === "timestamp_granularities[]").map(([, v]) => v)).toEqual(["word", "segment"]);
    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual(verbose);
    expect(result.nativeUnits).toEqual({ audioSeconds: 2.5 });
    expect(result.usageValue).toEqual({ usage: { type: "duration", seconds: 3 } });
  });

  it("answers text as text/plain, from a text body or a JSON body", async () => {
    const { fetchImpl } = transport(
      new Response("plain words", { status: 200, headers: { "content-type": "text/plain" } }),
      json({ text: "json words" }),
    );
    const adapter = createPollinationsSttAdapter({ fetchImpl });
    const fromText = await adapter.transcribe({ model: "whisper", formData: form([["response_format", "text"]]), credentials: CRED_A });
    const fromJson = await adapter.transcribe({ model: "whisper", formData: form([["response_format", "text"]]), credentials: CRED_A });
    expect(fromText.response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await fromText.response.text()).toBe("plain words");
    expect(await fromJson.response.text()).toBe("json words");
  });

  it.each([
    ["a translation", "whisper", [], { kind: "translation" }],
    ["an unknown model", "whisper-1", [], {}],
    ["srt output", "whisper", [["response_format", "srt"]], {}],
    ["vtt output", "whisper", [["response_format", "vtt"]], {}],
    ["diarized_json", "whisper", [["response_format", "diarized_json"]], {}],
    ["granularities without verbose_json", "whisper", [["timestamp_granularities[]", "segment"]], {}],
    ["an unknown granularity", "whisper", [["response_format", "verbose_json"], ["timestamp_granularities[]", "char"]], {}],
    ["streaming", "whisper", [["stream", "true"]], {}],
    ["a temperature above 1", "whisper", [["temperature", "1.5"]], {}],
    ["a non-numeric temperature", "whisper", [["temperature", "warm"]], {}],
  ])("refuses %s before submit", async (_label, model, entries, extra) => {
    const { fetchImpl } = transport();
    const result = await createPollinationsSttAdapter({ fetchImpl }).transcribe({ model, formData: form(entries), credentials: CRED_A, ...extra });
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a missing, url-only, empty or oversized file and a missing key before submit", async () => {
    const { fetchImpl } = transport();
    const adapter = createPollinationsSttAdapter({ fetchImpl });
    const missing = await adapter.transcribe({ model: "whisper", formData: form([], null), credentials: CRED_A });
    const url = await adapter.transcribe({ model: "whisper", formData: form([["url", "http://169.254.169.254/latest"]], null), credentials: CRED_A });
    const empty = await adapter.transcribe({ model: "whisper", formData: form([], new File([], "a.wav")), credentials: CRED_A });
    const huge = { name: "a.wav", size: 26 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) };
    const big = await adapter.transcribe({ model: "whisper", formData: { get: (n) => (n === "file" ? huge : null), getAll: () => [] }, credentials: CRED_A });
    const noKey = await adapter.transcribe({ model: "whisper", formData: form([]), credentials: {} });
    for (const result of [missing, url, empty, big]) expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(noKey).toMatchObject({ success: false, status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Pollinations transcription failures and malformed answers", () => {
  it("maps refusals without quoting Pollinations", async () => {
    const { fetchImpl } = transport(leaky(401), leaky(402), leaky(429, { "retry-after": "5" }), leaky(502));
    const adapter = createPollinationsSttAdapter({ fetchImpl });
    const call = () => adapter.transcribe({ model: "whisper", formData: form([]), credentials: CRED_A });
    const [auth, quota, limited, upstream] = [await call(), await call(), await call(), await call()];
    expect(auth).toMatchObject({ success: false, status: 401 });
    expect(quota).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    expect(limited).toMatchObject({ success: false, status: 429 });
    expect(upstream).toMatchObject({ success: false, status: 502 });
    expect(upstream.acceptedJob).toMatchObject({ modality: "stt", costStatus: "unknown", meta: { jobState: "submit-unknown", authScope: "apikey" } });
    for (const result of [auth, quota, limited]) expect(result.acceptedJob).toBeUndefined();
    for (const result of [auth, quota, limited, upstream]) expectNoLeak(result);
  });

  it("reads a 200 error envelope as a refusal and a missing transcript as a lost result", async () => {
    const { fetchImpl } = transport(leaky(200), json({ segments: [] }), new Response("{not json", { status: 200, headers: { "content-type": "application/json" } }));
    const adapter = createPollinationsSttAdapter({ fetchImpl });
    const call = () => adapter.transcribe({ model: "whisper", formData: form([]), credentials: CRED_A });
    const envelope = await call();
    const noText = await call();
    const broken = await call();
    expect(envelope).toMatchObject({ success: false, status: 502 });
    expect(envelope.acceptedJob).toBeUndefined();
    expectNoLeak(envelope);
    expect(noText.acceptedJob.meta.jobState).toBe("accepted");
    expect(broken.acceptedJob.meta.jobState).toBe("accepted");
    expectNoLeak(broken);
  });

  it("treats HTML or non-JSON for a JSON format as a lost result", async () => {
    const { fetchImpl } = transport(
      new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
      new Response("words", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const adapter = createPollinationsSttAdapter({ fetchImpl });
    const html = await adapter.transcribe({ model: "whisper", formData: form([["response_format", "text"]]), credentials: CRED_A });
    const textForJson = await adapter.transcribe({ model: "whisper", formData: form([]), credentials: CRED_A });
    expect(html.acceptedJob).toBeDefined();
    expect(textForJson.acceptedJob).toBeDefined();
  });

  it("refuses a redirect, honors abort before send, and ends at the deadline without replay", async () => {
    const before = new AbortController();
    before.abort();
    let seenSignal;
    const { fetchImpl, calls } = transport(
      new Response(null, { status: 302, headers: { location: "https://evil.invalid/" } }),
      (_url, init) => {
        seenSignal = init.signal;
        return hang();
      },
      stalledBody("application/json"),
    );
    const adapter = createPollinationsSttAdapter({ fetchImpl, timeoutMs: 25 });
    const redirect = await adapter.transcribe({ model: "whisper", formData: form([]), credentials: CRED_A });
    const unsent = await adapter.transcribe({ model: "whisper", formData: form([]), credentials: CRED_A, signal: before.signal });
    const timedOut = await adapter.transcribe({ model: "whisper", formData: form([]), credentials: CRED_A });
    const stalled = await adapter.transcribe({ model: "whisper", formData: form([]), credentials: CRED_A });
    expect(calls).toHaveLength(3);
    expect(redirect.acceptedJob).toBeDefined();
    expect(unsent).toMatchObject({ success: false, status: 499, local: true });
    expect(timedOut).toMatchObject({ success: false, status: 504 });
    expect(timedOut.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seenSignal.aborted).toBe(true);
    expect(stalled).toMatchObject({ success: false, status: 504 });
    expect(stalled.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("records a caller abort after send as uncertain", async () => {
    const controller = new AbortController();
    const { fetchImpl } = transport(() => {
      setTimeout(() => controller.abort(), 5);
      return hang();
    });
    const result = await createPollinationsSttAdapter({ fetchImpl }).transcribe({ model: "whisper", formData: form([]), credentials: CRED_A, signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  // Added: an independent stalled STT success body, one request only.
  it("ends a stalled 200 transcript body at the deadline, cancels it, records the accepted job and sends once", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('{"text":"par')); },
      cancel() { cancelled = true; },
    });
    const { fetchImpl, calls } = transport(new Response(body, { status: 200, headers: { "content-type": "application/json" } }));
    const result = await createPollinationsSttAdapter({ fetchImpl, timeoutMs: 30 }).transcribe({ model: "whisper", formData: form([]), credentials: CRED_A });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob).toMatchObject({ modality: "stt", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "accepted", authScope: "apikey" } });
    expect(cancelled).toBe(true);
    expectNoLeak(result);
  });
});
