// NanoGPT documented audio formats (#2034): pcm speech and srt/vtt
// transcription on the documented-format adapters, staged and unregistered.
// Closed mocks only: every request goes to an injected transport, an
// unexpected request fails the test, and every key is synthetic. Format
// evidence: OmniRoute c71f0065 audioSpeech.ts / audioTranscription.ts default
// branches forward any response_format; NanoGPT documents pcm for tts-1 and
// tts-1-hd (docs.nano-gpt.com/api-reference/endpoint/speech.md) and srt/vtt for
// whisper-1 (public GET /api/v1/audio-models?type=stt). Passing here says
// nothing about the live service.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-nanogpt-tts-stt/index.js";
import {
  NANOGPT_DOCUMENTED_STT_MODELS,
  NANOGPT_STT_MODELS,
  checkNanogptPcm,
  createNanogptDocumentedSttAdapter,
  createNanogptDocumentedTtsAdapter,
  createNanogptSttAdapter,
  createNanogptTtsAdapter,
  nanogptDocumentedSttAdapter,
  nanogptDocumentedTtsAdapter,
  resolveNanogptContainer,
  validSubtitles,
} from "../../open-sse/services/providerParity/native-nanogpt-tts-stt/index.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const SPEECH_URL = "https://nano-gpt.com/api/v1/audio/speech";
const TRANSCRIPTION_URL = "https://nano-gpt.com/api/v1/audio/transcriptions";
const KEY = "sk-nano-SYNTHETIC-fmt-0001";
const CRED = { apiKey: KEY, connectionId: "conn-fmt" };
const STAGE_DIR = "../../open-sse/services/providerParity/native-nanogpt-tts-stt/";
const REGISTRATION = JSON.parse(readFileSync(new URL(`${STAGE_DIR}registration.json`, import.meta.url), "utf8"));

/** 0.01 s of 24 kHz s16le mono: 240 frames, 480 bytes. */
const PCM = Buffer.from(Array.from({ length: 480 }, (_, i) => (i * 37) & 0xff));
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(200, 1)]);
const SRT = "1\n00:00:00,000 --> 00:00:01,500\nHello there.\n\n2\n00:00:01,500 --> 00:00:03,000\nSecond line\nwraps here.\n";
const VTT = "WEBVTT\n\nNOTE generated\n\n00:00.000 --> 00:01.500\nHello there.\n\ncue-2\n00:00:01.500 --> 00:00:03.000 align:start\nSecond line.\n";

const bytes = (body, type) => new Response(body, { status: 200, headers: type === null ? {} : { "content-type": type } });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const leaky = (status) => json({ error: { message: `upstream echo ${KEY} at /srv/app/index.js:44` } }, status);

function transport(...steps) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    const step = steps.shift();
    if (!step) throw new Error(`Unexpected request: ${url}`);
    const value = isFunction(step) ? await step(url, init) : step;
    if (value instanceof Error) throw value;
    return value;
  });
  return { fetchImpl, calls };
}

const tts = (fetchImpl) => createNanogptDocumentedTtsAdapter({ fetchImpl });
const stt = (fetchImpl) => createNanogptDocumentedSttAdapter({ fetchImpl });
const expectNoLeak = (result) => {
  const text = JSON.stringify(result);
  expect(text).not.toContain(KEY);
  expect(text).not.toContain("upstream echo");
  expect(text).not.toContain("/srv/app");
};
const expectLost = (result) => {
  expect(result).toMatchObject({ success: false, status: 502, acceptedJob: { costSource: "accepted-job", meta: { jobState: "accepted" } } });
  expect(result.local).toBeUndefined();
  expectNoLeak(result);
};

function form(entries) {
  const fd = new FormData();
  fd.append("file", new File([Buffer.from("RIFFfakeaudio")], "clip.wav", { type: "audio/wav" }));
  for (const [key, value] of entries) fd.append(key, value);
  return fd;
}

async function sentEntries(call) {
  const request = new Request("https://capture.invalid/", { method: "POST", body: call.init.body });
  return [...(await request.formData()).entries()].filter(([name]) => name !== "file");
}

