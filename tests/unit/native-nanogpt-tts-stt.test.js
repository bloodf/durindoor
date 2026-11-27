// NanoGPT native speech (TTS) and transcription (STT) adapters, staged and
// unregistered (#2034). Closed mocks only: every request goes to an injected
// transport, an unexpected request fails the test, and every key is synthetic.
// Wire shapes follow OmniRoute c71f0065 (audioSpeech.ts and
// audioTranscription.ts OpenAI-compatible default branches, audioMultipart.ts
// buildMultipartBody, audioRegistry.ts `nanogpt` rows). Passing here says
// nothing about the live service.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-nanogpt-tts-stt/index.js";
import {
  NANOGPT_AUDIO_DEFINITION,
  NANOGPT_STT_MODELS,
  NANOGPT_TTS_MODELS,
  buildNanogptSpeechRequest,
  createNanogptSttAdapter,
  createNanogptTtsAdapter,
  matchesContainer,
  nanogptSttAdapter,
  nanogptTtsAdapter,
  nanogptUploadFileName,
  resolveNanogptContainer,
} from "../../open-sse/services/providerParity/native-nanogpt-tts-stt/index.js";
import nanogptRegistry from "../../open-sse/providers/registry/nanogpt.js";
import { TTS_ADAPTERS } from "../../open-sse/handlers/ttsProviders/index.js";
import { supportsSttTranslation } from "../../open-sse/handlers/sttCore.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const SPEECH_URL = "https://nano-gpt.com/api/v1/audio/speech";
const TRANSCRIPTION_URL = "https://nano-gpt.com/api/v1/audio/transcriptions";
const KEY_A = "sk-nano-SYNTHETIC-a-0001";
const KEY_B = "sk-nano-SYNTHETIC-b-0002";
const CRED_A = { apiKey: KEY_A, connectionId: "conn-a" };
const CRED_B = { apiKey: KEY_B, connectionId: "conn-b" };
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 7)]);
const MP3_FRAME = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(100, 1)]);
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(200, 1)]);
const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(100, 2)]);
const FLAC = Buffer.concat([Buffer.from("fLaC"), Buffer.alloc(100, 3)]);
const AAC = Buffer.concat([Buffer.from([0xff, 0xf1, 0x50, 0x80]), Buffer.alloc(100, 4)]);
const STAGE_DIR = "../../open-sse/services/providerParity/native-nanogpt-tts-stt/";
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
const tts = (fetchImpl, extra = {}) => createNanogptTtsAdapter({ fetchImpl, ...extra });
const stt = (fetchImpl, extra = {}) => createNanogptSttAdapter({ fetchImpl, ...extra });

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
describe("NanoGPT tts/stt staging state (promote at registration)", () => {
  it("is not registered: no TTS adapter, the existing entry serves chat only", () => {
    expect(Object.hasOwn(TTS_ADAPTERS, "nanogpt")).toBe(false);
    expect(nanogptRegistry.serviceKinds).toEqual(["llm"]);
    expect(nanogptRegistry.ttsConfig).toBeUndefined();
    expect(nanogptRegistry.sttConfig).toBeUndefined();
    expect(REGISTRATION.status).toBe("staged-unregistered");
    expect(REGISTRATION.provider.existingServiceKinds).toEqual(nanogptRegistry.serviceKinds);
  });
});

