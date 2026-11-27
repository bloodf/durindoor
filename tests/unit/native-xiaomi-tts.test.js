// Xiaomi MiMo native speech (TTS) adapter, staged and unregistered (#2034).
// Closed mocks only: every request goes to an injected transport, an
// unexpected request fails the test, and every key is synthetic. Wire shapes
// follow OmniRoute c71f0065 (audioSpeech.ts handleXiaomiMimoSpeech,
// audioRegistry.ts `xiaomi-mimo` speech row, audio-speech-handler.test.ts,
// xiaomi-mimo-models-fetch-15307.test.ts). Passing here says nothing about the
// live service.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import * as staged from "../../open-sse/services/providerParity/native-xiaomi-tts/index.js";
import {
  XIAOMI_MIMO_TTS_CONFIG,
  XIAOMI_MIMO_TTS_MODELS,
  XIAOMI_MIMO_TTS_PROVIDER_ADDITIONS,
  buildXiaomiMimoSpeechRequest,
  createXiaomiMimoTtsAdapter,
  discoverXiaomiMimoTtsModels,
  normalizeXiaomiMimoRequestFormat,
  xiaomiMimoTtsAdapter,
} from "../../open-sse/services/providerParity/native-xiaomi-tts/index.js";
import { TTS_ADAPTERS } from "../../open-sse/handlers/ttsProviders/index.js";
import { FORMAT_HANDLERS } from "../../open-sse/handlers/ttsProviders/genericFormats.js";
import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";
import xiaomiRegistry from "../../open-sse/providers/registry/xiaomi-mimo.js";
import tokenplanRegistry from "../../open-sse/providers/registry/xiaomi-tokenplan.js";
import { isFunction } from "../../src/shared/utils/typeChecks.js";

const SPEECH_URL = "https://api.xiaomimimo.com/v1/chat/completions";
const MODELS_URL = "https://api.xiaomimimo.com/v1/models";
const KEY_A = "sk-SYNTHETIC-mimo-a-0001";
const KEY_B = "sk-SYNTHETIC-mimo-b-0002";
const PASS = "SYNTHETIC-passToken-0003";
const CRED_A = { apiKey: KEY_A, connectionId: "conn-a" };
const CRED_B = { apiKey: KEY_B, connectionId: "conn-b" };
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(200, 7)]);
const MP3_FRAME = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(100, 1)]);
const WAV = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(200, 1)]);
const STAGE_DIR = "../../open-sse/services/providerParity/native-xiaomi-tts/";
const REGISTRATION = JSON.parse(readFileSync(new URL(`${STAGE_DIR}registration.json`, import.meta.url), "utf8"));

