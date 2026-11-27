// OpenRouter native transcription (STT) adapter, staged and unregistered
// (#2034). Closed mocks only: every request goes to an injected transport, an
// unexpected request fails the test, and every key is synthetic. Wire shapes
// follow OmniRoute c71f0065 (openrouterTranscription.ts
// handleOpenRouterTranscription and resolveOpenRouterAudioFormat,
// audioRegistry.ts `openrouter` transcription row,
// audio-transcription-opus-filename.test.ts). Passing here says nothing about
// the live service.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-openrouter-stt/index.js";
import {
  OPENROUTER_STT_CONFIG,
  OPENROUTER_STT_MODELS,
  createOpenRouterSttAdapter,
  openrouterSttAdapter,
  resolveOpenRouterAudioFormat,
  sniffOpenRouterAudioFormat,
} from "../../open-sse/services/providerParity/native-openrouter-stt/index.js";
import { supportsSttTranslation } from "../../open-sse/handlers/sttCore.js";
import openrouterRegistry from "../../open-sse/providers/registry/openrouter.js";
import { resolveCredentialProxyOptions } from "../../open-sse/services/oauthCredentialManager.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const TRANSCRIPTION_URL = "https://openrouter.ai/api/v1/audio/transcriptions";
const KEY_A = "sk-or-v1-SYNTHETIC-a-0001";
const KEY_B = "sk-or-v1-SYNTHETIC-b-0002";
const CRED_A = { apiKey: KEY_A, connectionId: "conn-a" };
const CRED_B = { apiKey: KEY_B, connectionId: "conn-b" };
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(32, 1)]);
const MODEL = "openai/whisper-1";
const REGISTRATION = JSON.parse(readFileSync(new URL("../../open-sse/services/providerParity/native-openrouter-stt/registration.json", import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const leaky = (status, headers = {}) => json({ error: { message: `upstream echo ${KEY_A} at /srv/app/index.js:44` } }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });
/** A fetch that never settles and ignores its signal. */
const hang = () => new Promise(() => {});
/** A 200 whose body never finishes. */
const stalledBody = () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{\"text\":")); } }), { status: 200, headers: { "content-type": "application/json" } });

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

const bodyOf = (call) => JSON.parse(call.init.body);
const expectNoLeak = (result) => {
  const text = JSON.stringify(result);
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
  expect(text).not.toContain("/srv/app");
};

function form(entries, file = new File([WAV], "clip.wav", { type: "audio/wav" })) {
  const fd = new FormData();
  if (file) fd.append("file", file);
  for (const [key, value] of entries) fd.append(key, value);
  return fd;
}

const run = (adapter, extra = {}) => adapter.transcribe({ model: MODEL, formData: form([]), credentials: CRED_A, ...extra });