describe("NanoGPT staged metadata", () => {
  it("pins the source registry fields and models", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryFields.tts).toEqual({ id: "nanogpt", baseUrl: SPEECH_URL, authType: "apikey", authHeader: "bearer" });
    expect(REGISTRATION.source.registryFields.stt).toEqual({ id: "nanogpt", baseUrl: TRANSCRIPTION_URL, authType: "apikey", authHeader: "bearer" });
    expect(NANOGPT_TTS_MODELS.map((m) => m.id)).toEqual(["tts-1-hd", "tts-1"]);
    expect(NANOGPT_STT_MODELS.map((m) => m.id)).toEqual(["whisper-1", "gpt-4o-transcription"]);
    expect(REGISTRATION.models.tts.map((m) => m.id)).toEqual(NANOGPT_TTS_MODELS.map((m) => m.id));
    expect(REGISTRATION.models.stt.map((m) => m.id)).toEqual(NANOGPT_STT_MODELS.map((m) => m.id));
    expect(REGISTRATION.provider).toMatchObject({ canonicalId: "nanogpt", aliases: ["nanogpt"], authModes: ["apikey"], addServiceKinds: ["tts", "stt"] });
  });

  it("keeps the existing provider's identity and auth mode", () => {
    expect(NANOGPT_AUDIO_DEFINITION).toMatchObject({ id: nanogptRegistry.id, alias: nanogptRegistry.alias, category: nanogptRegistry.category, authType: nanogptRegistry.authType });
    expect(NANOGPT_AUDIO_DEFINITION.ttsConfig).toEqual({ baseUrl: SPEECH_URL, authType: "apikey", authHeader: "bearer", format: "openai" });
    expect(NANOGPT_AUDIO_DEFINITION.sttConfig.baseUrl).toBe(TRANSCRIPTION_URL);
    expect(supportsSttTranslation(NANOGPT_AUDIO_DEFINITION.sttConfig, "whisper-1")).toBe(false);
  });

  it("exports every name registration.json lists", () => {
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(nanogptTtsAdapter.provider).toBe("nanogpt");
    expect(nanogptSttAdapter.provider).toBe("nanogpt");
  });
});