describe("NanoGPT documented formats: staging and evidence", () => {
  it("registers the documented-format instances and keeps the original defaults", () => {
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(REGISTRATION.status).toBe("staged-unregistered");
    const changes = REGISTRATION.integrationPoints.map((point) => point.change).join("\n");
    expect(changes).toContain("nanogpt: nanogptDocumentedTtsAdapter");
    expect(changes).toContain("nanogptDocumentedSttAdapter.transcribe(");
    expect(nanogptDocumentedTtsAdapter.responseFormats).toContain("pcm");
    expect(nanogptDocumentedSttAdapter.responseFormats).toEqual(["json", "text", "verbose_json", "srt", "vtt"]);
    expect(staged.nanogptTtsAdapter.responseFormats).not.toContain("pcm");
    expect(staged.nanogptSttAdapter.responseFormats).toEqual(["json", "text", "verbose_json"]);
  });

  it("cites the pinned source and the vendor documents for each added and refused format", () => {
    const evidence = REGISTRATION.documentedFormats;
    expect(evidence.sources.omniroute).toMatch(/^c71f0065a7efe9230ec23b96a12253b050c4d7ad /);
    expect(evidence.sources.speechDocs).toContain("https://docs.nano-gpt.com/api-reference/endpoint/speech.md");
    expect(evidence.sources.speechDocs).toMatch(/pcm/);
    expect(evidence.sources.sttCatalog).toContain("https://nano-gpt.com/api/v1/audio-models?type=stt");
    expect(evidence.sources.sttCatalog).toMatch(/whisper-1 .*srt, vtt/);
    expect(Object.keys(evidence.added.tts)).toEqual(["pcm"]);
    expect(Object.keys(evidence.added.stt)).toEqual(["srt", "vtt"]);
    expect(evidence.unsupported.diarized_json).toMatch(/Elevenlabs-STT/);
  });

  it("adds srt and vtt for whisper-1 only and keeps the model ids", () => {
    expect(NANOGPT_DOCUMENTED_STT_MODELS.map((m) => m.id)).toEqual(NANOGPT_STT_MODELS.map((m) => m.id));
    expect(NANOGPT_DOCUMENTED_STT_MODELS[0].responseFormats).toEqual(["json", "text", "verbose_json", "srt", "vtt"]);
    expect(NANOGPT_DOCUMENTED_STT_MODELS[1].responseFormats).toEqual(NANOGPT_STT_MODELS[1].responseFormats);
  });
});