const json = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
/** The source's primary success envelope: choices[0].message.audio.data. */
const speech = (bytes = MP3, extra = {}) => json({ choices: [{ message: { role: "assistant", audio: { data: Buffer.from(bytes).toString("base64") } } }], ...extra });
const leaky = (status, headers = {}) => json({ error: { message: `upstream echo ${KEY_A} at /srv/app/index.js:44` } }, status, headers);
const transportError = (code) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`connect ${KEY_A}`), { code }) });
/** A fetch that never settles and ignores its signal. */
const hang = () => new Promise(() => {});
/** A 200 whose body never finishes. */
const stalledBody = () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"choices":[{"message":{"audio":{"data":"SUQz')); } }), { status: 200, headers: { "content-type": "application/json" } });

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
const bodyOf = (call) => JSON.parse(call.init.body);
const expectNoLeak = (result) => {
  const text = JSON.stringify(result);
  expect(text).not.toContain(KEY_A);
  expect(text).not.toContain(KEY_B);
  expect(text).not.toContain(PASS);
  expect(text).not.toContain("upstream echo");
  expect(text).not.toContain("/srv/app");
};
const synth = (adapter, options = {}, model = "mimo-v2.5-tts", cred = CRED_A) => adapter.synthesize("Hello there.", model, cred, "mp3", options);

// ── Staging block: the only assertions about registration state ──────────
describe("Xiaomi MiMo tts staging state (promote at registration)", () => {
  it("is not registered: no TTS adapter, no ttsConfig, no tts kind or model row, no format handler", () => {
    for (const key of ["xiaomi-mimo", "mimo", "mimo-desktop", "xmd"]) expect(Object.hasOwn(TTS_ADAPTERS, key), key).toBe(false);
    expect(xiaomiRegistry.ttsConfig).toBeUndefined();
    expect(xiaomiRegistry.serviceKinds ?? []).not.toContain("tts");
    expect(xiaomiRegistry.models.some((m) => /-tts/.test(m.id))).toBe(false);
    expect(Object.hasOwn(FORMAT_HANDLERS, "xiaomi-mimo-tts")).toBe(false);
    expect(REGISTRATION.status).toBe("staged-unregistered");
  });

  it("xiaomi-tokenplan's tts model rows are dormant: the speech core refuses them without a network call", async () => {
    // A separate token-plan provider (tp- keys, regional hosts) whose tts rows have no adapter or ttsConfig.
    expect(tokenplanRegistry.models.filter((m) => m.kind === "tts").map((m) => m.id)).toEqual(["mimo-v2.5-tts", "mimo-v2.5-tts-voiceclone", "mimo-v2.5-tts-voicedesign"]);
    expect(tokenplanRegistry.ttsConfig).toBeUndefined();
    expect(Object.hasOwn(TTS_ADAPTERS, "xiaomi-tokenplan")).toBe(false);
    const fetchSpy = vi.fn(async () => { throw new Error("unexpected network call"); });
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const result = await handleTtsCore({ provider: "xiaomi-tokenplan", model: "mimo-v2.5-tts", input: "Hi", credentials: { apiKey: KEY_A } });
      expect(result).toMatchObject({ success: false, status: 400 });
      expect(JSON.stringify(result)).toContain("does not support TTS");
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Xiaomi MiMo staged metadata", () => {
  it("pins the exact source registry fields and models", () => {
    expect(REGISTRATION.source.commit).toBe("c71f0065a7efe9230ec23b96a12253b050c4d7ad");
    expect(REGISTRATION.source.registryFields.tts).toMatchObject({
      id: "xiaomi-mimo", baseUrl: SPEECH_URL, authType: "apikey", authHeader: "bearer", format: "xiaomi-mimo-tts", supportedFormats: ["mp3", "wav"],
    });
    const rows = [
      { id: "mimo-v2.5-tts", name: "MiMo V2.5 TTS" },
      { id: "mimo-v2.5-tts-voicedesign", name: "MiMo V2.5 Voice Design" },
      { id: "mimo-v2.5-tts-voiceclone", name: "MiMo V2.5 Voice Clone" },
    ];
    expect(REGISTRATION.source.registryFields.tts.models).toEqual(rows);
    expect(REGISTRATION.models.tts).toEqual(rows);
    expect(XIAOMI_MIMO_TTS_MODELS).toEqual(rows.map((r) => ({ ...r, kind: "tts" })));
  });

  it("stages a ttsConfig and additions that keep the existing provider identity and both auth modes", () => {
    expect(XIAOMI_MIMO_TTS_CONFIG).toMatchObject({ baseUrl: SPEECH_URL, authType: "apikey", authHeader: "bearer", format: "xiaomi-mimo-tts", supportedFormats: ["mp3", "wav"], defaultVoice: "mimo_default" });
    expect(XIAOMI_MIMO_TTS_PROVIDER_ADDITIONS).toMatchObject({ id: "xiaomi-mimo", aliases: ["mimo", "mimo-desktop", "xmd"], authModes: ["oauth", "apikey"], addServiceKinds: ["tts"] });
    // Identity must match the existing chat provider the speech half merges into.
    expect(xiaomiRegistry.id).toBe(XIAOMI_MIMO_TTS_PROVIDER_ADDITIONS.id);
    expect(xiaomiRegistry.aliases).toEqual([...XIAOMI_MIMO_TTS_PROVIDER_ADDITIONS.aliases]);
    expect(xiaomiRegistry.authModes).toEqual([...XIAOMI_MIMO_TTS_PROVIDER_ADDITIONS.authModes]);
    expect(REGISTRATION.provider).toMatchObject({ canonicalId: "xiaomi-mimo", aliases: ["mimo", "mimo-desktop", "xmd"], speechAuthModes: ["apikey"], connectionBaseUrlHonored: false });
  });

  it("exports every name registration.json lists", () => {
    for (const name of Object.keys(REGISTRATION.exports)) expect(staged[name], name).toBeDefined();
    expect(xiaomiMimoTtsAdapter.provider).toBe("xiaomi-mimo");
  });
});

describe("Xiaomi MiMo speech wire contract", () => {
  it("posts exactly the source body with the Bearer key and returns decoded mp3", async () => {
    const { fetchImpl, calls } = transport(speech(MP3, { usage: { prompt_tokens: 4, completion_tokens: 9 } }));
    const result = await synth(createXiaomiMimoTtsAdapter({ fetchImpl }), { voice: "default_zh" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(SPEECH_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("manual");
    expect(headersOf(calls[0])).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(bodyOf(calls[0])).toEqual({
      model: "mimo-v2.5-tts",
      messages: [{ role: "assistant", content: "Hello there." }],
      audio: { format: "mp3", voice: "default_zh" },
    });
    expect(result.format).toBe("mp3");
    expect(Buffer.from(result.base64, "base64").equals(MP3)).toBe(true);
    expect(result.accounting).toMatchObject({ modality: "tts", cost: null, costStatus: "unknown", tokens: { prompt_tokens: 4, completion_tokens: 9 }, meta: { model: "mimo-v2.5-tts", container: "mp3" } });
    expect(result.acceptedJob).toBeUndefined();
  });

  it("sends the audio.format enum, never an IANA media type, and maps wav aliases", async () => {
    const { fetchImpl, calls } = transport(speech(), speech(), speech(WAV), speech(WAV), speech());
    const adapter = createXiaomiMimoTtsAdapter({ fetchImpl });
    await synth(adapter);
    await synth(adapter, { response_format: "audio/mpeg" });
    const wav = await synth(adapter, { response_format: "WAV" });
    await synth(adapter, { requestedResponseFormat: "audio/wave" });
    await synth(adapter, { requestedResponseFormat: "json" });
    expect(calls.map((c) => bodyOf(c).audio.format)).toEqual(["mp3", "mp3", "wav", "wav", "mp3"]);
    expect(wav.format).toBe("wav");
    expect(Buffer.from(wav.base64, "base64").equals(WAV)).toBe(true);
    expect(normalizeXiaomiMimoRequestFormat(undefined)).toBe("mp3");
    expect(normalizeXiaomiMimoRequestFormat("opus")).toBeNull();
  });

  it("defaults the voice to the connection's defaultVoice, then mimo_default; empty model selects mimo-v2.5-tts", async () => {
    const { fetchImpl, calls } = transport(speech(), speech(MP3_FRAME), speech());
    const adapter = createXiaomiMimoTtsAdapter({ fetchImpl });
    await synth(adapter, {}, "mimo-v2.5-tts-voicedesign", { ...CRED_A, providerSpecificData: { defaultVoice: "default_en" } });
    await synth(adapter, { voice: "" }, "");
    await synth(adapter, { speed: 1 }, "mimo-v2.5-tts-voiceclone");
    expect(calls.map((c) => [bodyOf(c).model, bodyOf(c).audio.voice])).toEqual([
      ["mimo-v2.5-tts-voicedesign", "default_en"],
      ["mimo-v2.5-tts", "mimo_default"],
      ["mimo-v2.5-tts-voiceclone", "mimo_default"],
    ]);
  });

  it("passes through a raw audio/* answer after checking the container", async () => {
    const { fetchImpl } = transport(new Response(WAV, { status: 200, headers: { "content-type": "audio/wav" } }));
    const result = await synth(createXiaomiMimoTtsAdapter({ fetchImpl }), { response_format: "wav" });
    expect(result.format).toBe("wav");
    expect(Buffer.from(result.base64, "base64").equals(WAV)).toBe(true);
  });

  it.each([
    ["message.audio.b64_json", { choices: [{ message: { audio: { b64_json: "B64" } } }] }],
    ["audio.data", { audio: { data: "B64" } }],
    ["output_audio.b64_json", { output_audio: { b64_json: "B64" } }],
    ["data[0].b64_json", { data: [{ b64_json: "B64" }] }],
    ["data[0].audio", { data: [{ audio: "B64" }] }],
    ["audioContent", { audioContent: "B64" }],
    ["audio_content", { audio_content: "B64" }],
  ])("reads the source fallback path %s", async (_label, envelope) => {
    const b64 = MP3.toString("base64");
    const { fetchImpl } = transport(json(JSON.parse(JSON.stringify(envelope).replace("B64", b64))));
    const result = await synth(createXiaomiMimoTtsAdapter({ fetchImpl }));
    expect(Buffer.from(result.base64, "base64").equals(MP3)).toBe(true);
  });

  it("ignores a connection base URL override and forwards the connection egress policy", async () => {
    const { fetchImpl, calls } = transport(speech());
    const proxied = { ...CRED_A, baseUrl: "https://evil.invalid", providerSpecificData: { baseUrl: "https://evil.invalid/v1", connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.invalid:8080" } };
    await synth(createXiaomiMimoTtsAdapter({ fetchImpl }), {}, "mimo-v2.5-tts", proxied);
    expect(calls[0].url).toBe(SPEECH_URL);
    expect(calls[0].proxyOptions).toBeTypeOf("object");
  });

  it("keeps each selected connection's key on its own request", async () => {
    const { fetchImpl, calls } = transport(speech(), speech());
    const adapter = createXiaomiMimoTtsAdapter({ fetchImpl });
    await synth(adapter, {}, "mimo-v2.5-tts", CRED_A);
    await synth(adapter, {}, "mimo-v2.5-tts", CRED_B);
    expect(headersOf(calls[0]).Authorization).toBe(`Bearer ${KEY_A}`);
    expect(headersOf(calls[1]).Authorization).toBe(`Bearer ${KEY_B}`);
  });

  it("refuses an account-session connection without an API key and never sends its tokens", async () => {
    const { fetchImpl } = transport();
    const session = { accessToken: KEY_B, providerSpecificData: { mimoPassToken: PASS } };
    const result = await synth(createXiaomiMimoTtsAdapter({ fetchImpl }), {}, "mimo-v2.5-tts", session);
    expect(result).toMatchObject({ success: false, status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
    expectNoLeak(result);
  });

  it("uses only the apiKey of a dual-mode connection that also has a session", async () => {
    const { fetchImpl, calls } = transport(speech());
    await synth(createXiaomiMimoTtsAdapter({ fetchImpl }), {}, "mimo-v2.5-tts", { apiKey: KEY_A, accessToken: KEY_B, providerSpecificData: { mimoPassToken: PASS } });
    expect(headersOf(calls[0])).toEqual({ "Content-Type": "application/json", Authorization: `Bearer ${KEY_A}` });
    expect(calls[0].init.body).not.toContain(PASS);
  });

  it.each([
    ["an opus container", "mimo-v2.5-tts", { response_format: "opus" }],
    ["a query-string ogg container", "mimo-v2.5-tts", { requestedResponseFormat: "ogg" }],
    ["a non-string container", "mimo-v2.5-tts", { response_format: 3 }],
    ["sse streaming", "mimo-v2.5-tts", { stream_format: "sse" }],
    ["stream: true", "mimo-v2.5-tts", { stream: true }],
    ["an unknown model", "tts-1", {}],
    ["a chat model", "mimo-v2.5-pro", {}],
    ["an ASR model", "mimo-v2.5-asr", {}],
    ["a model/voice suffix", "mimo-v2.5-tts/default_zh", {}],
    ["a non-string voice", "mimo-v2.5-tts", { voice: 3 }],
    ["a speed other than 1", "mimo-v2.5-tts", { speed: 1.5 }],
    ["instructions", "mimo-v2.5-tts", { instructions: "whisper" }],
    ["a language hint", "mimo-v2.5-tts", { language: "fr" }],
  ])("refuses %s before submit", async (_label, model, options) => {
    const { fetchImpl } = transport();
    const result = await synth(createXiaomiMimoTtsAdapter({ fetchImpl }), options, model);
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(result.acceptedJob).toBeUndefined();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the source message for an unsupported format", async () => {
    const result = await synth(createXiaomiMimoTtsAdapter({ fetchImpl: transport().fetchImpl }), { response_format: "flac" });
    expect(result).toMatchObject({ success: false, status: 400, local: true });
    expect(JSON.stringify(result)).toContain("Xiaomi MiMo TTS supports response_format mp3 or wav only");
  });

  it("refuses empty input, an oversized request and a missing or unsafe key before submit", async () => {
    const { fetchImpl } = transport();
    const adapter = createXiaomiMimoTtsAdapter({ fetchImpl });
    expect(() => buildXiaomiMimoSpeechRequest("mimo-v2.5-tts", "x".repeat(300 * 1024))).toThrow(/too large/);
    expect(await adapter.synthesize("  ", "mimo-v2.5-tts", CRED_A, "mp3", {})).toMatchObject({ success: false, status: 400, local: true });
    expect(await synth(adapter, {}, "mimo-v2.5-tts", { apiKey: "" })).toMatchObject({ success: false, status: 401 });
    expect(await synth(adapter, {}, "mimo-v2.5-tts", { apiKey: "a\r\nX-Evil: 1" })).toMatchObject({ success: false, status: 401 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Xiaomi MiMo speech failures", () => {
  it.each([[401, 401], [403, 403], [400, 400], [404, 404], [422, 422]])(
    "maps HTTP %i to %i without quoting Xiaomi or accepting a job",
    async (status, expected) => {
      const { fetchImpl } = transport(leaky(status));
      const result = await synth(createXiaomiMimoTtsAdapter({ fetchImpl }));
      expect(result).toMatchObject({ success: false, status: expected });
      expect(result.acceptedJob).toBeUndefined();
      expectNoLeak(result);
    },
  );

  it("marks 402 as quota exhausted on this connection only", async () => {
    const { fetchImpl } = transport(leaky(402));
    const result = await synth(createXiaomiMimoTtsAdapter({ fetchImpl }));
    expect(result).toMatchObject({ success: false, status: 402, quotaExhausted: true });
    expectNoLeak(result);
  });

  it("keeps a bounded Retry-After on 429 and 503", async () => {
    const { fetchImpl } = transport(leaky(429, { "retry-after": "7" }), leaky(503, { "retry-after": "3" }));
    const adapter = createXiaomiMimoTtsAdapter({ fetchImpl });
    const limited = await synth(adapter);
    const unavailable = await synth(adapter);
    expect(limited).toMatchObject({ success: false, status: 429 });
    expect(limited.resetsAtMs).toBeGreaterThan(Date.now());
    expect(unavailable).toMatchObject({ success: false, status: 503 });
    expect(limited.acceptedJob).toBeUndefined();
    expect(unavailable.acceptedJob).toEqual({ state: "complete", tokens: {}, nativeUnits: {}, modality: "tts", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
    expectNoLeak(limited);
  });

  it("treats other 5xx as an uncertain, never-replayed job with unknown cost", async () => {
    const { fetchImpl, calls } = transport(leaky(500));
    const result = await synth(createXiaomiMimoTtsAdapter({ fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toMatchObject({ modality: "tts", cost: null, costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "submit-unknown" } });
    expectNoLeak(result);
  });

  it("refuses a redirect without following it or resending the key", async () => {
    const redirect = new Response(null, { status: 307, headers: { location: "https://evil.invalid/steal" } });
    const { fetchImpl, calls } = transport(redirect);
    const result = await synth(createXiaomiMimoTtsAdapter({ fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeDefined();
  });

  it("distinguishes a provably unsent connect failure from a failure after send", async () => {
    const { fetchImpl, calls } = transport(transportError("ENOTFOUND"), transportError("ECONNRESET"));
    const adapter = createXiaomiMimoTtsAdapter({ fetchImpl });
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
    const result = await synth(createXiaomiMimoTtsAdapter({ fetchImpl }), { signal: controller.signal });
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
    const result = await synth(createXiaomiMimoTtsAdapter({ fetchImpl }), { signal: controller.signal });
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
    const result = await synth(createXiaomiMimoTtsAdapter({ fetchImpl, timeoutMs: 20 }));
    expect(calls).toHaveLength(1);
    expect(seenSignal.aborted).toBe(true);
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob).toBeDefined();
  });

  it("bounds a stalled JSON body by the same deadline", async () => {
    const { fetchImpl } = transport(stalledBody());
    const result = await synth(createXiaomiMimoTtsAdapter({ fetchImpl, timeoutMs: 30 }));
    expect(result).toMatchObject({ success: false, status: 504 });
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });

  it("records a caller abort during the body read as accepted work", async () => {
    const controller = new AbortController();
    const { fetchImpl } = transport(() => {
      setTimeout(() => controller.abort(), 5);
      return stalledBody();
    });
    const result = await synth(createXiaomiMimoTtsAdapter({ fetchImpl }), { signal: controller.signal });
    expect(result).toMatchObject({ success: false, status: 499 });
    expect(result.acceptedJob.meta.jobState).toBe("accepted");
  });
});

describe("Xiaomi MiMo speech malformed or unsafe answers", () => {
  it("reads a 200 error envelope as a refusal without quoting it", async () => {
    const { fetchImpl } = transport(leaky(200));
    const result = await synth(createXiaomiMimoTtsAdapter({ fetchImpl }));
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toBeUndefined();
    expectNoLeak(result);
  });

  it.each([
    ["a chat answer without audio", () => json({ choices: [{ message: { content: "hi" } }] })],
    ["a non-string audio field", () => json({ choices: [{ message: { audio: { data: 42 } } }] })],
    ["non-base64 audio", () => json({ choices: [{ message: { audio: { data: "not base64!!" } } }] })],
    ["a data URL instead of base64", () => json({ choices: [{ message: { audio: { data: `data:audio/mpeg;base64,${MP3.toString("base64")}` } } }] })],
    ["WAV bytes for an mp3 request", () => speech(WAV)],
    ["a JSON array", () => json([MP3.toString("base64")])],
    ["invalid JSON", () => new Response(`{"audio": ${KEY_A}`, { status: 200, headers: { "content-type": "application/json" } })],
    ["HTML", () => new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } })],
    ["a raw audio body of the wrong container", () => new Response(WAV, { status: 200, headers: { "content-type": "audio/mpeg" } })],
    ["an empty raw audio body", () => new Response(new Uint8Array(0), { status: 200, headers: { "content-type": "audio/mpeg" } })],
  ])("treats %s as a lost result of billable work", async (_label, answer) => {
    const { fetchImpl, calls } = transport(answer());
    const result = await synth(createXiaomiMimoTtsAdapter({ fetchImpl }));
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({ success: false, status: 502 });
    expect(result.acceptedJob).toMatchObject({ costStatus: "unknown", costSource: "accepted-job", meta: { jobState: "accepted" } });
    expectNoLeak(result);
  });

  it("caps the envelope, a raw body and the decoded audio size", async () => {
    const big = Buffer.concat([MP3, Buffer.alloc(4096)]);
    const { fetchImpl } = transport(speech(big), new Response(big, { status: 200, headers: { "content-type": "audio/mpeg" } }));
    const adapter = createXiaomiMimoTtsAdapter({ fetchImpl, maxAudioBytes: 512 });
    const enveloped = await synth(adapter);
    const raw = await synth(adapter);
    expect(enveloped).toMatchObject({ success: false, status: 502 });
    expect(raw).toMatchObject({ success: false, status: 502 });
    expect(enveloped.acceptedJob).toBeDefined();
    expect(raw.acceptedJob).toBeDefined();
  });

  it("does not read usage cost fields as a priced receipt; keeps only token counts", async () => {
    const { fetchImpl } = transport(speech(MP3, { usage: { cost_usd: 99, cost: 1, prompt_tokens: 3 } }));
    const result = await synth(createXiaomiMimoTtsAdapter({ fetchImpl }));
    expect(result.accounting).toMatchObject({ cost: null, costStatus: "unknown", tokens: { prompt_tokens: 3 } });
    expect(JSON.stringify(result.accounting)).not.toContain("cost_usd");
  });
});

describe("Xiaomi MiMo speech model discovery", () => {
  const catalog = () => json({ object: "list", data: [
    { id: "mimo-v2.5-pro" }, { id: "mimo-v2.6-flash" }, { id: "mimo-v2.5-asr" },
    { id: "mimo-v2.5-tts" }, { id: "mimo-v2.5-tts-voiceclone" }, { id: "mimo-v2.5-tts-voicedesign" }, { id: "mimo-v2.6-tts" }, { id: "mimo-v2.5-tts" },
  ] });

  it("fetches the live catalog with the selected key and keeps only speech models", async () => {
    const { fetchImpl, calls } = transport(catalog());
    const result = await discoverXiaomiMimoTtsModels(CRED_B, { fetchImpl });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(MODELS_URL);
    expect(calls[0].init).toMatchObject({ method: "GET", redirect: "manual" });
    expect(headersOf(calls[0])).toEqual({ Authorization: `Bearer ${KEY_B}` });
    expect(result.source).toBe("api");
    expect(result.models.map((m) => m.id)).toEqual(["mimo-v2.5-tts", "mimo-v2.5-tts-voiceclone", "mimo-v2.5-tts-voicedesign", "mimo-v2.6-tts"]);
    expect(result.models.at(-1)).toEqual({ id: "mimo-v2.6-tts", name: "mimo-v2.6-tts", kind: "tts" });
  });

  it("accepts a discovered newer speech model for synthesis", async () => {
    const { fetchImpl, calls } = transport(speech());
    await synth(createXiaomiMimoTtsAdapter({ fetchImpl }), {}, "mimo-v2.6-tts");
    expect(bodyOf(calls[0]).model).toBe("mimo-v2.6-tts");
  });

  it.each([
    ["a 401", () => leaky(401), 401],
    ["a redirect", () => new Response(null, { status: 302, headers: { location: "https://evil.invalid" } }), 502],
    ["invalid JSON", () => new Response("<html>", { status: 200, headers: { "content-type": "application/json" } }), 502],
    ["a transport error", () => transportError("ECONNRESET"), 502],
  ])("falls back to the static rows on %s without upstream text", async (_label, answer, status) => {
    const { fetchImpl, calls } = transport(answer());
    const result = await discoverXiaomiMimoTtsModels(CRED_A, { fetchImpl });
    expect(calls).toHaveLength(1);
    expect(result).toEqual({ models: [...XIAOMI_MIMO_TTS_MODELS], source: "local_catalog", status });
    expectNoLeak(result);
  });

  it("falls back at the deadline and without a key never calls out", async () => {
    let seenSignal;
    const { fetchImpl } = transport((_url, init) => {
      seenSignal = init.signal;
      return hang();
    });
    const timed = await discoverXiaomiMimoTtsModels(CRED_A, { fetchImpl, timeoutMs: 20 });
    expect(seenSignal.aborted).toBe(true);
    expect(timed.source).toBe("local_catalog");
    const none = transport();
    expect(await discoverXiaomiMimoTtsModels({ accessToken: KEY_B }, { fetchImpl: none.fetchImpl })).toMatchObject({ source: "local_catalog", status: 401 });
    expect(none.fetchImpl).not.toHaveBeenCalled();
  });
});

describe("Xiaomi MiMo speech through handleTtsCore (test-local wiring)", () => {
  // Wires the adapter into TTS_ADAPTERS only for the duration of this test to
  // check the core contract (usage merge, json wrapper, binary body); the
  // registration state itself is asserted only in the staging block above.
  it("returns audio bytes with character usage, or the json wrapper, and keeps refusals local", async () => {
    const { fetchImpl } = transport(speech(WAV), speech());
    const adapter = createXiaomiMimoTtsAdapter({ fetchImpl });
    const key = "xiaomi-mimo-test-wiring";
    TTS_ADAPTERS[key] = { adapter };
    try {
      const binary = await handleTtsCore({ provider: key, model: "mimo-v2.5-tts", input: " Hé llo ", credentials: CRED_A, responseFormat: "wav", response_format: "wav" });
      expect(binary.success).toBe(true);
      expect(binary.response.headers.get("content-type")).toBe("audio/wav");
      expect(Buffer.from(await binary.response.arrayBuffer()).equals(WAV)).toBe(true);
      expect(binary.accounting).toMatchObject({ costStatus: "unknown", nativeUnits: { characters: 6 } });

      const wrapped = await handleTtsCore({ provider: key, model: "mimo-v2.5-tts", input: "Hi", credentials: CRED_A, responseFormat: "json", requestedResponseFormat: "json" });
      expect(await wrapped.response.json()).toEqual({ audio: MP3.toString("base64"), format: "mp3" });

      const refused = await handleTtsCore({ provider: key, model: "mimo-v2.5-tts", input: "Hi", credentials: CRED_A, speed: 2 });
      expect(refused).toMatchObject({ success: false, status: 400, local: true });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      delete TTS_ADAPTERS[key];
    }
  });
});
