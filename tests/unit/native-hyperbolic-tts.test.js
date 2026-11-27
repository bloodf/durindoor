// Hyperbolic native speech (TTS) adapter, staged and unregistered (#2034).
// Closed mocks only: every request goes to an injected transport (or a stubbed
// global fetch for the dormant local handler), an unexpected request fails the
// test, and every key is synthetic. Wire shapes follow OmniRoute c71f0065
// (audioSpeech.ts handleHyperbolicSpeech, audioRegistry.ts `hyperbolic` speech
// row, audio-speech-handler.test.ts). Passing here says nothing about the live
// service.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-hyperbolic-tts/index.js";
import {
  HYPERBOLIC_TTS_CONFIG,
  HYPERBOLIC_TTS_MODELS,
  HYPERBOLIC_TTS_PROVIDER_ADDITIONS,
  buildHyperbolicSpeechRequest,
  createHyperbolicTtsAdapter,
  hyperbolicTtsAdapter,
} from "../../open-sse/services/providerParity/native-hyperbolic-tts/index.js";
import { TTS_ADAPTERS } from "../../open-sse/handlers/ttsProviders/index.js";
import { FORMAT_HANDLERS } from "../../open-sse/handlers/ttsProviders/genericFormats.js";
import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";
import hyperbolicRegistry from "../../open-sse/providers/registry/hyperbolic.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const SPEECH_URL = "https://api.hyperbolic.xyz/v1/audio/generation";
const KEY_A = "hyp-SYNTHETIC-a-0001";
const KEY_B = "hyp-SYNTHETIC-b-0002";
const CRED_A = { apiKey: KEY_A, connectionId: "conn-a" };
const CRED_B = { apiKey: KEY_B, connectionId: "conn-b" };
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 7)]);
const MP3_FRAME = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(100, 1)]);
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(200, 1)]);
const STAGE_DIR = "../../open-sse/services/providerParity/native-hyperbolic-tts/";
const REGISTRATION = JSON.parse(readFileSync(new URL(`${STAGE_DIR}registration.json`, import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
const speech = (bytes = MP3) => json({ audio: Buffer.from(bytes).toString("base64") });
const leaky = (status, headers = {}) => json({ error: { message: `upstream echo ${KEY_A} at /srv/app/index.js:44` } }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });
/** A fetch that never settles and ignores its signal. */
const hang = () => new Promise(() => {});
/** A 200 whose body never finishes. */
const stalledBody = () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"audio":"SUQz')); } }), { status: 200, headers: { "content-type": "application/json" } });

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
const synth = (adapter, options = {}, model = "melo-tts", cred = CRED_A) => adapter.synthesize("Hello there.", model, cred, "mp3", options);

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Staging block: the only assertions about registration state ──────────
describe("Hyperbolic tts staging state (promote at registration)", () => {
  it("is not registered: no TTS adapter under hyperbolic or hyp, no ttsConfig on the registry entry", () => {
    expect(Object.hasOwn(TTS_ADAPTERS, "hyperbolic")).toBe(false);
    expect(Object.hasOwn(TTS_ADAPTERS, "hyp")).toBe(false);
    expect(hyperbolicRegistry.ttsConfig).toBeUndefined();
    expect(hyperbolicRegistry.serviceKinds ?? []).not.toContain("tts");
    expect(hyperbolicRegistry.models.some((m) => m.id === "melo-tts")).toBe(false);
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });

  it("documents the dormant local format handler as the same wire envelope", async () => {
    // FORMAT_HANDLERS.hyperbolic exists but is unreachable without a ttsConfig;
    // it posts the same body to the same URL with the same Bearer header.
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return speech();
    }));
    const result = await FORMAT_HANDLERS.hyperbolic({ baseUrl: SPEECH_URL, apiKey: KEY_A, text: "Hi" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(SPEECH_URL);
    expect(calls[0].init.headers).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(calls[0].init.body).toBe(JSON.stringify({ text: "Hi" }));
    expect(result).toEqual({ base64: MP3.toString("base64"), format: "mp3" });
  });
});

describe("Hyperbolic staged metadata", () => {
  it("pins the source registry fields and model", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryFields.tts).toEqual({
      id: "hyperbolic", baseUrl: SPEECH_URL, authType: "apikey", authHeader: "bearer", format: "hyperbolic", models: [{ id: "melo-tts", name: "Melo TTS" }],
    });
    expect(HYPERBOLIC_TTS_MODELS).toEqual([{ id: "melo-tts", name: "Melo TTS", kind: "tts" }]);
    expect(REGISTRATION.models.tts.map((m) => m.id)).toEqual(["melo-tts"]);
    expect(REGISTRATION.provider).toMatchObject({ canonicalId: "hyperbolic", aliases: ["hyp"], authModes: ["apikey"], addServiceKinds: ["tts"] });
  });

  it("stages a ttsConfig and additions that keep the existing provider identity and auth mode", () => {
    expect(HYPERBOLIC_TTS_CONFIG).toMatchObject({ baseUrl: SPEECH_URL, authType: "apikey", authHeader: "bearer", format: "hyperbolic" });
    expect(HYPERBOLIC_TTS_PROVIDER_ADDITIONS).toMatchObject({ id: "hyperbolic", aliases: ["hyp"], authType: "apikey", addServiceKinds: ["tts"] });
    // Identity must match the existing chat provider the speech half merges into.
    expect(hyperbolicRegistry.id).toBe(HYPERBOLIC_TTS_PROVIDER_ADDITIONS.id);
    expect(hyperbolicRegistry.aliases).toEqual([...HYPERBOLIC_TTS_PROVIDER_ADDITIONS.aliases]);
    expect(hyperbolicRegistry.authType).toBe(HYPERBOLIC_TTS_PROVIDER_ADDITIONS.authType);
  });

  it("exports every name registration.json lists", () => {
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(hyperbolicTtsAdapter.provider).toBe("hyperbolic");
    expect(hyperbolicTtsAdapter.responseFormats).toEqual(["mp3", "json"]);
  });
});

