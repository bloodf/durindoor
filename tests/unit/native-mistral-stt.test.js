// Mistral native transcription (STT) adapter, staged and unregistered
// (#2034). Closed mocks only: every request goes to an injected transport, an
// unexpected request fails the test, and every key is synthetic. Wire shapes
// follow OmniRoute c71f0065 (audioRegistry.ts `mistral` transcription row,
// audioTranscription.ts default multipart branch, audioMultipart.ts
// buildMultipartBody / getUploadedFileName). Passing here says nothing about
// the live service.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-mistral-stt/index.js";
import {
  MISTRAL_STT_CONFIG,
  MISTRAL_STT_MODELS,
  createMistralSttAdapter,
  mistralSttAdapter,
  mistralUploadFileName,
} from "../../open-sse/services/providerParity/native-mistral-stt/index.js";
import { supportsSttTranslation } from "../../open-sse/handlers/sttCore.js";
import mistralRegistry from "../../open-sse/providers/registry/mistral.js";
import { resolveCredentialProxyOptions } from "../../open-sse/services/oauthCredentialManager.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const TRANSCRIPTION_URL = "https://api.mistral.ai/v1/audio/transcriptions";
const KEY_A = "SYNTHETIC-mistral-key-a-0001";
const KEY_B = "SYNTHETIC-mistral-key-b-0002";
const CRED_A = { apiKey: KEY_A, connectionId: "conn-a" };
const CRED_B = { apiKey: KEY_B, connectionId: "conn-b" };
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(32, 1)]);
const MODEL = "voxtral-mini-latest";
const REGISTRATION = JSON.parse(readFileSync(new URL("../../open-sse/services/providerParity/native-mistral-stt/registration.json", import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const leaky = (status, headers = {}) => json({ object: "error", message: `upstream echo ${KEY_A} at /srv/app/index.js:44`, type: "invalid_request_error" }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });
/** A fetch that never settles and ignores its signal. */
const hang = () => new Promise(() => {});
/** A 200 whose body never finishes. */
const stalledBody = () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("{\"text\":")); } }), { status: 200, headers: { "content-type": "application/json" } });
/** Mistral's documented transcription answer shape. */
const transcript = (text = "hello world", extra = {}) => ({
  model: MODEL, text, language: "en", segments: [],
  usage: { prompt_audio_seconds: 3, prompt_tokens: 4, total_tokens: 40, completion_tokens: 36 }, ...extra,
});

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

/** Multipart parts as [name, value] in order; the file part as { name, type, bytes }. */
async function partsOf(call) {
  const out = [];
  for (const [name, value] of call.init.body.entries()) {
    out.push([name, isString(value) ? value : { name: value.name, type: value.type, bytes: Buffer.from(await value.arrayBuffer()) }]);
  }
  return out;
}
const isString = (value) => typeof value === "string";

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
describe("Mistral stt staging state (promote at registration)", () => {
  it("is not registered: the mistral registry entry has no stt kind, sttConfig or stt models", () => {
    expect(mistralRegistry.serviceKinds).not.toContain("stt");
    expect(mistralRegistry.sttConfig).toBeUndefined();
    expect(mistralRegistry.models.some((m) => m.kind === "stt")).toBe(false);
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });
});

describe("Mistral stt staged metadata", () => {
  it("pins the source registry fields and models", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryFields.stt).toEqual({
      id: "mistral", baseUrl: TRANSCRIPTION_URL, authType: "apikey", authHeader: "bearer",
    });
    expect(MISTRAL_STT_MODELS.map((m) => m.id)).toEqual(["voxtral-mini-latest", "voxtral-mini-2602", "voxtral-mini-transcribe-3"]);
    expect(MISTRAL_STT_MODELS.every((m) => m.kind === "stt")).toBe(true);
    expect(REGISTRATION.models.stt.map((m) => m.id)).toEqual(MISTRAL_STT_MODELS.map((m) => m.id));
    expect(REGISTRATION.provider).toMatchObject({ canonicalId: "mistral", aliases: ["mistral"], authModes: ["apikey"], addServiceKinds: ["stt"] });
  });

  it("stages an sttConfig with the source auth, fixed endpoint and no translations", () => {
    expect(MISTRAL_STT_CONFIG).toMatchObject({ baseUrl: TRANSCRIPTION_URL, authType: "apikey", authHeader: "bearer", format: "mistral-stt" });
    expect(supportsSttTranslation(MISTRAL_STT_CONFIG, MODEL)).toBe(false);
  });

  it("exports every name registration.json lists", () => {
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(mistralSttAdapter.provider).toBe("mistral");
  });
});