// ── Staging block: the only assertions about registration state ──────────
describe("OpenRouter stt staging state (promote at registration)", () => {
  it("is not registered: the openrouter registry entry has no stt kind or sttConfig", () => {
    expect(openrouterRegistry.serviceKinds).not.toContain("stt");
    expect(openrouterRegistry.sttConfig).toBeUndefined();
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("OpenRouter stt staged metadata", () => {
  it("pins the source registry fields and models", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryFields.stt).toEqual({
      id: "openrouter", baseUrl: TRANSCRIPTION_URL, authType: "apikey", authHeader: "bearer", format: "openrouter-stt",
      supportedFormats: ["wav", "mp3", "flac", "m4a", "ogg", "webm", "aac"],
    });
    expect(OPENROUTER_STT_MODELS.map((m) => m.id)).toEqual([
      "deepgram/nova-3", "microsoft/mai-transcribe-1.5", "nvidia/parakeet-tdt-0.6b-v3", "mistralai/voxtral-mini-transcribe",
      "qwen/qwen3-asr-flash-2026-02-10", "google/chirp-3", "openai/gpt-4o-mini-transcribe", "openai/whisper-large-v3",
      "openai/whisper-large-v3-turbo", "openai/whisper-1", "openai/gpt-4o-transcribe",
    ]);
    expect(OPENROUTER_STT_MODELS.every((m) => m.kind === "stt")).toBe(true);
    expect(REGISTRATION.models.stt.map((m) => m.id)).toEqual(OPENROUTER_STT_MODELS.map((m) => m.id));
    expect(REGISTRATION.provider).toMatchObject({ canonicalId: "openrouter", aliases: ["openrouter"], authModes: ["apikey"], addServiceKinds: ["stt"] });
  });

  it("stages an sttConfig with the source auth, fixed endpoint and no translations", () => {
    expect(OPENROUTER_STT_CONFIG).toMatchObject({ baseUrl: TRANSCRIPTION_URL, authType: "apikey", authHeader: "bearer", format: "openrouter-stt" });
    expect(supportsSttTranslation(OPENROUTER_STT_CONFIG, MODEL)).toBe(false);
  });

  it("exports every name registration.json lists", () => {
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(openrouterSttAdapter.provider).toBe("openrouter");
  });
});

describe("OpenRouter audio format resolution (source resolveOpenRouterAudioFormat)", () => {
  const file = (name, type = "") => ({ name, type });
  it("follows the source extension, .opus and base-MIME rules", () => {
    expect(resolveOpenRouterAudioFormat(file("note.opus"))).toBe("ogg");
    expect(resolveOpenRouterAudioFormat(file("note.OPUS"))).toBe("ogg");
    expect(resolveOpenRouterAudioFormat(file("blob", "audio/opus"))).toBe("ogg");
    expect(resolveOpenRouterAudioFormat(file("a.mp3"))).toBe("mp3");
    expect(resolveOpenRouterAudioFormat(file("blob", "audio/webm;codecs=opus"))).toBe("webm");
    expect(resolveOpenRouterAudioFormat(file("blob", "audio/x-flac"))).toBe("flac");
  });

  it("checks the bytes instead of announcing unknown audio as wav", () => {
    expect(resolveOpenRouterAudioFormat(file("mystery.xyz"), Buffer.from("not audio at all"))).toBeNull();
    expect(resolveOpenRouterAudioFormat(file("mystery.xyz"), WAV)).toBe("wav");
    expect(sniffOpenRouterAudioFormat(Buffer.from("fLaC0000"))).toBe("flac");
    expect(sniffOpenRouterAudioFormat(Buffer.from("OggS0000"))).toBe("ogg");
    expect(sniffOpenRouterAudioFormat(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0]))).toBe("webm");
    expect(sniffOpenRouterAudioFormat(Buffer.concat([Buffer.alloc(4), Buffer.from("ftypM4A ")]))).toBe("m4a");
    expect(sniffOpenRouterAudioFormat(Buffer.from("ID3\u0004\u0000"))).toBe("mp3");
    expect(sniffOpenRouterAudioFormat(Buffer.from([0xff, 0xfb, 0x90, 0x00]))).toBe("mp3");
    expect(sniffOpenRouterAudioFormat(Buffer.from([0xff, 0xf1, 0x50, 0x80]))).toBe("aac");
  });
});