describe("NanoGPT speech wire contract", () => {
  it("posts the source body with the Bearer key and returns mp3", async () => {
    const { fetchImpl, calls } = transport(audio());
    const result = await tts(fetchImpl).synthesize("Hello there.", "tts-1", CRED_A, "mp3", {});
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(SPEECH_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(headersOf(calls[0])).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(calls[0].init.body).toBe(JSON.stringify({ model: "tts-1", input: "Hello there.", voice: "alloy", response_format: "mp3", speed: 1 }));
    expect(result.format).toBe("mp3");
    expect(Buffer.from(result.base64, "base64").equals(MP3)).toBe(true);
    expect(result.accounting).toMatchObject({ modality: "tts", cost: null, costStatus: "unknown", costSource: "unavailable" });
    expect(result.accounting.meta).toEqual({ nativeUnitsSource: "input-characters", model: "tts-1" });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("sends voice, speed and instructions, and a model/voice suffix as the voice", async () => {
    const { fetchImpl, calls } = transport(audio(MP3_FRAME), audio());
    const adapter = tts(fetchImpl);
    await adapter.synthesize("Hi", "tts-1-hd", CRED_A, "mp3", { voice: "nova", speed: 1.5, instructions: "calm" });
    await adapter.synthesize("Hi", "tts-1-hd/shimmer", CRED_A, "mp3", { instructions: "" });
    expect(speechBody(calls[0])).toEqual({ model: "tts-1-hd", input: "Hi", voice: "nova", response_format: "mp3", speed: 1.5, instructions: "calm" });
    expect(speechBody(calls[1])).toEqual({ model: "tts-1-hd", input: "Hi", voice: "shimmer", response_format: "mp3", speed: 1 });
  });

  it.each([
    ["wav", { response_format: "wav" }, "mp3", WAV, "audio/wav"],
    ["opus from the ogg alias", { response_format: "OGG" }, "mp3", OGG, "audio/ogg"],
    ["flac from the query string", {}, "flac", FLAC, "audio/flac"],
    ["aac named for the json wrapper", { requestedResponseFormat: "aac" }, "json", AAC, "audio/aac"],
  ])("honors %s and checks the container signature", async (_label, options, gatewayFormat, bytes, type) => {
    const { fetchImpl, calls } = transport(audio(bytes, type));
    const result = await tts(fetchImpl).synthesize("Hi", "tts-1", CRED_A, gatewayFormat, options);
    const container = speechBody(calls[0]).response_format;
    expect(matchesContainer(container, bytes)).toBe(true);
    expect(result.format).toBe(container);
    expect(Buffer.from(result.base64, "base64").equals(bytes)).toBe(true);
  });

  it("resolves the container like the source normalizer, json meaning the gateway wrapper", () => {
    expect(resolveNanogptContainer(null, "mp3")).toBe("mp3");
    expect(resolveNanogptContainer(null, "json")).toBe("mp3");
    expect(resolveNanogptContainer("json", "json")).toBe("mp3");
    expect(resolveNanogptContainer("ogg", "mp3")).toBe("opus");
    expect(resolveNanogptContainer("wav", "wav")).toBe("wav");
    expect(() => resolveNanogptContainer("wav", "flac")).toThrow(/twice/);
    expect(() => resolveNanogptContainer("pcm", "mp3")).toThrow(/pcm/);
  });

  it("forwards the connection egress policy to the transport", async () => {
    const { fetchImpl, calls } = transport(audio());
    const proxied = { ...CRED_A, providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.invalid:8080" } };
    await tts(fetchImpl).synthesize("Hi", "tts-1", proxied, "mp3", {});
    expect(calls[0].proxyOptions).toBeTypeOf("object");
  });

  it("keeps each selected connection's key on its own request and ignores connection base URLs", async () => {
    const { fetchImpl, calls } = transport(audio(), audio());
    const adapter = tts(fetchImpl);
    await adapter.synthesize("one", "tts-1", { ...CRED_A, baseUrl: "https://evil.invalid/v1" }, "mp3", {});
    await adapter.synthesize("two", "tts-1", CRED_B, "mp3", {});
    expect(calls.map((c) => c.url)).toEqual([SPEECH_URL, SPEECH_URL]);
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${KEY_A}`);
    expect(headersOf(calls[1]).Authorization).toBe(`Bearer ${KEY_B}`);
  });

  it.each([
    ["pcm output", "tts-1", { response_format: "pcm" }],
    ["an unknown container", "tts-1", { response_format: "m4a" }],
    ["a non-string container", "tts-1", { response_format: 3 }],
    ["conflicting containers", "tts-1", { response_format: "wav" }, "opus"],
    ["sse streaming", "tts-1", { stream_format: "sse" }],
    ["stream: true", "tts-1", { stream: true }],
    ["an unknown model", "gpt-4o-mini-tts", {}],
    ["a chat model", "gpt-4o-mini", {}],
    ["non-string instructions", "tts-1", { instructions: 5 }],
    ["speed out of range", "tts-1", { speed: 9 }],
    ["non-numeric speed", "tts-1", { speed: "fast" }],
    ["a non-string voice", "tts-1", { voice: 3 }],
    ["a conflicting voice", "tts-1/onyx", { voice: "nova" }],
  ])("refuses %s before submit", async (_label, model, options, gatewayFormat = "mp3") => {
    const { fetchImpl } = transport();
    const result = await tts(fetchImpl).synthesize("Hi", model, CRED_A, gatewayFormat, options);
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(result.acceptedJob).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an oversized request and a missing or unsafe key before submit", async () => {
    const { fetchImpl } = transport();
    const adapter = tts(fetchImpl);
    expect(() => buildNanogptSpeechRequest("tts-1", "x".repeat(300 * 1024))).toThrow(/too large/);
    expect(await adapter.synthesize("Hi", "tts-1", { apiKey: "" }, "mp3", {})).toMatchObject({ success: false, status: 401 });
    expect(await adapter.synthesize("Hi", "tts-1", { apiKey: "a\r\nX-Evil: 1" }, "mp3", {})).toMatchObject({ success: false, status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("NanoGPT speech failures", () => {
  it.each([401, 403, 400, 404])("maps HTTP %i without quoting NanoGPT or accepting a job", async (status) => {
    const { fetchImpl } = transport(leaky(status));
    const result = await tts(fetchImpl).synthesize("Hi", "tts-1", CRED_A, "mp3", {});
    expect(result).toMatchObject({ success: false, status });
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it("marks 402 as quota exhausted on this connection only", async () => {
    const { fetchImpl, calls } = transport(leaky(402), audio());
    const adapter = tts(fetchImpl);
    const exhausted = await adapter.synthesize("Hi", "tts-1", CRED_A, "mp3", {});
    expect(exhausted).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    expectNoLeak(exhausted);
    const other = await adapter.synthesize("Hi", "tts-1", CRED_B, "mp3", {});
    expect(other.format).toBe("mp3");
    expect(headersOf(calls[1]).Authorization).toBe(`Bearer ${KEY_B}`);
  });

  it("keeps a bounded Retry-After on 429 and 503", async () => {
    const { fetchImpl } = transport(leaky(429, { "retry-after": "7" }), leaky(503, { "retry-after": "3" }));
    const adapter = tts(fetchImpl);
    const limited = await adapter.synthesize("Hi", "tts-1", CRED_A, "mp3", {});
    const unavailable = await adapter.synthesize("Hi", "tts-1", CRED_A, "mp3", {});
    expect(limited).toMatchObject({ success: false, status: 429 });
    expect(limited.resetsAtMs).toBeGreaterThan(Date.now());
    expect(unavailable).toMatchObject({ success: false, status: 503 });
    expect(limited.acceptedJob).toBeUndefined();
    expect(unavailable.acceptedJob).toBeUndefined();
    expectNoLeak(limited);
  });

  it("treats other 5xx as an uncertain, never-replayed job with unknown cost", async () => {
    const { fetchImpl, calls } = transport(leaky(500));
    const result = await tts(fetchImpl).synthesize("Hi", "tts-1", CRED_A, "mp3", {});
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toMatchObject({ modality: "tts", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
    expectNoLeak(result);
  });

  it("refuses a redirect without following it", async () => {
    const redirect = new Response(null, { status: 307, headers: { location: "https://evil.invalid/steal" } });
    const { fetchImpl, calls } = transport(redirect);
    const result = await tts(fetchImpl).synthesize("Hi", "tts-1", CRED_A, "mp3", {});
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("distinguishes a provably unsent connect failure from a failure after send", async () => {
    const { fetchImpl, calls } = transport(transportError("ENOTFOUND"), transportError("ECONNRESET"));
    const adapter = tts(fetchImpl);
    const unsent = await adapter.synthesize("Hi", "tts-1", CRED_A, "mp3", {});
    const reset = await adapter.synthesize("Hi", "tts-1", CRED_A, "mp3", {});
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
    const result = await tts(fetchImpl).synthesize("Hi", "tts-1", CRED_A, "mp3", { signal: controller.signal });
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
    const result = await tts(fetchImpl).synthesize("Hi", "tts-1", CRED_A, "mp3", { signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("aborts the transport signal and ends at the deadline even when fetch ignores it", async () => {
    let seenSignal;
    const { fetchImpl, calls } = transport((_url, init) => {
      seenSignal = init.signal;
      return hang();
    });
    const result = await tts(fetchImpl, { timeoutMs: 20 }).synthesize("Hi", "tts-1", CRED_A, "mp3", {});
    expect(calls).toHaveLength(1);
    expect(seenSignal.aborted).toBe(true);
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("bounds a stalled audio body by the same deadline", async () => {
    const { fetchImpl } = transport(stalledBody());
    const result = await tts(fetchImpl, { timeoutMs: 30 }).synthesize("Hi", "tts-1", CRED_A, "mp3", {});
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });
});

describe("NanoGPT speech malformed or unsafe answers", () => {
  it("reads a 200 error envelope as a refusal without quoting it", async () => {
    const { fetchImpl } = transport(leaky(200));
    const result = await tts(fetchImpl).synthesize("Hi", "tts-1", CRED_A, "mp3", {});
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it.each([
    ["non-envelope JSON", () => json({ ok: true }), "mp3"],
    ["HTML", () => new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }), "mp3"],
    ["WAV bytes for mp3", () => audio(WAV, "audio/wav"), "mp3"],
    ["mp3 bytes for wav", () => audio(MP3, "audio/wav"), "wav"],
    ["an empty body", () => audio(Buffer.alloc(0)), "mp3"],
  ])("treats %s as a lost result of billable work", async (_label, answer, container) => {
    const { fetchImpl } = transport(answer());
    const result = await tts(fetchImpl).synthesize("Hi", "tts-1", CRED_A, "mp3", { response_format: container });
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toMatchObject({ costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "accepted" } });
  });

  it("caps the audio size", async () => {
    const { fetchImpl } = transport(audio(Buffer.concat([MP3, Buffer.alloc(2048)])));
    const result = await tts(fetchImpl, { maxAudioBytes: 1024 }).synthesize("Hi", "tts-1", CRED_A, "mp3", {});
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeDefined();
  });
});

describe("NanoGPT transcription wire contract", () => {
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
    const result = await stt(fetchImpl).transcribe({ model: "whisper-1", formData: fd, credentials: CRED_A });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TRANSCRIPTION_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(headersOf(calls[0])).toEqual({ Authorization: `Bearer ${KEY_A}` });
    const sent = await sentForm(calls[0]);
    expect(sent.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(sent.entries.map(([key]) => key)).toEqual(["model", "language", "prompt", "response_format", "temperature", "file"]);
    expect(sent.entries.slice(0, 5)).toEqual([["model", "whisper-1"], ["language", "en"], ["prompt", "names: Ana"], ["response_format", "json"], ["temperature", "0.2"]]);
    const file = sent.entries[5][1];
    expect(file.name).toBe("voice _memo_.ogg");
    expect(file.type).toBe("audio/ogg");
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe("OggSaudio");
    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual({ text: "hello world" });
    expect(result.accounting).toMatchObject({ modality: "stt", cost: null, costStatus: "unknown" });
    expect(result.accounting.meta).toEqual({ model: "whisper-1", responseFormat: "json" });
  });

  it("sends only model and file when nothing else is named, with the source default file name", async () => {
    const { fetchImpl, calls } = transport(json({ text: "ok" }));
    await stt(fetchImpl).transcribe({ model: "gpt-4o-transcription", formData: form([], new Blob([Buffer.from("abc")])), credentials: CRED_A });
    const sent = await sentForm(calls[0]);
    expect(sent.entries.map(([key]) => key)).toEqual(["model", "file"]);
    expect(sent.entries[0][1]).toBe("gpt-4o-transcription");
    expect(sent.entries[1][1].type).toBe("application/octet-stream");
    expect(nanogptUploadFileName({})).toBe("audio.wav");
    expect(nanogptUploadFileName({ name: "a\r\nb.opus" })).toBe("a__b.ogg");
  });

  it("returns whisper-1 verbose_json with every granularity and records audio seconds and usage", async () => {
    const answer = { text: "hi", duration: 3.5, words: [{ word: "hi", start: 0, end: 0.4 }], usage: { type: "duration", seconds: 4 } };
    const { fetchImpl, calls } = transport(json(answer));
    const fd = form([["response_format", "verbose_json"], ["timestamp_granularities[]", "word"], ["timestamp_granularities[]", "segment"]]);
    const result = await stt(fetchImpl).transcribe({ model: "whisper-1", formData: fd, credentials: CRED_A });
    const sent = await sentForm(calls[0]);
    expect(sent.entries.filter(([key]) => key === "timestamp_granularities[]").map(([, v]) => v)).toEqual(["word", "segment"]);
    expect(await result.response.json()).toEqual(answer);
    expect(result.nativeUnits).toEqual({ audioSeconds: 3.5 });
    expect(result.usageValue).toEqual({ usage: answer.usage });
  });

  it("answers text as text/plain, from a text body or a JSON body", async () => {
    const { fetchImpl } = transport(
      new Response("[music] plain words", { status: 200, headers: { "content-type": "text/plain" } }),
      json({ text: "from json" }),
    );
    const adapter = stt(fetchImpl);
    const plain = await adapter.transcribe({ model: "whisper-1", formData: form([["response_format", "text"]]), credentials: CRED_A });
    const wrapped = await adapter.transcribe({ model: "gpt-4o-transcription", formData: form([["response_format", "text"]]), credentials: CRED_B });
    expect(plain.response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await plain.response.text()).toBe("[music] plain words");
    expect(await wrapped.response.text()).toBe("from json");
  });

  it("keeps each selected connection's key on its own request", async () => {
    const { fetchImpl, calls } = transport(json({ text: "a" }), json({ text: "b" }));
    const adapter = stt(fetchImpl);
    await adapter.transcribe({ model: "whisper-1", formData: form([]), credentials: CRED_A });
    await adapter.transcribe({ model: "whisper-1", formData: form([]), credentials: CRED_B });
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${KEY_A}`);
    expect(headersOf(calls[1]).Authorization).toBe(`Bearer ${KEY_B}`);
  });

  it.each([
    ["a translation", "whisper-1", [], "translation"],
    ["an unknown model", "whisper-large-v3", []],
    ["a speech model", "tts-1", []],
    ["srt", "whisper-1", [["response_format", "srt"]]],
    ["vtt", "whisper-1", [["response_format", "vtt"]]],
    ["diarized_json", "whisper-1", [["response_format", "diarized_json"]]],
    ["verbose_json on gpt-4o-transcription", "gpt-4o-transcription", [["response_format", "verbose_json"]]],
    ["timestamps on gpt-4o-transcription", "gpt-4o-transcription", [["timestamp_granularities[]", "word"]]],
    ["granularities without verbose_json", "whisper-1", [["timestamp_granularities[]", "word"]]],
    ["an unknown granularity", "whisper-1", [["response_format", "verbose_json"], ["timestamp_granularities[]", "char"]]],
    ["streaming", "whisper-1", [["stream", "true"]]],
    ["temperature out of range", "whisper-1", [["temperature", "3"]]],
    ["an overlong prompt", "whisper-1", [["prompt", "p".repeat(5000)]]],
  ])("refuses %s before submit", async (_label, model, entries, kind = "transcription") => {
    const { fetchImpl } = transport();
    const result = await stt(fetchImpl).transcribe({ model, formData: form(entries), credentials: CRED_A, kind });
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a missing, url-only, empty or oversized file and a missing key before submit", async () => {
    const { fetchImpl } = transport();
    const adapter = stt(fetchImpl);
    const urlOnly = new FormData();
    urlOnly.append("url", "http://169.254.169.254/latest");
    expect(await adapter.transcribe({ model: "whisper-1", formData: form([], null), credentials: CRED_A })).toMatchObject({ status: 400, local: true });
    const viaUrl = await adapter.transcribe({ model: "whisper-1", formData: urlOnly, credentials: CRED_A });
    expect(viaUrl).toMatchObject({ status: 400, local: true });
    expect(viaUrl.error.message ?? JSON.stringify(viaUrl)).toMatch(/not a url/);
    expect(await adapter.transcribe({ model: "whisper-1", formData: form([], new File([], "e.wav")), credentials: CRED_A })).toMatchObject({ status: 400 });
    const big = { name: "big.wav", type: "audio/wav", size: 26 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(8) };
    const bigForm = { get: (k) => (k === "file" ? big : null), getAll: () => [] };
    expect(await adapter.transcribe({ model: "whisper-1", formData: bigForm, credentials: CRED_A })).toMatchObject({ status: 400, local: true });
    expect(await adapter.transcribe({ model: "whisper-1", formData: form([]), credentials: {} })).toMatchObject({ status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("NanoGPT transcription failures and malformed answers", () => {
  it("maps refusals without quoting NanoGPT", async () => {
    const { fetchImpl } = transport(leaky(401), leaky(402), leaky(429, { "retry-after": "5" }), leaky(500));
    const adapter = stt(fetchImpl);
    const run = () => adapter.transcribe({ model: "whisper-1", formData: form([]), credentials: CRED_A });
    const [denied, broke, limited, failed] = [await run(), await run(), await run(), await run()];
    expect(denied).toMatchObject({ success: false, status: 401 });
    expect(broke).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    expect(limited).toMatchObject({ success: false, status: 429 });
    expect(failed).toMatchObject({ success: false, status: 502 });
    expect(failed.acceptedJob).toMatchObject({ modality: "stt", costStatus: "unknown", meta: { jobState: "submit-unknown" } });
    for (const result of [denied, broke, limited, failed]) expectNoLeak(result);
    for (const result of [denied, broke, limited]) expect(result.acceptedJob).toBeUndefined();
  });

  it("reads a 200 error envelope as a refusal and a missing transcript as a lost result", async () => {
    const { fetchImpl } = transport(leaky(200), json({ segments: [] }), json([1, 2]));
    const adapter = stt(fetchImpl);
    const run = () => adapter.transcribe({ model: "whisper-1", formData: form([]), credentials: CRED_A });
    const envelope = await run();
    expect(envelope).toMatchObject({ success: false, status: 502 });
    expect(envelope.acceptedJob).toBeUndefined();
    expectNoLeak(envelope);
    for (const result of [await run(), await run()]) {
      expect(result).toMatchObject({ success: false, status: 502 });
      expect(result.acceptedJob.meta.jobState).toBe("accepted");
    }
  });

  it("treats HTML, non-JSON for a JSON format, or a JSON document for text as a lost result", async () => {
    const { fetchImpl } = transport(
      new Response("<html>x</html>", { status: 200, headers: { "content-type": "text/html" } }),
      new Response("hello", { status: 200, headers: { "content-type": "text/plain" } }),
      new Response('{"text":"x"}', { status: 200, headers: { "content-type": "text/plain" } }),
      new Response("<!DOCTYPE html><p>", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const adapter = stt(fetchImpl);
    const html = await adapter.transcribe({ model: "whisper-1", formData: form([]), credentials: CRED_A });
    const nonJson = await adapter.transcribe({ model: "whisper-1", formData: form([]), credentials: CRED_A });
    const jsonAsText = await adapter.transcribe({ model: "whisper-1", formData: form([["response_format", "text"]]), credentials: CRED_A });
    const htmlAsText = await adapter.transcribe({ model: "whisper-1", formData: form([["response_format", "text"]]), credentials: CRED_A });
    for (const result of [html, nonJson, jsonAsText, htmlAsText]) {
      expect(result).toMatchObject({ success: false, status: 502 });
      expect(result.acceptedJob).toBeDefined();
    }
  });

  it("caps the transcript size", async () => {
    const { fetchImpl } = transport(json({ text: "x".repeat(4096) }));
    const result = await stt(fetchImpl, { maxTranscriptBytes: 1024 }).transcribe({ model: "whisper-1", formData: form([]), credentials: CRED_A });
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeDefined();
  });

  it("refuses a redirect, honors abort before send, and ends at the deadline without replay", async () => {
    const redirect = new Response(null, { status: 302, headers: { location: "https://evil.invalid/" } });
    let seenSignal;
    const { fetchImpl, calls } = transport(redirect, (_url, init) => {
      seenSignal = init.signal;
      return hang();
    });
    const adapter = stt(fetchImpl, { timeoutMs: 20 });
    const moved = await adapter.transcribe({ model: "whisper-1", formData: form([]), credentials: CRED_A });
    expect(moved).toMatchObject({ success: false, status: 502 });
    expect(moved.acceptedJob.meta.jobState).toBe("submit-unknown");
    const controller = new AbortController();
    controller.abort();
    const early = await adapter.transcribe({ model: "whisper-1", formData: form([]), credentials: CRED_A, signal: controller.signal });
    expect(early).toMatchObject({ success: false, status: 499, local: true });
    const late = await adapter.transcribe({ model: "whisper-1", formData: form([]), credentials: CRED_A });
    expect(late).toMatchObject({ success: false, status: 504 });
    expect(late.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seenSignal.aborted).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it("records a caller abort after send as uncertain", async () => {
    const controller = new AbortController();
    const { fetchImpl } = transport(() => {
      setTimeout(() => controller.abort(), 5);
      return hang();
    });
    const result = await stt(fetchImpl).transcribe({ model: "whisper-1", formData: form([]), credentials: CRED_A, signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });
});
