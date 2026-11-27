// Soniox native speech (TTS) and asynchronous transcription (STT) adapters,
// staged and unregistered (#2034). Closed mocks only: every request goes to an
// injected transport, an unexpected request fails the test, and every key is
// synthetic. Wire shapes follow OmniRoute c71f0065 (audioSpeech.ts
// handleSonioxSpeech, audioTranscription.ts handleSonioxTranscription,
// audioMultipart.ts, audioRegistry.ts `soniox` rows). Passing here says
// nothing about the live service.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-soniox-tts-stt/index.js";
import {
  SONIOX_PROVIDER_DEFINITION,
  SONIOX_STT_MODELS,
  SONIOX_TTS_MODELS,
  buildSonioxSpeechRequest,
  createSonioxSttAdapter,
  createSonioxTtsAdapter,
  groupSonioxTokensBySpeaker,
  matchesSonioxContainer,
  resolveSonioxContainer,
  resolveSonioxVoice,
  sonioxSttAdapter,
  sonioxTtsAdapter,
  sonioxUploadFileName,
} from "../../open-sse/services/providerParity/native-soniox-tts-stt/index.js";
import REGISTRY from "../../open-sse/providers/registry/index.js";
import { TTS_ADAPTERS } from "../../open-sse/handlers/ttsProviders/index.js";
import { supportsSttTranslation } from "../../open-sse/handlers/sttCore.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const TTS_URL = "https://tts-rt.soniox.com/tts";
const FILES_URL = "https://api.soniox.com/v1/files";
const JOBS_URL = "https://api.soniox.com/v1/transcriptions";
const KEY_A = "soniox-SYNTHETIC-a-0001";
const KEY_B = "soniox-SYNTHETIC-b-0002";
const CRED_A = { apiKey: KEY_A, connectionId: "conn-a" };
const CRED_B = { apiKey: KEY_B, connectionId: "conn-b" };
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 7)]);
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(200, 1)]);
const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(100, 2)]);
const STAGE_DIR = "../../open-sse/services/providerParity/native-soniox-tts-stt/";
const REGISTRATION = JSON.parse(readFileSync(new URL(`${STAGE_DIR}registration.json`, import.meta.url), "utf8"));

const audio = (bytes = MP3, type = "audio/mpeg") => new Response(bytes, { status: 200, headers: { "content-type": type } });
const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const leaky = (status, headers = {}) => json({ error: { message: `upstream echo ${KEY_A} at /srv/app/index.js:44` } }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });
const hang = () => new Promise(() => {});
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
const expectNoLeak = (result) => {
  const text = JSON.stringify(result);
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
  expect(text).not.toContain("/srv/app");
};
const tts = (fetchImpl, extra = {}) => createSonioxTtsAdapter({ fetchImpl, ...extra });
const fastWait = vi.fn(async (_ms, signal) => { if (signal?.aborted) throw signal.reason; });
const stt = (fetchImpl, extra = {}) => createSonioxSttAdapter({ fetchImpl, wait: fastWait, ...extra });