describe("OpenRouter transcription wire contract", () => {
  it("posts the source JSON body with only the Bearer and JSON headers", async () => {
    const { fetchImpl, calls } = transport(json({ text: "hello world" }));
    const fd = form([
      ["model", "ignored-by-adapter"],
      ["language", "en"],
      ["response_format", "json"],
      ["temperature", "0.2"],
      ["include[]", "logprobs"],
    ], new File([Buffer.from("OggSaudio")], "voice.opus", { type: "audio/ogg" }));
    const result = await createOpenRouterSttAdapter({ fetchImpl }).transcribe({ model: MODEL, formData: fd, credentials: CRED_A });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TRANSCRIPTION_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.headers).toEqual({ Authorization: `Bearer ${KEY_A}`, "Content-Type": "application/json" });
    expect(bodyOf(calls[0])).toEqual({
      model: MODEL,
      input_audio: { data: Buffer.from("OggSaudio").toString("base64"), format: "ogg" },
      language: "en",
      response_format: "json",
      temperature: 0.2,
    });
    expect(Object.keys(bodyOf(calls[0]))).toEqual(["model", "input_audio", "language", "response_format", "temperature"]);
    expect(result.success).toBe(true);
    expect(result.response.headers.get("content-type")).toBe("application/json");
    expect(await result.response.json()).toEqual({ text: "hello world" });
    expect(result.accounting).toMatchObject({ modality: "stt", cost: null, costStatus: "unknown", meta: { model: MODEL, responseFormat: "json" } });
  });

  it("sends only model and input_audio when nothing else is named", async () => {
    const { fetchImpl, calls } = transport(json({ text: "x" }));
    await run(createOpenRouterSttAdapter({ fetchImpl }));
    expect(bodyOf(calls[0])).toEqual({ model: MODEL, input_audio: { data: WAV.toString("base64"), format: "wav" } });
  });

  it("forwards the connection egress policy to the transport", async () => {
    const { fetchImpl, calls } = transport(json({ text: "x" }));
    const credentials = { ...CRED_A, providerSpecificData: { proxyMode: "pool", proxyPoolId: "pool-a" } };
    await createOpenRouterSttAdapter({ fetchImpl }).transcribe({ model: MODEL, formData: form([]), credentials });
    expect(calls[0].proxyOptions).toEqual(resolveCredentialProxyOptions(credentials));
    expect(calls[0].proxyOptions).toMatchObject({ proxyMode: "pool", proxyPoolId: "pool-a" });
  });

  it("keeps each selected connection's key on its own request", async () => {
    const { fetchImpl, calls } = transport(json({ text: "a" }), json({ text: "b" }), leaky(402), json({ text: "b2" }));
    const adapter = createOpenRouterSttAdapter({ fetchImpl });
    const [a, b] = await Promise.all([run(adapter), run(adapter, { credentials: CRED_B })]);
    expect(a.success && b.success).toBe(true);
    expect(calls.map((c) => c.init.headers.Authorization).sort()).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
    // A quota refusal on A is A's alone; B's next request is unaffected.
    const quotaA = await run(adapter);
    const nextB = await run(adapter, { credentials: CRED_B });
    expect(quotaA).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    expect(calls[2].init.headers.Authorization).toBe(`Bearer ${KEY_A}`);
    expect(calls[3].init.headers.Authorization).toBe(`Bearer ${KEY_B}`);
    expect(nextB.success).toBe(true);
    expectNoLeak(quotaA);
  });

  it("returns verbose_json with granularities and records audio seconds and usage without a cost", async () => {
    const verbose = { text: "hi", duration: 2.5, words: [{ word: "hi", start: 0, end: 0.4 }], usage: { seconds: 3, cost: 0.0004 } };
    const { fetchImpl, calls } = transport(json(verbose));
    const fd = form([["response_format", "verbose_json"], ["timestamp_granularities[]", "word"], ["timestamp_granularities", "segment,word"]]);
    const result = await createOpenRouterSttAdapter({ fetchImpl }).transcribe({ model: MODEL, formData: fd, credentials: CRED_A });
    expect(bodyOf(calls[0]).timestamp_granularities).toEqual(["word", "segment"]);
    expect(result.success).toBe(true);
    expect(await result.response.json()).toEqual(verbose);
    expect(result.nativeUnits).toEqual({ audioSeconds: 2.5 });
    expect(result.usageValue).toEqual({ usage: { seconds: 3, cost: 0.0004 } });
    expect(result.accounting).toMatchObject({ cost: null, costStatus: "unknown" });
  });

  it("takes audio seconds from usage.seconds when no duration is given", async () => {
    const { fetchImpl } = transport(json({ text: "hi", usage: { seconds: 4 } }));
    const result = await run(createOpenRouterSttAdapter({ fetchImpl }));
    expect(result.nativeUnits).toEqual({ audioSeconds: 4 });
  });

  it("answers text as text/plain, from a text body or a JSON body, and keeps bracketed transcripts", async () => {
    const { fetchImpl } = transport(
      new Response("[music] plain words", { status: 200, headers: { "content-type": "text/plain" } }),
      json({ text: "json words" }),
    );
    const adapter = createOpenRouterSttAdapter({ fetchImpl });
    const fromText = await adapter.transcribe({ model: MODEL, formData: form([["response_format", "text"]]), credentials: CRED_A });
    const fromJson = await adapter.transcribe({ model: MODEL, formData: form([["response_format", "text"]]), credentials: CRED_A });
    expect(fromText.response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await fromText.response.text()).toBe("[music] plain words");
    expect(await fromJson.response.text()).toBe("json words");
  });

  it.each([
    ["a translation", MODEL, [], { kind: "translation" }],
    ["an unknown model", "openai/gpt-4o", [], {}],
    ["srt output", MODEL, [["response_format", "srt"]], {}],
    ["diarized_json output", MODEL, [["response_format", "diarized_json"]], {}],
    ["granularities without verbose_json", MODEL, [["timestamp_granularities[]", "segment"]], {}],
    ["an unknown granularity", MODEL, [["response_format", "verbose_json"], ["timestamp_granularities[]", "char"]], {}],
    ["streaming", MODEL, [["stream", "true"]], {}],
    ["a prompt the source would drop", MODEL, [["prompt", "names: Ana"]], {}],
    ["a temperature above 1", MODEL, [["temperature", "1.5"]], {}],
    ["a non-numeric temperature", MODEL, [["temperature", "warm"]], {}],
  ])("refuses %s before submit", async (_label, model, entries, extra) => {
    const { fetchImpl } = transport();
    const result = await createOpenRouterSttAdapter({ fetchImpl }).transcribe({ model, formData: form(entries), credentials: CRED_A, ...extra });
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a missing, url-only, empty, oversized or unrecognisable file and a missing key before submit", async () => {
    const { fetchImpl } = transport();
    const adapter = createOpenRouterSttAdapter({ fetchImpl });
    const call = (formData, credentials = CRED_A) => adapter.transcribe({ model: MODEL, formData, credentials });
    const missing = await call(form([], null));
    const url = await call(form([["url", "https://example.com/a.mp3"]], null));
    const empty = await call(form([], new File([], "a.wav")));
    const huge = { name: "a.wav", size: 26 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) };
    const big = await call({ get: (n) => (n === "file" ? huge : null), getAll: () => [] });
    const unknown = await call(form([], new File([Buffer.from("not audio")], "notes.txt", { type: "text/plain" })));
    const noKey = await call(form([]), {});
    const badKey = await call(form([]), { apiKey: "sk-or\r\nX-Injected: 1" });
    for (const result of [missing, url, empty, big, unknown]) expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(noKey).toMatchObject({ success: false, status: 401 });
    expect(badKey).toMatchObject({ success: false, status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("OpenRouter transcription failures and malformed answers", () => {
  it("maps refusals by status without quoting OpenRouter", async () => {
    const { fetchImpl } = transport(leaky(400), leaky(401), leaky(402), leaky(403), leaky(429, { "retry-after": "5" }), leaky(503), leaky(502));
    const adapter = createOpenRouterSttAdapter({ fetchImpl });
    const results = [];
    for (let i = 0; i < 7; i++) results.push(await run(adapter));
    expect(results.map((r) => r.status)).toEqual([400, 401, 402, 403, 429, 503, 502]);
    expect(results[2]).toMatchObject({ quotaExhausted: true });
    expect(results[4].resetsAtMs).toBeGreaterThan(Date.now());
    expect(results[4].response.headers.get("retry-after")).toBe("5");
    expect(results[6].acceptedJob).toMatchObject({ modality: "stt", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
    for (const result of results.slice(0, 6)) expect(result.acceptedJob).toBeUndefined();
    for (const result of results) {
      expect(result.success).toBe(false);
      expect(result.local).toBeUndefined();
      expectNoLeak(result);
    }
  });

  it("reads a 200 error envelope as a refusal and a missing transcript as a lost result", async () => {
    const { fetchImpl } = transport(
      leaky(200),
      json({ segments: [] }),
      new Response("{not json", { status: 200, headers: { "content-type": "application/json" } }),
      new Response(JSON.stringify({ error: { message: `echo ${KEY_A}` } }), { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const adapter = createOpenRouterSttAdapter({ fetchImpl });
    const envelope = await run(adapter);
    const noText = await run(adapter);
    const broken = await run(adapter);
    const mislabelled = await adapter.transcribe({ model: MODEL, formData: form([["response_format", "text"]]), credentials: CRED_A });
    expect(envelope).toMatchObject({ success: false, status: 502 });
    expect(envelope.acceptedJob).toBeUndefined();
    expect(noText.acceptedJob.meta.jobState).toBe("accepted");
    expect(broken.acceptedJob.meta.jobState).toBe("accepted");
    expect(mislabelled).toMatchObject({ success: false, status: 502 });
    for (const result of [envelope, noText, broken, mislabelled]) expectNoLeak(result);
  });

  it("treats HTML or non-JSON for a JSON format as a lost result", async () => {
    const { fetchImpl } = transport(
      new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
      new Response("words", { status: 200, headers: { "content-type": "text/plain" } }),
      new Response("<!DOCTYPE html><p>", { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const adapter = createOpenRouterSttAdapter({ fetchImpl });
    const html = await adapter.transcribe({ model: MODEL, formData: form([["response_format", "text"]]), credentials: CRED_A });
    const textForJson = await run(adapter);
    const htmlAsText = await adapter.transcribe({ model: MODEL, formData: form([["response_format", "text"]]), credentials: CRED_A });
    for (const result of [html, textForJson, htmlAsText]) expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("caps the transcript size", async () => {
    const { fetchImpl } = transport(json({ text: "x".repeat(200) }));
    const result = await run(createOpenRouterSttAdapter({ fetchImpl, maxTranscriptBytes: 64 }));
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("refuses a redirect without following it or replaying the request", async () => {
    const { fetchImpl, calls } = transport(new Response(null, { status: 307, headers: { location: "https://evil.invalid/" } }));
    const result = await run(createOpenRouterSttAdapter({ fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("distinguishes a provably unsent connect failure from a failure after send", async () => {
    const { fetchImpl, calls } = transport(transportError("ECONNREFUSED"), transportError("ECONNRESET"));
    const adapter = createOpenRouterSttAdapter({ fetchImpl });
    const unsent = await run(adapter);
    const uncertain = await run(adapter);
    expect(calls).toHaveLength(2);
    expect(unsent).toMatchObject({ success: false, status: 502 });
    expect(unsent.acceptedJob).toBeUndefined();
    expect(uncertain.acceptedJob.meta.jobState).toBe("submit-unknown");
    expectNoLeak(unsent);
    expectNoLeak(uncertain);
  });

  it("does not send when the caller already left", async () => {
    const before = new AbortController();
    before.abort();
    const { fetchImpl } = transport();
    const result = await run(createOpenRouterSttAdapter({ fetchImpl }), { signal: before.signal });
    expect(result).toMatchObject({ success: false, status: 499, local: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("records a caller abort after send as uncertain and aborts the transport signal", async () => {
    const controller = new AbortController();
    let seen;
    const { fetchImpl } = transport((_url, init) => {
      seen = init.signal;
      setTimeout(() => controller.abort(), 5);
      return hang();
    });
    const result = await run(createOpenRouterSttAdapter({ fetchImpl }), { signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
  });

  it("ends at the deadline even when fetch ignores its signal, and bounds a stalled body", async () => {
    let seen;
    const { fetchImpl, calls } = transport((_url, init) => {
      seen = init.signal;
      return hang();
    }, stalledBody());
    const adapter = createOpenRouterSttAdapter({ fetchImpl, timeoutMs: 25 });
    const timedOut = await run(adapter);
    const stalled = await run(adapter);
    expect(calls).toHaveLength(2);
    expect(timedOut).toMatchObject({ success: false, status: 504 });
    expect(timedOut.acceptedJob.meta.jobState).toBe("submit-unknown");
    expect(seen.aborted).toBe(true);
    expect(stalled).toMatchObject({ success: false, status: 504 });
    expect(stalled.acceptedJob.meta.jobState).toBe("accepted");
  });
});
