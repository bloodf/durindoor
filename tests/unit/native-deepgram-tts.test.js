// Deepgram native speech (TTS) adapter and bounded model discovery, staged and
// unregistered (#2034). Closed mocks only: every request goes to an injected
// transport, an unexpected request fails the test, and every key is synthetic.
// Wire shapes follow OmniRoute c71f0065 (audioSpeech.ts handleDeepgramSpeech,
// registryUtils.ts buildAuthHeaders "token", audioRegistry.ts `deepgram`
// speech row). Passing here says nothing about the live service.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-deepgram-tts/index.js";
import {
  DEEPGRAM_TTS_DEFINITION,
  DEEPGRAM_TTS_MODELS,
  buildDeepgramSpeechRequest,
  createDeepgramTtsAdapter,
  deepgramTtsAdapter,
  groupDeepgramVoices,
  isMp3,
  listDeepgramTtsModels,
  parseDeepgramTtsModels,
  resolveDeepgramContainer,
} from "../../open-sse/services/providerParity/native-deepgram-tts/index.js";
import deepgramRegistry from "../../open-sse/providers/registry/deepgram.js";
import { TTS_ADAPTERS } from "../../open-sse/handlers/ttsProviders/index.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const SPEAK_URL = "https://api.deepgram.com/v1/speak";
const MODELS_URL = "https://api.deepgram.com/v1/models";
const KEY_A = "dg-SYNTHETIC-key-a-0001";
const KEY_B = "dg-SYNTHETIC-key-b-0002";
const CRED_A = { apiKey: KEY_A, connectionId: "conn-a" };
const CRED_B = { apiKey: KEY_B, connectionId: "conn-b" };
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 7)]);
const MP3_FRAME = Buffer.concat([Buffer.from([0xff, 0xf3, 0x90, 0x00]), Buffer.alloc(100, 1)]);
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(200, 1)]);
const STAGE_DIR = "../../open-sse/services/providerParity/native-deepgram-tts/";
const REGISTRATION = JSON.parse(readFileSync(new URL(`${STAGE_DIR}registration.json`, import.meta.url), "utf8"));

const audio = (bytes = MP3, type = "audio/mpeg", headers = {}) => new Response(bytes, { status: 200, headers: { "content-type": type, ...headers } });
const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const leaky = (status, headers = {}) =>
  json({ err_code: "SOMETHING", err_msg: `upstream echo ${KEY_A} at /srv/app/index.js:44`, request_id: "r-1" }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });
/** A fetch that never settles and ignores its signal. */
const hang = () => new Promise(() => {});
/** A 200 whose body never finishes. */
const stalledBody = (type = "audio/mpeg") =>
  new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MP3.subarray(0, 10))); } }), { status: 200, headers: { "content-type": type } });

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

const expectNoLeak = (result) => {
  const text = JSON.stringify(result);
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain("upstream echo");
  expect(text).not.toContain("/srv/app");
};
const tts = (fetchImpl, extra = {}) => createDeepgramTtsAdapter({ fetchImpl, ...extra });

