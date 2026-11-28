// HuggingFace native speech (TTS) adapter, staged and unregistered (#2034).
// Closed mocks only: every request goes to an injected transport (or a stubbed
// global fetch for the dormant local handler), an unexpected request fails the
// test, and every key is synthetic. Wire shapes follow OmniRoute c71f0065
// (audioSpeech.ts handleHuggingFaceTtsSpeech, audioRegistry.ts `huggingface`
// speech row, audio-speech-handler.test.ts, huggingface-audio-router-host.test.ts).
// Passing here says nothing about the live service.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-huggingface-tts/index.js";
import {
  HUGGINGFACE_TTS_CONFIG,
  HUGGINGFACE_TTS_MODELS,
  HUGGINGFACE_TTS_MODELS_FETCHER,
  HUGGINGFACE_TTS_PROVIDER_ADDITIONS,
  buildHuggingFaceSpeechRequest,
  createHuggingFaceTtsAdapter,
  huggingfaceTtsAdapter,
  huggingfaceTtsSuggestions,
  sniffAudioContainer,
} from "../../open-sse/services/providerParity/native-huggingface-tts/index.js";
import { TTS_ADAPTERS } from "../../open-sse/handlers/ttsProviders/index.js";
import { FORMAT_HANDLERS } from "../../open-sse/handlers/ttsProviders/genericFormats.js";
import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";
import huggingfaceRegistry from "../../open-sse/providers/registry/huggingface.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const BASE = "https://router.huggingface.co/hf-inference/models";
const KOKORO = "hexgrad/Kokoro-82M";
const KOKORO_URL = `${BASE}/${KOKORO}`;
const KEY_A = "hf_SYNTHETICaaaaaaaaaaaaaaaaaaaaaaaaa01";
const KEY_B = "hf_SYNTHETICbbbbbbbbbbbbbbbbbbbbbbbbb02";
const CRED_A = { apiKey: KEY_A, connectionId: "conn-a" };
const CRED_B = { apiKey: KEY_B, connectionId: "conn-b" };
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(200, 1)]);
const FLAC = Buffer.concat([Buffer.from("fLaC"), Buffer.alloc(200, 2)]);
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 7)]);
const MP3_FRAME = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(100, 1)]);
const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(200, 3)]);
const STAGE_DIR = "../../open-sse/services/providerParity/native-huggingface-tts/";
const REGISTRATION = JSON.parse(readFileSync(new URL(`${STAGE_DIR}registration.json`, import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const audio = (bytes = WAV, type = "audio/wav") => new Response(bytes, { status: 200, headers: type ? { "content-type": type } : {} });
const leaky = (status, headers = {}) => json({ error: `upstream echo ${KEY_A} at /srv/app/index.js:44`, estimated_time: 20 }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });
/** A fetch that never settles and ignores its signal. */
const hang = () => new Promise(() => {});
/** A 200 whose body never finishes. */
const stalledBody = () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(WAV.subarray(0, 16))); } }), { status: 200, headers: { "content-type": "audio/wav" } });

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
const synth = (adapter, options = {}, model = KOKORO, cred = CRED_A) => adapter.synthesize("Hello there.", model, cred, "mp3", options);

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Staging block: the only assertions about registration state ──────────
describe("HuggingFace tts staging state (promote at registration)", () => {
  it("is not registered: no TTS adapter under huggingface or hf, tts hidden, no ttsConfig on the registry entry", () => {
    expect(Object.hasOwn(TTS_ADAPTERS, "huggingface")).toBe(false);
    expect(Object.hasOwn(TTS_ADAPTERS, "hf")).toBe(false);
    expect(huggingfaceRegistry.ttsConfig).toBeUndefined();
    expect(huggingfaceRegistry.hiddenKinds).toContain("tts");
    expect(huggingfaceRegistry.serviceKinds).not.toContain("tts");
    expect(huggingfaceRegistry.models.some((m) => m.kind === "tts")).toBe(false);
    expect(huggingfaceRegistry.modelsFetchers?.tts).toBeUndefined();
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });

  it("documents the dormant local format handler: same body and auth, but an encoded path", async () => {
    // FORMAT_HANDLERS["huggingface-tts"] exists but is unreachable without a ttsConfig;
    // it encodes the Hub id's slash, which is not the source wire path.
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return audio(WAV);
    }));
    const result = await FORMAT_HANDLERS["huggingface-tts"]({ baseUrl: BASE, apiKey: KEY_A, text: "Hi", modelId: KOKORO });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/hexgrad%2FKokoro-82M`);
    expect(calls[0].url).not.toBe(KOKORO_URL);
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(calls[0].init.body).toBe(JSON.stringify({ inputs: "Hi" }));
    expect(result).toEqual({ base64: WAV.toString("base64"), format: "wav" });
  });
});

describe("HuggingFace staged metadata", () => {
  it("pins the source registry fields and models", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryFields.tts).toEqual({
      id: "huggingface",
      baseUrl: BASE,
      authType: "apikey",
      authHeader: "bearer",
      format: "huggingface-tts",
      models: [
        { id: "canopylabs/orpheus-3b-0.1-ft", name: "Orpheus 3B" },
        { id: "ResembleAI/chatterbox", name: "Chatterbox" },
        { id: "hexgrad/Kokoro-82M", name: "Kokoro TTS" },
      ],
    });
    expect(HUGGINGFACE_TTS_MODELS.map(({ id, name }) => ({ id, name }))).toEqual(REGISTRATION.source.registryFields.tts.models);
    expect(HUGGINGFACE_TTS_MODELS.every((m) => m.kind === "tts")).toBe(true);
    expect(REGISTRATION.models.tts).toEqual(REGISTRATION.source.registryFields.tts.models);
    expect(REGISTRATION.provider).toMatchObject({ canonicalId: "huggingface", aliases: ["hf"], authModes: ["apikey"], addServiceKinds: ["tts"], removeHiddenKinds: ["tts"] });
  });

  it("matches the existing stt row to the source stt row (present, not re-staged)", () => {
    expect(huggingfaceRegistry.sttConfig).toEqual(REGISTRATION.source.registryFields.stt && {
      baseUrl: REGISTRATION.source.registryFields.stt.baseUrl,
      authType: REGISTRATION.source.registryFields.stt.authType,
      authHeader: REGISTRATION.source.registryFields.stt.authHeader,
      format: REGISTRATION.source.registryFields.stt.format,
    });
  });

  it("stages a ttsConfig and additions that keep the existing provider identity and auth mode", () => {
    expect(HUGGINGFACE_TTS_CONFIG).toMatchObject({ baseUrl: BASE, authType: "apikey", authHeader: "bearer", format: "huggingface-tts" });
    expect(HUGGINGFACE_TTS_PROVIDER_ADDITIONS).toMatchObject({ id: "huggingface", aliases: ["hf"], authType: "apikey", addServiceKinds: ["tts"], removeHiddenKinds: ["tts"] });
    expect(huggingfaceRegistry.id).toBe(HUGGINGFACE_TTS_PROVIDER_ADDITIONS.id);
    expect(huggingfaceRegistry.aliases).toEqual([...HUGGINGFACE_TTS_PROVIDER_ADDITIONS.aliases]);
    expect(huggingfaceRegistry.authType).toBe(HUGGINGFACE_TTS_PROVIDER_ADDITIONS.authType);
  });

  it("exports every name registration.json lists", () => {
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(huggingfaceTtsAdapter.provider).toBe("huggingface");
    expect(huggingfaceTtsAdapter.responseFormats).toEqual(["json"]);
  });
});

describe("HuggingFace tts dynamic discovery", () => {
  it("stages a Hub fetcher on the hf-inference text-to-speech pipeline", () => {
    const url = new URL(HUGGINGFACE_TTS_MODELS_FETCHER.url);
    expect(url.origin).toBe("https://huggingface.co");
    expect(url.pathname).toBe("/api/models");
    expect(Object.fromEntries(url.searchParams)).toEqual({ inference_provider: "hf-inference", pipeline_tag: "text-to-speech", limit: "30" });
    expect(HUGGINGFACE_TTS_MODELS_FETCHER.type).toBe("huggingface-tts");
    // Same shape as the existing per-kind rows.
    expect(Object.keys(huggingfaceRegistry.modelsFetchers.stt).sort()).toEqual(Object.keys(HUGGINGFACE_TTS_MODELS_FETCHER).sort());
  });

  it("keeps only well-formed Hub ids, most downloaded first", () => {
    const suggestions = huggingfaceTtsSuggestions([
      { id: "facebook/mms-tts-eng", downloads: 10 },
      { id: KOKORO, downloads: 900, likes: 5 },
      { id: "../etc/passwd" },
      { id: "owner/name/voice" },
      { id: "a..b/c" },
      { id: "https://evil.invalid/x" },
      { id: 42 },
      null,
    ]);
    expect(suggestions).toEqual([{ id: KOKORO, name: KOKORO }, { id: "facebook/mms-tts-eng", name: "facebook/mms-tts-eng" }]);
    expect(huggingfaceTtsSuggestions({ error: "nope" })).toEqual([]);
  });
});

describe("HuggingFace speech wire contract", () => {
  it("posts exactly the source body to the unencoded Hub path with the Bearer key", async () => {
    const { fetchImpl, calls } = transport(audio(WAV));
    const result = await synth(createHuggingFaceTtsAdapter({ fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(KOKORO_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(headersOf(calls[0])).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(calls[0].init.body).toBe(JSON.stringify({ inputs: "Hello there." }));
    expect(result.format).toBe("wav");
    expect(Buffer.from(result.base64, "base64").equals(WAV)).toBe(true);
    expect(result.accounting).toMatchObject({ modality: "tts", cost: null, costStatus: "unknown", costSource: "unavailable", meta: { model: KOKORO } });
    expect(result.acceptedJob).toBeUndefined();
  });

  it.each([
    ["wav", WAV, "audio/wav"],
    ["flac", FLAC, "audio/flac"],
    ["mp3", MP3, "audio/mpeg"],
    ["mp3", MP3_FRAME, "application/octet-stream"],
    ["ogg", OGG, "audio/ogg"],
    ["flac", FLAC, null],
    ["flac", FLAC, "audio/wav"],
  ])("labels the answer %s by its bytes", async (format, bytes, type) => {
    const { fetchImpl } = transport(audio(bytes, type));
    const result = await synth(createHuggingFaceTtsAdapter({ fetchImpl }));
    expect(result.format).toBe(format);
    expect(Buffer.from(result.base64, "base64").equals(bytes)).toBe(true);
  });

  it("defaults an empty model to the first source model and sends other Hub ids as-is", async () => {
    const { fetchImpl, calls } = transport(audio(), audio());
    const adapter = createHuggingFaceTtsAdapter({ fetchImpl });
    await synth(adapter, { voice: "", speed: 1, requestedResponseFormat: "json" }, "");
    await synth(adapter, { response_format: "JSON" }, "facebook/mms-tts-eng");
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/canopylabs/orpheus-3b-0.1-ft`, `${BASE}/facebook/mms-tts-eng`]);
  });

  it("ignores any connection base URL and forwards the connection egress policy", async () => {
    const { fetchImpl, calls } = transport(audio());
    const proxied = { ...CRED_A, baseUrl: "https://evil.invalid", providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.invalid:8080" } };
    await synth(createHuggingFaceTtsAdapter({ fetchImpl }), {}, KOKORO, proxied);
    expect(calls[0].url).toBe(KOKORO_URL);
    expect(calls[0].proxyOptions).toBeTypeOf("object");
  });

  it("keeps each selected connection's key on its own request", async () => {
    const { fetchImpl, calls } = transport(audio(), audio());
    const adapter = createHuggingFaceTtsAdapter({ fetchImpl });
    await synth(adapter, {}, KOKORO, CRED_A);
    await synth(adapter, {}, KOKORO, CRED_B);
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${KEY_A}`);
    expect(headersOf(calls[1]).Authorization).toBe(`Bearer ${KEY_B}`);
  });

  it("uses an accessToken when the connection has no apiKey", async () => {
    const { fetchImpl, calls } = transport(audio());
    await synth(createHuggingFaceTtsAdapter({ fetchImpl }), {}, KOKORO, { accessToken: KEY_B });
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${KEY_B}`);
  });

  it.each([
    ["a named wav container", KOKORO, { response_format: "wav" }],
    ["a query-string mp3 container", KOKORO, { requestedResponseFormat: "mp3" }],
    ["sse streaming", KOKORO, { stream_format: "sse" }],
    ["stream: true", KOKORO, { stream: true }],
    ["a bare model name", "tts-1", {}],
    ["a model/voice suffix", `${KOKORO}/af_heart`, {}],
    ["a path traversal", "hexgrad/../admin", {}],
    ["a double slash", "hexgrad//Kokoro-82M", {}],
    ["an absolute URL", "https://evil.invalid/x", {}],
    ["an encoded slash", "hexgrad%2FKokoro-82M", {}],
    ["a query string", "hexgrad/Kokoro-82M?x=1", {}],
    ["a named voice", KOKORO, { voice: "alloy" }],
    ["a non-string voice", KOKORO, { voice: 3 }],
    ["a speed other than 1", KOKORO, { speed: 1.5 }],
    ["a non-numeric speed", KOKORO, { speed: "fast" }],
    ["instructions", KOKORO, { instructions: "whisper" }],
    ["a language hint", KOKORO, { language: "fr" }],
  ])("refuses %s before submit", async (_label, model, options) => {
    const { fetchImpl } = transport();
    const result = await synth(createHuggingFaceTtsAdapter({ fetchImpl }), options, model);
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(result.acceptedJob).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses empty input, an oversized request and a missing or unsafe key before submit", async () => {
    const { fetchImpl } = transport();
    const adapter = createHuggingFaceTtsAdapter({ fetchImpl });
    expect(() => buildHuggingFaceSpeechRequest(KOKORO, "x".repeat(300 * 1024))).toThrow(/too large/);
    expect(await adapter.synthesize("  ", KOKORO, CRED_A, "mp3", {})).toMatchObject({ success: false, status: 400, local: true });
    expect(await synth(adapter, {}, KOKORO, { apiKey: "" })).toMatchObject({ success: false, status: 401 });
    expect(await synth(adapter, {}, KOKORO, { apiKey: "a\r\nX-Evil: 1" })).toMatchObject({ success: false, status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("HuggingFace speech failures", () => {
  it.each([
    [401, 401],
    [403, 403],
    [400, 400],
    [404, 404],
    [422, 422],
  ])("maps HTTP %i to %i without quoting HuggingFace or accepting a job", async (status, expected) => {
    const { fetchImpl } = transport(leaky(status));
    const result = await synth(createHuggingFaceTtsAdapter({ fetchImpl }));
    expect(result).toMatchObject({ success: false, status: expected });
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it("marks 402 as quota exhausted on this connection only", async () => {
    const { fetchImpl } = transport(leaky(402));
    const result = await synth(createHuggingFaceTtsAdapter({ fetchImpl }));
    expect(result).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it("keeps a bounded Retry-After on 429 and on a 503 model-loading answer", async () => {
    const { fetchImpl } = transport(leaky(429, { "retry-after": "7" }), leaky(503, { "retry-after": "3" }));
    const adapter = createHuggingFaceTtsAdapter({ fetchImpl });
    const limited = await synth(adapter);
    const loading = await synth(adapter);
    expect(limited).toMatchObject({ success: false, status: 429 });
    expect(limited.resetsAtMs).toBeGreaterThan(Date.now());
    expect(loading).toMatchObject({ success: false, status: 503 });
    expect(loading.resetsAtMs).toBeGreaterThan(Date.now());
    expect(limited.acceptedJob).toBeUndefined();
    // No published HuggingFace contract says a 503 did no billable work, so it is
    // kept as an unknown-cost job (see internal/docs/port-reports/native-audio-503-contract.md).
    expect(loading.acceptedJob).toMatchObject({ modality: "tts", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
    expectNoLeak(limited);
    expectNoLeak(loading);
  });

  it("treats other 5xx as an uncertain, never-replayed job with unknown cost", async () => {
    const { fetchImpl, calls } = transport(leaky(500));
    const result = await synth(createHuggingFaceTtsAdapter({ fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toMatchObject({ modality: "tts", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
    expectNoLeak(result);
  });

  it("refuses a redirect without following it or resending the key", async () => {
    const redirect = new Response(null, { status: 307, headers: { location: "https://evil.invalid/steal" } });
    const { fetchImpl, calls } = transport(redirect);
    const result = await synth(createHuggingFaceTtsAdapter({ fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeDefined();
  });

  it("distinguishes a provably unsent connect failure from a failure after send", async () => {
    const { fetchImpl, calls } = transport(transportError("ENOTFOUND"), transportError("ECONNRESET"));
    const adapter = createHuggingFaceTtsAdapter({ fetchImpl });
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
    const result = await synth(createHuggingFaceTtsAdapter({ fetchImpl }), { signal: controller.signal });
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
    const result = await synth(createHuggingFaceTtsAdapter({ fetchImpl }), { signal: controller.signal });
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
    const result = await synth(createHuggingFaceTtsAdapter({ fetchImpl, timeoutMs: 20 }));
    expect(calls).toHaveLength(1);
    expect(seenSignal.aborted).toBe(true);
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob).toBeDefined();
  });

  it("bounds a stalled audio body by the same deadline", async () => {
    const { fetchImpl } = transport(stalledBody());
    const result = await synth(createHuggingFaceTtsAdapter({ fetchImpl, timeoutMs: 30 }));
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("records a caller abort during the body read as accepted work", async () => {
    const controller = new AbortController();
    const { fetchImpl } = transport(() => {
      setTimeout(() => controller.abort(), 5);
      return stalledBody();
    });
    const result = await synth(createHuggingFaceTtsAdapter({ fetchImpl }), { signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });
});

describe("HuggingFace speech malformed or unsafe answers", () => {
  it("reads a 200 JSON error envelope as a refusal without quoting it", async () => {
    const { fetchImpl } = transport(leaky(200));
    const result = await synth(createHuggingFaceTtsAdapter({ fetchImpl }));
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it.each([
    ["JSON without an error", () => json({ audio: WAV.toString("base64") })],
    ["invalid JSON", () => new Response(`{"x": ${KEY_A}`, { status: 200, headers: { "content-type": "application/json" } })],
    ["an oversized JSON body", () => json({ pad: "x".repeat(32 * 1024) })],
    ["HTML", () => new Response(`<html>${KEY_A}</html>`, { status: 200, headers: { "content-type": "text/html" } })],
    ["plain text", () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } })],
    ["an empty audio body", () => audio(Buffer.alloc(0))],
    ["unrecognised bytes", () => audio(Buffer.from(`not audio ${KEY_A}`), "application/octet-stream")],
    ["a truncated RIFF header", () => audio(Buffer.from("RIFF"))],
    ["a PNG labelled audio", () => audio(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))],
  ])("treats %s as a lost result of billable work", async (_label, answer) => {
    const { fetchImpl, calls } = transport(answer());
    const result = await synth(createHuggingFaceTtsAdapter({ fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toMatchObject({ costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "accepted" } });
    expectNoLeak(result);
  });

  it("caps the audio size", async () => {
    const { fetchImpl } = transport(audio(Buffer.concat([WAV, Buffer.alloc(4096)])));
    const result = await synth(createHuggingFaceTtsAdapter({ fetchImpl, maxAudioBytes: 512 }));
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeDefined();
  });

  it("does not read response headers as a usage receipt", async () => {
    const { fetchImpl } = transport(new Response(WAV, { status: 200, headers: { "content-type": "audio/wav", "x-compute-time": "9.9", "x-cost-usd": "99" } }));
    const result = await synth(createHuggingFaceTtsAdapter({ fetchImpl }));
    expect(result.accounting).toMatchObject({ cost: null, costStatus: "unknown" });
  });

  it("sniffs containers strictly", () => {
    expect(sniffAudioContainer(WAV)).toBe("wav");
    expect(sniffAudioContainer(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("AVI "), Buffer.alloc(8)]))).toBeNull();
    expect(sniffAudioContainer(Buffer.from([0xff, 0xf1, 0x50, 0x80]))).toBeNull(); // AAC ADTS, not layer III
    expect(sniffAudioContainer(Buffer.alloc(2))).toBeNull();
  });
});

describe("HuggingFace speech through handleTtsCore (test-local wiring)", () => {
  // Wires the adapter into TTS_ADAPTERS only for the duration of this test to
  // check the core contract (usage merge, json wrapper, binary body); the
  // registration state itself is asserted only in the staging block above.
  it("returns the model's audio with character usage, or the json wrapper, and keeps refusals local", async () => {
    const { fetchImpl } = transport(audio(FLAC, "audio/flac"), audio(WAV));
    const adapter = createHuggingFaceTtsAdapter({ fetchImpl });
    const key = "huggingface-test-wiring";
    TTS_ADAPTERS[key] = { adapter };
    try {
      const binary = await handleTtsCore({ provider: key, model: KOKORO, input: " Hé llo ", credentials: CRED_A });
      expect(binary.success).toBe(true);
      expect(binary.response.headers.get("content-type")).toBe("audio/flac");
      expect(Buffer.from(await binary.response.arrayBuffer()).equals(FLAC)).toBe(true);
      expect(binary.accounting).toMatchObject({ costStatus: "unknown", nativeUnits: { characters: 6 } });

      const wrapped = await handleTtsCore({ provider: key, model: KOKORO, input: "Hi", credentials: CRED_A, responseFormat: "json", requestedResponseFormat: "json" });
      expect(await wrapped.response.json()).toEqual({ audio: WAV.toString("base64"), format: "wav" });

      const refused = await handleTtsCore({ provider: key, model: KOKORO, input: "Hi", credentials: CRED_A, voice: "alloy" });
      expect(refused).toMatchObject({ success: false, status: 400, local: true });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      delete TTS_ADAPTERS[key];
    }
  });
});