function form(entries = [], file = new File([Buffer.from("RIFFfakeaudio")], "clip.wav", { type: "audio/wav" })) {
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

/** The source happy path: upload, create, one pending poll, completed poll, transcript. */
const happySteps = (transcript = { text: "soniox result" }, jobId = "job-1") => [
  json({ id: "file-1" }),
  json({ id: jobId, status: "queued" }),
  json({ status: "processing" }),
  json({ status: "completed" }),
  json(transcript),
];
const transcribe = (adapter, { model = "stt-async-v5", entries = [], credentials = CRED_A, signal, file } = {}) =>
  adapter.transcribe({ model, formData: form(entries, file), credentials, kind: "transcription", signal });

// ── Staging block: the only assertions about registration state ──────────
describe("Soniox tts/stt staging state (promote at registration)", () => {
  it("is not registered: no registry entry and no TTS adapter", () => {
    expect(REGISTRY.some((entry) => entry.id === "soniox" || entry.alias === "sx" || entry.aliases?.includes("sx") || entry.aliases?.includes("soniox"))).toBe(false);
    expect(Object.hasOwn(TTS_ADAPTERS, "soniox")).toBe(false);
    expect(REGISTRATION.status).toBe("staged-unregistered");
    expect(REGISTRATION.provider.existingRegistryEntry).toBeNull();
  });
});

describe("Soniox staged metadata", () => {
  it("pins the source registry fields and models", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryFields.stt).toEqual({ id: "soniox", baseUrl: JOBS_URL, authType: "apikey", authHeader: "bearer", async: true, format: "soniox" });
    expect(REGISTRATION.source.registryFields.tts).toEqual({ id: "soniox", baseUrl: TTS_URL, authType: "apikey", authHeader: "bearer", format: "soniox-tts" });
    expect(SONIOX_TTS_MODELS.map((m) => m.id)).toEqual(["tts-rt-v2", "tts-rt-v1"]);
    expect(SONIOX_STT_MODELS.map((m) => m.id)).toEqual(["stt-async-v5", "stt-async-v4"]);
    expect(REGISTRATION.models.tts.map((m) => m.id)).toEqual(SONIOX_TTS_MODELS.map((m) => m.id));
    expect(REGISTRATION.models.stt.map((m) => m.id)).toEqual(SONIOX_STT_MODELS.map((m) => m.id));
  });

  it("stages an apikey-only provider definition with the source alias and fixed origins", () => {
    expect(SONIOX_PROVIDER_DEFINITION).toMatchObject({ id: "soniox", alias: "soniox", aliases: ["sx"], category: "apikey", authType: "apikey", serviceKinds: ["tts", "stt"] });
    expect(SONIOX_PROVIDER_DEFINITION.display).toMatchObject({ name: "Soniox", textIcon: "SX", website: "https://soniox.com" });
    expect(SONIOX_PROVIDER_DEFINITION.transport.validateUrl).toBe(JOBS_URL);
    expect(SONIOX_PROVIDER_DEFINITION.ttsConfig).toEqual({ baseUrl: TTS_URL, authType: "apikey", authHeader: "bearer", format: "soniox-tts" });
    expect(SONIOX_PROVIDER_DEFINITION.sttConfig).toMatchObject({ baseUrl: JOBS_URL, authHeader: "bearer", async: true, format: "soniox" });
    expect(supportsSttTranslation(SONIOX_PROVIDER_DEFINITION.sttConfig, "stt-async-v5")).toBe(false);
    expect(REGISTRATION.provider).toMatchObject({ canonicalId: "soniox", aliases: ["sx"], authModes: ["apikey"], serviceKinds: ["tts", "stt"] });
  });

  it("exports every name registration.json lists", () => {
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(sonioxTtsAdapter.provider).toBe("soniox");
    expect(sonioxSttAdapter.provider).toBe("soniox");
  });
});