describe("deepgram speech request (source: handleDeepgramSpeech)", () => {
  it("sends the model as a query parameter, Token auth and a { text } JSON body to the fixed origin", async () => {
    const { fetchImpl, calls } = transport(audio());
    const result = await tts(fetchImpl).synthesize("Hello there", "aura-asteria-en", CRED_A, "mp3", {});
    expect(result.format).toBe("mp3");
    expect(Buffer.from(result.base64, "base64").equals(MP3)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${SPEAK_URL}?model=aura-asteria-en`);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Token ${KEY_A}` });
    expect(JSON.parse(calls[0].init.body)).toEqual({ text: "Hello there" });
    expect(calls[0].init.redirect).toBe("manual");
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps the exact source registry fields and models", () => {
    expect(DEEPGRAM_TTS_DEFINITION.ttsConfig).toEqual({ baseUrl: SPEAK_URL, authType: "apikey", authHeader: "token", format: "deepgram" });
    expect(DEEPGRAM_TTS_MODELS.map((m) => m.id)).toEqual(["aura-asteria-en", "aura-luna-en", "aura-stella-en"]);
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryFields.tts).toEqual({ id: "deepgram", ...DEEPGRAM_TTS_DEFINITION.ttsConfig });
    expect(REGISTRATION.provider.canonicalId).toBe("deepgram");
    expect(REGISTRATION.provider.aliases).toEqual(["deepgram", "dg"]);
    expect(REGISTRATION.models.tts.map((m) => m.id)).toEqual(DEEPGRAM_TTS_MODELS.map((m) => m.id));
  });

  it("accepts discovered Aura-2 ids and keeps the text verbatim", () => {
    const request = buildDeepgramSpeechRequest("aura-2-thalia-en", "  spaced  ", { voice: "alloy", speed: 1, language: "en-US" });
    expect(request).toEqual({ url: `${SPEAK_URL}?model=aura-2-thalia-en`, body: { text: "  spaced  " } });
  });

  it("uses accessToken when no apiKey is set, as the source does", async () => {
    const { fetchImpl, calls } = transport(audio());
    await tts(fetchImpl).synthesize("hi", "aura-luna-en", { accessToken: KEY_B }, "mp3", {});
    expect(calls[0].init.headers.Authorization).toBe(`Token ${KEY_B}`);
  });

  it("ignores a connection base URL and never sends the key elsewhere", async () => {
    const { fetchImpl, calls } = transport(audio());
    await tts(fetchImpl).synthesize("hi", "aura-luna-en", { ...CRED_A, baseUrl: "https://evil.example" }, "mp3", {});
    expect(new URL(calls[0].url).origin).toBe("https://api.deepgram.com");
  });
});