describe("Mistral transcription wire contract", () => {
  it("posts the source multipart body with only the Bearer header", async () => {
    const { fetchImpl, calls } = transport(json(transcript()));
    const fd = form([
      ["model", "ignored-by-adapter"],
      ["language", "en"],
      ["response_format", "json"],
      ["temperature", "0.2"],
      ["include[]", "logprobs"],
    ], new File([Buffer.from("OggSaudio")], "voice.opus", { type: "audio/ogg" }));
    const result = await createMistralSttAdapter({ fetchImpl }).transcribe({ model: MODEL, formData: fd, credentials: CRED_A });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TRANSCRIPTION_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.headers).toEqual({ Authorization: `Bearer ${KEY_A}` });
    expect(calls[0].init.body).toBeInstanceOf(FormData);
    expect(await partsOf(calls[0])).toEqual([
      ["model", MODEL],
      ["language", "en"],
      ["response_format", "json"],
      ["temperature", "0.2"],
      ["file", { name: "voice.ogg", type: "audio/ogg", bytes: Buffer.from("OggSaudio") }],
    ]);
    expect(result.success).toBe(true);
    expect(result.response.headers.get("content-type")).toBe("application/json");
    expect(await result.response.json()).toEqual(transcript());
    expect(result.accounting).toMatchObject({ modality: "stt", cost: null, costStatus: "unknown", meta: { model: MODEL, responseFormat: "json" } });
  });

  it("sends only model and file when nothing else is named", async () => {
    const { fetchImpl, calls } = transport(json(transcript()));
    await run(createMistralSttAdapter({ fetchImpl }));
    expect(await partsOf(calls[0])).toEqual([["model", MODEL], ["file", { name: "clip.wav", type: "audio/wav", bytes: WAV }]]);
  });

  it("names the file like the source buildMultipartBody", () => {
    expect(mistralUploadFileName({ name: "a.OPUS" })).toBe("a.ogg");
    expect(mistralUploadFileName({ name: "" })).toBe("audio.wav");
    expect(mistralUploadFileName({})).toBe("audio.wav");
    expect(mistralUploadFileName({ name: "a\"b\r\n.mp3" })).toBe("a_b__.mp3");
  });

  it("labels an untyped upload application/octet-stream", async () => {
    const { fetchImpl, calls } = transport(json(transcript()));
    await createMistralSttAdapter({ fetchImpl }).transcribe({ model: MODEL, formData: form([], new File([WAV], "x.wav")), credentials: CRED_A });
    const file = (await partsOf(calls[0])).find(([name]) => name === "file")[1];
    expect(file.type).toBe("application/octet-stream");
  });

  it("merges both granularity spellings under timestamp_granularities[]", async () => {
    const { fetchImpl, calls } = transport(json(transcript("hi", { segments: [{ text: "hi", start: 0, end: 0.4 }] })));
    const fd = form([["timestamp_granularities[]", "segment"], ["timestamp_granularities", "word,segment"]]);
    const result = await createMistralSttAdapter({ fetchImpl }).transcribe({ model: MODEL, formData: fd, credentials: CRED_A });
    const parts = await partsOf(calls[0]);
    expect(parts.filter(([name]) => name.startsWith("timestamp_granularities"))).toEqual([
      ["timestamp_granularities[]", "segment"], ["timestamp_granularities[]", "word"],
    ]);
    expect(result.success).toBe(true);
  });

  it("forwards the connection egress policy to the transport", async () => {
    const { fetchImpl, calls } = transport(json(transcript()));
    const credentials = { ...CRED_A, providerSpecificData: { proxyMode: "pool", proxyPoolId: "pool-a" } };
    await createMistralSttAdapter({ fetchImpl }).transcribe({ model: MODEL, formData: form([]), credentials });
    expect(calls[0].proxyOptions).toEqual(resolveCredentialProxyOptions(credentials));
    expect(calls[0].proxyOptions).toMatchObject({ proxyMode: "pool", proxyPoolId: "pool-a" });
  });

  it("ignores a connection base URL and only talks to the fixed origin", async () => {
    const { fetchImpl, calls } = transport(json(transcript()));
    const credentials = { ...CRED_A, providerSpecificData: { baseUrl: "http://169.254.169.254/latest" } };
    await createMistralSttAdapter({ fetchImpl }).transcribe({ model: MODEL, formData: form([]), credentials });
    expect(calls[0].url).toBe(TRANSCRIPTION_URL);
  });

  it("keeps each selected connection's key on its own request", async () => {
    const { fetchImpl, calls } = transport(json(transcript("a")), json(transcript("b")), leaky(402), json(transcript("b2")));
    const adapter = createMistralSttAdapter({ fetchImpl });
    const [a, b] = await Promise.all([run(adapter), run(adapter, { credentials: CRED_B })]);
    expect(a.success && b.success).toBe(true);
    expect(calls.map((c) => c.init.headers.Authorization).sort()).toEqual([`Bearer ${KEY_A}`, `Bearer ${KEY_B}`]);
    // A billing refusal on A is A's alone; B's next request is unaffected.
    const quotaA = await run(adapter);
    const nextB = await run(adapter, { credentials: CRED_B });
    expect(quotaA).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    expect(calls[2].init.headers.Authorization).toBe(`Bearer ${KEY_A}`);
    expect(calls[3].init.headers.Authorization).toBe(`Bearer ${KEY_B}`);
    expect(nextB.success).toBe(true);
    expectNoLeak(quotaA);
  });

  it("records audio seconds and token usage without a cost", async () => {
    const { fetchImpl } = transport(json(transcript()), json({ text: "x", duration: 1.5 }), json({ text: "x", usage: { prompt_audio_seconds: -1 } }));
    const adapter = createMistralSttAdapter({ fetchImpl });
    const fromUsage = await run(adapter);
    const fromDuration = await run(adapter);
    const invalid = await run(adapter);
    expect(fromUsage.nativeUnits).toEqual({ audioSeconds: 3 });
    expect(fromUsage.usageValue).toEqual({ usage: transcript().usage });
    expect(fromUsage.accounting).toMatchObject({ cost: null, costStatus: "unknown" });
    expect(fromDuration.nativeUnits).toEqual({ audioSeconds: 1.5 });
    expect(fromDuration.usageValue).toBeUndefined();
    expect(invalid.nativeUnits).toEqual({});
  });

  it.each([
    ["a translation", MODEL, [], { kind: "translation" }],
    ["an unknown model", "mistral-large-latest", [], {}],
    ["the OpenRouter-routed voxtral id", "mistralai/voxtral-mini-transcribe", [], {}],
    ["text output", MODEL, [["response_format", "text"]], {}],
    ["verbose_json output", MODEL, [["response_format", "verbose_json"]], {}],
    ["srt output", MODEL, [["response_format", "srt"]], {}],
    ["vtt output", MODEL, [["response_format", "vtt"]], {}],
    ["an unknown granularity", MODEL, [["timestamp_granularities[]", "char"]], {}],
    ["streaming", MODEL, [["stream", "true"]], {}],
    ["a prompt the endpoint does not document", MODEL, [["prompt", "names: Ana"]], {}],
    ["a temperature above 1", MODEL, [["temperature", "1.5"]], {}],
    ["a negative temperature", MODEL, [["temperature", "-0.1"]], {}],
    ["a non-numeric temperature", MODEL, [["temperature", "warm"]], {}],
    ["an oversized language", MODEL, [["language", "x".repeat(5000)]], {}],
  ])("refuses %s before submit", async (_label, model, entries, extra) => {
    const { fetchImpl } = transport();
    const result = await createMistralSttAdapter({ fetchImpl }).transcribe({ model, formData: form(entries), credentials: CRED_A, ...extra });
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a missing, url-only, empty or oversized file and a missing or unsafe key before submit", async () => {
    const { fetchImpl } = transport();
    const adapter = createMistralSttAdapter({ fetchImpl });
    const call = (formData, credentials = CRED_A) => adapter.transcribe({ model: MODEL, formData, credentials });
    const missing = await call(form([], null));
    const url = await call(form([["url", "https://example.com/a.mp3"]], null));
    const empty = await call(form([], new File([], "a.wav")));
    const huge = { name: "a.wav", size: 26 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(0) };
    const big = await call({ get: (n) => (n === "file" ? huge : null), getAll: () => [] });
    const noKey = await call(form([]), {});
    const badKey = await call(form([]), { apiKey: "key\r\nX-Injected: 1" });
    for (const result of [missing, url, empty, big]) expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(noKey).toMatchObject({ success: false, status: 401 });
    expect(badKey).toMatchObject({ success: false, status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Mistral transcription failures and malformed answers", () => {
  it("maps refusals by status without quoting Mistral", async () => {
    const { fetchImpl } = transport(leaky(400), leaky(401), leaky(402), leaky(403), leaky(422), leaky(429, { "retry-after": "5" }), leaky(503), leaky(500));
    const adapter = createMistralSttAdapter({ fetchImpl });
    const results = [];
    for (let i = 0; i < 8; i++) results.push(await run(adapter));
    expect(results.map((r) => r.status)).toEqual([400, 401, 402, 403, 422, 429, 503, 502]);
    expect(results[2]).toMatchObject({ quotaExhausted: true });
    expect(results[5].resetsAtMs).toBeGreaterThan(Date.now());
    expect(results[5].response.headers.get("retry-after")).toBe("5");
    expect(results[7].acceptedJob).toMatchObject({ modality: "stt", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
    for (const result of results.slice(0, 7)) expect(result.acceptedJob).toBeUndefined();
    for (const result of results) {
      expect(result.success).toBe(false);
      expect(result.local).toBeUndefined();
      expectNoLeak(result);
    }
  });

  it("reads a 200 error envelope as a refusal and a missing transcript as a lost result", async () => {
    const { fetchImpl } = transport(
      leaky(200),
      json({ error: { message: `echo ${KEY_A}` } }),
      json({ segments: [] }),
      json(["not", "an", "object"]),
      new Response("{not json", { status: 200, headers: { "content-type": "application/json" } }),
    );
    const adapter = createMistralSttAdapter({ fetchImpl });
    const mistralEnvelope = await run(adapter);
    const openaiEnvelope = await run(adapter);
    const noText = await run(adapter);
    const array = await run(adapter);
    const broken = await run(adapter);
    for (const envelope of [mistralEnvelope, openaiEnvelope]) {
      expect(envelope).toMatchObject({ success: false, status: 502 });
      expect(envelope.acceptedJob).toBeUndefined();
    }
    for (const lost of [noText, array, broken]) expect(lost.acceptedJob.meta.jobState).toBe("accepted");
    for (const result of [mistralEnvelope, openaiEnvelope, noText, array, broken]) expectNoLeak(result);
  });

  it("treats HTML, plain text or a mislabelled JSON error as a lost result", async () => {
    const { fetchImpl } = transport(
      new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
      new Response("words", { status: 200, headers: { "content-type": "text/plain" } }),
      new Response(JSON.stringify({ error: { message: `echo ${KEY_A}` } }), { status: 200, headers: { "content-type": "text/plain" } }),
    );
    const adapter = createMistralSttAdapter({ fetchImpl });
    const results = [await run(adapter), await run(adapter), await run(adapter)];
    for (const result of results) {
      expect(result).toMatchObject({ success: false, status: 502 });
      expect(result.acceptedJob.meta.jobState).toBe("accepted");
      expectNoLeak(result);
    }
  });

  it("caps the transcript size", async () => {
    const { fetchImpl } = transport(json(transcript("x".repeat(200))));
    const result = await run(createMistralSttAdapter({ fetchImpl, maxTranscriptBytes: 64 }));
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("refuses a redirect without following it or replaying the request", async () => {
    const { fetchImpl, calls } = transport(new Response(null, { status: 307, headers: { location: "https://evil.invalid/" } }));
    const result = await run(createMistralSttAdapter({ fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob.meta.jobState).toBe("submit-unknown");
  });

  it("distinguishes a provably unsent connect failure from a failure after send, and never replays", async () => {
    const { fetchImpl, calls } = transport(transportError("ECONNREFUSED"), transportError("ECONNRESET"));
    const adapter = createMistralSttAdapter({ fetchImpl });
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
    const result = await run(createMistralSttAdapter({ fetchImpl }), { signal: before.signal });
    expect(result).toMatchObject({ success: false, status: 499, local: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("records a caller abort after send as uncertain and aborts the transport signal", async () => {
    const controller = new AbortController();
    let seen;
    const { fetchImpl, calls } = transport((_url, init) => {
      seen = init.signal;
      setTimeout(() => controller.abort(), 5);
      return hang();
    });
    const result = await run(createMistralSttAdapter({ fetchImpl }), { signal: controller.signal });
    expect(calls).toHaveLength(1);
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
    const adapter = createMistralSttAdapter({ fetchImpl, timeoutMs: 25 });
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