describe("Soniox speech wire contract", () => {
  it("posts the source body with the Bearer key and returns mp3", async () => {
    const { fetchImpl, calls } = transport(audio());
    const result = await tts(fetchImpl).synthesize("Hello there.", "tts-rt-v2", CRED_A, "mp3", {});
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TTS_URL);
    expect(calls[0].init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(headersOf(calls[0])).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(calls[0].init.body).toBe(JSON.stringify({ text: "Hello there.", model: "tts-rt-v2", language: "en", voice: "Adrian", audio_format: "mp3" }));
    expect(result).toMatchObject({ format: "mp3", base64: MP3.toString("base64") });
    expect(result.accounting).toMatchObject({ modality: "tts", cost: null, costStatus: "unknown", meta: { model: "tts-rt-v2", contentType: "audio/mpeg" } });
  });

  it("maps voices and language like the source and accepts a model/voice suffix", async () => {
    const { fetchImpl, calls } = transport(audio(WAV, "audio/wav"), audio(OGG, "audio/opus"), audio());
    const adapter = tts(fetchImpl);
    const wav = await adapter.synthesize("Hi", "tts-rt-v1", CRED_A, "wav", { voice: " Maya ", language: " de " });
    const opus = await adapter.synthesize("Hi", "tts-rt-v2/Noah", CRED_A, "opus", {});
    await adapter.synthesize("Hi", "tts-rt-v2", CRED_A, "mp3", { voice: "alloy" });
    expect(JSON.parse(calls[0].init.body)).toEqual({ text: "Hi", model: "tts-rt-v1", language: "de", voice: "Maya", audio_format: "wav" });
    expect(JSON.parse(calls[1].init.body)).toMatchObject({ voice: "Noah", audio_format: "opus" });
    expect(JSON.parse(calls[2].init.body).voice).toBe("Adrian");
    expect(wav.format).toBe("wav");
    expect(opus.format).toBe("opus");
    expect(resolveSonioxVoice("shimmer")).toBe("Adrian");
    expect(resolveSonioxVoice("")).toBe("Adrian");
  });

  it("resolves the container with json meaning the gateway wrapper", () => {
    expect(resolveSonioxContainer(undefined, "mp3")).toBe("mp3");
    expect(resolveSonioxContainer("json", "mp3")).toBe("mp3");
    expect(resolveSonioxContainer("WAV", "mp3")).toBe("wav");
    expect(resolveSonioxContainer(null, "opus")).toBe("opus");
    expect(matchesSonioxContainer("wav", WAV)).toBe(true);
    expect(matchesSonioxContainer("opus", MP3)).toBe(false);
  });

  it("forwards the connection egress policy and keeps each connection's key, ignoring connection base URLs", async () => {
    const { fetchImpl, calls } = transport(audio(), audio());
    const adapter = tts(fetchImpl);
    await adapter.synthesize("one", "tts-rt-v2", { ...CRED_A, baseUrl: "https://evil.invalid/v1" }, "mp3", {});
    await adapter.synthesize("two", "tts-rt-v2", CRED_B, "mp3", {});
    expect(calls.map((c) => c.url)).toEqual([TTS_URL, TTS_URL]);
    expect(calls[0].proxyOptions).toBeTypeOf("object");
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${KEY_A}`);
    expect(headersOf(calls[1]).Authorization).toBe(`Bearer ${KEY_B}`);
  });

  it.each([
    ["pcm output", "tts-rt-v2", { response_format: "pcm" }],
    ["an unknown container", "tts-rt-v2", { response_format: "flac" }],
    ["the ogg alias the source never mapped", "tts-rt-v2", { response_format: "ogg" }],
    ["conflicting containers", "tts-rt-v2", { response_format: "wav" }, "opus"],
    ["sse streaming", "tts-rt-v2", { stream_format: "sse" }],
    ["stream: true", "tts-rt-v2", { stream: true }],
    ["an unknown model", "tts-1", {}],
    ["a non-1 speed the source would drop", "tts-rt-v2", { speed: 1.5 }],
    ["instructions the source would drop", "tts-rt-v2", { instructions: "whisper" }],
    ["a non-string voice", "tts-rt-v2", { voice: 3 }],
    ["an unsafe voice", "tts-rt-v2", { voice: "../x\r\n" }],
    ["a conflicting voice", "tts-rt-v2/Noah", { voice: "Maya" }],
    ["a malformed language", "tts-rt-v2", { language: "english please" }],
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
    expect(() => buildSonioxSpeechRequest("tts-rt-v2", "x".repeat(300 * 1024))).toThrow(/too large/);
    expect(await adapter.synthesize("Hi", "tts-rt-v2", { apiKey: "" }, "mp3", {})).toMatchObject({ success: false, status: 401 });
    expect(await adapter.synthesize("Hi", "tts-rt-v2", { apiKey: "a\r\nX-Evil: 1" }, "mp3", {})).toMatchObject({ success: false, status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Soniox speech failures and unsafe answers", () => {
  it.each([400, 401, 403, 404])("maps HTTP %i without quoting Soniox or accepting a job", async (status) => {
    const { fetchImpl } = transport(leaky(status));
    const result = await tts(fetchImpl).synthesize("Hi", "tts-rt-v2", CRED_A, "mp3", {});
    expect(result).toMatchObject({ success: false, status });
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it("marks 402 as quota exhausted on that connection only, and keeps Retry-After on 429", async () => {
    const { fetchImpl, calls } = transport(leaky(402), audio(), leaky(429, { "retry-after": "7" }));
    const adapter = tts(fetchImpl);
    const exhausted = await adapter.synthesize("Hi", "tts-rt-v2", CRED_A, "mp3", {});
    const other = await adapter.synthesize("Hi", "tts-rt-v2", CRED_B, "mp3", {});
    const limited = await adapter.synthesize("Hi", "tts-rt-v2", CRED_A, "mp3", {});
    expect(exhausted).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    expect(other.format).toBe("mp3");
    expect(headersOf(calls[1]).Authorization).toBe(`Bearer ${KEY_B}`);
    expect(limited).toMatchObject({ success: false, status: 429 });
    expect(limited.resetsAtMs).toBeGreaterThan(Date.now());
    expectNoLeak(exhausted);
    expectNoLeak(limited);
  });

  it("treats a 5xx, a redirect and a reset after send as uncertain, never replayed", async () => {
    const redirect = new Response(null, { status: 307, headers: { location: "https://evil.invalid/steal" } });
    const { fetchImpl, calls } = transport(leaky(500), redirect, transportError("ECONNRESET"), transportError("ENOTFOUND"));
    const adapter = tts(fetchImpl);
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await adapter.synthesize("Hi", "tts-rt-v2", CRED_A, "mp3", {}));
    expect(calls).toHaveLength(4);
    for (const result of results.slice(0, 3)) {
      expect(result).toMatchObject({ success: false, status: 502 });
      expect(result.acceptedJob).toMatchObject({ modality: "tts", cost: null, costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
      expectNoLeak(result);
    }
    expect(results[3]).toMatchObject({ success: false, status: 502 });
    expect(results[3].acceptedJob).toBeUndefined();
  });

  it("does not send when the caller already left, and records an abort after send as uncertain", async () => {
    const left = new AbortController();
    left.abort();
    const { fetchImpl: never } = transport();
    const before = await tts(never).synthesize("Hi", "tts-rt-v2", CRED_A, "mp3", { signal: left.signal });
    expect(before).toMatchObject({ success: false, status: 499, local: true });
    expect(never).not.toHaveBeenCalled();

    const controller = new AbortController();
    const { fetchImpl } = transport(() => {
      setTimeout(() => controller.abort(), 5);
      return hang();
    });
    const after = await tts(fetchImpl).synthesize("Hi", "tts-rt-v2", CRED_A, "mp3", { signal: controller.signal });
    expect(after).toMatchObject({ success: false, status: 499 });
    expect(after.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("ends at the deadline even when fetch ignores its signal, and bounds a stalled body", async () => {
    let seenSignal;
    const { fetchImpl } = transport((_url, init) => {
      seenSignal = init.signal;
      return hang();
    }, stalledBody());
    const hung = await tts(fetchImpl, { timeoutMs: 20 }).synthesize("Hi", "tts-rt-v2", CRED_A, "mp3", {});
    expect(seenSignal.aborted).toBe(true);
    expect(hung).toMatchObject({ success: false, status: 504 });
    expect(hung.acceptedJob.meta.jobState).toBe("submit-unknown");
    const stalled = await tts(fetchImpl, { timeoutMs: 30 }).synthesize("Hi", "tts-rt-v2", CRED_A, "mp3", {});
    expect(stalled).toMatchObject({ success: false, status: 504 });
    expect(stalled.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("refuses error envelopes, HTML, mismatched containers, empty and oversized audio", async () => {
    const { fetchImpl } = transport(
      leaky(200),
      new Response("<html>oops</html>", { status: 200, headers: { "content-type": "text/html" } }),
      audio(MP3, "audio/wav"),
      audio(Buffer.alloc(0)),
      audio(Buffer.concat([MP3, Buffer.alloc(4096)])),
    );
    const adapter = tts(fetchImpl, { maxAudioBytes: 1024 });
    const envelope = await adapter.synthesize("Hi", "tts-rt-v2", CRED_A, "mp3", {});
    expect(envelope).toMatchObject({ success: false, status: 502 });
    expect(envelope.acceptedJob).toBeUndefined();
    expectNoLeak(envelope);
    const html = await adapter.synthesize("Hi", "tts-rt-v2", CRED_A, "mp3", {});
    const mismatch = await adapter.synthesize("Hi", "tts-rt-v2", CRED_A, "wav", {});
    const empty = await adapter.synthesize("Hi", "tts-rt-v2", CRED_A, "mp3", {});
    const huge = await adapter.synthesize("Hi", "tts-rt-v2", CRED_A, "mp3", {});
    for (const result of [html, mismatch, empty, huge]) {
      expect(result).toMatchObject({ success: false, status: 502 });
      expect(result.acceptedJob.meta.jobState).toBe("accepted");
    }
  });
});

describe("Soniox transcription wire contract", () => {
  it("uploads, creates, polls and reads the transcript with the source requests", async () => {
    const { fetchImpl, calls } = transport(...happySteps());
    const result = await transcribe(stt(fetchImpl));
    expect(calls.map((c) => [c.init.method, c.url])).toEqual([
      ["POST", FILES_URL],
      ["POST", JOBS_URL],
      ["GET", `${JOBS_URL}/job-1`],
      ["GET", `${JOBS_URL}/job-1`],
      ["GET", `${JOBS_URL}/job-1/transcript`],
    ]);
    for (const call of calls) {
      expect(call.init.redirect).toBe("manual");
      expect(headersOf(call).Authorization).toBe(`Bearer ${KEY_A}`);
    }
    expect(Object.keys(headersOf(calls[0]))).toEqual(["Authorization"]);
    const upload = await sentForm(calls[0]);
    expect(upload.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(upload.entries.map(([k]) => k)).toEqual(["file"]);
    expect(upload.entries[0][1].name).toBe("clip.wav");
    expect(upload.entries[0][1].type).toBe("audio/wav");
    expect(headersOf(calls[1])).toEqual({ Authorization: `Bearer ${KEY_A}`, "Content-Type": "application/json" });
    expect(calls[1].init.body).toBe(JSON.stringify({ model: "stt-async-v5", file_id: "file-1", enable_language_identification: true }));
    expect(fastWait).toHaveBeenCalledWith(2_000, undefined);
    expect(result).toMatchObject({ success: true, usageValue: undefined, nativeUnits: {} });
    expect(await result.response.json()).toEqual({ text: "soniox result" });
    expect(result.accounting).toMatchObject({ modality: "stt", cost: null, costStatus: "unknown", meta: { model: "stt-async-v5", jobId: "job-1" } });
  });

  it("adds diarization, context and language hints only when asked, and returns verbose_json with words", async () => {
    const tokens = [
      { text: "Hi ", start_ms: 0, end_ms: 400, speaker: "1", language: "en" },
      { text: "there", start_ms: 400, end_ms: 900, speaker: "1", language: "en" },
      { text: " yo", start_ms: 1000, end_ms: 1500, speaker: "2" },
    ];
    const { fetchImpl, calls } = transport(...happySteps({ tokens }));
    const result = await transcribe(stt(fetchImpl), {
      model: "stt-async-v4",
      entries: [["diarize", "true"], ["context", "medical"], ["language", "en"], ["timestamp_granularities[]", "word"]],
    });
    expect(JSON.parse(calls[1].init.body)).toEqual({
      model: "stt-async-v4", file_id: "file-1", enable_language_identification: true, enable_speaker_diarization: true, context: "medical", language_hints: ["en"],
    });
    const body = await result.response.json();
    expect(body).toEqual({
      task: "transcribe",
      language: "en",
      duration: 1.5,
      text: "Hi there yo",
      segments: [
        { id: 0, start: 0, end: 0.9, text: "Hi there", speaker: "1" },
        { id: 1, start: 1, end: 1.5, text: "yo", speaker: "2" },
      ],
      words: [
        { word: "Hi ", start: 0, end: 0.4, speaker: "1" },
        { word: "there", start: 0.4, end: 0.9, speaker: "1" },
        { word: " yo", start: 1, end: 1.5, speaker: "2" },
      ],
    });
    expect(result.nativeUnits).toEqual({ audioSeconds: 1.5 });
    expect(groupSonioxTokensBySpeaker([{ text: "a" }, { text: "b" }])).toEqual([{ speaker: null, startMs: 0, endMs: 0, text: "ab" }]);
  });

  it.each(["enable_speaker_diarization", "diarization", "speaker_labels", "diarize"])("accepts the %s diarization spelling", async (name) => {
    const { fetchImpl, calls } = transport(...happySteps());
    await transcribe(stt(fetchImpl), { entries: [[name, "yes"]] });
    expect(JSON.parse(calls[1].init.body).enable_speaker_diarization).toBe(true);
  });

  it("joins token text when the transcript has none, and answers text as text/plain", async () => {
    const { fetchImpl } = transport(...happySteps({ tokens: [{ text: "one " }, { text: "two", end_ms: 2000 }] }));
    const result = await transcribe(stt(fetchImpl), { entries: [["response_format", "text"]] });
    expect(result.response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await result.response.text()).toBe("one two");
    expect(result.nativeUnits).toEqual({ audioSeconds: 2 });
  });

  it("uses the source upload name rule", async () => {
    expect(sonioxUploadFileName({ name: "note.opus" })).toBe("note.ogg");
    expect(sonioxUploadFileName({})).toBe("audio.wav");
    expect(sonioxUploadFileName({ name: 'a"b\r\n.wav' })).toBe("a_b__.wav");
  });

  it("keeps each selected connection's key on its own job and ignores connection base URLs", async () => {
    const { fetchImpl, calls } = transport(...happySteps(), ...happySteps({ text: "b" }, "job-2"));
    const adapter = stt(fetchImpl);
    await transcribe(adapter, { credentials: { ...CRED_A, baseUrl: "https://evil.invalid" } });
    const second = await transcribe(adapter, { credentials: CRED_B });
    expect(calls.slice(0, 5).every((c) => headersOf(c).Authorization === `Bearer ${KEY_A}`)).toBe(true);
    expect(calls.slice(5).every((c) => headersOf(c).Authorization === `Bearer ${KEY_B}`)).toBe(true);
    expect(calls.every((c) => c.url.startsWith("https://api.soniox.com/v1/"))).toBe(true);
    expect(await second.response.json()).toEqual({ text: "b" });
  });

  it.each([
    ["a translation", { kind: "translation" }],
    ["an unknown model", { model: "whisper-1" }],
    ["a url instead of a file", { file: null, entries: [["url", "https://example.com/a.wav"]] }],
    ["a missing file", { file: null }],
    ["an empty file", { file: new File([], "a.wav") }],
    ["streaming", { entries: [["stream", "true"]] }],
    ["srt output", { entries: [["response_format", "srt"]] }],
    ["a prompt the source would drop", { entries: [["prompt", "names"]] }],
    ["a non-zero temperature", { entries: [["temperature", "0.4"]] }],
    ["word timestamps without verbose", { entries: [["timestamp_granularities[]", "word"]] }],
    ["an unknown granularity", { entries: [["response_format", "verbose_json"], ["timestamp_granularities[]", "char"]] }],
    ["text output with diarization", { entries: [["response_format", "text"], ["diarize", "1"]] }],
    ["a malformed language", { entries: [["language", "en; DROP"]] }],
    ["an oversized context", { entries: [["context", "x".repeat(10_001)]] }],
  ])("refuses %s before anything is uploaded", async (_label, { kind = "transcription", model = "stt-async-v5", entries = [], file } = {}) => {
    const { fetchImpl } = transport();
    const formData = form(entries, file === undefined ? undefined : file);
    const result = await stt(fetchImpl).transcribe({ model, formData, credentials: CRED_A, kind });
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an oversized file and a missing key before upload", async () => {
    const { fetchImpl } = transport();
    const big = await transcribe(stt(fetchImpl), { file: { name: "a.wav", size: 200 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(1) } });
    expect(big).toMatchObject({ success: false, status: 400, local: true });
    expect(await transcribe(stt(fetchImpl), { credentials: { apiKey: "" } })).toMatchObject({ success: false, status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Soniox transcription failures, uncertainty and no replay", () => {
  it("maps upload refusals without quoting Soniox and never creates a job", async () => {
    const { fetchImpl, calls } = transport(leaky(401), leaky(402), leaky(500));
    const adapter = stt(fetchImpl);
    const auth = await transcribe(adapter);
    const quota = await transcribe(adapter);
    const broken = await transcribe(adapter);
    expect(calls.every((c) => c.url === FILES_URL)).toBe(true);
    expect(auth).toMatchObject({ success: false, status: 401 });
    expect(quota).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    // The upload bills nothing, so even an uncertain upload records no accepted job.
    expect(broken).toMatchObject({ success: false, status: 502 });
    for (const result of [auth, quota, broken]) {
      expect(result.acceptedJob).toBeUndefined();
      expectNoLeak(result);
    }
  });

  it("refuses an unusable file id without creating a job", async () => {
    const { fetchImpl, calls } = transport(json({ id: "../../admin" }));
    const result = await transcribe(stt(fetchImpl));
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("treats an uncertain create as an accepted job and never replays it", async () => {
    const { fetchImpl, calls } = transport(json({ id: "file-1" }), transportError("ECONNRESET"));
    const result = await transcribe(stt(fetchImpl));
    expect(calls.map((c) => c.url)).toEqual([FILES_URL, JOBS_URL]);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toMatchObject({ modality: "stt", cost: null, costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
    expectNoLeak(result);
  });

  it("records a create answered without a usable job id as accepted", async () => {
    const { fetchImpl, calls } = transport(json({ id: "file-1" }), json({ id: "a/b" }));
    const result = await transcribe(stt(fetchImpl));
    expect(calls).toHaveLength(2);
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("reports a failed job without quoting Soniox's message", async () => {
    const { fetchImpl } = transport(json({ id: "file-1" }), json({ id: "job-1" }), json({ status: "error", error_message: `bad ${KEY_A} /srv/app` }));
    const result = await transcribe(stt(fetchImpl));
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("/srv/app");
    expectNoLeak(result);
  });

  it("keeps polling through transient status failures inside the deadline", async () => {
    const { fetchImpl, calls } = transport(
      json({ id: "file-1" }), json({ id: "job-1" }),
      leaky(503), leaky(429), transportError("ECONNRESET"), json({ status: "completed" }), json({ text: "ok" }),
    );
    const result = await transcribe(stt(fetchImpl));
    expect(calls.filter((c) => c.url === JOBS_URL)).toHaveLength(1);
    expect(await result.response.json()).toEqual({ text: "ok" });
  });

  it("stops at an auth refusal, a redirect or an unknown state while polling, with the job recorded", async () => {
    const redirect = new Response(null, { status: 302, headers: { location: "https://evil.invalid/" } });
    const { fetchImpl } = transport(
      json({ id: "file-1" }), json({ id: "job-1" }), leaky(401),
      json({ id: "file-2" }), json({ id: "job-2" }), redirect,
      json({ id: "file-3" }), json({ id: "job-3" }), json({ status: "weird" }),
    );
    const adapter = stt(fetchImpl);
    const auth = await transcribe(adapter);
    const moved = await transcribe(adapter);
    const weird = await transcribe(adapter);
    expect(auth).toMatchObject({ success: false, status: 401 });
    expect(auth.acceptedJob.meta).toEqual({ jobState: "poll-failed", jobId: "job-1" });
    expect(moved.acceptedJob.meta).toEqual({ jobState: "poll-failed", jobId: "job-2" });
    expect(weird.acceptedJob.meta).toEqual({ jobState: "poll-failed", jobId: "job-3" });
    for (const result of [auth, moved, weird]) expectNoLeak(result);
  });

  it("ends at the total deadline while polling, without re-creating the job", async () => {
    let clock = 0;
    const pending = () => json({ status: "processing" });
    const { fetchImpl, calls } = transport(json({ id: "file-1" }), json({ id: "job-1" }), ...Array.from({ length: 50 }, () => pending));
    const adapter = stt(fetchImpl, { totalTimeoutMs: 10_000, now: () => clock, wait: async (ms) => { clock += ms; } });
    const result = await transcribe(adapter);
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob.meta).toEqual({ jobState: "poll-timeout", jobId: "job-1" });
    expect(calls.filter((c) => c.url === JOBS_URL)).toHaveLength(1);
    expect(calls.length).toBeLessThanOrEqual(2 + 5);
  });

  it("bounds each call: a hung create ends at the per-call ceiling as uncertain", async () => {
    let seenSignal;
    const { fetchImpl } = transport(json({ id: "file-1" }), (_url, init) => {
      seenSignal = init.signal;
      return hang();
    });
    const result = await transcribe(stt(fetchImpl, { callTimeoutMs: 20 }));
    expect(seenSignal.aborted).toBe(true);
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("aborts polling when the caller leaves and records the running job", async () => {
    const controller = new AbortController();
    const { fetchImpl, calls } = transport(json({ id: "file-1" }), json({ id: "job-1" }));
    const adapter = stt(fetchImpl, {
      wait: (_ms, signal) => new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        setTimeout(() => controller.abort(), 5);
      }),
    });
    const result = await transcribe(adapter, { signal: controller.signal });
    expect(calls).toHaveLength(2);
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob.meta).toEqual({ jobState: "accepted", jobId: "job-1" });
  });

  it("does not upload when the caller already left", async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetchImpl } = transport();
    const result = await transcribe(stt(fetchImpl), { signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499, local: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats malformed, HTML, error-envelope, oversized or refused transcripts as lost results", async () => {
    const steps = (last) => [json({ id: "file-1" }), json({ id: "job-1" }), json({ status: "completed" }), last];
    const { fetchImpl } = transport(
      ...steps(json({ tokens: "nope" })),
      ...steps(new Response("<html>x</html>", { status: 200, headers: { "content-type": "text/html" } })),
      ...steps(leaky(200)),
      ...steps(json({ text: "x".repeat(4096) })),
      ...steps(leaky(404)),
    );
    const adapter = stt(fetchImpl, { maxTranscriptBytes: 1024 });
    for (let i = 0; i < 5; i += 1) {
      const result = await transcribe(adapter);
      expect(result.success).toBe(false);
      expect(result.acceptedJob.meta).toEqual({ jobState: "accepted", jobId: "job-1" });
      expectNoLeak(result);
    }
  });
});
