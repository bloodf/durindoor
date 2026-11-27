// deAPI native speech (TTS) and transcription (STT) adapters, staged and
// unregistered (#2034). Closed mocks only: every request goes to an injected
// transport, an unexpected request fails the test, and every key is synthetic.
// Wire shapes follow OmniRoute c71f0065 (audioSpeech.ts and
// audioTranscription.ts OpenAI-compatible default branches, audioMultipart.ts
// buildMultipartBody, audioRegistry.ts `deapi` rows, deapi-provider.test.ts).
// Passing here says nothing about the live service.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-deapi-tts-stt/index.js";
import {
  DEAPI_PROVIDER_DEFINITION,
  DEAPI_STT_MODELS,
  DEAPI_TTS_MODELS,
  buildDeapiSpeechRequest,
  createDeapiSttAdapter,
  createDeapiTtsAdapter,
  deapiSttAdapter,
  deapiTtsAdapter,
  deapiUploadFileName,
} from "../../open-sse/services/providerParity/native-deapi-tts-stt/index.js";
import { TTS_ADAPTERS } from "../../open-sse/handlers/ttsProviders/index.js";
import { supportsSttTranslation } from "../../open-sse/handlers/sttCore.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const SPEECH_URL = "https://oai.deapi.ai/v1/audio/speech";
const TRANSCRIPTION_URL = "https://oai.deapi.ai/v1/audio/transcriptions";
const KEY_A = "sk-dp-SYNTHETIC-a-0001";
const KEY_B = "sk-dp-SYNTHETIC-b-0002";
const CRED_A = { apiKey: KEY_A, connectionId: "conn-a" };
const CRED_B = { apiKey: KEY_B, connectionId: "conn-b" };
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 7)]);
const MP3_FRAME = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(100, 1)]);
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(200, 1)]);
const STAGE_DIR = "../../open-sse/services/providerParity/native-deapi-tts-stt/";
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
describe("deAPI tts/stt staging state (promote at registration)", () => {
  it("is not registered: no TTS adapter, no provider registry file", () => {
    expect(Object.hasOwn(TTS_ADAPTERS, "deapi")).toBe(false);
    expect(existsSync(new URL("../../open-sse/providers/registry/deapi.js", import.meta.url))).toBe(false);
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("deAPI staged metadata", () => {
  it("pins the source registry fields and models", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryFields.tts).toEqual({
      id: "deapi", baseUrl: SPEECH_URL, authType: "apikey", authHeader: "bearer", format: "openai", supportedFormats: ["mp3"],
    });
    expect(REGISTRATION.source.registryFields.stt).toEqual({
      id: "deapi", baseUrl: TRANSCRIPTION_URL, authType: "apikey", authHeader: "bearer", format: "openai",
    });
    expect(DEAPI_TTS_MODELS.map((m) => m.id)).toEqual(["Kokoro", "Chatterbox", "Qwen3_TTS_12Hz_1_7B_CustomVoice", "Qwen3_TTS_12Hz_1_7B_VoiceDesign"]);
    expect(DEAPI_STT_MODELS.map((m) => m.id)).toEqual(["WhisperLargeV3Ct2", "WhisperLargeV3"]);
    expect(REGISTRATION.models.tts.map((m) => m.id)).toEqual(DEAPI_TTS_MODELS.map((m) => m.id));
    expect(REGISTRATION.models.stt.map((m) => m.id)).toEqual(DEAPI_STT_MODELS.map((m) => m.id));
    expect(REGISTRATION.provider.canonicalId).toBe("deapi");
    expect(REGISTRATION.provider.authModes).toEqual(["apikey"]);
  });

  it("stages a provider definition with apikey auth, fixed endpoints and no translations", () => {
    expect(DEAPI_PROVIDER_DEFINITION).toMatchObject({ id: "deapi", alias: "deapi", category: "apikey", authType: "apikey", serviceKinds: ["tts", "stt"] });
    expect(DEAPI_PROVIDER_DEFINITION.ttsConfig).toEqual({ baseUrl: SPEECH_URL, authType: "apikey", authHeader: "bearer", format: "openai" });
    expect(DEAPI_PROVIDER_DEFINITION.sttConfig.baseUrl).toBe(TRANSCRIPTION_URL);
    expect(supportsSttTranslation(DEAPI_PROVIDER_DEFINITION.sttConfig, "WhisperLargeV3")).toBe(false);
  });

  it("exports every name registration.json lists", () => {
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(deapiTtsAdapter.provider).toBe("deapi");
    expect(deapiSttAdapter.provider).toBe("deapi");
  });
});

describe("deAPI speech wire contract", () => {
  it("posts the source body with the Bearer key and returns mp3", async () => {
    const { fetchImpl, calls } = transport(audio());
    const result = await createDeapiTtsAdapter({ fetchImpl }).synthesize("Hello there.", "Kokoro", CRED_A, "mp3", {});
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(SPEECH_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(headersOf(calls[0])).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(calls[0].init.body).toBe(JSON.stringify({ model: "Kokoro", input: "Hello there.", voice: "alloy", response_format: "mp3", speed: 1 }));
    expect(result.format).toBe("mp3");
    expect(Buffer.from(result.base64, "base64").equals(MP3)).toBe(true);
    expect(result.accounting).toMatchObject({ modality: "tts", cost: null, costStatus: "unknown", costSource: "unavailable" });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("sends instructions for the voice-design model and a model/voice suffix as the voice", async () => {
    const { fetchImpl, calls } = transport(audio(MP3_FRAME), audio());
    const adapter = createDeapiTtsAdapter({ fetchImpl });
    await adapter.synthesize("Hi", "Qwen3_TTS_12Hz_1_7B_VoiceDesign", CRED_A, "mp3", { instructions: "a warm British voice", speed: 1.25 });
    await adapter.synthesize("Hi", "Kokoro/af_bella", CRED_A, "mp3", { response_format: "MP3" });
    expect(speechBody(calls[0])).toEqual({
      model: "Qwen3_TTS_12Hz_1_7B_VoiceDesign", input: "Hi", voice: "alloy", response_format: "mp3", speed: 1.25, instructions: "a warm British voice",
    });
    expect(speechBody(calls[1])).toEqual({ model: "Kokoro", input: "Hi", voice: "af_bella", response_format: "mp3", speed: 1 });
    expect("instructions" in speechBody(calls[1])).toBe(false);
  });

  it("forwards the connection egress policy to the transport", async () => {
    const { fetchImpl, calls } = transport(audio());
    const proxied = { ...CRED_A, providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.invalid:8080" } };
    await createDeapiTtsAdapter({ fetchImpl }).synthesize("Hi", "Chatterbox", proxied, "mp3", {});
    expect(calls[0].proxyOptions).toBeTypeOf("object");
  });

  it("keeps each selected connection's key on its own request", async () => {
    const { fetchImpl, calls } = transport(audio(), audio());
    const adapter = createDeapiTtsAdapter({ fetchImpl });
    await adapter.synthesize("one", "Kokoro", CRED_A, "mp3", {});
    await adapter.synthesize("two", "Kokoro", CRED_B, "mp3", {});
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${KEY_A}`);
    expect(headersOf(calls[1]).Authorization).toBe(`Bearer ${KEY_B}`);
  });

  it.each([
    ["a wav container", "Kokoro", { response_format: "wav" }],
    ["a query-string opus container", "Kokoro", { requestedResponseFormat: "opus" }],
    ["sse streaming", "Kokoro", { stream_format: "sse" }],
    ["stream: true", "Kokoro", { stream: true }],
    ["an unknown model", "tts-1", {}],
    ["voice design without instructions", "Qwen3_TTS_12Hz_1_7B_VoiceDesign", {}],
    ["non-string instructions", "Kokoro", { instructions: 5 }],
    ["speed out of range", "Kokoro", { speed: 9 }],
    ["non-numeric speed", "Kokoro", { speed: "fast" }],
    ["a non-string voice", "Kokoro", { voice: 3 }],
    ["a conflicting voice", "Kokoro/af_bella", { voice: "nova" }],
  ])("refuses %s before submit", async (_label, model, options) => {
    const { fetchImpl } = transport();
    const result = await createDeapiTtsAdapter({ fetchImpl }).synthesize("Hi", model, CRED_A, "mp3", options);
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(result.acceptedJob).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an oversized request and a missing key before submit", async () => {
    const { fetchImpl } = transport();
    const adapter = createDeapiTtsAdapter({ fetchImpl });
    expect(() => buildDeapiSpeechRequest("Kokoro", "x".repeat(300 * 1024))).toThrow(/too large/);
    const noKey = await adapter.synthesize("Hi", "Kokoro", { apiKey: "" }, "mp3", {});
    expect(noKey).toMatchObject({ success: false, status: 401 });
    const headerInjection = await adapter.synthesize("Hi", "Kokoro", { apiKey: "a\r\nX-Evil: 1" }, "mp3", {});
    expect(headerInjection).toMatchObject({ success: false, status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("deAPI speech failures", () => {
  it.each([
    [401, 401, false],
    [403, 403, false],
    [400, 400, false],
    [404, 404, false],
  ])("maps HTTP %i to %i without quoting deAPI or accepting a job", async (status, expected) => {
    const { fetchImpl } = transport(leaky(status));
    const result = await createDeapiTtsAdapter({ fetchImpl }).synthesize("Hi", "Kokoro", CRED_A, "mp3", {});
    expect(result).toMatchObject({ success: false, status: expected });
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it("marks 402 as quota exhausted on this connection only", async () => {
    const { fetchImpl } = transport(leaky(402));
    const result = await createDeapiTtsAdapter({ fetchImpl }).synthesize("Hi", "Kokoro", CRED_A, "mp3", {});
    expect(result).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    expectNoLeak(result);
  });

  it("keeps a bounded Retry-After on 429 and 503", async () => {
    const { fetchImpl } = transport(leaky(429, { "retry-after": "7" }), leaky(503, { "retry-after": "3" }));
    const adapter = createDeapiTtsAdapter({ fetchImpl });
    const limited = await adapter.synthesize("Hi", "Kokoro", CRED_A, "mp3", {});
    const unavailable = await adapter.synthesize("Hi", "Kokoro", CRED_A, "mp3", {});
    expect(limited).toMatchObject({ success: false, status: 429 });
    expect(limited.resetsAtMs).toBeGreaterThan(Date.now());
    expect(unavailable).toMatchObject({ success: false, status: 503 });
    expect(limited.acceptedJob).toBeUndefined();
    expect(unavailable.acceptedJob).toBeUndefined();
    expectNoLeak(limited);
  });

  it("treats other 5xx as an uncertain, never-replayed job with unknown cost", async () => {
    const { fetchImpl, calls } = transport(leaky(500));
    const result = await createDeapiTtsAdapter({ fetchImpl }).synthesize("Hi", "Kokoro", CRED_A, "mp3", {});
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toMatchObject({ modality: "tts", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
    expectNoLeak(result);
  });

  it("refuses a redirect without following it", async () => {
    const redirect = new Response(null, { status: 307, headers: { location: "https://evil.invalid/steal" } });
    const { fetchImpl, calls } = transport(redirect);
    const result = await createDeapiTtsAdapter({ fetchImpl }).synthesize("Hi", "Kokoro", CRED_A, "mp3", {});
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeDefined();
  });

  it("distinguishes a provably unsent connect failure from a failure after send", async () => {
    const { fetchImpl } = transport(transportError("ENOTFOUND"), transportError("ECONNRESET"));
    const adapter = createDeapiTtsAdapter({ fetchImpl });
    const unsent = await adapter.synthesize("Hi", "Kokoro", CRED_A, "mp3", {});
    const reset = await adapter.synthesize("Hi", "Kokoro", CRED_A, "mp3", {});
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
    const result = await createDeapiTtsAdapter({ fetchImpl }).synthesize("Hi", "Kokoro", CRED_A, "mp3", { signal: controller.signal });
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
    const result = await createDeapiTtsAdapter({ fetchImpl }).synthesize("Hi", "Kokoro", CRED_A, "mp3", { signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("aborts the transport signal and ends at the deadline even when fetch ignores it", async () => {
    let seenSignal;
    const { fetchImpl, calls } = transport((_url, init) => {
      seenSignal = init.signal;
      return hang();
    });
    const result = await createDeapiTtsAdapter({ fetchImpl, timeoutMs: 20 }).synthesize("Hi", "Kokoro", CRED_A, "mp3", {});
    expect(calls).toHaveLength(1);
    expect(seenSignal.aborted).toBe(true);
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob).toBeDefined();
  });

  it("bounds a stalled audio body by the same deadline", async () => {
    const { fetchImpl } = transport(stalledBody());
    const result = await createDeapiTtsAdapter({ fetchImpl, timeoutMs: 30 }).synthesize("Hi", "Kokoro", CRED_A, "mp3", {});
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });
});

describe("deAPI speech malformed or unsafe answers", () => {
  it("reads a 200 error envelope as a refusal without quoting it", async () => {
    const { fetchImpl } = transport(leaky(200));
    const result = await createDeapiTtsAdapter({ fetchImpl }).synthesize("Hi", "Kokoro", CRED_A, "mp3", {});
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it.each([
    ["non-envelope JSON", () => json({ ok: true })],
    ["HTML", () => new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } })],
    ["WAV bytes", () => audio(WAV, "audio/wav")],
    ["non-mp3 bytes labelled mpeg", () => audio(WAV)],
    ["an empty body", () => audio(Buffer.alloc(0))],
  ])("treats %s as a lost result of billable work", async (_label, answer) => {
    const { fetchImpl } = transport(answer());
    const result = await createDeapiTtsAdapter({ fetchImpl }).synthesize("Hi", "Kokoro", CRED_A, "mp3", {});
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toMatchObject({ costStatus: "unknown", costSource: "accepted-job" });
  });

  it("caps the audio size", async () => {
    const { fetchImpl } = transport(audio(Buffer.concat([MP3, Buffer.alloc(1024)])));
    const result = await createDeapiTtsAdapter({ fetchImpl, maxAudioBytes: 512 }).synthesize("Hi", "Kokoro", CRED_A, "mp3", {});
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeDefined();
  });
});

describe("deAPI transcription wire contract", () => {
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
    const result = await createDeapiSttAdapter({ fetchImpl }).transcribe({ model: "WhisperLargeV3", formData: fd, credentials: CRED_A });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TRANSCRIPTION_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(headersOf(calls[0])).toEqual({ Authorization: `Bearer ${KEY_A}` });
    const sent = await sentForm(calls[0]);
    expect(sent.contentType).toMatch(/^multipart\/form-data; boundary=/);
    expect(sent.entries.map(([key]) => key)).toEqual(["model", "language", "prompt", "response_format", "temperature", "file"]);
    expect(sent.entries.slice(0, 5)).toEqual([["model", "WhisperLargeV3"], ["language", "en"], ["prompt", "names: Ana"], ["response_format", "json"], ["temperature", "0.2"]]);
    const file = sent.entries[5][1];
    expect(file.name).toBe("voice _memo_.ogg");
    expect(file.type).toBe("audio/ogg");
    expect(Buffer.from(await file.arrayBuffer()).toString()).toBe("OggSaudio");
    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual({ text: "hello world" });
    expect(result.accounting).toMatchObject({ modality: "stt", cost: null, costStatus: "unknown" });
  });

  it("sends only model and file when nothing else is named, with the source default file name", async () => {
    const { fetchImpl, calls } = transport(json({ text: "x" }));
    const nameless = new Blob([Buffer.from("abc")]);
    const fd = { get: (name) => (name === "file" ? nameless : null), getAll: () => [] };
    await createDeapiSttAdapter({ fetchImpl }).transcribe({ model: "WhisperLargeV3Ct2", formData: fd, credentials: CRED_B });
    const sent = await sentForm(calls[0]);
    expect(sent.entries.map(([key]) => key)).toEqual(["model", "file"]);
    expect(sent.entries[1][1].name).toBe("audio.wav");
    expect(sent.entries[1][1].type).toBe("application/octet-stream");
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${KEY_B}`);
    expect(deapiUploadFileName({ name: "a\r\nb.mp3" })).toBe("a__b.mp3");
  });

  it("returns verbose_json with word timestamps from the CT2 model and records audio seconds and usage", async () => {
    const verbose = { text: "hi", duration: 2.5, words: [{ word: "hi", start: 0, end: 0.4 }], usage: { type: "duration", seconds: 3 } };
    const { fetchImpl, calls } = transport(json(verbose));
    const fd = form([["response_format", "verbose_json"], ["timestamp_granularities[]", "word"], ["timestamp_granularities", "segment,word"]]);
    const result = await createDeapiSttAdapter({ fetchImpl }).transcribe({ model: "WhisperLargeV3Ct2", formData: fd, credentials: CRED_A });
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
    const adapter = createDeapiSttAdapter({ fetchImpl });
    const fromText = await adapter.transcribe({ model: "WhisperLargeV3", formData: form([["response_format", "text"]]), credentials: CRED_A });
    const fromJson = await adapter.transcribe({ model: "WhisperLargeV3", formData: form([["response_format", "text"]]), credentials: CRED_A });
    expect(fromText.response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await fromText.response.text()).toBe("plain words");
    expect(await fromJson.response.text()).toBe("json words");
  });

  it.each([
    ["a translation", "WhisperLargeV3", [], { kind: "translation" }],
    ["an unknown model", "whisper-1", [], {}],
    ["srt output", "WhisperLargeV3", [["response_format", "srt"]], {}],
    ["diarized_json on the non-CT2 model", "WhisperLargeV3", [["response_format", "diarized_json"]], {}],
    ["word timestamps on the non-CT2 model", "WhisperLargeV3", [["response_format", "verbose_json"], ["timestamp_granularities[]", "word"]], {}],
    ["granularities without verbose_json", "WhisperLargeV3Ct2", [["timestamp_granularities[]", "segment"]], {}],
    ["an unknown granularity", "WhisperLargeV3Ct2", [["response_format", "verbose_json"], ["timestamp_granularities[]", "char"]], {}],
    ["streaming", "WhisperLargeV3", [["stream", "true"]], {}],
    ["a temperature above 1", "WhisperLargeV3", [["temperature", "1.5"]], {}],
    ["a non-numeric temperature", "WhisperLargeV3", [["temperature", "warm"]], {}],
  ])("refuses %s before submit", async (_label, model, entries, extra) => {
    const { fetchImpl } = transport();
    const result = await createDeapiSttAdapter({ fetchImpl }).transcribe({ model, formData: form(entries), credentials: CRED_A, ...extra });
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a missing, url-only, empty or oversized file and a missing key before submit", async () => {
    const { fetchImpl } = transport();
    const adapter = createDeapiSttAdapter({ fetchImpl });
    const missing = await adapter.transcribe({ model: "WhisperLargeV3", formData: form([], null), credentials: CRED_A });
    const url = await adapter.transcribe({ model: "WhisperLargeV3", formData: form([["url", "https://example.com/a.mp3"]], null), credentials: CRED_A });
    const empty = await adapter.transcribe({ model: "WhisperLargeV3", formData: form([], new File([], "a.wav")), credentials: CRED_A });
    const huge = { name: "a.wav", size: 26 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) };
    const big = await adapter.transcribe({ model: "WhisperLargeV3", formData: { get: (n) => (n === "file" ? huge : null), getAll: () => [] }, credentials: CRED_A });
    const noKey = await adapter.transcribe({ model: "WhisperLargeV3", formData: form([]), credentials: {} });
    for (const result of [missing, url, empty, big]) expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(url.error.message ?? url.error).toBeDefined();
    expect(noKey).toMatchObject({ success: false, status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("deAPI transcription failures and malformed answers", () => {
  it("maps refusals without quoting deAPI", async () => {
    const { fetchImpl } = transport(leaky(401), leaky(402), leaky(429, { "retry-after": "5" }), leaky(502));
    const adapter = createDeapiSttAdapter({ fetchImpl });
    const call = () => adapter.transcribe({ model: "WhisperLargeV3", formData: form([]), credentials: CRED_A });
    const [auth, quota, limited, upstream] = [await call(), await call(), await call(), await call()];
    expect(auth).toMatchObject({ success: false, status: 401 });
    expect(quota).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    expect(limited).toMatchObject({ success: false, status: 429 });
    expect(upstream).toMatchObject({ success: false, status: 502 });
    expect(upstream.acceptedJob).toMatchObject({ modality: "stt", costStatus: "unknown", meta: { jobState: "submit-unknown" } });
    for (const result of [auth, quota, limited]) expect(result.acceptedJob).toBeUndefined();
    for (const result of [auth, quota, limited, upstream]) expectNoLeak(result);
  });

  it("reads a 200 error envelope as a refusal and a missing transcript as a lost result", async () => {
    const { fetchImpl } = transport(leaky(200), json({ segments: [] }), new Response("{not json", { status: 200, headers: { "content-type": "application/json" } }));
    const adapter = createDeapiSttAdapter({ fetchImpl });
    const call = () => adapter.transcribe({ model: "WhisperLargeV3", formData: form([]), credentials: CRED_A });
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
    const adapter = createDeapiSttAdapter({ fetchImpl });
    const html = await adapter.transcribe({ model: "WhisperLargeV3", formData: form([["response_format", "text"]]), credentials: CRED_A });
    const textForJson = await adapter.transcribe({ model: "WhisperLargeV3", formData: form([]), credentials: CRED_A });
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
    const adapter = createDeapiSttAdapter({ fetchImpl, timeoutMs: 25 });
    const redirect = await adapter.transcribe({ model: "WhisperLargeV3", formData: form([]), credentials: CRED_A });
    const unsent = await adapter.transcribe({ model: "WhisperLargeV3", formData: form([]), credentials: CRED_A, signal: before.signal });
    const timedOut = await adapter.transcribe({ model: "WhisperLargeV3", formData: form([]), credentials: CRED_A });
    const stalled = await adapter.transcribe({ model: "WhisperLargeV3", formData: form([]), credentials: CRED_A });
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
    const result = await createDeapiSttAdapter({ fetchImpl }).transcribe({ model: "WhisperLargeV3", formData: form([]), credentials: CRED_A, signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });
});