describe("Hyperbolic speech wire contract", () => {
  it("posts exactly the source body with the Bearer key and returns decoded mp3", async () => {
    const { fetchImpl, calls } = transport(speech());
    const result = await synth(createHyperbolicTtsAdapter({ fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(SPEECH_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(headersOf(calls[0])).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(calls[0].init.body).toBe(JSON.stringify({ text: "Hello there." }));
    expect(result.format).toBe("mp3");
    expect(Buffer.from(result.base64, "base64").equals(MP3)).toBe(true);
    expect(result.accounting).toMatchObject({ modality: "tts", cost: null, costStatus: "unknown", costSource: "unavailable", meta: { model: "melo-tts" } });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("accepts an MPEG frame, an empty model (default melo-tts), an empty voice and speed 1", async () => {
    const { fetchImpl, calls } = transport(speech(MP3_FRAME), speech());
    const adapter = createHyperbolicTtsAdapter({ fetchImpl });
    const frame = await synth(adapter, { voice: "", speed: 1, response_format: "MP3" });
    const defaulted = await synth(adapter, { requestedResponseFormat: "json" }, "");
    expect(Buffer.from(frame.base64, "base64").equals(MP3_FRAME)).toBe(true);
    expect(defaulted.success).toBeUndefined();
    expect(calls.map((c) => c.init.body)).toEqual([JSON.stringify({ text: "Hello there." }), JSON.stringify({ text: "Hello there." })]);
  });

  it("ignores any connection base URL and forwards the connection egress policy", async () => {
    const { fetchImpl, calls } = transport(speech());
    const proxied = { ...CRED_A, baseUrl: "https://evil.invalid", providerSpecificData: { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.invalid:8080" } };
    await synth(createHyperbolicTtsAdapter({ fetchImpl }), {}, "melo-tts", proxied);
    expect(calls[0].url).toBe(SPEECH_URL);
    expect(calls[0].proxyOptions).toBeTypeOf("object");
  });

  it("keeps each selected connection's key on its own request", async () => {
    const { fetchImpl, calls } = transport(speech(), speech());
    const adapter = createHyperbolicTtsAdapter({ fetchImpl });
    await synth(adapter, {}, "melo-tts", CRED_A);
    await synth(adapter, {}, "melo-tts", CRED_B);
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${KEY_A}`);
    expect(headersOf(calls[1]).Authorization).toBe(`Bearer ${KEY_B}`);
  });

  it("uses an accessToken when the connection has no apiKey", async () => {
    const { fetchImpl, calls } = transport(speech());
    await synth(createHyperbolicTtsAdapter({ fetchImpl }), {}, "melo-tts", { accessToken: KEY_B });
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${KEY_B}`);
  });

  it.each([
    ["a wav container", "melo-tts", { response_format: "wav" }],
    ["a query-string opus container", "melo-tts", { requestedResponseFormat: "opus" }],
    ["sse streaming", "melo-tts", { stream_format: "sse" }],
    ["stream: true", "melo-tts", { stream: true }],
    ["an unknown model", "tts-1", {}],
    ["a model/voice suffix", "melo-tts/EN-US", {}],
    ["a named voice", "melo-tts", { voice: "alloy" }],
    ["a non-string voice", "melo-tts", { voice: 3 }],
    ["a speed other than 1", "melo-tts", { speed: 1.5 }],
    ["a non-numeric speed", "melo-tts", { speed: "fast" }],
    ["instructions", "melo-tts", { instructions: "whisper" }],
    ["a language hint", "melo-tts", { language: "fr" }],
  ])("refuses %s before submit", async (_label, model, options) => {
    const { fetchImpl } = transport();
    const result = await synth(createHyperbolicTtsAdapter({ fetchImpl }), options, model);
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(result.acceptedJob).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses empty input, an oversized request and a missing or unsafe key before submit", async () => {
    const { fetchImpl } = transport();
    const adapter = createHyperbolicTtsAdapter({ fetchImpl });
    expect(() => buildHyperbolicSpeechRequest("melo-tts", "x".repeat(300 * 1024))).toThrow(/too large/);
    expect(await adapter.synthesize("  ", "melo-tts", CRED_A, "mp3", {})).toMatchObject({ success: false, status: 400, local: true });
    expect(await synth(adapter, {}, "melo-tts", { apiKey: "" })).toMatchObject({ success: false, status: 401 });
    expect(await synth(adapter, {}, "melo-tts", { apiKey: "a\r\nX-Evil: 1" })).toMatchObject({ success: false, status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Hyperbolic speech failures", () => {
  it.each([
    [401, 401],
    [403, 403],
    [400, 400],
    [404, 404],
    [422, 422],
  ])("maps HTTP %i to %i without quoting Hyperbolic or accepting a job", async (status, expected) => {
    const { fetchImpl } = transport(leaky(status));
    const result = await synth(createHyperbolicTtsAdapter({ fetchImpl }));
    expect(result).toMatchObject({ success: false, status: expected });
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it("marks 402 as quota exhausted on this connection only", async () => {
    const { fetchImpl } = transport(leaky(402));
    const result = await synth(createHyperbolicTtsAdapter({ fetchImpl }));
    expect(result).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    expectNoLeak(result);
  });

  it("keeps a bounded Retry-After on 429 and 503", async () => {
    const { fetchImpl } = transport(leaky(429, { "retry-after": "7" }), leaky(503, { "retry-after": "3" }));
    const adapter = createHyperbolicTtsAdapter({ fetchImpl });
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
    const result = await synth(createHyperbolicTtsAdapter({ fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toMatchObject({ modality: "tts", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
    expectNoLeak(result);
  });

  it("refuses a redirect without following it or resending the key", async () => {
    const redirect = new Response(null, { status: 307, headers: { location: "https://evil.invalid/steal" } });
    const { fetchImpl, calls } = transport(redirect);
    const result = await synth(createHyperbolicTtsAdapter({ fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeDefined();
  });

  it("distinguishes a provably unsent connect failure from a failure after send", async () => {
    const { fetchImpl, calls } = transport(transportError("ENOTFOUND"), transportError("ECONNRESET"));
    const adapter = createHyperbolicTtsAdapter({ fetchImpl });
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
    const result = await synth(createHyperbolicTtsAdapter({ fetchImpl }), { signal: controller.signal });
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
    const result = await synth(createHyperbolicTtsAdapter({ fetchImpl }), { signal: controller.signal });
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
    const result = await synth(createHyperbolicTtsAdapter({ fetchImpl, timeoutMs: 20 }));
    expect(calls).toHaveLength(1);
    expect(seenSignal.aborted).toBe(true);
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob).toBeDefined();
  });

  it("bounds a stalled JSON body by the same deadline", async () => {
    const { fetchImpl } = transport(stalledBody());
    const result = await synth(createHyperbolicTtsAdapter({ fetchImpl, timeoutMs: 30 }));
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("records a caller abort during the body read as accepted work", async () => {
    const controller = new AbortController();
    const { fetchImpl } = transport(() => {
      setTimeout(() => controller.abort(), 5);
      return stalledBody();
    });
    const result = await synth(createHyperbolicTtsAdapter({ fetchImpl }), { signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });
});

describe("Hyperbolic speech malformed or unsafe answers", () => {
  it("reads a 200 error envelope as a refusal without quoting it", async () => {
    const { fetchImpl } = transport(leaky(200));
    const result = await synth(createHyperbolicTtsAdapter({ fetchImpl }));
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it.each([
    ["JSON without audio", () => json({ ok: true })],
    ["a non-string audio field", () => json({ audio: 42 })],
    ["an empty audio string", () => json({ audio: "" })],
    ["non-base64 audio", () => json({ audio: "not base64!!" })],
    ["a data URL instead of base64", () => json({ audio: `data:audio/mpeg;base64,${MP3.toString("base64")}` })],
    ["base64 WAV bytes", () => speech(WAV)],
    ["a JSON array", () => json([MP3.toString("base64")])],
    ["invalid JSON", () => new Response(`{"audio": ${KEY_A}`, { status: 200, headers: { "content-type": "application/json" } })],
    ["HTML", () => new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } })],
    ["raw mp3 bytes instead of JSON", () => new Response(MP3, { status: 200, headers: { "content-type": "audio/mpeg" } })],
  ])("treats %s as a lost result of billable work", async (_label, answer) => {
    const { fetchImpl, calls } = transport(answer());
    const result = await synth(createHyperbolicTtsAdapter({ fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toMatchObject({ costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "accepted" } });
    expectNoLeak(result);
  });

  it("caps the envelope and the decoded audio size", async () => {
    const { fetchImpl } = transport(speech(Buffer.concat([MP3, Buffer.alloc(4096)])));
    const result = await synth(createHyperbolicTtsAdapter({ fetchImpl, maxAudioBytes: 512 }));
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeDefined();
  });

  it("does not read extra answer fields as a usage receipt", async () => {
    const { fetchImpl } = transport(json({ audio: MP3.toString("base64"), usage: { cost_usd: 99 } }));
    const result = await synth(createHyperbolicTtsAdapter({ fetchImpl }));
    expect(result.accounting).toMatchObject({ cost: null, costStatus: "unknown" });
  });
});

describe("Hyperbolic speech through handleTtsCore (test-local wiring)", () => {
  // Wires the adapter into TTS_ADAPTERS only for the duration of this test to
  // check the core contract (usage merge, json wrapper, binary body); the
  // registration state itself is asserted only in the staging block above.
  it("returns mp3 bytes with character usage, or the json wrapper, and keeps refusals local", async () => {
    const { fetchImpl } = transport(speech(), speech());
    const adapter = createHyperbolicTtsAdapter({ fetchImpl });
    const key = "hyperbolic-test-wiring";
    TTS_ADAPTERS[key] = { adapter };
    try {
      const binary = await handleTtsCore({ provider: key, model: "melo-tts", input: " Hé llo ", credentials: CRED_A, responseFormat: "mp3" });
      expect(binary.success).toBe(true);
      expect(binary.response.headers.get("content-type")).toBe("audio/mp3");
      expect(Buffer.from(await binary.response.arrayBuffer()).equals(MP3)).toBe(true);
      expect(binary.accounting).toMatchObject({ costStatus: "unknown", nativeUnits: { characters: 6 } });

      const wrapped = await handleTtsCore({ provider: key, model: "melo-tts", input: "Hi", credentials: CRED_A, responseFormat: "json", requestedResponseFormat: "json" });
      expect(await wrapped.response.json()).toEqual({ audio: MP3.toString("base64"), format: "mp3" });

      const refused = await handleTtsCore({ provider: key, model: "melo-tts", input: "Hi", credentials: CRED_A, voice: "alloy" });
      expect(refused).toMatchObject({ success: false, status: 400, local: true });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      delete TTS_ADAPTERS[key];
    }
  });
});