describe("NanoGPT documented speech: pcm", () => {
  it("sends response_format pcm on the source wire and returns the raw samples with their layout", async () => {
    const { fetchImpl, calls } = transport(bytes(PCM, "audio/pcm"));
    const result = await tts(fetchImpl).synthesize("Hello", "tts-1-hd/nova", CRED, "mp3", { response_format: "PCM", speed: 1.25 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(SPEECH_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY}` });
    expect(JSON.parse(calls[0].init.body)).toEqual({ model: "tts-1-hd", input: "Hello", voice: "nova", response_format: "pcm", speed: 1.25 });
    expect(result.format).toBe("pcm");
    expect(Buffer.from(result.base64, "base64").equals(PCM)).toBe(true);
    expect(result.pcm).toEqual({ encoding: "s16le", bitsPerSample: 16, sampleRate: 24000, channels: 1, frames: 240, durationSeconds: 0.01, source: "openai-pcm-default" });
    expect(result.accounting.meta).toMatchObject({ model: "tts-1-hd", pcm: result.pcm });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("takes pcm from the gateway query format and accepts an untyped or octet-stream answer", async () => {
    const { fetchImpl, calls } = transport(bytes(PCM, null), bytes(PCM, "application/octet-stream"));
    const adapter = tts(fetchImpl);
    const fromQuery = await adapter.synthesize("Hi", "tts-1", CRED, "json", { requestedResponseFormat: "pcm" });
    const octet = await adapter.synthesize("Hi", "tts-1", CRED, "pcm", {});
    expect(JSON.parse(calls[0].init.body).response_format).toBe("pcm");
    expect(JSON.parse(calls[1].init.body).response_format).toBe("pcm");
    expect(fromQuery.format).toBe("pcm");
    expect(octet.format).toBe("pcm");
  });

  it("reads rate and channels from an audio/pcm type and aligns on whole frames", async () => {
    const { fetchImpl } = transport(bytes(PCM, "audio/pcm; rate=16000; channels=2"));
    const result = await tts(fetchImpl).synthesize("Hi", "tts-1", CRED, "pcm", {});
    expect(result.pcm).toMatchObject({ sampleRate: 16000, channels: 2, frames: 120, durationSeconds: 0.0075, source: "content-type" });
  });

  it("still verifies the other containers and resolves pcm only when allowed", async () => {
    const { fetchImpl } = transport(bytes(WAV, "audio/wav"));
    const result = await tts(fetchImpl).synthesize("Hi", "tts-1", CRED, "wav", {});
    expect(result.format).toBe("wav");
    expect(resolveNanogptContainer("pcm", "mp3", { allowPcm: true })).toBe("pcm");
    expect(() => resolveNanogptContainer("pcm", "wav", { allowPcm: true })).toThrow(/twice/);
    expect(() => resolveNanogptContainer("pcm", "mp3")).toThrow(/pcm/);
  });

  it.each([
    ["an unknown container", { response_format: "m4a" }, "mp3"],
    ["pcm conflicting with a named gateway format", { response_format: "pcm" }, "flac"],
    ["an unknown model", { response_format: "pcm" }, "mp3", "gpt-4o-mini-tts"],
    ["streaming pcm", { response_format: "pcm", stream: true }, "mp3"],
  ])("refuses %s before submit", async (_label, options, gatewayFormat, model = "tts-1") => {
    const { fetchImpl } = transport();
    const result = await tts(fetchImpl).synthesize("Hi", model, CRED, gatewayFormat, options);
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps refusing pcm on the original adapter", async () => {
    const { fetchImpl } = transport();
    const result = await createNanogptTtsAdapter({ fetchImpl }).synthesize("Hi", "tts-1", CRED, "pcm", {});
    expect(result).toMatchObject({ status: 400, local: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["an odd byte count", () => bytes(PCM.subarray(0, 479), "audio/pcm")],
    ["a partial stereo frame", () => bytes(PCM.subarray(0, 478), "audio/pcm; channels=2")],
    ["a wav container under audio/pcm", () => bytes(WAV, "audio/pcm")],
    ["mp3 bytes with an ID3 tag", () => bytes(Buffer.concat([Buffer.from("ID3"), Buffer.alloc(201)]), "application/octet-stream")],
    ["Ogg bytes", () => bytes(Buffer.concat([Buffer.from("OggS"), Buffer.alloc(200)]), null)],
    ["a typed mp3 answer", () => bytes(PCM, "audio/mpeg")],
    ["a JSON document as octet-stream", () => bytes(Buffer.from(JSON.stringify({ text: "nope", n: 1 })), "application/octet-stream")],
    ["an HTML page as octet-stream", () => bytes(Buffer.from("<!doctype html><html><body>hi</body></html>"), "application/octet-stream")],
    ["a malformed rate", () => bytes(PCM, "audio/pcm; rate=abc")],
    ["a zero channel count", () => bytes(PCM, "audio/pcm; channels=0")],
    ["an empty body", () => bytes(Buffer.alloc(0), "audio/pcm")],
    ["a JSON non-envelope", () => json({ audio: "AAAA" })],
  ])("records %s as a lost, possibly billed result", async (_label, answer) => {
    const { fetchImpl } = transport(answer());
    const result = await tts(fetchImpl).synthesize("Hi", "tts-1", CRED, "pcm", {});
    expectLost(result);
  });

  it("treats a JSON error envelope as a refusal without quoting it", async () => {
    const { fetchImpl } = transport(json({ error: { message: `unsupported_format ${KEY}`, type: "invalid_request_error" } }));
    const result = await tts(fetchImpl).synthesize("Hi", "tts-1", CRED, "pcm", {});
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it("maps refusals and server failures with redaction and no replay", async () => {
    const { fetchImpl } = transport(leaky(401), leaky(500), leaky(400));
    const adapter = tts(fetchImpl);
    const denied = await adapter.synthesize("Hi", "tts-1", CRED, "pcm", {});
    const failed = await adapter.synthesize("Hi", "tts-1", CRED, "pcm", {});
    const refused = await adapter.synthesize("Hi", "tts-1", CRED, "pcm", {});
    expect(denied).toMatchObject({ success: false, status: 401 });
    expect(denied.acceptedJob).toBeUndefined();
    expect(failed).toMatchObject({ success: false, status: 502, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(refused).toMatchObject({ success: false, status: 400 });
    expect(refused.acceptedJob).toBeUndefined();
    for (const result of [denied, failed, refused]) expectNoLeak(result);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("sends nothing when the caller already left, and needs a key", async () => {
    const { fetchImpl } = transport();
    const controller = new AbortController();
    controller.abort();
    const aborted = await tts(fetchImpl).synthesize("Hi", "tts-1", CRED, "pcm", { signal: controller.signal });
    const keyless = await tts(fetchImpl).synthesize("Hi", "tts-1", {}, "pcm", {});
    expect(aborted).toMatchObject({ success: false, status: 499, local: true });
    expect(keyless).toMatchObject({ success: false, status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("checks pcm bytes directly", () => {
    expect(checkNanogptPcm(Buffer.from([1, 2, 3, 4]), "audio/pcm").pcm).toMatchObject({ frames: 2 });
    expect(checkNanogptPcm(Buffer.from([1, 2, 3]), "audio/pcm").error).toMatch(/whole sample frame/);
    expect(checkNanogptPcm(Buffer.from("[music] hi"), "")).toHaveProperty("pcm");
  });
});

describe("NanoGPT documented transcription: srt and vtt", () => {
  it.each([
    ["srt", SRT, "application/x-subrip", /^application\/x-subrip/],
    ["vtt", VTT, "text/vtt", /^text\/vtt/],
  ])("sends response_format %s on the source wire and returns the subtitles", async (format, body, upstreamType, returnedType) => {
    const { fetchImpl, calls } = transport(bytes(body, upstreamType));
    const result = await stt(fetchImpl).transcribe({ model: "whisper-1", formData: form([["language", "en"], ["response_format", format.toUpperCase()]]), credentials: CRED });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TRANSCRIPTION_URL);
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.headers).toEqual({ Authorization: `Bearer ${KEY}` });
    expect(await sentEntries(calls[0])).toEqual([["model", "whisper-1"], ["language", "en"], ["response_format", format]]);
    expect(result).toMatchObject({ success: true, usageValue: undefined, nativeUnits: {} });
    expect(result.accounting.meta).toEqual({ model: "whisper-1", responseFormat: format });
    expect(result.response.headers.get("content-type")).toMatch(returnedType);
    expect(await result.response.text()).toBe(body);
    expect(result.acceptedJob).toBeUndefined();
  });

  it("accepts subtitles as text/plain or untyped, with CRLF, a BOM, or no cues", async () => {
    const crlf = `﻿${SRT.replace(/\n/g, "\r\n")}`;
    const { fetchImpl } = transport(bytes(crlf, "text/plain; charset=utf-8"), bytes("WEBVTT\n", null), bytes("", "text/plain"));
    const adapter = stt(fetchImpl);
    const srt = await adapter.transcribe({ model: "whisper-1", formData: form([["response_format", "srt"]]), credentials: CRED });
    const vtt = await adapter.transcribe({ model: "whisper-1", formData: form([["response_format", "vtt"]]), credentials: CRED });
    const silent = await adapter.transcribe({ model: "whisper-1", formData: form([["response_format", "srt"]]), credentials: CRED });
    // The bytes pass through unchanged; Response#text() drops the BOM when decoding.
    expect(Buffer.from(await srt.response.arrayBuffer()).equals(Buffer.from(crlf))).toBe(true);
    expect(vtt.success).toBe(true);
    expect(silent.success).toBe(true);
  });

  it.each([
    ["srt on gpt-4o-transcription", "gpt-4o-transcription", [["response_format", "srt"]]],
    ["vtt on gpt-4o-transcription", "gpt-4o-transcription", [["response_format", "vtt"]]],
    ["verbose_json on gpt-4o-transcription", "gpt-4o-transcription", [["response_format", "verbose_json"]]],
    ["diarized_json on whisper-1", "whisper-1", [["response_format", "diarized_json"]]],
    ["diarized_json on gpt-4o-transcription", "gpt-4o-transcription", [["response_format", "diarized_json"]]],
    ["timestamp granularities with srt", "whisper-1", [["response_format", "srt"], ["timestamp_granularities[]", "word"]]],
    ["an unknown format", "whisper-1", [["response_format", "ass"]]],
  ])("refuses %s before submit", async (_label, model, entries) => {
    const { fetchImpl } = transport();
    const result = await stt(fetchImpl).transcribe({ model, formData: form(entries), credentials: CRED });
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps refusing srt and vtt on the original adapter", async () => {
    const { fetchImpl } = transport();
    const adapter = createNanogptSttAdapter({ fetchImpl });
    for (const format of ["srt", "vtt"]) {
      expect(await adapter.transcribe({ model: "whisper-1", formData: form([["response_format", format]]), credentials: CRED })).toMatchObject({ status: 400, local: true });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["srt", "an srt cue without an index", "00:00:00,000 --> 00:00:01,000\nHi\n", "text/plain"],
    ["srt", "an srt cue ending before it starts", "1\n00:00:02,000 --> 00:00:01,000\nHi\n", "text/plain"],
    ["srt", "an srt cue with vtt timing", "1\n00:00:00.000 --> 00:00:01.000\nHi\n", "text/plain"],
    ["srt", "a plain transcript instead of srt", "just words", "text/plain"],
    ["srt", "an html page typed as text", "<!doctype html><p>busy</p>", "text/plain"],
    ["srt", "an html page", "<html></html>", "text/html"],
    ["srt", "srt typed as csv", SRT, "text/csv"],
    ["vtt", "vtt without its header", "00:00.000 --> 00:01.000\nHi\n", "text/vtt"],
    ["vtt", "vtt with srt timing", "WEBVTT\n\n00:00:00,000 --> 00:00:01,000\nHi\n", "text/vtt"],
    ["vtt", "vtt with an identifier and no timing", "WEBVTT\n\ncue-1\nHi\n", "text/vtt"],
    ["vtt", "srt sent for vtt", SRT, "text/plain"],
    ["vtt", "a JSON transcript", JSON.stringify({ text: "hi" }), "application/json"],
  ])("records %s (%s) as a lost, possibly billed result", async (format, _label, body, type) => {
    const { fetchImpl } = transport(bytes(body, type));
    const result = await stt(fetchImpl).transcribe({ model: "whisper-1", formData: form([["response_format", format]]), credentials: CRED });
    expectLost(result);
  });

  it("records an oversized subtitle answer as lost", async () => {
    const { fetchImpl } = transport(bytes(SRT.repeat(10), "text/plain"));
    const result = await createNanogptDocumentedSttAdapter({ fetchImpl, maxTranscriptBytes: 64 }).transcribe({ model: "whisper-1", formData: form([["response_format", "srt"]]), credentials: CRED });
    expectLost(result);
  });

  it("treats a JSON error envelope as a refusal without quoting it", async () => {
    const { fetchImpl } = transport(json({ error: { message: `bad format ${KEY}` } }));
    const result = await stt(fetchImpl).transcribe({ model: "whisper-1", formData: form([["response_format", "vtt"]]), credentials: CRED });
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it("maps refusals and server failures with redaction and no replay", async () => {
    const { fetchImpl } = transport(leaky(402), leaky(502), leaky(429));
    const adapter = stt(fetchImpl);
    const call = () => adapter.transcribe({ model: "whisper-1", formData: form([["response_format", "srt"]]), credentials: CRED });
    const broke = await call();
    const failed = await call();
    const limited = await call();
    expect(broke).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    expect(failed).toMatchObject({ success: false, status: 502, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(limited).toMatchObject({ success: false, status: 429 });
    for (const result of [broke, failed, limited]) expectNoLeak(result);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("aborts after send as a possibly billed request, and before send with nothing sent", async () => {
    const before = new AbortController();
    before.abort();
    const { fetchImpl: idle } = transport();
    const unsent = await stt(idle).transcribe({ model: "whisper-1", formData: form([["response_format", "vtt"]]), credentials: CRED, signal: before.signal });
    expect(unsent).toMatchObject({ success: false, status: 499, local: true });
    expect(idle).not.toHaveBeenCalled();

    const after = new AbortController();
    const { fetchImpl } = transport(() => {
      after.abort();
      return new Promise(() => {});
    });
    const sent = await stt(fetchImpl).transcribe({ model: "whisper-1", formData: form([["response_format", "vtt"]]), credentials: CRED, signal: after.signal });
    expect(sent).toMatchObject({ success: false, status: 499, acceptedJob: { meta: { jobState: "submit-unknown" } } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("checks subtitle syntax directly", () => {
    expect(validSubtitles("srt", SRT)).toBe(true);
    expect(validSubtitles("vtt", VTT)).toBe(true);
    expect(validSubtitles("vtt", "WEBVTT - title\n\n01:00:00.000 --> 01:00:01.000 line:0\nHi")).toBe(true);
    expect(validSubtitles("vtt", "WEBVTTX\n")).toBe(false);
    expect(validSubtitles("srt", "1\n00:00:00,000 -> 00:00:01,000\nHi")).toBe(false);
    expect(validSubtitles("json", "{}")).toBe(false);
  });
});