describe("pre-submit rejection (nothing is sent)", () => {
  const cases = [
    ["unknown model", "nova-3", "hi", {}],
    ["model with a slash", "aura-asteria-en/alloy", "hi", {}],
    ["empty model", "", "hi", {}],
    ["empty text", "aura-asteria-en", "   ", {}],
    ["over 2000 characters", "aura-asteria-en", "a".repeat(2001), {}],
    ["streaming", "aura-asteria-en", "hi", { stream: true }],
    ["sse stream format", "aura-asteria-en", "hi", { stream_format: "sse" }],
    ["speed", "aura-asteria-en", "hi", { speed: 1.5 }],
    ["instructions", "aura-asteria-en", "hi", { instructions: "whisper" }],
    ["conflicting Aura voice", "aura-asteria-en", "hi", { voice: "aura-luna-en" }],
    ["non-string voice", "aura-asteria-en", "hi", { voice: 7 }],
    ["mismatched language", "aura-asteria-en", "hi", { language: "es" }],
    ["wav body format", "aura-asteria-en", "hi", { response_format: "wav" }],
    ["opus query format", "aura-asteria-en", "hi", { requestedResponseFormat: "opus" }],
  ];
  it.each(cases)("refuses %s with a local 400", async (_label, model, text, options) => {
    const { fetchImpl } = transport();
    const result = await tts(fetchImpl).synthesize(text, model, CRED_A, "mp3", options);
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.local).toBe(true);
    expect(result.acceptedJob).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a gateway format other than mp3/json", async () => {
    const { fetchImpl } = transport();
    const result = await tts(fetchImpl).synthesize("hi", "aura-asteria-en", CRED_A, "flac", {});
    expect(result.status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("counts characters by code point at the limit", () => {
    expect(() => buildDeepgramSpeechRequest("aura-asteria-en", "😀".repeat(2000))).not.toThrow();
    expect(resolveDeepgramContainer("JSON", "mp3", null, "")).toBe("mp3");
  });

  it("refuses a missing or header-unsafe key with 401 before sending", async () => {
    for (const credentials of [{}, { apiKey: "  " }, { apiKey: `${KEY_A}\r\nX-Evil: 1` }]) {
      const { fetchImpl } = transport();
      const result = await tts(fetchImpl).synthesize("hi", "aura-asteria-en", credentials, "mp3", {});
      expect(result.status).toBe(401);
      expect(fetchImpl).not.toHaveBeenCalled();
      expectNoLeak(result);
    }
  });
});

describe("success normalization and usage", () => {
  it("returns MP3 with unknown cost and the provider character count when reported", async () => {
    const { fetchImpl } = transport(audio(MP3_FRAME, "audio/mpeg", { "dg-char-count": "11", "dg-request-id": "abc-123" }));
    const result = await tts(fetchImpl).synthesize("Hello there", "aura-asteria-en", CRED_A, "json", {});
    expect(result.format).toBe("mp3");
    expect(result.accounting).toMatchObject({
      modality: "tts", cost: null, costStatus: "unknown", nativeUnits: { characters: 11 },
      meta: { nativeUnitsSource: "dg-char-count", model: "aura-asteria-en", requestId: "abc-123" },
    });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("falls back to gateway-counted characters when the header is absent or malformed", async () => {
    const { fetchImpl } = transport(audio(MP3, "audio/mpeg", { "dg-char-count": "-3", "dg-request-id": "<bad id>" }));
    const result = await tts(fetchImpl).synthesize("hi", "aura-asteria-en", CRED_A, "mp3", {});
    expect(result.accounting.nativeUnits).toEqual({});
    expect(result.accounting.meta).toEqual({ nativeUnitsSource: "input-characters", model: "aura-asteria-en" });
  });

  it("checks MP3 signatures", () => {
    expect(isMp3(MP3)).toBe(true);
    expect(isMp3(MP3_FRAME)).toBe(true);
    expect(isMp3(WAV)).toBe(false);
    expect(isMp3(Buffer.alloc(0))).toBe(false);
  });

  it("keeps two connections separate: each call uses only its own key", async () => {
    const { fetchImpl, calls } = transport(audio(), audio());
    const adapter = tts(fetchImpl);
    await adapter.synthesize("one", "aura-asteria-en", CRED_A, "mp3", {});
    await adapter.synthesize("two", "aura-asteria-en", CRED_B, "mp3", {});
    expect(calls.map((c) => c.init.headers.Authorization)).toEqual([`Token ${KEY_A}`, `Token ${KEY_B}`]);
  });
});

describe("refusals, quota and leaks", () => {
  it.each([
    [400, 400, false],
    [401, 401, false],
    [403, 403, false],
    [402, 402, false],
    [429, 429, false],
    [503, 503, true],
    [500, 502, true],
    [502, 502, true],
  ])("maps Deepgram %i to %i without quoting the body", async (upstream, status, accepted) => {
    const { fetchImpl } = transport(leaky(upstream, upstream === 429 ? { "retry-after": "30" } : {}));
    const result = await tts(fetchImpl).synthesize("hi", "aura-asteria-en", CRED_A, "mp3", {});
    expect(result.success).toBe(false);
    expect(result.status).toBe(status);
    expect(Boolean(result.acceptedJob)).toBe(accepted);
    if (accepted) expect(result.acceptedJob).toMatchObject({ costSource: "accepted-job", cost: null, meta: { jobState: "submit-unknown" } });
    if (upstream === 402) expect(result.quotaExhausted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expectNoLeak(result);
  });

  it("treats a 200 JSON error envelope as a refusal without audio", async () => {
    const { fetchImpl } = transport(leaky(200));
    const result = await tts(fetchImpl).synthesize("hi", "aura-asteria-en", CRED_A, "mp3", {});
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it.each([
    ["non-audio content type", () => audio(MP3, "text/html")],
    ["wrong container bytes", () => audio(WAV, "audio/mpeg")],
    ["empty body", () => audio(Buffer.alloc(0))],
    ["unrecognized JSON", () => json({ ok: true })],
  ])("reports %s as a lost result of accepted work", async (_label, make) => {
    const { fetchImpl } = transport(make());
    const result = await tts(fetchImpl).synthesize("hi", "aura-asteria-en", CRED_A, "mp3", {});
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ meta: { jobState: "accepted" } });
  });

  it("bounds the audio size", async () => {
    const { fetchImpl } = transport(audio(Buffer.concat([MP3, Buffer.alloc(1000)])));
    const result = await tts(fetchImpl, { maxAudioBytes: 512 }).synthesize("hi", "aura-asteria-en", CRED_A, "mp3", {});
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toBeDefined();
  });

  it("refuses a redirect without following it and without replay", async () => {
    const { fetchImpl } = transport(new Response(null, { status: 307, headers: { location: "https://evil.example/" } }));
    const result = await tts(fetchImpl).synthesize("hi", "aura-asteria-en", CRED_A, "mp3", {});
    expect(result.status).toBe(502);
    expect(result.acceptedJob).toMatchObject({ meta: { jobState: "submit-unknown" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("cancellation, deadlines and uncertain submits (never replayed)", () => {
  it("a pre-aborted signal sends nothing", async () => {
    const { fetchImpl } = transport();
    const controller = new AbortController();
    controller.abort();
    const result = await tts(fetchImpl).synthesize("hi", "aura-asteria-en", CRED_A, "mp3", { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.local).toBe(true);
    expect(result.acceptedJob).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("an abort after send returns 499 with an accepted job, even when the transport ignores its signal", async () => {
    const controller = new AbortController();
    const { fetchImpl } = transport(() => { setTimeout(() => controller.abort(), 5); return hang(); });
    const result = await tts(fetchImpl).synthesize("hi", "aura-asteria-en", CRED_A, "mp3", { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toMatchObject({ meta: { jobState: "submit-unknown" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a deadline on the request returns 504 submit-unknown, once", async () => {
    const { fetchImpl } = transport(hang);
    const result = await tts(fetchImpl, { timeoutMs: 20 }).synthesize("hi", "aura-asteria-en", CRED_A, "mp3", {});
    expect(result.status).toBe(504);
    expect(result.acceptedJob).toMatchObject({ meta: { jobState: "submit-unknown" } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a deadline on a stalled body returns 504 with an accepted job", async () => {
    const { fetchImpl } = transport(stalledBody());
    const result = await tts(fetchImpl, { timeoutMs: 30 }).synthesize("hi", "aura-asteria-en", CRED_A, "mp3", {});
    expect(result.status).toBe(504);
    expect(result.acceptedJob).toMatchObject({ meta: { jobState: "accepted" } });
  });

  it("an abort while reading the body returns 499 with an accepted job", async () => {
    const controller = new AbortController();
    const { fetchImpl } = transport(() => { setTimeout(() => controller.abort(), 5); return stalledBody(); });
    const result = await tts(fetchImpl).synthesize("hi", "aura-asteria-en", CRED_A, "mp3", { signal: controller.signal });
    expect(result.status).toBe(499);
    expect(result.acceptedJob).toBeDefined();
  });

  it("a pre-connect failure is a plain 502 with no accepted job; a mid-flight failure is uncertain", async () => {
    const before = transport(transportError("ECONNREFUSED"));
    const r1 = await tts(before.fetchImpl).synthesize("hi", "aura-asteria-en", CRED_A, "mp3", {});
    expect(r1.status).toBe(502);
    expect(r1.acceptedJob).toBeUndefined();
    expectNoLeak(r1);
    const during = transport(transportError("ECONNRESET"));
    const r2 = await tts(during.fetchImpl).synthesize("hi", "aura-asteria-en", CRED_A, "mp3", {});
    expect(r2.status).toBe(502);
    expect(r2.acceptedJob).toMatchObject({ meta: { jobState: "submit-unknown" } });
    expect(during.fetchImpl).toHaveBeenCalledTimes(1);
    expectNoLeak(r2);
  });
});

describe("model discovery (bounded GET /v1/models)", () => {
  const payload = {
    stt: [{ canonical_name: "nova-3" }],
    tts: [
      { name: "thalia", canonical_name: "aura-2-thalia-en", languages: ["en", "en-US"], metadata: { tags: ["feminine"] } },
      { name: "asteria", canonical_name: "aura-asteria-en", languages: [], metadata: {} },
      { name: "dup", canonical_name: "aura-asteria-en" },
      { name: "<script>", canonical_name: "aura-2-celeste-es", languages: ["es", "../x"] },
      { name: "bad", canonical_name: "https://evil.example/aura" },
      "junk",
    ],
  };

  it("sends one Token-authenticated GET to the fixed origin and keeps only safe Aura rows", async () => {
    const { fetchImpl, calls } = transport(json(payload));
    const result = await listDeepgramTtsModels(CRED_A, { fetchImpl });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(MODELS_URL);
    expect(calls[0].init).toMatchObject({ method: "GET", headers: { Authorization: `Token ${KEY_A}` }, redirect: "manual" });
    expect(result.models).toEqual([
      { id: "aura-2-thalia-en", name: "thalia", kind: "tts", languages: ["en", "en-US"], gender: "feminine" },
      { id: "aura-asteria-en", name: "asteria", kind: "tts", languages: ["en"], gender: "" },
      { id: "aura-2-celeste-es", name: "aura-2-celeste-es", kind: "tts", languages: ["es"], gender: "" },
    ]);
    const grouped = groupDeepgramVoices(result.models);
    expect(grouped.languages.map((l) => l.code)).toEqual(["en", "en-US", "es"]);
    expect(grouped.byLang.en.voices.map((v) => v.id)).toEqual(["aura-2-thalia-en", "aura-asteria-en"]);
  });

  it("maps refusals without quoting and never marks free discovery as accepted work", async () => {
    for (const [upstream, status] of [[401, 401], [500, 502]]) {
      const { fetchImpl } = transport(leaky(upstream));
      const result = await listDeepgramTtsModels(CRED_A, { fetchImpl });
      expect(result.status).toBe(status);
      expect(result.acceptedJob).toBeUndefined();
      expectNoLeak(result);
    }
    const timed = transport(hang);
    const late = await listDeepgramTtsModels(CRED_A, { fetchImpl: timed.fetchImpl, timeoutMs: 20 });
    expect(late.status).toBe(504);
    expect(late.acceptedJob).toBeUndefined();
  });

  it("rejects malformed, oversized and missing-list answers", async () => {
    for (const [response, opts] of [
      [new Response("not json", { status: 200 }), {}],
      [json(payload), { maxBytes: 16 }],
      [json({ stt: [] }), {}],
    ]) {
      const { fetchImpl } = transport(response);
      const result = await listDeepgramTtsModels(CRED_A, { fetchImpl, ...opts });
      expect(result.status).toBe(502);
    }
    expect(parseDeepgramTtsModels(null)).toEqual([]);
  });

  it("refuses without a key and sends nothing", async () => {
    const { fetchImpl } = transport();
    expect((await listDeepgramTtsModels({}, { fetchImpl })).status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ── Staging block: the only assertions that depend on the unregistered state.
// Registration promotes these to positive identity assertions.
describe("staging: unregistered state", () => {
  it("exports a default adapter for the deepgram provider", () => {
    expect(deepgramTtsAdapter.provider).toBe("deepgram");
    expect(isFunction(staged.deepgramTtsAdapter.synthesize)).toBe(true);
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });

  it("is not yet in TTS_ADAPTERS and the registry entry is STT-only without ttsConfig", () => {
    expect(TTS_ADAPTERS.deepgram).toBeUndefined();
    expect(TTS_ADAPTERS.dg).toBeUndefined();
    expect(deepgramRegistry.serviceKinds).toEqual(["stt"]);
    expect(deepgramRegistry.ttsConfig).toBeUndefined();
    expect(deepgramRegistry.aliases).toEqual(["dg"]);
  });
});
